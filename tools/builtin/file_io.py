# -*- coding: utf-8 -*-
"""
文件操作工具集
提供基础的文件读写、编辑功能
"""
import os
from pathlib import Path
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Optional
from agentscope.message import TextBlock
from agentscope.tool import ToolResponse


# 默认项目根目录。用户运行时会通过 ContextVar 注入自己的 workspace。
PROJECT_ROOT = Path(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
WORKING_DIR = PROJECT_ROOT


@dataclass(frozen=True)
class FileWorkspace:
    """Agent 文件工具可访问的用户级工作区。"""
    root_dir: Path
    preview_dir: Path
    doc_dir: Path


_CURRENT_WORKSPACE: ContextVar[Optional[FileWorkspace]] = ContextVar(
    "agent_file_workspace",
    default=None,
)


def build_workspace(root_dir: str, preview_dir: str, doc_dir: str) -> FileWorkspace:
    """构建规范化的文件工具工作区。"""
    return FileWorkspace(
        root_dir=Path(root_dir).expanduser().resolve(),
        preview_dir=Path(preview_dir).expanduser().resolve(),
        doc_dir=Path(doc_dir).expanduser().resolve(),
    )


def get_working_dir() -> Path:
    """获取当前工具调用的默认工作目录。"""
    workspace = _CURRENT_WORKSPACE.get()
    return workspace.root_dir if workspace else WORKING_DIR


@contextmanager
def workspace_context(workspace: Optional[FileWorkspace]):
    """在一次工具调用期间绑定用户工作区。"""
    if workspace is None:
        yield
        return
    token = _CURRENT_WORKSPACE.set(workspace)
    try:
        yield
    finally:
        _CURRENT_WORKSPACE.reset(token)


def _is_relative_to(path: Path, base: Path) -> bool:
    try:
        path.relative_to(base)
        return True
    except ValueError:
        return False


def _resolve_file_path(file_path: str) -> str:
    """
    解析文件路径
    - 无用户 workspace 时，相对路径从项目根目录解析
    - 有用户 workspace 时，路径限制在用户 output 目录内
    - output/preview/* 映射到用户 HTML 预览目录
    - output/doc/* 映射到用户文档产出目录
    """
    workspace = _CURRENT_WORKSPACE.get()
    raw = (file_path or "").strip().replace("\\", "/").lstrip("/")

    if workspace:
        if raw == "output":
            candidate = workspace.root_dir
        elif raw.startswith("output/preview/"):
            candidate = workspace.preview_dir / raw.removeprefix("output/preview/")
        elif raw.startswith("output/doc/"):
            candidate = workspace.doc_dir / raw.removeprefix("output/doc/")
        elif raw.startswith("output/"):
            candidate = workspace.root_dir / raw.removeprefix("output/")
        else:
            path = Path(file_path).expanduser()
            candidate = path if path.is_absolute() else workspace.root_dir / raw

        resolved = candidate.resolve()
        allowed_roots = (workspace.root_dir, workspace.preview_dir, workspace.doc_dir)
        if not any(_is_relative_to(resolved, root) for root in allowed_roots):
            raise ValueError(
                f"路径 {file_path} 不在当前用户工作区内；请使用 output/preview/、output/doc/ 或相对路径"
            )
        return str(resolved)

    path = Path(file_path).expanduser()
    if path.is_absolute():
        return str(path)
    return str(WORKING_DIR / file_path)


async def read_file(
    file_path: str,
    start_line: Optional[int] = None,
    end_line: Optional[int] = None,
) -> ToolResponse:
    """
    读取文件内容

    可以指定行号范围读取部分内容，不指定则读取全部

    Args:
        file_path: 文件路径（相对或绝对）
        start_line: 起始行号（1-based，包含）
        end_line: 结束行号（1-based，包含）

    Returns:
        ToolResponse: 包含文件内容的响应
    """
    # 参数类型转换
    if start_line is not None:
        try:
            start_line = int(start_line)
        except (ValueError, TypeError):
            return ToolResponse(
                content=[TextBlock(
                    type="text",
                    text=f"错误: start_line 必须是整数，当前值: {start_line!r}"
                )]
            )

    if end_line is not None:
        try:
            end_line = int(end_line)
        except (ValueError, TypeError):
            return ToolResponse(
                content=[TextBlock(
                    type="text",
                    text=f"错误: end_line 必须是整数，当前值: {end_line!r}"
                )]
            )

    try:
        file_path = _resolve_file_path(file_path)
    except Exception as e:
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: 路径无效 - {e}")]
        )

    # 检查文件存在性
    if not os.path.exists(file_path):
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: 文件 {file_path} 不存在")]
        )

    if not os.path.isfile(file_path):
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: {file_path} 不是文件")]
        )

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        all_lines = content.split("\n")
        total = len(all_lines)

        # 确定读取范围
        s = max(1, start_line if start_line is not None else 1)
        e = min(total, end_line if end_line is not None else total)

        if s > total:
            return ToolResponse(
                content=[TextBlock(
                    type="text",
                    text=f"错误: 起始行 {s} 超出文件长度 ({total} 行)"
                )]
            )

        if s > e:
            return ToolResponse(
                content=[TextBlock(
                    type="text",
                    text=f"错误: 起始行 ({s}) > 结束行 ({e})"
                )]
            )

        # 提取选中行
        selected_lines = all_lines[s - 1:e]
        selected_content = "\n".join(selected_lines)

        # 构建输出
        if start_line is not None or end_line is not None:
            text = f"{file_path} (第 {s}-{e} 行，共 {total} 行)\n```\n{selected_content}\n```"
        else:
            text = f"{file_path}\n```\n{selected_content}\n```"

        # 添加续读提示
        if e < total:
            remaining = total - e
            text += f"\n\n[{remaining} 行未显示，使用 start_line={e + 1} 继续读取]"

        return ToolResponse(content=[TextBlock(type="text", text=text)])

    except Exception as e:
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: 读取文件失败 - {e}")]
        )


