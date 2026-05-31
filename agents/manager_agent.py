"""
管理者智能体 - 负责任务分析、规划和分派
基于 AgentScope 实现 Manager-Worker 协作模式
"""
from typing import Optional, Dict, Any, List, Callable, Literal
import json
import asyncio
from agentscope.agent import AgentBase
from agentscope.message import Msg
from agentscope.model import DashScopeChatModel, OpenAIChatModel, AnthropicChatModel
from agentscope.formatter import OpenAIChatFormatter
from agentscope.tool import Toolkit
from pydantic import BaseModel, Field

from tools import get_toolkit


class TaskPlan:
    """任务计划"""
    def __init__(self, task_id: str, description: str, steps: List[Dict]):
        self.task_id = task_id
        self.description = description
        self.steps = steps  # 每个步骤包含: agent_name, action, input
        self.results = {}   # 存储每个步骤的结果
        self.status = "pending"  # pending, running, completed, failed

    def to_dict(self) -> Dict:
        return {
            "task_id": self.task_id,
            "description": self.description,
            "steps": self.steps,
            "results": self.results,
            "status": self.status
        }


class TaskPlanStepModel(BaseModel):
    """Manager 规划输出中的单个步骤。"""
    step_id: int = Field(..., ge=1)
    worker_id: Optional[str] = None
    agent_name: Optional[str] = None
    task: str = Field(..., min_length=1)
    input: str = ""
    artifact_type: Literal[
        "none",
        "document",
        "html",
        "code",
        "analysis",
        "test_report",
        "data",
    ] = "none"
    output: Optional[str] = None
    depends_on: List[int] = Field(default_factory=list)


class TaskPlanDecisionModel(BaseModel):
    """Manager 规划输出 schema。"""
    need_dispatch: bool
    reason: str = ""
    steps: List[TaskPlanStepModel] = Field(default_factory=list)


