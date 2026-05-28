# -*- coding: utf-8 -*-
"""API routes for tool management."""

from typing import List, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from auth.user_managers import get_user_tool_registry
from auth.dependencies import get_current_user

router = APIRouter(prefix="/api/tools", tags=["tools"])


class ToolInfo(BaseModel):
    """工具信息"""
    name: str = Field(..., description="工具名称")
    enabled: bool = Field(..., description="是否启用")
    description: str = Field(default="", description="工具描述")


class ToolListResponse(BaseModel):
    """工具列表响应"""
    tools: List[ToolInfo]


class UpdateToolRequest(BaseModel):
    """更新工具状态请求"""
    enabled: bool = Field(..., description="是否启用")


class UpdateToolsRequest(BaseModel):
    """批量更新工具状态请求"""
    tools: Dict[str, bool] = Field(..., description="工具名称到启用状态的映射")


class ToolUpdateResponse(BaseModel):
    """工具更新响应"""
    success: bool
    message: str


# 工具描述映射
TOOL_DESCRIPTIONS = {
    "read_file": "读取文件内容，支持指定行号范围",
    "write_file": "创建或覆盖文件",
    "edit_file": "查找并替换文件内容",
    "append_file": "追加内容到文件末尾",
    "browser_use": "浏览器自动化操作，支持导航、点击、输入、截图等",
}


@router.get("", response_model=ToolListResponse)
async def list_tools(user: dict = Depends(get_current_user)):
    """获取所有工具列表及其状态"""
    tool_registry = get_user_tool_registry(user["id"])
    tools = tool_registry.list_tools()
    result = []

    for tool_name in tools:
        enabled = tool_registry.is_tool_enabled(tool_name)
        description = TOOL_DESCRIPTIONS.get(tool_name, "")
        result.append(ToolInfo(
            name=tool_name,
            enabled=enabled,
            description=description
        ))

    return ToolListResponse(tools=result)


@router.put("/{tool_name}", response_model=ToolUpdateResponse)
async def update_tool(tool_name: str, request: UpdateToolRequest, user: dict = Depends(get_current_user)):
    """更新单个工具状态"""
    tool_registry = get_user_tool_registry(user["id"])
    available_tools = tool_registry.list_tools()

    if tool_name not in available_tools:
        raise HTTPException(status_code=404, detail=f"工具 {tool_name} 不存在")

    if request.enabled:
        tool_registry.enable_tool(tool_name)
    else:
        tool_registry.disable_tool(tool_name)

    # 保存配置
    tool_registry.save_config()

    return ToolUpdateResponse(
        success=True,
        message=f"工具 {tool_name} 已{'启用' if request.enabled else '禁用'}"
    )


@router.put("", response_model=ToolUpdateResponse)
async def update_tools_batch(request: UpdateToolsRequest, user: dict = Depends(get_current_user)):
    """批量更新工具状态"""
    tool_registry = get_user_tool_registry(user["id"])
    available_tools = set(tool_registry.list_tools())

    success_count = 0
    failed_tools = []

    for tool_name, enabled in request.tools.items():
        if tool_name not in available_tools:
            failed_tools.append(tool_name)
            continue

        if enabled:
            tool_registry.enable_tool(tool_name)
        else:
            tool_registry.disable_tool(tool_name)
        success_count += 1

    # 保存配置
    tool_registry.save_config()

    message = f"成功更新 {success_count} 个工具状态"
    if failed_tools:
        message += f"，以下工具不存在: {', '.join(failed_tools)}"

    return ToolUpdateResponse(
        success=len(failed_tools) == 0,
        message=message
    )


@router.get("/{tool_name}/config")
async def get_tool_config(tool_name: str, user: dict = Depends(get_current_user)):
    """获取工具配置详情"""
    tool_registry = get_user_tool_registry(user["id"])
    available_tools = tool_registry.list_tools()

    if tool_name not in available_tools:
        raise HTTPException(status_code=404, detail=f"工具 {tool_name} 不存在")

    enabled = tool_registry.is_tool_enabled(tool_name)

    return {
        "name": tool_name,
        "enabled": enabled,
        "description": TOOL_DESCRIPTIONS.get(tool_name, ""),
    }
