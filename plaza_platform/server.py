"""
平台 API 服务 - 作品发布与广场
挂载到主应用的 /platform 路径下
"""
import os
import uuid
from typing import Optional, List
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from .database import init_db, SessionLocal
from .models import Work
from .storage import storage

# 导入 User 模型确保表被创建
from auth.models import User  # noqa: F401
from auth.service import auth_service

# 初始化数据库（创建所有表，包括 users 和 works）
init_db()

# 创建平台子应用
platform_app = FastAPI(title="Agent Club Platform", version="0.2.0")


# ============== 辅助函数 ==============

def _extract_user_from_request(request: Request) -> Optional[dict]:
    """从请求头中提取用户信息（可选认证）"""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        return auth_service.verify_token(token)
    return None


def _require_user(request: Request) -> dict:
    """要求必须登录"""
    user = _extract_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="请先登录")
    return user


def _get_user_nickname(user_id: str) -> str:
    """根据 user_id 获取昵称"""
    user_info = auth_service.get_user_by_id(user_id)
    if user_info:
        return user_info.get("nickname", "匿名用户")
    return "匿名用户"


# ============== 请求/响应模型 ==============

class PublishRequest(BaseModel):
    title: str
    description: str = ""
    tags: str = ""  # 逗号分隔
    source_file: Optional[str] = None  # 当前会话 preview 目录下的文件名
    conversation_id: Optional[str] = None
    content: Optional[str] = None  # 或者直接传 HTML 内容


class PublishResponse(BaseModel):
    success: bool
    work_id: str
    title: str
    message: str


class WorkInfo(BaseModel):
    id: str
    title: str
    description: str
    author: str
    author_id: str
    tags: str
    file_size: int
    view_count: int
    status: str
    created_at: str
    updated_at: str
    is_mine: bool = False  # 是否是当前用户的作品


class WorkListResponse(BaseModel):
    works: List[WorkInfo]
    total: int
    page: int
    page_size: int


# ============== API 路由 ==============

@platform_app.get("/api/health")
async def platform_health():
    """平台健康检查"""
    return {"status": "healthy", "service": "platform"}


@platform_app.post("/api/publish", response_model=PublishResponse)
async def publish_work(req: PublishRequest, request: Request):
    """发布作品到平台（需要登录）"""
    user = _require_user(request)

    # 获取 HTML 内容
    html_content = req.content
    if not html_content:
        if not req.source_file:
            raise HTTPException(status_code=400, detail="必须提供 source_file 或 content")
        # 从当前会话的 preview 目录读取
        from auth.user_data import get_user_data
        user_data = get_user_data(user["id"])
        if not req.conversation_id:
            raise HTTPException(status_code=400, detail="必须提供 conversation_id")
        preview_dir = user_data.conversation_preview_dir(req.conversation_id)
        source_path = os.path.join(preview_dir, req.source_file)
        if os.path.commonpath([os.path.normpath(preview_dir), os.path.normpath(source_path)]) != os.path.normpath(preview_dir):
            raise HTTPException(status_code=400, detail="源文件路径无效")
        if not os.path.exists(source_path):
            raise HTTPException(status_code=404, detail=f"源文件不存在: {req.source_file}")
        with open(source_path, "r", encoding="utf-8") as f:
            html_content = f.read()

    if not html_content.strip():
        raise HTTPException(status_code=400, detail="HTML 内容不能为空")

    # 限制文件大小 (2MB)
    if len(html_content.encode("utf-8")) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小超过 2MB 限制")

    # 生成 work_id 并存储
    work_id = str(uuid.uuid4())
    relative_path = await storage.save(work_id, html_content)
    file_size = storage.get_size(work_id)

    # 获取用户昵称作为作者名
    author_name = _get_user_nickname(user["id"])

    # 写入数据库
    title = req.title.strip() or "未命名作品"
    db = SessionLocal()
    try:
        work = Work(
            id=work_id,
            title=title,
            description=req.description.strip(),
            author=author_name,
            author_id=user["id"],
            tags=req.tags.strip(),
            file_path=relative_path,
            file_size=file_size,
            status="published",
        )
        db.add(work)
        db.commit()
    finally:
        db.close()

    return PublishResponse(
        success=True,
        work_id=work_id,
        title=title,
        message="发布成功"
    )