async def write_file(file_path: str, content: str) -> ToolResponse:
    """
    创建或覆盖文件

    Args:
        file_path: 文件路径
        content: 文件内容

    Returns:
        ToolResponse: 操作结果
    """
    if not file_path:
        return ToolResponse(
            content=[TextBlock(type="text", text="错误: 未提供 file_path")]
        )

    try:
        file_path = _resolve_file_path(file_path)
    except Exception as e:
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: 路径无效 - {e}")]
        )

    try:
        # 确保目录存在
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)

        return ToolResponse(
            content=[TextBlock(
                type="text",
                text=f"成功写入 {len(content)} 字节到 {file_path}"
            )]
        )
    except Exception as e:
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: 写入文件失败 - {e}")]
        )


async def edit_file(file_path: str, old_text: str, new_text: str) -> ToolResponse:
    """
    查找替换文件内容

    替换文件中所有匹配的 old_text

    Args:
        file_path: 文件路径
        old_text: 要查找的文本
        new_text: 替换后的文本

    Returns:
        ToolResponse: 操作结果
    """
    if not file_path:
        return ToolResponse(
            content=[TextBlock(type="text", text="错误: 未提供 file_path")]
        )

    try:
        resolved_path = _resolve_file_path(file_path)
    except Exception as e:
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: 路径无效 - {e}")]
        )

    if not os.path.exists(resolved_path):
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: 文件 {resolved_path} 不存在")]
        )

    if not os.path.isfile(resolved_path):
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: {resolved_path} 不是文件")]
        )

    try:
        with open(resolved_path, 'r', encoding='utf-8') as f:
            content = f.read()
    except Exception as e:
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: 读取文件失败 - {e}")]
        )

    if old_text not in content:
        return ToolResponse(
            content=[TextBlock(
                type="text",
                text=f"错误: 在 {file_path} 中未找到要替换的文本"
            )]
        )

    new_content = content.replace(old_text, new_text)

    try:
        with open(resolved_path, 'w', encoding='utf-8') as f:
            f.write(new_content)

        count = content.count(old_text)
        return ToolResponse(
            content=[TextBlock(
                type="text",
                text=f"成功替换 {count} 处文本在 {file_path}"
            )]
        )
    except Exception as e:
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: 写入文件失败 - {e}")]
        )


async def append_file(file_path: str, content: str) -> ToolResponse:
    """
    追加内容到文件末尾

    Args:
        file_path: 文件路径
        content: 要追加的内容

    Returns:
        ToolResponse: 操作结果
    """
    if not file_path:
        return ToolResponse(
            content=[TextBlock(type="text", text="错误: 未提供 file_path")]
        )

    try:
        file_path = _resolve_file_path(file_path)
    except Exception as e:
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: 路径无效 - {e}")]
        )

    try:
        # 确保目录存在
        os.makedirs(os.path.dirname(file_path), exist_ok=True)

        with open(file_path, 'a', encoding='utf-8') as f:
            f.write(content)

        return ToolResponse(
            content=[TextBlock(
                type="text",
                text=f"成功追加 {len(content)} 字节到 {file_path}"
            )]
        )
    except Exception as e:
        return ToolResponse(
            content=[TextBlock(type="text", text=f"错误: 追加文件失败 - {e}")]
        )
