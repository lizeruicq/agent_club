"""
聊天智能体 - 基于 AgentScope ReActAgent
支持 MsgHub 多 Agent 通信，集成工具调用能力
"""
from typing import Optional, Dict, Any, List
from agentscope.agent import AgentBase
from agentscope.message import Msg, TextBlock
from agentscope.memory import InMemoryMemory
from agentscope.model import DashScopeChatModel, OpenAIChatModel, AnthropicChatModel
from agentscope.agent import ReActAgent
from agentscope.formatter import OpenAIChatFormatter
from agentscope.tool import Toolkit

from tools import get_toolkit


class _MediaFilteringMemory:
    """包装 InMemoryMemory，过滤掉 image/audio/video block，替换为文本描述。

    某些模型 API（如 kimi 通过 Anthropic 兼容接口）不支持 file:// 格式的
    本地图片 URL。当 tool_result 中包含 ImageBlock 时，会导致 API 400 错误。
    此包装器在消息进入 memory 前将媒体 block 替换为文本引用，避免 API 报错。
    """

    def __init__(self, wrapped):
        self._wrapped = wrapped

    async def add(self, memories, marks=None, **kwargs):
        if memories is None:
            return
        if isinstance(memories, Msg):
            memories = self._filter_msg(memories)
        elif isinstance(memories, list):
            memories = [self._filter_msg(m) for m in memories if m is not None]
        await self._wrapped.add(memories, marks=marks, **kwargs)

    def _filter_block(self, block):
        """递归过滤单个 content block，处理嵌套在 tool_result output 中的媒体。"""
        typ = block.get("type")
        if typ == "image":
            src = block.get("source", {})
            url = src.get("url", "unknown") if isinstance(src, dict) else "unknown"
            return TextBlock(type="text", text=f"[图片: {url}]")
        elif typ == "audio":
            src = block.get("source", {})
            url = src.get("url", "unknown") if isinstance(src, dict) else "unknown"
            return TextBlock(type="text", text=f"[音频: {url}]")
        elif typ == "video":
            src = block.get("source", {})
            url = src.get("url", "unknown") if isinstance(src, dict) else "unknown"
            return TextBlock(type="text", text=f"[视频: {url}]")
        elif typ == "tool_result":
            output = block.get("output", [])
            if isinstance(output, list):
                filtered_output = []
                has_change = False
                for ob in output:
                    fb = self._filter_block(ob)
                    if fb is not ob:
                        has_change = True
                    filtered_output.append(fb)
                if has_change:
                    new_block = dict(block)
                    new_block["output"] = filtered_output
                    return new_block
        return block

    def _filter_msg(self, msg):
        if not msg or not msg.content:
            return msg
        filtered = []
        has_media = False
        for block in msg.get_content_blocks():
            fb = self._filter_block(block)
            if fb is not block:
                has_media = True
            filtered.append(fb)
        if not has_media:
            return msg
        return Msg(
            name=msg.name,
            content=filtered,
            role=msg.role,
            metadata=msg.metadata,
            invocation_id=getattr(msg, "invocation_id", None),
        )

    async def get_memory(self, **kwargs):
        return await self._wrapped.get_memory(**kwargs)

    async def delete_by_mark(self, **kwargs):
        return await self._wrapped.delete_by_mark(**kwargs)