@platform_app.get("/api/works", response_model=WorkListResponse)
async def list_works(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=50),
    sort: str = Query("latest", pattern="^(latest|popular)$"),
    tag: Optional[str] = None,
    search: Optional[str] = None,
    mine: bool = Query(False, description="只看自己的作品"),
):
    """获取广场作品列表"""
    current_user = _extract_user_from_request(request)
    current_user_id = current_user["id"] if current_user else ""

    db = SessionLocal()
    try:
        query = db.query(Work).filter(Work.status == "published")

        # 只看自己的作品
        if mine and current_user_id:
            query = query.filter(Work.author_id == current_user_id)

        # 标签筛选
        if tag:
            query = query.filter(Work.tags.contains(tag))

        # 搜索
        if search:
            query = query.filter(
                (Work.title.contains(search)) | (Work.description.contains(search))
            )

        # 排序
        if sort == "popular":
            query = query.order_by(Work.view_count.desc())
        else:
            query = query.order_by(Work.created_at.desc())

        total = query.count()
        works = query.offset((page - 1) * page_size).limit(page_size).all()

        return WorkListResponse(
            works=[
                WorkInfo(
                    id=w.id,
                    title=w.title,
                    description=w.description,
                    author=w.author,
                    author_id=w.author_id or "",
                    tags=w.tags,
                    file_size=w.file_size,
                    view_count=w.view_count,
                    status=w.status,
                    created_at=w.created_at.isoformat() if w.created_at else "",
                    updated_at=w.updated_at.isoformat() if w.updated_at else "",
                    is_mine=(w.author_id == current_user_id) if current_user_id else False,
                )
                for w in works
            ],
            total=total,
            page=page,
            page_size=page_size,
        )
    finally:
        db.close()


@platform_app.get("/api/works/{work_id}")
async def get_work(work_id: str, request: Request):
    """获取单个作品详情"""
    current_user = _extract_user_from_request(request)
    current_user_id = current_user["id"] if current_user else ""

    db = SessionLocal()
    try:
        work = db.query(Work).filter(Work.id == work_id).first()
        if not work:
            raise HTTPException(status_code=404, detail="作品不存在")

        return WorkInfo(
            id=work.id,
            title=work.title,
            description=work.description,
            author=work.author,
            author_id=work.author_id or "",
            tags=work.tags,
            file_size=work.file_size,
            view_count=work.view_count,
            status=work.status,
            created_at=work.created_at.isoformat() if work.created_at else "",
            updated_at=work.updated_at.isoformat() if work.updated_at else "",
            is_mine=(work.author_id == current_user_id) if current_user_id else False,
        )
    finally:
        db.close()


@platform_app.get("/api/works/{work_id}/render")
async def render_work(work_id: str):
    """渲染作品 HTML（供 iframe 加载，无需登录）"""
    db = SessionLocal()
    try:
        work = db.query(Work).filter(Work.id == work_id).first()
        if not work:
            raise HTTPException(status_code=404, detail="作品不存在")

        # 增加浏览量
        work.view_count = (work.view_count or 0) + 1
        db.commit()
    finally:
        db.close()

    # 读取 HTML 文件
    try:
        content = await storage.get(work_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="作品文件丢失")

    return HTMLResponse(content=content)


@platform_app.delete("/api/works/{work_id}")
async def delete_work(work_id: str, request: Request):
    """删除作品（仅作者本人可删除）"""
    user = _require_user(request)

    db = SessionLocal()
    try:
        work = db.query(Work).filter(Work.id == work_id).first()
        if not work:
            raise HTTPException(status_code=404, detail="作品不存在")

        # 权限检查：只有作者本人能删除
        if work.author_id and work.author_id != user["id"]:
            raise HTTPException(status_code=403, detail="只能删除自己的作品")

        db.delete(work)
        db.commit()
    finally:
        db.close()

    # 删除文件
    await storage.delete(work_id)

    return {"success": True, "message": "已删除"}


@platform_app.get("/api/my-works", response_model=WorkListResponse)
async def my_works(
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(12, ge=1, le=50),
):
    """获取当前用户的作品列表"""
    user = _require_user(request)

    db = SessionLocal()
    try:
        query = db.query(Work).filter(Work.author_id == user["id"])
        query = query.order_by(Work.created_at.desc())

        total = query.count()
        works = query.offset((page - 1) * page_size).limit(page_size).all()

        return WorkListResponse(
            works=[
                WorkInfo(
                    id=w.id,
                    title=w.title,
                    description=w.description,
                    author=w.author,
                    author_id=w.author_id or "",
                    tags=w.tags,
                    file_size=w.file_size,
                    view_count=w.view_count,
                    status=w.status,
                    created_at=w.created_at.isoformat() if w.created_at else "",
                    updated_at=w.updated_at.isoformat() if w.updated_at else "",
                    is_mine=True,
                )
                for w in works
            ],
            total=total,
            page=page,
            page_size=page_size,
        )
    finally:
        db.close()
