#!/usr/bin/env python3
"""
FastAPI 后端 - MsgHub 多 Agent RPG 系统
每个 Agent 独立配置模型和 API
"""
import os
import sys
import asyncio
import traceback
from contextlib import asynccontextmanager
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import subprocess
import argparse
import json

# 添加项目路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Agent 系统
from agentscope.message import Msg
from agentscope.pipeline import MsgHub
from api.agents_api import router as agents_router
from api.providers_api import router as providers_router
from api.tools_api import router as tools_router
from api.manager_api import router as manager_router
from api.skills_api import router as skills_router
from api.game_config_api import router as game_config_router
from api.html_preview_api import router as html_preview_router
from api.conversations_api import router as conversations_router
from skills import skill_registry

# ============== 游戏配置路径 ==============
GAME_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "rpg-frontend", "public", "assets", "game-config.json"
)

# ============== Per-user Session 管理 ==============
from api.session_manager import session_manager, UserSession
from auth.user_data import get_user_data

# ============== 命令行参数 ==============
parser = argparse.ArgumentParser(description="RPG Chat API Server")
parser.add_argument(
    "--dev",
    action="store_true",
    help="开发模式：不构建前端，仅提供 API 服务"
)
parser.add_argument(
    "--build",
    action="store_true",
    help="构建前端后启动（生产模式）"
)
args = parser.parse_args()

# 默认生产模式（构建前端）
DEV_MODE = args.dev
BUILD_FRONTEND = args.build or not args.dev

# ============== 数据模型 ==============

class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None


class ReinitializeRequest(BaseModel):
    conversation_id: Optional[str] = None


class AgentResponse(BaseModel):
    agent_name: str
    agent_role: str
    content: str


class ChatResponse(BaseModel):
    responses: List[AgentResponse]


class AgentInfo(BaseModel):
    id: str
    name: str
    role: str
    personality: str
    avatar_type: str


class AgentListResponse(BaseModel):
    agents: List[AgentInfo]


class StreamChunk(BaseModel):
    """流式响应数据块"""
    type: str  # start, agent_start, chunk, done, agent_done, all_done, error
    agent_name: Optional[str] = None
    agent_role: Optional[str] = None
    content: Optional[str] = None
    index: Optional[int] = None
    message: Optional[str] = None


# ============== 前端构建 ==============

def build_frontend():
    """构建前端静态文件"""
    frontend_dir = os.path.join(os.path.dirname(__file__), "..", "rpg-frontend")
    dist_dir = os.path.join(frontend_dir, "dist")

    # 如果已经构建过，跳过
    if os.path.exists(dist_dir) and os.path.exists(os.path.join(dist_dir, "index.html")):
        print("📦 前端已构建，跳过构建步骤")
        return dist_dir

    # 检查是否有 node_modules
    if not os.path.exists(os.path.join(frontend_dir, "node_modules")):
        print("📦 安装前端依赖...")
        try:
            subprocess.run(
                ["npm", "install"],
                cwd=frontend_dir,
                check=True,
                capture_output=True,
            )
        except subprocess.CalledProcessError as e:
            print(f"⚠️ 前端依赖安装失败: {e}")
            return None
        except FileNotFoundError:
            print("⚠️ 未找到 npm，请安装 Node.js")
            return None

    print("🔨 构建前端...")
    try:
        subprocess.run(
            ["npm", "run", "build"],
            cwd=frontend_dir,
            check=True,
            capture_output=True,
        )
        print("✅ 前端构建完成")
        return dist_dir
    except subprocess.CalledProcessError as e:
        print(f"⚠️ 前端构建失败: {e}")
        return None


# ============== 生命周期管理 ==============

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    print("🚀 多 Agent 系统就绪（per-user session 模式，按需初始化）")

    # 仅在非开发模式下构建前端
    if BUILD_FRONTEND:
        dist_dir = build_frontend()
        if dist_dir:
            print(f"📦 前端资源路径: {dist_dir}")
            setup_static_files()
    else:
        print("🔧 开发模式：不构建前端，仅提供 API 服务")
        print("   请运行: cd rpg-frontend && npm run dev")

    yield

    # 关闭时清理
    print("🛑 正在关闭系统...")