class ChatAgent(AgentBase):
    """
    聊天智能体 - 支持多 Agent 协作对话

    Attributes:
        name: Agent 名称
        role: Agent 角色描述（用于 system prompt）
        personality: Agent 性格特点
        skill_names: 关联的 Skill 名称列表
    """

    def __init__(
        self,
        name: str,
        role: str,
        personality: str,
        model_name: str = "qwen-max",
        api_key: Optional[str] = None,
        llm_config: Optional[Dict[str, Any]] = None,
        skill_names: Optional[List[str]] = None,
        toolkit: Optional[Toolkit] = None,
    ):
        """
        初始化聊天智能体

        Args:
            name: Agent 名称（如"小蓝"、"小红"）
            role: Agent 角色（如"办公室助理"、"技术专家"）
            personality: Agent 性格描述
            model_name: 使用的语言模型名称
            api_key: API 密钥
            llm_config: 语言模型配置字典
            skill_names: 关联的技能名称列表
        """
        super().__init__()
        self.name = name
        self.role = role
        self.personality = personality
        self.skill_names = skill_names or []

        # 使用 llm_config 或回退到旧参数
        if llm_config:
            self.provider = llm_config.get("provider", "dashscope")
            self.model_name = llm_config.get("model_id", model_name)
            self.api_key = llm_config.get("api_key") or api_key
            raw_base_url = llm_config.get("base_url")
            self.base_url = raw_base_url if self.provider != "dashscope" else None
        else:
            self.provider = "dashscope"
            self.model_name = model_name
            self.api_key = api_key
            self.base_url = None

        # 初始化语言模型
        if not self.api_key:
            raise ValueError(f"API key is required for agent {name}")

        self.model = self._create_model()
        formatter = self._create_formatter()

        # 用户级 Toolkit 优先；未传入时回退到全局 Toolkit，保持兼容。
        toolkit = toolkit or get_toolkit()

        # 创建 ReAct 智能体，使用角色化的 system prompt
        sys_prompt = self._create_system_prompt()
        self.react_agent = ReActAgent(
            name=name,
            sys_prompt=sys_prompt,
            model=self.model,
            formatter=formatter,
            toolkit=toolkit,  # 注册工具
            memory=_MediaFilteringMemory(InMemoryMemory()),
            max_iters=10,
        )

    def _create_system_prompt(self) -> str:
        """创建角色化的 system prompt，注入所有启用的技能"""
        from tools import list_tools
        available_tools = list_tools()
        tools_info = "、".join(available_tools) if available_tools else "暂无"

        # 注入技能说明
        from skills import skill_registry
        skills_prompt = skill_registry.get_skills_prompt(self.skill_names)

        base_prompt = f"""你是{self.name}，{self.role}。

你的性格特点：{self.personality}

你可以使用的工具：{tools_info}

请记住：
1. 始终保持你的角色人设，用符合性格的方式说话
2. 当其他同事（其他 Agent）发言时，你可以回应或补充
3. 你的回答应该简洁、有趣、有互动性
4. 不要透露你是 AI，始终保持角色扮演
5. 需要时使用工具完成任务，但不要过度依赖
"""

        if skills_prompt:
            print(f"   📎 [{self.name}] 注入 skills: {self.skill_names}")
            return base_prompt + "\n\n" + skills_prompt
        print(f"   📎 [{self.name}] 无 skills 注入")
        return base_prompt

    def _create_model(self):
        """根据配置创建对应的模型实例"""
        if self.provider == "dashscope":
            return OpenAIChatModel(
                model_name=self.model_name,
                api_key=self.api_key,
                client_kwargs={"base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1"},
                stream=False,
            )
        elif self.provider == "kimicode":
            client_kwargs = {}
            if self.base_url:
                client_kwargs["base_url"] = self.base_url
            return AnthropicChatModel(
                model_name=self.model_name,
                api_key=self.api_key,
                client_kwargs=client_kwargs if client_kwargs else None,
                stream=False,
            )
        elif self.provider in ["openai", "anthropic", "custom"]:
            client_kwargs = {}
            if self.base_url:
                client_kwargs["base_url"] = self.base_url
            return OpenAIChatModel(
                model_name=self.model_name,
                api_key=self.api_key,
                client_kwargs=client_kwargs if client_kwargs else None,
                stream=False,
            )
        else:
            return DashScopeChatModel(
                model_name=self.model_name,
                api_key=self.api_key
            )

    def _create_formatter(self):
        """根据配置创建对应的 formatter"""
        if self.provider == "kimicode":
            from agentscope.formatter import AnthropicChatFormatter
            return AnthropicChatFormatter()
        return OpenAIChatFormatter()

    async def observe(self, msg: Msg) -> None:
        """接收其他 agent 的消息，放入 ReActAgent 的 memory（支持 MsgHub 广播）。"""
        if self.react_agent and hasattr(self.react_agent, 'observe'):
            await self.react_agent.observe(msg)

    async def reply(self, msg: Msg) -> Msg:
        """
        处理消息并生成回复

        skill 已通过 system prompt 全局注入，LLM 自主决定是否使用。
        无需再对单条消息做额外扫描或注入。

        Args:
            msg: 输入消息

        Returns:
            Agent 的回复消息
        """
        return await self.react_agent.reply(msg)

#
# def create_default_agents(llm_config: Dict[str, Any]) -> List[ChatAgent]:
#     """
#     创建默认的双 Agent 配置
#
#     Args:
#         llm_config: 语言模型配置
#
#     Returns:
#         包含两个 Agent 的列表
#     """
#     agent1 = ChatAgent(
#         name="小智",
#         role="办公室技术专家",
#         personality="专业、理性、喜欢分享技术知识，说话简洁明了，偶尔会给出实用的建议",
#         llm_config=llm_config,
#     )
#
#     agent2 = ChatAgent(
#         name="小美",
#         role="办公室行政助理",
#         personality="热情、友好、善于沟通，说话温柔体贴，喜欢帮助同事解决问题",
#         llm_config=llm_config,
#     )
#
#     return [agent1, agent2]
