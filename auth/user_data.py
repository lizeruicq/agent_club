"""
用户数据隔离服务
为每个用户提供独立的配置目录和文件路径
"""
import os
import json
import shutil
from typing import Dict, Any

# 项目根目录
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 用户数据根目录
USER_DATA_ROOT = os.path.join(PROJECT_ROOT, "data", "users")
os.makedirs(USER_DATA_ROOT, exist_ok=True)

# 用户产出根目录
USER_OUTPUT_ROOT = os.path.join(PROJECT_ROOT, "output", "users")
os.makedirs(USER_OUTPUT_ROOT, exist_ok=True)


class UserDataService:
    """用户数据目录管理"""

    def __init__(self, user_id: str):
        self.user_id = user_id
        self._data_dir = os.path.join(USER_DATA_ROOT, user_id)
        self._output_dir = os.path.join(USER_OUTPUT_ROOT, user_id)
        self._preview_dir = os.path.join(self._output_dir, "preview")
        # 确保目录存在
        os.makedirs(self._data_dir, exist_ok=True)
        os.makedirs(self._preview_dir, exist_ok=True)

    @property
    def data_dir(self) -> str:
        """用户配置数据目录"""
        return self._data_dir

    @property
    def output_dir(self) -> str:
        """用户产出目录"""
        return self._output_dir

    @property
    def preview_dir(self) -> str:
        """用户 HTML 预览目录"""
        return self._preview_dir

    @property
    def agents_config_file(self) -> str:
        return os.path.join(self._data_dir, "agents_config.json")

    @property
    def manager_config_file(self) -> str:
        return os.path.join(self._data_dir, "manager_config.json")

    @property
    def providers_config_file(self) -> str:
        return os.path.join(self._data_dir, "providers_config.json")

    @property
    def skills_config_file(self) -> str:
        return os.path.join(self._data_dir, "skills_config.json")

    @property
    def game_config_file(self) -> str:
        return os.path.join(self._data_dir, "game_config.json")

    @property
    def conversations_dir(self) -> str:
        """历史会话目录，每个会话存一个 JSON 文件"""
        path = os.path.join(self._data_dir, "conversations")
        os.makedirs(path, exist_ok=True)
        return path

    def init_default_data(self):
        """初始化默认用户数据（首次注册时调用）"""
        # 创建空 agents 配置
        if not os.path.exists(self.agents_config_file):
            with open(self.agents_config_file, 'w', encoding='utf-8') as f:
                json.dump({"agents": []}, f, ensure_ascii=False, indent=2)

        # 创建默认 manager 配置
        if not os.path.exists(self.manager_config_file):
            with open(self.manager_config_file, 'w', encoding='utf-8') as f:
                json.dump({
                    "name": "任务管理器",
                    "role": "项目协调经理",
                    "personality": "专业、有条理、善于规划和协调",
                    "avatar_type": "mafia2",
                    "provider_id": "",
                    "is_active": False,
                }, f, ensure_ascii=False, indent=2)

        # 创建空 providers 配置
        if not os.path.exists(self.providers_config_file):
            with open(self.providers_config_file, 'w', encoding='utf-8') as f:
                json.dump({"providers": [], "version": "1.0"}, f, ensure_ascii=False, indent=2)

        # 创建默认游戏配置（从公共模板复制场景列表）
        if not os.path.exists(self.game_config_file):
            self._init_game_config()


    def _init_game_config(self):
        """从公共模板初始化用户游戏配置"""
        # 读取公共 game-config.json 作为模板
        public_config_path = os.path.join(
            PROJECT_ROOT, "rpg-frontend", "public", "assets", "game-config.json"
        )
        if os.path.exists(public_config_path):
            try:
                with open(public_config_path, 'r', encoding='utf-8') as f:
                    base_config = json.load(f)
                # 用户配置只保存场景选择和描述
                user_game_config = {
                    "currentScene": base_config.get("currentScene", ""),
                    "scenes": {}
                }
                # 复制所有场景的 key 和 description
                for key, scene in base_config.get("scenes", {}).items():
                    user_game_config["scenes"][key] = {
                        "description": scene.get("description", "")
                    }
                with open(self.game_config_file, 'w', encoding='utf-8') as f:
                    json.dump(user_game_config, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"⚠️ 初始化用户游戏配置失败: {e}")
                # 创建最小默认配置
                with open(self.game_config_file, 'w', encoding='utf-8') as f:
                    json.dump({"currentScene": "", "scenes": {}}, f, ensure_ascii=False, indent=2)
        else:
            with open(self.game_config_file, 'w', encoding='utf-8') as f:
                json.dump({"currentScene": "", "scenes": {}}, f, ensure_ascii=False, indent=2)


# 缓存已创建的 UserDataService 实例
_user_data_cache: Dict[str, UserDataService] = {}


def get_user_data(user_id: str) -> UserDataService:
    """获取用户数据服务（带缓存）"""
    if user_id not in _user_data_cache:
        _user_data_cache[user_id] = UserDataService(user_id)
    return _user_data_cache[user_id]
