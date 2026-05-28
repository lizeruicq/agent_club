"""
Per-user Session Manager (Phase 3)
每个用户拥有独立的 Agent 运行时会话，互不干扰。
"""
import asyncio
import time
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

from agents import ChatAgent, ManagerAgent, WorkerAgent
from config.agents_config import AgentConfig
from config.manager_config import ManagerConfig


# Session 过期时间（秒）- 30 分钟无活动则标记可回收
SESSION_EXPIRE_SECONDS = 30 * 60


@dataclass
class UserSession:
    """单个用户的 Agent 运行时会话"""
    user_id: str
    initialized: bool = False
    agents: list = field(default_factory=list)
    manager: Optional[Any] = None
    workers: list = field(default_factory=list)
    use_manager_mode: bool = False
    last_active: float = field(default_factory=time.time)

    # 场景注入状态（per-user）
    last_scene_key: Optional[str] = None
    last_scene_desc: Optional[str] = None

    def touch(self):
        """更新最后活跃时间"""
        self.last_active = time.time()

    def is_expired(self) -> bool:
        """检查是否过期"""
        return (time.time() - self.last_active) > SESSION_EXPIRE_SECONDS

    def reset(self):
        """重置会话状态"""
        self.initialized = False
        self.agents = []
        self.manager = None
        self.workers = []
        self.use_manager_mode = False
        self.last_scene_key = None
        self.last_scene_desc = None