def _get_scene_description(session: UserSession) -> str:
    """读取当前场景描述（优先从用户配置文件读取，回退到公共配置）。

    只在场景切换或描述内容变化时返回描述，避免同一场景下重复注入。
    """
    try:
        # 优先从用户配置文件读取当前场景
        user_data = get_user_data(session.user_id)
        user_config_path = user_data.game_config_file
        config = None
        if os.path.exists(user_config_path):
            with open(user_config_path, "r", encoding="utf-8") as f:
                user_config = json.load(f)
            current_scene_key = user_config.get("currentScene", "")
            scenes = user_config.get("scenes", {})
            scene = scenes.get(current_scene_key, {})
            desc = scene.get("description", "")
            if desc:
                # 场景未变化且描述未变化，不需要重新注入
                if current_scene_key == session.last_scene_key and desc == session.last_scene_desc:
                    return ""
                session.last_scene_key = current_scene_key
                session.last_scene_desc = desc
                return desc

        # 回退到公共配置
        if not os.path.exists(GAME_CONFIG_PATH):
            session.last_scene_key = None
            session.last_scene_desc = None
            return ""
        with open(GAME_CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
        current_scene_key = config.get("currentScene", "")
        scenes = config.get("scenes", {})
        scene = scenes.get(current_scene_key, {})
        desc = scene.get("description", "")

        # 场景未变化且描述未变化，不需要重新注入
        if current_scene_key == session.last_scene_key and desc == session.last_scene_desc:
            return ""

        # 更新记录并返回新描述
        session.last_scene_key = current_scene_key
        session.last_scene_desc = desc
        return desc
    except Exception as e:
        print(f"⚠️ 读取场景描述失败: {e}")
        return ""


def _wrap_message_with_scene(message: str, session: UserSession) -> str:
    """将用户消息包装上场景描述前缀。只在场景变化时注入一次。"""
    scene_desc = _get_scene_description(session)
    if not scene_desc:
        return message
    return f"【场景背景】{scene_desc}\n\n{message}"


async def _get_user_session(request: Request, conversation_id: Optional[str] = None) -> UserSession:
    """从请求中获取当前用户的 session（按需初始化）"""
    from auth.dependencies import get_current_user

    user = await get_current_user(request)
    user_id = user["id"]
    session = session_manager.get_session(user_id)

    if not session.initialized or session.active_conversation_id != conversation_id:
        await session_manager.init_user_session(user_id, conversation_id)

    return session


# ============== FastAPI 应用 ==============

app = FastAPI(
    title="RPG Chat API",
    description="MsgHub 多 Agent RPG 系统 API - 每个 Agent 独立配置",
    version="0.3.0",
    lifespan=lifespan,
)

# CORS 配置
ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"] if BUILD_FRONTEND else ["*"]
if DEV_MODE:
    ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 添加 Agent 配置路由
app.include_router(agents_router)

# 添加 Provider 配置路由
app.include_router(providers_router)

# 添加工具管理路由
app.include_router(tools_router)

# 添加 Manager 配置路由
app.include_router(manager_router)

# 添加 Skill 管理路由
app.include_router(skills_router)

# 添加游戏配置路由
app.include_router(game_config_router)

# 添加 HTML 预览路由
app.include_router(html_preview_router)

# 添加历史会话路由
app.include_router(conversations_router)

# 添加认证路由
from auth.router import router as auth_router
app.include_router(auth_router)

# 挂载平台子应用（作品发布与广场）
from plaza_platform.server import platform_app
app.mount("/platform", platform_app)


# ============== API 端点 ==============

@app.get("/api/agents", response_model=AgentListResponse)
async def list_agents(request: Request):
    """获取当前用户启用的 Agent 信息（包含 Manager）"""
    from auth.dependencies import get_current_user
    from auth.user_managers import get_user_agents_manager, get_user_manager_config

    # 获取当前用户
    try:
        user = await get_current_user(request)
    except Exception:
        return AgentListResponse(agents=[])

    # 获取用户专属的配置管理器
    user_agents_mgr = get_user_agents_manager(user["id"])
    user_manager_mgr = get_user_manager_config(user["id"])

    # 获取 Worker Agents
    worker_agents = user_agents_mgr.get_active_agents()

    # 获取 Manager 配置
    manager_config = user_manager_mgr.get_config()

    result_agents = []

    # 如果 Manager 已启用，添加到列表
    if manager_config.is_active and manager_config.provider_id:
        result_agents.append(AgentInfo(
            id="manager_default",
            name=manager_config.name,
            role=manager_config.role,
            personality=manager_config.personality,
            avatar_type=manager_config.avatar_type
        ))

    # 添加 Worker Agents
    for a in worker_agents:
        result_agents.append(AgentInfo(
            id=a.id,
            name=a.name,
            role=a.role,
            personality=a.personality,
            avatar_type=a.avatar_type
        ))

    return AgentListResponse(agents=result_agents)


@app.post("/api/system/reinitialize")
async def reinitialize(request: Request, body: Optional[ReinitializeRequest] = None):
    """重新初始化当前用户的 Agent 会话"""
    from auth.dependencies import get_current_user

    try:
        user = await get_current_user(request)
    except Exception:
        raise HTTPException(status_code=401, detail="未登录")

    user_id = user["id"]
    conversation_id = body.conversation_id if body else None
    try:
        print(f"🔄 Reinitializing session for user={user_id}...")
        session = await session_manager.reinitialize_user_session(user_id, conversation_id)
        agent_count = len(session.agents)
        print(f"✅ Session reinitialized: user={user_id}, agents={agent_count}")

        return {
            "success": True,
            "message": "系统已重新初始化",
            "agent_count": agent_count,
        }
    except Exception as e:
        print(f"❌ Reinitialization failed for user={user_id}: {e}")
        raise HTTPException(status_code=500, detail=f"重新初始化失败: {str(e)}")


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: Request, chat_request: ChatRequest):
    """聊天接口 - 支持 Manager-Worker 和 MsgHub 两种模式（per-user session）"""
    try:
        session = await _get_user_session(request, chat_request.conversation_id)
    except Exception:
        raise HTTPException(status_code=401, detail="未登录，无法使用聊天功能")

    if not session.initialized:
        raise HTTPException(status_code=503, detail="用户会话未初始化")

    try:
        if session.use_manager_mode and session.manager:
            return await _chat_with_manager(chat_request, session)
        else:
            return await _chat_with_msghub(chat_request, session)
    except HTTPException:
        raise
    except Exception as e:
        error_detail = f"对话失败: {str(e)}\n\n详细错误:\n{traceback.format_exc()}"
        print(error_detail)
        raise HTTPException(status_code=500, detail=error_detail)