class ManagerAgent(AgentBase):
    """
    管理者智能体 - 任务协调中心

    职责:
    1. 分析用户请求，拆解为子任务
    2. 根据Worker能力分派任务
    3. 收集Worker结果，整合回复
    4. 管理任务执行顺序和依赖
    """

    def __init__(
        self,
        name: str = "任务管理器",
        role: str = "项目协调经理",
        personality: str = "专业、有条理、善于规划和协调，能够准确分析需求并合理分配任务",
        model_name: str = "qwen-max",
        api_key: Optional[str] = None,
        llm_config: Optional[Dict[str, Any]] = None,
        skill_names: Optional[List[str]] = None,
        toolkit: Optional[Toolkit] = None,
        event_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ):
        super().__init__()
        self.name = name
        self.role = role
        self.personality = personality
        self.skill_names = skill_names or []
        self.toolkit = toolkit or get_toolkit()
        self._event_callback = event_callback

        # 初始化模型
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

        self.model = self._create_model()
        self.formatter = self._create_formatter()

        # Worker注册表
        self._workers: Dict[str, 'WorkerAgent'] = {}
        self._workers_by_name: Dict[str, 'WorkerAgent'] = {}

        # 任务历史
        self._task_history: List[TaskPlan] = []

    def _emit(self, event_type: str, **kwargs):
        """发射中间过程事件，供流式展示使用"""
        if self._event_callback:
            try:
                self._event_callback({"type": event_type, **kwargs})
            except Exception:
                pass

    def _create_model(self):
        """创建模型实例 - Manager 不需要流式输出"""
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

    def _get_skills_prompt(self) -> str:
        """获取技能说明文本，用于注入 system prompt"""
        from skills import skill_registry
        return skill_registry.get_skills_prompt(self.skill_names)

    def register_worker(self, worker: 'WorkerAgent'):
        """注册Worker Agent"""
        self._workers[worker.worker_id] = worker
        self._workers_by_name[worker.name] = worker
        worker.set_manager(self)  # 告诉Worker谁是Manager
        print(f"✅ Manager 注册 Worker: {worker.name} ({worker.specialty})")

    def get_worker_capabilities(self) -> str:
        """获取所有Worker的能力描述"""
        capabilities = []
        for worker_id, worker in self._workers.items():
            capabilities.append(
                f"- worker_id: {worker_id}\n  name: {worker.name}\n  specialty: {worker.specialty}\n  expertise: {worker.expertise}"
            )
        return "\n".join(capabilities)

    def _extract_text_from_response(self, content) -> str:
        """从模型响应中提取文本内容"""
        if isinstance(content, list):
            # 查找 type='text' 的元素
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    return item.get("text", "")
            # 如果没找到，取第一个字典的 text 字段或字符串表示
            if content:
                first = content[0]
                if isinstance(first, dict):
                    return first.get("text", str(first))
                return str(first)
            return ""
        elif isinstance(content, dict):
            return content.get("text", str(content))
        else:
            return str(content)

    async def reply(self, msg: Msg) -> Msg:
        """
        处理用户请求 - Manager的核心逻辑

        流程:
        1. 分析请求，理解意图
        2. 拆解为子任务
        3. 分派给合适的Worker
        4. 收集结果并整合
        """
        user_content = msg.content
        print(f"\n{'='*60}")
        print(f"🎯 [Manager] 收到用户请求: {user_content[:50]}...")
        print(f"{'='*60}")

        # 步骤1: 分析请求并制定计划
        print(f"\n📋 [Manager] 步骤1: 分析请求并制定计划...")
        self._emit("manager_thinking", agent_name=self.name, role=self.role, content="正在分析任务需求...")
        task_plan = await self._create_task_plan(user_content)

        if not task_plan.steps:
            # 不需要分派，自己处理
            print(f"✅ [Manager] 判断: 不需要分派，直接处理")
            return await self._handle_directly(msg)

        print(f"✅ [Manager] 任务计划创建完成:")
        print(f"   任务ID: {task_plan.task_id}")
        print(f"   步骤数: {len(task_plan.steps)}")
        for i, step in enumerate(task_plan.steps, 1):
            print(f"   步骤{i}: {step.get('agent_name')} -> {step.get('task', '')[:30]}...")

        # 发射计划完成事件
        self._emit("plan_done",
            agent_name=self.name,
            steps=[{"agent_name": s.get("agent_name"), "task": s.get("task", "")} for s in task_plan.steps]
        )

        # 步骤2: 执行计划，分派任务
        print(f"\n🚀 [Manager] 步骤2: 开始分派任务...")
        await self._execute_plan(task_plan)

        # 步骤3: 整合结果
        print(f"\n🔀 [Manager] 步骤3: 整合所有Worker结果...")
        self._emit("manager_integrating", agent_name=self.name, role=self.role, content="正在整合团队成员的结果...")
        final_response = await self._integrate_results(task_plan)

        print(f"\n✅ [Manager] 任务完成，返回最终回复")
        print(f"{'='*60}\n")

        final_msg = Msg(
            name=self.name,
            content=final_response,
            role="assistant"
        )
        return final_msg

    async def _create_task_plan(self, user_request: str) -> TaskPlan:
        """分析用户请求，创建任务执行计划"""

        skills_text = self._get_skills_prompt()
        system_prompt = f"""你是{self.name}，{self.role}。

你的团队成员及其专长：
{self.get_worker_capabilities()}

{skills_text}

请分析用户的请求，判断是否需要分派给团队成员：
1. 如果请求简单，直接回复 "DIRECT"，不需要分派
2. 如果需要多个步骤或不同专长，制定分派计划

文件协作约定（必须遵守）：
- 不要按团队成员名称决定是否产出文件，要根据用户请求和步骤真实需要决定。
- artifact_type 表示该步骤主要产物类型：none、document、html、code、analysis、test_report、data。
- 只有需要被用户查看、后续步骤读取或持久保存的产物，才填写 output；纯讨论、判断、协调类步骤使用 artifact_type="none"，output 可省略。
- output 是给文件工具使用的逻辑保存目标，不要在任务说明中解释真实磁盘目录或用户目录映射。
- 可交互 HTML 产物应尽量写成单文件，CSS/JavaScript 内联。
- 如步骤依赖上游产物，请在 input 中明确需要读取的文件引用。

请以JSON格式回复：
{{
    "need_dispatch": true/false,
    "reason": "为什么需要/不需要分派",
    "steps": [
        {{
            "step_id": 1,
            "worker_id": "必须从上方团队成员列表中选择 worker_id",
            "agent_name": "负责该步骤的Agent名称，仅用于展示",
            "task": "具体任务描述",
            "input": "需要传递给Agent的输入",
            "artifact_type": "none/document/html/code/analysis/test_report/data",
            "output": "可选，只有需要持久化产物时填写；无产物时省略",
            "depends_on": []  // 依赖的步骤ID
        }}
    ]
}}
"""

        planning_msg = Msg(name="system", content=system_prompt, role="system")
        user_msg = Msg(name="User", content=user_request, role="user")

        prompt = await self.formatter.format([planning_msg, user_msg])
        response = await self.model(prompt)

        try:
            content = self._extract_text_from_response(response.content)
            print(f"\n🤔 [Manager] AI规划思考:\n{content[:500]}...")

            decision = self._parse_task_plan_decision(content)
            reason = decision.reason
            print(f"\n📊 [Manager] 决策分析:")
            print(f"   需要分派: {decision.need_dispatch}")
            print(f"   原因: {reason[:100]}...")

            if not decision.need_dispatch:
                print(f"   结论: 任务简单，Manager直接处理")
                return TaskPlan(
                    task_id=f"task_{len(self._task_history)}",
                    description=user_request,
                    steps=[]
                )

            steps = self._normalize_task_steps(decision.steps)
            print(f"   结论: 需要分派给{len(steps)}个Worker执行")

            if not steps:
                print("   结论: 没有有效步骤，Manager直接处理")
                return TaskPlan(
                    task_id=f"task_{len(self._task_history)}",
                    description=user_request,
                    steps=[]
                )

            # 创建任务计划
            task_plan = TaskPlan(
                task_id=f"task_{len(self._task_history)}",
                description=user_request,
                steps=steps
            )
            self._task_history.append(task_plan)

            return task_plan

        except Exception as e:
            print(f"\n⚠️ [Manager] 计划创建失败: {e}, 将直接处理")
            return TaskPlan(
                task_id=f"task_{len(self._task_history)}",
                description=user_request,
                steps=[]
            )

    def _parse_task_plan_decision(self, content: str) -> TaskPlanDecisionModel:
        """解析并校验 Manager 规划输出。"""
        json_str = self._extract_json(content)
        plan_data = json.loads(json_str)
        return TaskPlanDecisionModel.model_validate(plan_data)

    def _normalize_task_steps(self, steps: List[TaskPlanStepModel]) -> List[Dict[str, Any]]:
        """把 LLM 输出步骤规范化为内部执行协议。"""
        normalized: List[Dict[str, Any]] = []
        seen_ids = set()
        for index, step in enumerate(steps, start=1):
            worker_id = step.worker_id
            worker = self._workers.get(worker_id or "") if worker_id else None
            if not worker and step.agent_name:
                worker = self._workers_by_name.get(step.agent_name)
                worker_id = worker.worker_id if worker else None
            if not worker or not worker_id:
                print(f"⚠️ [Manager] 跳过无效步骤 {step.step_id}: worker 不存在 ({step.worker_id or step.agent_name})")
                continue

            step_id = step.step_id if step.step_id not in seen_ids else index
            seen_ids.add(step_id)
            depends_on = [dep for dep in step.depends_on if dep in seen_ids or dep < step_id]
            normalized.append({
                "step_id": step_id,
                "worker_id": worker_id,
                "agent_name": worker.name,
                "task": step.task.strip(),
                "input": step.input.strip(),
                "artifact_type": step.artifact_type,
                "output": step.output.strip() if step.output else None,
                "depends_on": depends_on,
            })
        return normalized

    async def _execute_plan(self, task_plan: TaskPlan):
        """执行任务计划"""
        task_plan.status = "running"

        # 按依赖顺序执行任务。只有真正成功的步骤才会解锁下游依赖。
        succeeded_steps = set()
        failed_steps = set()
        skipped_steps = set()
        print(f"\n📋 [Manager] 开始执行{len(task_plan.steps)}个步骤...")

        while len(succeeded_steps) + len(failed_steps) + len(skipped_steps) < len(task_plan.steps):
            terminal_steps = succeeded_steps | failed_steps | skipped_steps

            # 依赖失败的步骤不能继续执行，直接标记为跳过。
            for step in task_plan.steps:
                step_id = step["step_id"]
                if step_id in terminal_steps:
                    continue
                blocked_deps = [
                    dep for dep in step.get("depends_on", [])
                    if dep in failed_steps or dep in skipped_steps
                ]
                if blocked_deps:
                    skipped_steps.add(step_id)
                    task_plan.results[step_id] = {
                        "status": "skipped",
                        "agent": step.get("agent_name"),
                        "error": f"上游步骤失败或跳过，无法执行依赖: {blocked_deps}",
                    }
                    print(f"   ⏭️ 步骤跳过: {step.get('agent_name')} - 依赖失败 {blocked_deps}")

            terminal_steps = succeeded_steps | failed_steps | skipped_steps
            if len(terminal_steps) >= len(task_plan.steps):
                break

            # 找到可以执行的任务（依赖已满足）
            ready_steps = [
                step for step in task_plan.steps
                if step["step_id"] not in terminal_steps
                and all(dep in succeeded_steps for dep in step.get("depends_on", []))
            ]

            if not ready_steps:
                print(f"⚠️ [Manager] 没有可执行的步骤，可能存在循环依赖或无法满足的依赖")
                for step in task_plan.steps:
                    step_id = step["step_id"]
                    if step_id not in succeeded_steps and step_id not in failed_steps and step_id not in skipped_steps:
                        failed_steps.add(step_id)
                        task_plan.results[step_id] = {
                            "status": "failed",
                            "agent": step.get("agent_name"),
                            "error": "依赖无法满足或存在循环依赖",
                        }
                break

            print(f"\n   🔄 本轮可执行步骤: {[s.get('agent_name') for s in ready_steps]}")

            # 并行执行准备好的任务
            results = await asyncio.gather(
                *(self._execute_step(step, task_plan) for step in ready_steps),
                return_exceptions=True,
            )

            for step, result in zip(ready_steps, results):
                step_id = step["step_id"]
                if isinstance(result, Exception):
                    result = {
                        "status": "failed",
                        "agent": step.get("agent_name"),
                        "error": str(result),
                    }

                if not isinstance(result, dict):
                    result = task_plan.results.get(step_id) or {
                        "status": "failed",
                        "agent": step.get("agent_name"),
                        "error": "步骤未返回有效执行结果",
                    }

                task_plan.results[step_id] = result
                if result.get("status") == "completed":
                    succeeded_steps.add(step_id)
                    print(f"   ✅ 步骤完成: {step.get('agent_name')} - {step.get('task', '')[:30]}...")
                else:
                    failed_steps.add(step_id)
                    print(f"   ❌ 步骤失败: {step.get('agent_name')} - {result.get('error', '未知错误')}")

        if failed_steps or skipped_steps:
            task_plan.status = "failed"
            print(f"\n⚠️ [Manager] 计划执行结束，成功={len(succeeded_steps)}，失败={len(failed_steps)}，跳过={len(skipped_steps)}")
        else:
            task_plan.status = "completed"
            print(f"\n✅ [Manager] 所有步骤执行完成")

    def _extract_summary(self, content) -> str:
        """从 Agent 响应内容中提取纯文本摘要"""
        if not content:
            return ""
        if isinstance(content, list):
            texts = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    texts.append(item.get("text", ""))
                elif isinstance(item, str):
                    texts.append(item)
            return "\n".join(texts)
        elif isinstance(content, dict):
            return content.get("text", str(content))
        return str(content)

    def _extract_file_paths(self, text: str) -> List[str]:
        """从文本中提取可能的文件路径（如 output/doc/prd.md）"""
        import re
        # 匹配 output/ 开头的路径
        paths = re.findall(r'output/[\w\-/.]+\.(?:md|html|css|js|json|txt|py)', text)
        # 匹配文件引用格式："保存到 xxx"、"写入 xxx"
        paths += re.findall(r'(?:保存到|写入|路径[:：]?\s*)[`"\']?(output/[\w\-/.]+)[`"\']?', text)
        return sorted(set(paths))

    def _build_context_from_results(self, task_plan: TaskPlan, depends_on: List[int]) -> str:
        """从上游步骤结果中构建精简上下文（简短摘要 + 明确的文件引用）。"""
        context_parts = []
        file_refs = []
        for dep_id in depends_on:
            dep_result = task_plan.results.get(dep_id)
            dep_step = next((s for s in task_plan.steps if s["step_id"] == dep_id), None)
            if dep_result and dep_result.get("status") == "completed":
                dep_agent = dep_step.get("agent_name", "未知") if dep_step else "未知"
                summary = dep_result.get("summary", "")
                if summary:
                    # 摘要始终简短，只给概览
                    context_parts.append(f"【{dep_agent} 的成果概览】\n{summary[:300]}")
                # 收集上游步骤引用的文件路径
                ref_files = dep_result.get("referenced_files", [])
                if ref_files:
                    file_refs.extend(ref_files)
            # 收集上游步骤在计划中约定的 output 文件路径
            if dep_step and dep_step.get("output"):
                file_refs.append(dep_step["output"])

        result = "\n\n".join(context_parts)
        if file_refs:
            unique_files = sorted(set(file_refs))
            result += (
                f"\n\n【必读文件】\n"
                f"以上仅为概览；如你的任务需要使用上游产物，请先读取以下原始文件：\n"
                + "\n".join(f"- read_file('{f}')" for f in unique_files)
            )
        return result

    def _build_file_instruction(self, step: Dict) -> str:
        """根据计划中的产物类型和路径生成文件协作提示。"""
        artifact_type = step.get("artifact_type") or "none"
        output_file = (step.get("output") or "").strip()
        file_notes = []

        if step.get("depends_on"):
            file_notes.append("【前置读取】如任务需要使用上游产物，请优先按【必读文件】中的文件引用调用 read_file 读取原文，不要只依赖摘要。")

        if not output_file:
            if artifact_type != "none":
                file_notes.append("【产出判断】当前步骤标记为需要产物，但计划未指定保存目标；如确需保存，请自拟清晰文件名并在回复中说明。")
            return "\n".join(file_notes)

        if output_file.startswith("output/doc/") or artifact_type in {"document", "analysis", "test_report"}:
            file_notes.append("【文档保存】请将本步骤需要持久化的文档、分析或报告保存到【产出要求】指定的位置。")
        elif output_file.startswith("output/preview/") or artifact_type == "html":
            file_notes.append("【HTML保存】请将可预览的 HTML 保存到【产出要求】指定的位置。")
            file_notes.append("【HTML要求】除非用户明确要求多文件项目，HTML 应尽量包含内联 CSS 和 JavaScript，完成后不需要打开浏览器预览、截图或发送文件。")
        else:
            file_notes.append("【文件保存】请将本步骤需要持久化的产物保存到【产出要求】指定的位置。")

        return "\n".join(file_notes)

    def _step_timeout_seconds(self, step: Dict) -> float:
        """根据步骤是否需要持久化产物设置超时。"""
        artifact_type = step.get("artifact_type") or "none"
        output_file = (step.get("output") or "").strip()
        if artifact_type != "none" or output_file:
            return 600.0
        return 120.0

    async def _execute_step(self, step: Dict, task_plan: TaskPlan):
        """执行单个步骤"""
        worker_id = step.get("worker_id")
        agent_name = step.get("agent_name")
        task_description = step.get("task")
        task_input = step.get("input", "")

        print(f"\n   📤 [Manager] 分派任务给 {agent_name}:")
        print(f"      任务: {task_description[:50]}...")

        worker = self._workers.get(worker_id) or self._workers_by_name.get(agent_name)
        if not worker:
            print(f"      ❌ Worker {worker_id or agent_name} 未找到")
            result = {
                "status": "failed",
                "error": f"Worker {worker_id or agent_name} 未找到"
            }
            task_plan.results[step["step_id"]] = result
            return result
        agent_name = worker.name

        # 发射 Worker 开始事件
        self._emit("worker_start",
            agent_name=agent_name,
            task=task_description,
            role=worker.role
        )

        # Manager 统一构建精简上下文：只提取上游步骤的文本摘要
        context_str = self._build_context_from_results(
            task_plan, step.get("depends_on", [])
        )

        file_instruction = self._build_file_instruction(step)

        # 构建精简的任务消息
        if context_str:
            task_content = (
                f"【任务分派】\n"
                f"任务: {task_description}\n"
                f"输入: {task_input}\n\n"
                f"【前置产出参考】\n"
                f"{context_str}\n\n"
                f"请直接基于以上内容执行任务。"
            )
        else:
            task_content = (
                f"【任务分派】\n"
                f"任务: {task_description}\n"
                f"输入: {task_input}\n"
                f"请执行此任务并返回结果。"
            )

        if file_instruction:
            task_content += f"\n\n{file_instruction}"

        # 如果当前步骤在计划中约定了产出文件路径，明确告知 Worker
        output_file = step.get("output")
        if output_file:
            task_content += f"\n\n【产出要求】请将本步骤的主要产出保存到: {output_file}"

        task_msg = Msg(
            name=self.name,
            content=task_content,
            role="user"
        )

        timeout_seconds = self._step_timeout_seconds(step)

        try:
            # 调用Worker，添加超时保护
            print(f"      ⏳ 等待 {agent_name} 执行（超时 {int(timeout_seconds)} 秒）...")
            response = await asyncio.wait_for(
                worker.reply(task_msg),
                timeout=timeout_seconds,
            )

            # Manager 统一提取摘要
            result_summary = self._extract_summary(response.content)
            result_preview = result_summary[:100] if result_summary else ""
            print(f"      ✅ {agent_name} 完成，摘要: {result_preview}...")

            # 从摘要中提取文件路径，供下游步骤引用
            referenced_files = self._extract_file_paths(result_summary)

            result = {
                "status": "completed",
                "agent": agent_name,
                "result": response.content,      # 完整结果（供最终整合使用）
                "summary": result_summary,        # 文本摘要（供下游Worker参考）
                "referenced_files": referenced_files,  # 引用的文件路径
            }
            task_plan.results[step["step_id"]] = result

            # 发射 Worker 完成事件
            self._emit("worker_done",
                agent_name=agent_name,
                result=result_summary,
                task=task_description
            )
            return result

        except asyncio.TimeoutError:
            print(f"      ❌ {agent_name} 执行超时（{int(timeout_seconds)} 秒）")
            result = {
                "status": "failed",
                "agent": agent_name,
                "error": f"执行超时（{int(timeout_seconds)} 秒），任务未完成"
            }
            task_plan.results[step["step_id"]] = result
            self._emit("worker_done",
                agent_name=agent_name,
                result=f"执行超时（{int(timeout_seconds)} 秒）",
                task=task_description,
                failed=True
            )
            return result
        except Exception as e:
            print(f"      ❌ {agent_name} 执行失败: {e}")
            result = {
                "status": "failed",
                "agent": agent_name,
                "error": str(e)
            }
            task_plan.results[step["step_id"]] = result
            self._emit("worker_done",
                agent_name=agent_name,
                result=f"执行失败: {e}",
                task=task_description,
                failed=True
            )
            return result
        finally:
            # 清空 Worker 的独立 memory，避免上下文累积影响后续任务
            if worker._agent and hasattr(worker._agent, 'react_agent') and worker._agent.react_agent:
                from agentscope.memory import InMemoryMemory
                from agents.chat_agent import _MediaFilteringMemory
                worker._agent.react_agent.memory = _MediaFilteringMemory(InMemoryMemory())
                print(f"      🧹 [{agent_name}] 已清空对话上下文")

    async def _integrate_results(self, task_plan: TaskPlan) -> str:
        """整合所有Worker的结果（使用摘要而非原始内容）"""

        results_summary = []
        for step in task_plan.steps:
            step_id = step["step_id"]
            result = task_plan.results.get(step_id, {})

            if result.get("status") == "completed":
                # 优先使用摘要，更简洁且为纯文本
                text = result.get("summary", "")
                if not text:
                    text = self._extract_summary(result.get("result", ""))
                results_summary.append(
                    f"步骤 {step_id} ({step.get('agent_name')}):\n{text}"
                )
            else:
                results_summary.append(
                    f"步骤 {step_id} ({step.get('agent_name')}):\n"
                    f"执行失败: {result.get('error', '未知错误')}"
                )

        all_results = "\n\n---\n\n".join(results_summary)
        print(f"\n   📊 [Manager] 收集到{len(results_summary)}个Worker的结果")

        # 让Manager整合结果
        skills_text = self._get_skills_prompt()
        system_prompt = f"""你是{self.name}，{self.role}。

原始用户请求: {task_plan.description}

{skills_text}

各团队成员的执行结果：
{all_results}

请以你的角色整合以上结果，给用户一个完整、连贯的回复。
保持你的人设，回答应该简洁、专业。
"""

        # Anthropic API 要求 messages 非空且不能只有 system 消息
        # 将 system prompt 和整合请求合并为 user 消息
        integrate_msg = Msg(
            name="user",
            content=system_prompt,
            role="user",
        )

        prompt = await self.formatter.format([integrate_msg])
        response = await self.model(prompt)

        final_content = self._extract_text_from_response(response.content)
        print(f"   ✅ [Manager] 结果整合完成，生成回复长度: {len(final_content)}字符")

        return final_content

    async def _handle_directly(self, msg: Msg) -> Msg:
        """直接处理请求（不需要分派）"""
        skills_text = self._get_skills_prompt()
        system_prompt = f"""你是{self.name}，{self.role}。

你的性格特点：{self.personality}

{skills_text}

可以直接回答用户的问题，不需要分派给团队成员。"""

        system_msg = Msg(name="system", content=system_prompt, role="system")

        print(f"\n   🧠 [Manager] 直接处理请求（不经过Workers）...")
        self._emit("manager_integrating", agent_name=self.name, role=self.role)
        prompt = await self.formatter.format([system_msg, msg])
        response = await self.model(prompt)

        content = self._extract_text_from_response(response.content)
        print(f"   ✅ [Manager] 直接回复完成，长度: {len(content)}字符")

        return Msg(name=self.name, content=content, role="assistant")

    def _extract_json(self, text: str) -> str:
        """从文本中提取JSON"""
        # 尝试找到JSON块
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1:
            return text[start:end+1]
        return text

    async def __call__(self, msg: Msg) -> Msg:
        """使 Agent 可以直接被调用"""
        return await self.reply(msg)


