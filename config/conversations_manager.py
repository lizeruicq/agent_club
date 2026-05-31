"""
历史会话管理器
每个用户的会话存为独立 JSON 文件，包含完整聊天记录 + 当时的 agent/manager/game-config 快照
"""
import json
import os
import re
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional


MAX_CONVERSATIONS = 10


class ConversationManager:
    """单用户的历史会话管理"""

    def __init__(self, conversations_dir: str):
        self._dir = conversations_dir
        os.makedirs(self._dir, exist_ok=True)

    def _path(self, conv_id: str) -> str:
        return os.path.join(self._dir, f"{conv_id}.json")

    @staticmethod
    def sanitize_id(conv_id: str) -> str:
        cleaned = re.sub(r"[^A-Za-z0-9_.-]", "_", (conv_id or "").strip())
        return cleaned[:80]

    def _read(self, conv_id: str) -> Optional[Dict[str, Any]]:
        path = self._path(conv_id)
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def _write(self, conv_id: str, data: Dict[str, Any]) -> None:
        with open(self._path(conv_id), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    @staticmethod
    def _meta_of(conv: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": conv.get("id", ""),
            "title": conv.get("title", ""),
            "created_at": conv.get("created_at", ""),
            "updated_at": conv.get("updated_at", ""),
            "message_count": len(conv.get("messages", [])),
        }

    def list_meta(self) -> List[Dict[str, Any]]:
        """返回元数据列表，按 updated_at 倒序"""
        result: List[Dict[str, Any]] = []
        for fname in os.listdir(self._dir):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(self._dir, fname), "r", encoding="utf-8") as f:
                    conv = json.load(f)
                result.append(self._meta_of(conv))
            except Exception:
                continue
        result.sort(key=lambda m: m.get("updated_at", ""), reverse=True)
        return result

    def count(self) -> int:
        return sum(1 for fname in os.listdir(self._dir) if fname.endswith(".json"))

    def get_oldest_meta(self) -> Optional[Dict[str, Any]]:
        """返回最旧的会话元数据（updated_at 最小）"""
        metas = self.list_meta()
        return metas[-1] if metas else None

    def get(self, conv_id: str) -> Optional[Dict[str, Any]]:
        """获取完整会话内容"""
        return self._read(conv_id)

    def create(
        self,
        title: str,
        messages: List[Dict[str, Any]],
        snapshots: Dict[str, Any],
        conv_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """创建新会话"""
        conv_id = self.sanitize_id(conv_id or "") or f"conv_{uuid.uuid4().hex[:12]}"
        if os.path.exists(self._path(conv_id)):
            return self.update(conv_id, messages, snapshots) or {}
        now = datetime.now().isoformat()
        conv = {
            "id": conv_id,
            "title": (title or "新对话").strip()[:80],
            "created_at": now,
            "updated_at": now,
            "messages": messages or [],
            "snapshots": snapshots or {},
        }
        self._write(conv_id, conv)
        return conv

    def update(
        self,
        conv_id: str,
        messages: List[Dict[str, Any]],
        snapshots: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """更新已有会话的消息和快照；title 保持不变"""
        conv = self._read(conv_id)
        if not conv:
            return None
        conv["messages"] = messages or []
        conv["snapshots"] = snapshots or {}
        conv["updated_at"] = datetime.now().isoformat()
        self._write(conv_id, conv)
        return conv

    def delete(self, conv_id: str) -> bool:
        path = self._path(conv_id)
        if not os.path.exists(path):
            return False
        try:
            os.remove(path)
            return True
        except Exception:
            return False