async def _chat_with_manager(chat_request: ChatRequest, session: UserSession) -> ChatResponse:
    """使用 Manager-Worker 模式处理对话"""
    manager = session.manager

    # 注入场景描述到用户消息中
    wrapped_message = _wrap_message_with_scene(chat_request.message, session)
    user_msg = Msg(name="User", content=wrapped_message, role="user")
    print(f"\n👤 [UserMsg → Manager] user={session.user_id} {wrapped_message[:500]}...")

    # Manager 分析任务并分派给 Workers
    response = await manager.reply(user_msg)

    # 提取响应内容
    content = response.content
    if isinstance(content, list):
        texts = []
        for item in content:
            if isinstance(item, dict) and "text" in item:
                texts.append(item["text"])
            elif isinstance(item, str):
                texts.append(item)
        answer = "\n".join(texts)
    elif isinstance(content, dict):
        answer = content.get("text", str(content))
    else:
        answer = str(content)

    # 获取任务执行详情（如果有）
    task_details = []
    if manager._task_history:
        latest_task = manager._task_history[-1]
        if latest_task.status == "completed":
            for step in latest_task.steps:
                result = latest_task.results.get(step["step_id"], {})
                if result.get("status") == "completed":
                    task_details.append(AgentResponse(
                        agent_name=step.get("agent_name", "Unknown"),
                        agent_role=f"执行: {step.get('task', '')[:20]}...",
                        content=str(result.get("result", ""))[:200]
                    ))

    responses = [
        AgentResponse(
            agent_name=manager.name,
            agent_role=manager.role,
            content=answer,
        )
    ]

    # 添加任务执行详情
    responses.extend(task_details)

    return ChatResponse(responses=responses)


