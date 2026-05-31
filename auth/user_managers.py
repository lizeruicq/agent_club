"""
用户级别的配置管理器工厂
根据 user_id 创建或获取用户专属的配置管理器实例
"""
from typing import Dict, Optional, Tuple

from .user_data import get_user_data
from config.agents_config import AgentsConfigManager
from config.manager_config import ManagerConfigManager
from providers.provider_manager import ProviderManager
from tools import ToolRegistry
from tools.builtin.file_io import build_workspace


# 缓存：user_id -> (AgentsConfigManager, ManagerConfigManager, ProviderManager)
_user_managers_cache: Dict[str, Tuple[AgentsConfigManager, ManagerConfigManager, ProviderManager]] = {}
_user_tool_registry_cache: Dict[Tuple[str, str], ToolRegistry] = {}


def get_user_managers(user_id: str) -> Tuple[AgentsConfigManager, ManagerConfigManager, ProviderManager]:
    """获取用户专属的配置管理器三元组（带缓存）"""
    if user_id not in _user_managers_cache:
        user_data = get_user_data(user_id)
        agents_mgr = AgentsConfigManager(config_file=user_data.agents_config_file)
        manager_mgr = ManagerConfigManager(config_file=user_data.manager_config_file)
        provider_mgr = ProviderManager(config_file=user_data.providers_config_file)
        _user_managers_cache[user_id] = (agents_mgr, manager_mgr, provider_mgr)
    return _user_managers_cache[user_id]


def get_user_agents_manager(user_id: str) -> AgentsConfigManager:
    """获取用户专属的 AgentsConfigManager"""
    return get_user_managers(user_id)[0]


def get_user_manager_config(user_id: str) -> ManagerConfigManager:
    """获取用户专属的 ManagerConfigManager"""
    return get_user_managers(user_id)[1]


def get_user_provider_manager(user_id: str) -> ProviderManager:
    """获取用户专属的 ProviderManager"""
    return get_user_managers(user_id)[2]


def get_user_tool_registry(user_id: str, conversation_id: Optional[str] = None) -> ToolRegistry:
    """获取用户指定会话专属的 ToolRegistry"""
    user_data = get_user_data(user_id)
    workspace_id = user_data.sanitize_conversation_id(conversation_id or "default")
    cache_key = (user_id, workspace_id)
    if cache_key not in _user_tool_registry_cache:
        if conversation_id:
            root_dir = user_data.conversation_output_dir(workspace_id)
            preview_dir = user_data.conversation_preview_dir(workspace_id)
            doc_dir = user_data.conversation_doc_dir(workspace_id)
            workspace = build_workspace(
                root_dir=root_dir,
                preview_dir=preview_dir,
                doc_dir=doc_dir,
            )
        else:
            workspace = None
        _user_tool_registry_cache[cache_key] = ToolRegistry(
            config_file=user_data.tools_config_file,
            workspace=workspace,
        )
    return _user_tool_registry_cache[cache_key]


def clear_user_runtime_caches(user_id: str):
    """清除用户运行时配置缓存，下一次访问会重新加载。"""
    _user_managers_cache.pop(user_id, None)
    for key in list(_user_tool_registry_cache):
        if key[0] == user_id:
            _user_tool_registry_cache.pop(key, None)
