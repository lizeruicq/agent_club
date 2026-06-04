"""
历史会话 API
- GET    /api/conversations              列表
- GET    /api/conversations/{id}         详情（含 messages）
- POST   /api/conversations              将"当前状态 + messages"保存为新会话
- DELETE /api/conversations/{id}         删除
- POST   /api/conversations/{id}/restore 用该会话覆盖当前配置并重建 session
"""
import json
import os
import shutil
from datetime import datetime
from typing import Any, Dict, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user
from auth.user_data import get_user_data
from config.conversations_manager import ConversationManager, MAX_CONVERSATIONS
from api.session_manager import session_manager

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _mgr(user_id: str) -> ConversationManager:
    return ConversationManager(get_user_data(user_id).conversations_dir)


def _read_json_file(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _write_json_file(path: str, data: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _conversation_output_path(user_id: str, conv_id: str) -> str:
    ud = get_user_data(user_id)
    safe_id = ud.sanitize_conversation_id(conv_id)
    return os.path.join(ud.output_dir, "conversations", safe_id)


def _conversation_outputs_root(user_id: str) -> str:
    return os.path.join(get_user_data(user_id).output_dir, "conversations")


def _output_only_meta(user_id: str, conv_id: str) -> Dict[str, Any]:
    output_path = _conversation_output_path(user_id, conv_id)
    try:
        mtime = os.path.getmtime(output_path)
        updated_at = datetime.fromtimestamp(mtime).isoformat()
    except OSError:
        updated_at = ""
    return {
        "id": conv_id,
        "title": f"未保存会话 {conv_id}",
        "created_at": updated_at,
        "updated_at": updated_at,
        "message_count": 0,
    }


def _list_output_conversation_ids(user_id: str) -> List[str]:
    root = _conversation_outputs_root(user_id)
    if not os.path.isdir(root):
        return []
    result = []
    for name in os.listdir(root):
        path = os.path.join(root, name)
        if os.path.isdir(path):
            result.append(name)
    return result


def _take_snapshots(user_id: str) -> Dict[str, Any]:
    ud = get_user_data(user_id)
    return {
        "agents_config": _read_json_file(ud.agents_config_file),
        "manager_config": _read_json_file(ud.manager_config_file),
        "game_config": _read_json_file(ud.game_config_file),
    }


def _apply_snapshots(user_id: str, snapshots: Dict[str, Any]) -> None:
    ud = get_user_data(user_id)
    if "agents_config" in snapshots and snapshots["agents_config"]:
        _write_json_file(ud.agents_config_file, snapshots["agents_config"])
    if "manager_config" in snapshots and snapshots["manager_config"]:
        _write_json_file(ud.manager_config_file, snapshots["manager_config"])
    if "game_config" in snapshots and snapshots["game_config"]:
        _write_json_file(ud.game_config_file, snapshots["game_config"])


def _derive_title(messages: List[Dict[str, Any]]) -> str:
    for msg in messages:
        if msg.get("role") == "user":
            content = (msg.get("content") or "").strip()
            if content:
                return content
    from datetime import datetime
    return f"新对话 {datetime.now().strftime('%m-%d %H:%M')}"


class SaveConversationRequest(BaseModel):
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    confirm_delete_oldest: bool = False
    conversation_id: str = ""


class UpdateConversationRequest(BaseModel):
    messages: List[Dict[str, Any]] = Field(default_factory=list)


@router.get("")
async def list_conversations(user: dict = Depends(get_current_user)):
    """获取当前用户的会话元数据列表"""
    user_id = user["id"]
    metas = _mgr(user_id).list_meta()
    known_ids = {meta.get("id") for meta in metas}
    for conv_id in _list_output_conversation_ids(user_id):
        if conv_id not in known_ids:
            metas.append(_output_only_meta(user_id, conv_id))
    metas.sort(key=lambda m: m.get("updated_at", ""), reverse=True)
    return {"conversations": metas, "max": MAX_CONVERSATIONS}


@router.get("/{conv_id}")
async def get_conversation(conv_id: str, user: dict = Depends(get_current_user)):
    """获取会话详情（含 messages）"""
    user_id = user["id"]
    conv = _mgr(user_id).get(conv_id)
    if not conv:
        output_path = _conversation_output_path(user_id, conv_id)
        if not os.path.isdir(output_path):
            raise HTTPException(status_code=404, detail="会话不存在")
        meta = _output_only_meta(user_id, conv_id)
        return {**meta, "messages": [], "snapshots": {}}
    return conv


@router.post("")
async def save_conversation(req: SaveConversationRequest, user: dict = Depends(get_current_user)):
    """将当前 messages + 用户当前配置快照保存为新会话。

    如果当前已达到 MAX_CONVERSATIONS 且未确认删除最旧条目，返回 409。
    """
    if not req.messages:
        raise HTTPException(status_code=400, detail="无消息可保存")

    user_id = user["id"]
    mgr = _mgr(user_id)

    if mgr.count() >= MAX_CONVERSATIONS:
        if not req.confirm_delete_oldest:
            oldest = mgr.get_oldest_meta()
            raise HTTPException(
                status_code=409,
                detail={
                    "requires_confirmation": True,
                    "message": "历史会话已达上限",
                    "max": MAX_CONVERSATIONS,
                    "current_count": mgr.count(),
                    "oldest": oldest,
                },
            )
        oldest = mgr.get_oldest_meta()
        if oldest:
            oldest_id = oldest["id"]
            mgr.delete(oldest_id)
            oldest_output = _conversation_output_path(user_id, oldest_id)
            if os.path.isdir(oldest_output):
                shutil.rmtree(oldest_output, ignore_errors=True)

    title = _derive_title(req.messages)
    snapshots = _take_snapshots(user_id)
    conv = mgr.create(
        title=title,
        messages=req.messages,
        snapshots=snapshots,
        conv_id=req.conversation_id,
    )
    return {"conversation": conv}


@router.put("/{conv_id}")
async def update_conversation(
    conv_id: str,
    req: UpdateConversationRequest,
    user: dict = Depends(get_current_user),
):
    """更新已有会话的 messages 和当前配置快照，不改 title"""
    user_id = user["id"]
    snapshots = _take_snapshots(user_id)
    conv = _mgr(user_id).update(conv_id, req.messages, snapshots)
    if not conv:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"conversation": conv}


@router.delete("/{conv_id}")
async def delete_conversation(conv_id: str, user: dict = Depends(get_current_user)):
    user_id = user["id"]
    ok = _mgr(user_id).delete(conv_id)
    conv_output = _conversation_output_path(user_id, conv_id)
    if not ok and not os.path.isdir(conv_output):
        raise HTTPException(status_code=404, detail="会话不存在")
    if os.path.isdir(conv_output):
        shutil.rmtree(conv_output, ignore_errors=True)
    session_manager.remove_session(user_id, conv_id)
    return {"success": True}


@router.post("/{conv_id}/restore")
async def restore_conversation(conv_id: str, user: dict = Depends(get_current_user)):
    """用该会话的快照覆盖用户配置，重建 session，并返回 messages + game_config"""
    user_id = user["id"]
    conv = _mgr(user_id).get(conv_id)
    if not conv:
        output_path = _conversation_output_path(user_id, conv_id)
        if not os.path.isdir(output_path):
            raise HTTPException(status_code=404, detail="会话不存在")
        conv = {
            "id": conv_id,
            "title": f"未保存会话 {conv_id}",
            "messages": [],
            "snapshots": {},
        }

    snapshots = conv.get("snapshots") or {}
    _apply_snapshots(user_id, snapshots)

    try:
        await session_manager.reinitialize_user_session(user_id, conv_id)
    except Exception as e:
        print(f"⚠️ restore reinit failed: {e}")

    # 返回合并后的完整 game_config（含公共资源），供前端直接替换 state
    from api.game_config_api import _load_base_config, _load_user_game_config, _merge_config
    full_game_config = _merge_config(_load_base_config(), _load_user_game_config(user_id))

    return {
        "id": conv["id"],
        "title": conv.get("title", ""),
        "messages": conv.get("messages", []),
        "game_config": full_game_config,
    }