async def _chat_with_msghub(chat_request: ChatRequest, session: UserSession) -> ChatResponse:
    """使用传统 MsgHub 模式处理对话"""
    agents = session.agents
    if not agents:
        raise HTTPException(status_code=400, detail="未配置任何可用的 Agent")

    responses = []

    async with MsgHub(participants=agents, enable_auto_broadcast=True):
        # 让第一个 Agent 主导对话
        primary_agent = agents[0]
        # 注入场景描述到用户消息中
        wrapped_message = _wrap_message_with_scene(chat_request.message, session)
        user_msg = Msg(name="User", content=wrapped_message, role="user")
        print(f"\n👤 [UserMsg → {primary_agent.name}] user={session.user_id} {wrapped_message[:500]}...")
        response = await primary_agent(user_msg)

        # 提取响应内容
        content = response.content
        if isinstance(content, list):
            texts = []
            for item in content:
                if isinstance(item, dict) and "text" in item:
                    texts.append(item["text"])
                elif isinstance(item, str):
                    texts.append(item)
            answer = "\n".join(texts)
        elif isinstance(content, dict):
            answer = content.get("text", str(content))
        else:
            answer = str(content)

        responses.append(AgentResponse(
            agent_name=primary_agent.name,
            agent_role=primary_agent.role,
            content=answer,
        ))

        # 其他 Agent 也参与对话
        for agent in agents[1:]:
            agent_msg = Msg(name="User", content=chat_request.message, role="user")
            agent_response = await agent(agent_msg)

            content = agent_response.content
            if isinstance(content, list):
                texts = []
                for item in content:
                    if isinstance(item, dict) and "text" in item:
                        texts.append(item["text"])
                    elif isinstance(item, str):
                        texts.append(item)
                answer = "\n".join(texts)
            elif isinstance(content, dict):
                answer = content.get("text", str(content))
            else:
                answer = str(content)

            responses.append(AgentResponse(
                agent_name=agent.name,
                agent_role=agent.role,
                content=answer,
            ))

    return ChatResponse(responses=responses)