class WorkerAgent:
    """
    Worker Agent 接口 - 被Manager调用的Agent
    """

    def __init__(
        self,
        name: str,
        role: str,
        personality: str,
        specialty: str,  # 专业领域
        expertise: str,  # 具体专长描述
        worker_id: Optional[str] = None,
        model_name: str = "qwen-max",
        api_key: Optional[str] = None,
        llm_config: Optional[Dict[str, Any]] = None,
        tools: Optional[List[str]] = None,  # 该Worker可用的工具
        skill_names: Optional[List[str]] = None,
        toolkit: Optional[Toolkit] = None,
    ):
        self.worker_id = worker_id or name
        self.name = name
        self.role = role
        self.personality = personality
        self.specialty = specialty
        self.expertise = expertise
        self._manager: Optional[ManagerAgent] = None
        self._available_tools = tools or []

        # 初始化底层 Agent
        from .chat_agent import ChatAgent

        # 构建带工具限制的llm_config
        worker_llm_config = llm_config or {
            "provider": "dashscope",
            "model_id": model_name,
            "api_key": api_key
        }

        self._agent = ChatAgent(
            name=name,
            role=role,
            personality=personality,
            llm_config=worker_llm_config,
            skill_names=skill_names,
            toolkit=toolkit,
        )

    def set_manager(self, manager: ManagerAgent):
        """设置Manager"""
        self._manager = manager

    async def reply(self, msg: Msg) -> Msg:
        """响应Manager分派的任务"""
        # 添加角色提示
        enhanced_content = f"""{msg.content}

记住你是{self.name}，{self.role}，你的专长是：{self.expertise}
请用符合你人设的方式回复。"""

        enhanced_msg = Msg(
            name=msg.name,
            content=enhanced_content,
            role=msg.role
        )

        return await self._agent.reply(enhanced_msg)

    async def __call__(self, msg: Msg) -> Msg:
        return await self.reply(msg)