class SessionManager:
    """管理所有用户的运行时会话"""

    def __init__(self):
        self._sessions: Dict[str, UserSession] = {}
        self._lock = asyncio.Lock()

    def get_session(self, user_id: str) -> UserSession:
        """获取用户 session（不存在则创建空的）"""
        if user_id not in self._sessions:
            self._sessions[user_id] = UserSession(user_id=user_id)
        session = self._sessions[user_id]
        session.touch()
        return session

    def has_session(self, user_id: str) -> bool:
        """检查用户是否有 session"""
        return user_id in self._sessions and self._sessions[user_id].initialized

    def remove_session(self, user_id: str):
        """移除用户 session"""
        if user_id in self._sessions:
            del self._sessions[user_id]

    def cleanup_expired(self):
        """清理过期 session"""
        expired_ids = [
            uid for uid, session in self._sessions.items()
            if session.is_expired()
        ]
        for uid in expired_ids:
            print(f"🧹 清理过期 session: user_id={uid}")
            del self._sessions[uid]
        return len(expired_ids)

    @property
    def active_count(self) -> int:
        """活跃 session 数量"""
        return len(self._sessions)

    async def init_user_session(self, user_id: str) -> UserSession:
        """
        初始化用户的 Agent 运行时会话。
        从用户专属的配置文件加载 providers、agents、manager，创建 Agent 实例。
        """
        from auth.user_managers import get_user_managers, get_user_tool_registry

        session = self.get_session(user_id)

        # 如果已初始化，直接返回
        if session.initialized:
            return session

        async with self._lock:
            # 二次检查（防止并发重复初始化）
            if session.initialized:
                return session

            session.reset()

            # 获取用户专属配置管理器
            agents_mgr, manager_mgr, provider_mgr = get_user_managers(user_id)
            tool_registry = get_user_tool_registry(user_id)
            toolkit = tool_registry.get_toolkit()

            # 获取配置
            manager_config = manager_mgr.get_config()
            worker_configs = agents_mgr.get_active_agents()

            print(f"🔧 [Session] user={user_id}: {len(worker_configs)} agents, manager_active={manager_config.is_active}")

            # 根据 Manager 配置决定模式
            if manager_config.is_active and manager_config.provider_id:
                session.use_manager_mode = True
                await self._init_manager_worker(session, manager_config, worker_configs, provider_mgr, toolkit)
            else:
                session.use_manager_mode = False
                await self._init_msghub(session, worker_configs, provider_mgr, toolkit)

            session.initialized = True
            print(f"✅ [Session] user={user_id} 初始化完成: mode={'manager' if session.use_manager_mode else 'msghub'}, agents={len(session.agents)}")
            return session

    async def reinitialize_user_session(self, user_id: str) -> UserSession:
        """重新初始化用户会话（用户修改配置后调用）"""
        from auth.user_managers import clear_user_runtime_caches

        # 清除配置缓存，确保重新加载文件
        clear_user_runtime_caches(user_id)

        # 移除旧 session
        self.remove_session(user_id)

        # 重新初始化
        return await self.init_user_session(user_id)

    async def _init_manager_worker(
        self,
        session: UserSession,
        manager_config: ManagerConfig,
        worker_configs: List[AgentConfig],
        provider_mgr,
        toolkit,
    ):
        """初始化 Manager-Worker 模式"""
        # 创建 Manager
        provider = provider_mgr.get_provider(manager_config.provider_id)
        if not provider or not provider.api_key:
            print(f"⚠️ [Session] Manager provider 未配置，回退到 MsgHub 模式")
            session.use_manager_mode = False
            await self._init_msghub(session, worker_configs, provider_mgr, toolkit)
            return

        try:
            llm_config = self._build_llm_config(provider)
            manager = ManagerAgent(
                name=manager_config.name,
                role=manager_config.role,
                personality=manager_config.personality,
                llm_config=llm_config,
                skill_names=[],
                toolkit=toolkit,
            )
            session.manager = manager
        except Exception as e:
            print(f"⚠️ [Session] 创建 Manager 失败: {e}")
            session.use_manager_mode = False
            await self._init_msghub(session, worker_configs, provider_mgr, toolkit)
            return

        # 创建 Workers
        workers = []
        for config in worker_configs:
            provider = provider_mgr.get_provider(config.provider_id)
            if not provider or not provider.api_key:
                print(f"⚠️ [Session] Worker {config.name} provider 未配置，跳过")
                continue
            try:
                llm_config = self._build_llm_config(provider)
                worker = WorkerAgent(
                    name=config.name,
                    role=config.role,
                    personality=config.personality,
                    specialty=config.specialty or "通用任务",
                    expertise=config.expertise or config.role,
                    worker_id=config.id,
                    llm_config=llm_config,
                    skill_names=config.skill_ids,
                    toolkit=toolkit,
                )
                workers.append(worker)
            except Exception as e:
                print(f"⚠️ [Session] 创建 Worker {config.name} 失败: {e}")

        # 注册 Workers 到 Manager
        for worker in workers:
            session.manager.register_worker(worker)

        session.workers = workers
        session.agents = [session.manager] + workers

    async def _init_msghub(
        self,
        session: UserSession,
        worker_configs: List[AgentConfig],
        provider_mgr,
        toolkit,
    ):
        """初始化 MsgHub 模式"""
        agents = []
        for config in worker_configs:
            provider = provider_mgr.get_provider(config.provider_id)
            if not provider or not provider.api_key:
                print(f"⚠️ [Session] Agent {config.name} provider 未配置，跳过")
                continue
            try:
                llm_config = self._build_llm_config(provider)
                agent = ChatAgent(
                    name=config.name,
                    role=config.role,
                    personality=config.personality,
                    llm_config=llm_config,
                    skill_names=config.skill_ids,
                    toolkit=toolkit,
                )
                agents.append(agent)
            except Exception as e:
                print(f"⚠️ [Session] 创建 Agent {config.name} 失败: {e}")

        session.agents = agents

    @staticmethod
    def _build_llm_config(provider) -> Dict[str, Any]:
        """从 Provider 实例构建 llm_config 字典"""
        return {
            "provider": provider.provider_type,
            "model_id": provider.model_id,
            "api_key": provider.api_key,
            "base_url": provider.base_url if provider.base_url else None,
        }


# 全局 SessionManager 实例
session_manager = SessionManager()
