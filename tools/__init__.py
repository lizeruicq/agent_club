"""
工具管理模块 - 统一管理所有Agent工具
所有工具在此注册，所有Agent共享同一个Toolkit实例
"""
from functools import wraps
from typing import Dict, List, Optional, Callable, Any
import logging
import os
import json
from agentscope.tool import Toolkit
from .builtin.file_io import FileWorkspace, workspace_context

logger = logging.getLogger(__name__)

# 配置文件路径
CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config")
TOOLS_CONFIG_FILE = os.path.join(CONFIG_DIR, "tools_config.json")


class ToolRegistry:
    """
    全局工具注册中心（单例模式）
    """

    _instance = None
    def __new__(cls, config_file: Optional[str] = None, workspace: Optional[FileWorkspace] = None):
        # 用户级 ToolRegistry 需要独立实例，避免工具状态和 workspace 串用户。
        if config_file is not None or workspace is not None:
            instance = super().__new__(cls)
            instance._initialized = False
            return instance
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, config_file: Optional[str] = None, workspace: Optional[FileWorkspace] = None):
        if self._initialized:
            return
        self._initialized = True
        self._config_file = config_file or TOOLS_CONFIG_FILE
        self._workspace = workspace
        self._toolkit = Toolkit()
        self._tools_config: Dict[str, bool] = {}
        self._tools_meta: Dict[str, Any] = {}
        self._load_config()  # 先加载配置
        self._load_builtin_tools()

    def _load_config(self):
        """从配置文件加载工具配置"""
        try:
            if os.path.exists(self._config_file):
                with open(self._config_file, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    self._tools_config = config.get('tools', {})
                    logger.info(f"✅ 从配置文件加载了 {len(self._tools_config)} 个工具配置")
            else:
                logger.info("📝 工具配置文件不存在，将使用默认配置")
                self._tools_config = {}
        except Exception as e:
            logger.warning(f"⚠️ 加载工具配置失败: {e}")
            self._tools_config = {}

    def save_config(self):
        """保存工具配置到文件"""
        try:
            # 确保配置目录存在
            os.makedirs(os.path.dirname(self._config_file), exist_ok=True)

            config = {
                'tools': self._tools_config
            }

            with open(self._config_file, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=2)

            logger.info(f"✅ 工具配置已保存到 {self._config_file}")
            return True
        except Exception as e:
            logger.error(f"❌ 保存工具配置失败: {e}")
            return False

    def _load_builtin_tools(self):
        """加载内置工具"""
        from .builtin import file_io, browser_control, shell, file_search
        from .builtin import get_current_time, desktop_screenshot, send_file

        # 注册文件操作工具（使用配置中的启用状态，默认为True）
        self.register_tool("read_file", file_io.read_file,
                          enabled=self._tools_config.get('read_file', True))
        self.register_tool("write_file", file_io.write_file,
                          enabled=self._tools_config.get('write_file', True))
        self.register_tool("edit_file", file_io.edit_file,
                          enabled=self._tools_config.get('edit_file', True))
        self.register_tool("append_file", file_io.append_file,
                          enabled=self._tools_config.get('append_file', True))

        # 注册浏览器工具
        self.register_tool("browser_use", browser_control.browser_use,
                          enabled=self._tools_config.get('browser_use', True))

        # 注册 shell 工具
        self.register_tool("execute_shell_command", shell.execute_shell_command,
                          enabled=self._tools_config.get('execute_shell_command', True))

        # 注册文件搜索工具
        self.register_tool("grep_search", file_search.grep_search,
                          enabled=self._tools_config.get('grep_search', True))
        self.register_tool("glob_search", file_search.glob_search,
                          enabled=self._tools_config.get('glob_search', True))

        # 注册时间工具
        self.register_tool("get_current_time", get_current_time.get_current_time,
                          enabled=self._tools_config.get('get_current_time', True))
        self.register_tool("set_user_timezone", get_current_time.set_user_timezone,
                          enabled=self._tools_config.get('set_user_timezone', True))

        # 注册截图工具
        self.register_tool("desktop_screenshot", desktop_screenshot.desktop_screenshot,
                          enabled=self._tools_config.get('desktop_screenshot', True))

        # 注册文件发送工具
        self.register_tool("send_file_to_user", send_file.send_file_to_user,
                          enabled=self._tools_config.get('send_file_to_user', True))

        logger.info(f"✅ 已注册 {len(self._toolkit.tools)} 个工具")

    def _bind_workspace(self, tool_func: Callable) -> Callable:
        """给工具调用绑定当前用户 workspace。"""
        if self._workspace is None:
            return tool_func

        @wraps(tool_func)
        async def wrapped(*args, **kwargs):
            with workspace_context(self._workspace):
                return await tool_func(*args, **kwargs)

        return wrapped

    def register_tool(
        self,
        name: str,
        tool_func: Callable,
        enabled: bool = True,
        namesake_strategy: str = "skip"
    ) -> bool:
        """
        注册工具到Toolkit

        Args:
            name: 工具名称
            tool_func: 工具函数
            enabled: 是否启用
            namesake_strategy: 同名处理策略 (override/skip/raise/rename)

        Returns:
            是否注册成功
        """
        if not enabled:
            self._tools_config[name] = False
            logger.debug(f"工具 {name} 已禁用，跳过注册")
            return False

        try:
            self._toolkit.register_tool_function(
                self._bind_workspace(tool_func),
                namesake_strategy=namesake_strategy
            )
            self._tools_config[name] = True
            logger.debug(f"✅ 注册工具: {name}")
            return True
        except Exception as e:
            logger.error(f"❌ 注册工具 {name} 失败: {e}")
            return False

    def get_toolkit(self) -> Toolkit:
        """获取全局Toolkit实例"""
        setattr(self._toolkit, "_agent_file_workspace", self._workspace)
        return self._toolkit

    def list_tools(self) -> List[str]:
        """获取所有可用工具列表（包括已禁用的）"""
        # 返回所有已知工具，包括已注册的和配置中有的
        all_tools = set(self._toolkit.tools.keys())
        all_tools.update(self._tools_config.keys())

        # 如果配置为空，返回默认工具列表
        if not all_tools:
            return [
                "read_file", "write_file", "edit_file", "append_file",
                "browser_use", "execute_shell_command", "grep_search",
                "glob_search", "get_current_time", "set_user_timezone",
                "desktop_screenshot", "send_file_to_user",
            ]

        return sorted(list(all_tools))

    def is_tool_enabled(self, name: str) -> bool:
        """检查工具是否启用"""
        return self._tools_config.get(name, True)

    def enable_tool(self, name: str):
        """启用工具 - 动态注册到 Toolkit"""
        self._tools_config[name] = True

        # 如果工具未在 Toolkit 中，则重新注册
        if name not in self._toolkit.tools:
            self._re_register_tool(name)
            logger.info(f"✅ 工具 {name} 已启用并注册到 Toolkit")

    def disable_tool(self, name: str):
        """禁用工具 - 从 Toolkit 移除"""
        self._tools_config[name] = False

        # 从 Toolkit 中移除工具
        if name in self._toolkit.tools:
            del self._toolkit.tools[name]
            logger.info(f"🚫 工具 {name} 已从 Toolkit 移除")

    def _re_register_tool(self, name: str):
        """重新注册工具到 Toolkit"""
        from .builtin import file_io, browser_control, shell, file_search
        from .builtin import get_current_time, desktop_screenshot, send_file

        tool_map = {
            "read_file": file_io.read_file,
            "write_file": file_io.write_file,
            "edit_file": file_io.edit_file,
            "append_file": file_io.append_file,
            "browser_use": browser_control.browser_use,
            "execute_shell_command": shell.execute_shell_command,
            "grep_search": file_search.grep_search,
            "glob_search": file_search.glob_search,
            "get_current_time": get_current_time.get_current_time,
            "set_user_timezone": get_current_time.set_user_timezone,
            "desktop_screenshot": desktop_screenshot.desktop_screenshot,
            "send_file_to_user": send_file.send_file_to_user,
        }

        if name in tool_map:
            try:
                self._toolkit.register_tool_function(
                    self._bind_workspace(tool_map[name]),
                    namesake_strategy="override"
                )
                logger.debug(f"✅ 重新注册工具: {name}")
            except Exception as e:
                logger.error(f"❌ 重新注册工具 {name} 失败: {e}")


# 全局实例
tool_registry = ToolRegistry()

# 便捷导出
get_toolkit = tool_registry.get_toolkit
list_tools = tool_registry.list_tools
