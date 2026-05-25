"""
Manager Agent 配置模块
Manager 作为系统级默认 Agent，固定存在但可配置
"""
import json
import os
from typing import Optional, Dict, Any
from pydantic import BaseModel, Field

# 默认配置文件路径（向后兼容）
DEFAULT_CONFIG_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "manager_config.json")

# 确保 data 目录存在
os.makedirs(os.path.dirname(DEFAULT_CONFIG_FILE), exist_ok=True)


class ManagerConfig(BaseModel):
    """Manager Agent 配置模型"""
    name: str = Field(default="任务管理器", description="Manager 名称")
    role: str = Field(default="项目协调经理", description="Manager 角色")
    personality: str = Field(
        default="专业、有条理、善于规划和协调，能够准确分析需求并合理分配任务",
        description="Manager 性格描述"
    )
    avatar_type: str = Field(default="boy", description="头像类型")
    provider_id: str = Field(default="", description="关联的 Provider ID")
    is_active: bool = Field(default=False, description="是否启用 Manager 模式")

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump()

    def to_llm_config(self) -> Dict[str, Any]:
        """转换为 LLM 配置字典 - 从 Provider 获取"""
        from providers import provider_manager
        provider = provider_manager.get_provider(self.provider_id)
        if not provider:
            raise ValueError(f"Provider {self.provider_id} not found")

        return {
            "provider": provider.provider_type,
            "model_id": provider.model_id,
            "api_key": provider.api_key,
            "base_url": provider.base_url if provider.base_url else None,
        }


class ManagerConfigManager:
    """Manager 配置管理器"""

    def __init__(self, config_file: str = None):
        self._config_file = config_file or DEFAULT_CONFIG_FILE
        os.makedirs(os.path.dirname(self._config_file), exist_ok=True)
        self.config: ManagerConfig = ManagerConfig()
        self._load_config()

    def _load_config(self):
        """从文件加载配置"""
        if os.path.exists(self._config_file):
            try:
                with open(self._config_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.config = ManagerConfig(**data)
                print(f"✅ 已加载 Manager 配置: {self.config.name}")
            except Exception as e:
                print(f"⚠️ 加载 Manager 配置失败: {e}")
                self.config = self._create_default_config()
        else:
            self.config = self._create_default_config()

    def _create_default_config(self) -> ManagerConfig:
        """创建默认配置"""
        config = ManagerConfig()
        self._save_config(config)
        return config

    def _save_config(self, config: ManagerConfig):
        """保存配置到文件"""
        try:
            with open(self._config_file, 'w', encoding='utf-8') as f:
                json.dump(config.to_dict(), f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            print(f"⚠️ 保存 Manager 配置失败: {e}")
            return False

    def get_config(self) -> ManagerConfig:
        """获取当前配置"""
        return self.config

    def update_config(self, data: Dict[str, Any]) -> ManagerConfig:
        """更新配置"""
        for field in ["name", "role", "personality", "avatar_type", "provider_id", "is_active"]:
            if field in data:
                setattr(self.config, field, data[field])

        self._save_config(self.config)
        return self.config

    def to_info(self, provider_manager=None) -> Dict[str, Any]:
        """转换为信息字典"""
        if provider_manager is None:
            from providers import provider_manager as _pm
            provider_manager = _pm

        provider = provider_manager.get_provider(self.config.provider_id)
        provider_info = None
        if provider:
            provider_info = {
                "id": provider.id,
                "name": provider.name,
                "provider_type": provider.provider_type,
                "model_id": provider.model_id,
                "model_name": provider.model_name,
            }

        return {
            "id": "manager_default",
            "name": self.config.name,
            "role": self.config.role,
            "personality": self.config.personality,
            "avatar_type": self.config.avatar_type,
            "agent_type": "manager",
            "provider_id": self.config.provider_id,
            "provider": provider_info,
            "is_active": self.config.is_active,
        }

    def is_ready(self) -> bool:
        """检查 Manager 是否配置完成"""
        return (
            self.config.is_active and
            self.config.provider_id and
            len(self.config.personality) > 0
        )


# 全局配置管理器实例
manager_config_manager = ManagerConfigManager()