@app.post("/api/chat/stream")
async def chat_stream(request: Request, chat_request: ChatRequest):
    """流式聊天接口 - 使用 Server-Sent Events（per-user session）"""
    try:
        session = await _get_user_session(request, chat_request.conversation_id)
    except Exception:
        raise HTTPException(status_code=401, detail="未登录，无法使用聊天功能")

    if not session.initialized:
        raise HTTPException(status_code=503, detail="用户会话未初始化")

    async def generate_stream():
        """生成流式响应"""
        try:
            if session.use_manager_mode and session.manager:
                # Manager-Worker 模式流式输出 - 展示中间过程
                manager = session.manager
                # 注入场景描述到用户消息中
                wrapped_message = _wrap_message_with_scene(chat_request.message, session)
                user_msg = Msg(name="User", content=wrapped_message, role="user")
                print(f"\n👤 [UserMsg → Manager] user={session.user_id} {wrapped_message[:500]}...")

                event_queue = asyncio.Queue()

                def on_manager_event(event):
                    event_queue.put_nowait(("event", event))

                # 临时设置事件回调
                manager._event_callback = on_manager_event

                async def run_manager():
                    """后台运行 Manager 任务"""
                    try:
                        response = await manager.reply(user_msg)
                        # 提取文本内容
                        content = response.content
                        if isinstance(content, list):
                            texts = [item.get("text", "") if isinstance(item, dict) else str(item) for item in content]
                            answer = "\n".join(texts)
                        elif isinstance(content, dict):
                            answer = content.get("text", str(content))
                        else:
                            answer = str(content)
                        await event_queue.put(("final", answer))
                    except Exception as e:
                        await event_queue.put(("error", str(e)))
                    finally:
                        await event_queue.put(("done", None))

                # 启动后台任务
                asyncio.create_task(run_manager())

                # 主循环：从队列取事件并 yield
                final_answer = ""
                while True:
                    kind, data = await event_queue.get()

                    if kind == "done":
                        break

                    elif kind == "event":
                        event_type = data.get("type")

                        if event_type == "worker_start":
                            agent_name = data.get("agent_name", "Worker")
                            task_desc = data.get("task", "")
                            yield f"data: {json.dumps({'type': 'agent_start', 'agent_name': agent_name, 'agent_role': task_desc[:40], 'index': 1})}\n\n"

                        elif event_type == "worker_done":
                            agent_name = data.get("agent_name", "Worker")
                            result = data.get("result", "")
                            if result:
                                yield f"data: {json.dumps({'type': 'chunk', 'content': result, 'agent_name': agent_name, 'index': 1})}\n\n"
                            yield f"data: {json.dumps({'type': 'agent_done', 'agent_name': agent_name, 'index': 1})}\n\n"
                            await asyncio.sleep(0.2)

                        elif event_type == "manager_integrating":
                            # Manager 开始整合，发送开始事件
                            yield f"data: {json.dumps({'type': 'start', 'agent_name': manager.name, 'agent_role': manager.role, 'index': 0})}\n\n"

                    elif kind == "final":
                        final_answer = data
                        # 模拟流式输出最终答案
                        chunk_size = 10
                        for i in range(0, len(final_answer), chunk_size):
                            chunk = final_answer[i:i + chunk_size]
                            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk, 'agent_name': manager.name, 'index': 0})}\n\n"
                            await asyncio.sleep(0.05)

                        yield f"data: {json.dumps({'type': 'done', 'agent_name': manager.name, 'index': 0})}\n\n"
                        yield f"data: {json.dumps({'type': 'all_done'})}\n\n"

                    elif kind == "error":
                        yield f"data: {json.dumps({'type': 'error', 'message': data})}\n\n"

                # 清除回调
                manager._event_callback = None

            else:
                # MsgHub 模式 - 支持多 Agent 流式输出
                agents = session.agents
                if not agents:
                    yield f"data: {json.dumps({'type': 'error', 'message': '未配置任何可用的 Agent'})}\n\n"
                    return

                async with MsgHub(participants=agents, enable_auto_broadcast=True):
                    for idx, agent in enumerate(agents):
                        # 注入场景描述到用户消息中
                        wrapped_message = _wrap_message_with_scene(chat_request.message, session)
                        user_msg = Msg(name="User", content=wrapped_message, role="user")
                        print(f"\n👤 [UserMsg → {agent.name}] user={session.user_id} {wrapped_message[:500]}...")

                        # 发送 Agent 开始事件
                        yield f"data: {json.dumps({'type': 'agent_start', 'agent_name': agent.name, 'agent_role': agent.role, 'index': idx})}\n\n"

                        # 获取响应
                        response = await agent(user_msg)
                        content = response.content
                        if isinstance(content, list):
                            texts = [item.get("text", "") if isinstance(item, dict) else str(item) for item in content]
                            answer = "\n".join(texts)
                        elif isinstance(content, dict):
                            answer = content.get("text", str(content))
                        else:
                            answer = str(content)

                        # 流式输出内容
                        chunk_size = 8
                        for i in range(0, len(answer), chunk_size):
                            chunk = answer[i:i + chunk_size]
                            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk, 'agent_name': agent.name, 'index': idx})}\n\n"
                            await asyncio.sleep(0.03)

                        # 发送 Agent 完成事件
                        yield f"data: {json.dumps({'type': 'agent_done', 'agent_name': agent.name, 'index': idx})}\n\n"

                        # Agent 之间的延迟
                        if idx < len(agents) - 1:
                            await asyncio.sleep(0.5)

                # 发送全部完成事件
                yield f"data: {json.dumps({'type': 'all_done'})}\n\n"

        except Exception as e:
            error_msg = f"流式输出错误: {str(e)}"
            print(f"❌ {error_msg}")
            yield f"data: {json.dumps({'type': 'error', 'message': error_msg})}\n\n"

    return StreamingResponse(
        generate_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@app.get("/api/health")
async def health_check():
    """健康检查"""
    return {
        "status": "healthy",
        "active_sessions": session_manager.active_count,
        "mode": "per-user-session",
    }


# ============== 静态文件服务 ==============

def setup_static_files():
    """配置静态文件服务"""
    dist_dir = os.path.join(os.path.dirname(__file__), "..", "rpg-frontend", "dist")

    if os.path.exists(dist_dir):
        app.mount("/assets", StaticFiles(directory=os.path.join(dist_dir, "assets")), name="assets")

        @app.api_route("/", methods=["GET", "HEAD"])
        async def serve_index():
            return FileResponse(os.path.join(dist_dir, "index.html"))

        @app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
        async def serve_spa(full_path: str):
            if full_path.startswith("api/") or full_path.startswith("preview/"):
                raise HTTPException(status_code=404, detail="Not Found")

            index_file = os.path.join(dist_dir, "index.html")
            if os.path.exists(index_file):
                return FileResponse(index_file)
            raise HTTPException(status_code=404, detail="Frontend not built")

        print(f"📦 静态文件服务已配置: {dist_dir}")
    else:
        print("⚠️ 前端未构建，运行开发模式")


# ============== 主入口 ==============

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "api.api_server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
