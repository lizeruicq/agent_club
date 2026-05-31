"""
HTML Preview API - Manage and preview AI-generated HTML files
Per-user isolated preview directories
"""
import os
import time
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from auth.dependencies import get_current_user
from auth.user_data import get_user_data

router = APIRouter()


def _get_user_preview_dir(user_id: str, conversation_id: Optional[str] = None) -> str:
    """获取指定会话的预览目录。"""
    if not conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id is required")
    user_data = get_user_data(user_id)
    preview_dir = user_data.conversation_preview_dir(conversation_id)
    os.makedirs(preview_dir, exist_ok=True)
    return preview_dir


def _get_user_artifact_roots(user_id: str, conversation_id: Optional[str] = None) -> dict:
    """获取当前会话可展示的产物目录。"""
    if not conversation_id:
        raise HTTPException(status_code=400, detail="conversation_id is required")
    user_data = get_user_data(user_id)
    preview_dir = user_data.conversation_preview_dir(conversation_id)
    doc_dir = user_data.conversation_doc_dir(conversation_id)
    os.makedirs(preview_dir, exist_ok=True)
    os.makedirs(doc_dir, exist_ok=True)
    return {
        "preview": preview_dir,
        "doc": doc_dir,
    }


def _sanitize_path(filepath: str) -> str:
    """Sanitize file path to prevent directory traversal."""
    filepath = filepath.strip("/\\")
    parts = filepath.replace("\\", "/").split("/")
    sanitized_parts = []
    for part in parts:
        part = "".join(c for c in part if c.isalnum() or c in "._-")
        if part and part not in (".", ".."):
            sanitized_parts.append(part)

    if not sanitized_parts:
        return f"preview_{int(time.time())}.html"

    result = "/".join(sanitized_parts)
    if not result.endswith(".html"):
        result += ".html"
    return result


def _resolve_path(filepath: str, preview_dir: str) -> str:
    """Resolve a path within preview_dir, ensuring it doesn't escape."""
    safe = _sanitize_path(filepath)
    full = os.path.normpath(os.path.join(preview_dir, safe))
    if not full.startswith(os.path.normpath(preview_dir)):
        raise HTTPException(status_code=400, detail="Invalid file path")
    return full


def _sanitize_artifact_path(filepath: str) -> str:
    """Sanitize a relative artifact path without changing its extension."""
    filepath = filepath.strip("/\\")
    parts = filepath.replace("\\", "/").split("/")
    sanitized_parts = []
    for part in parts:
        part = "".join(c for c in part if c.isalnum() or c in "._-")
        if part and part not in (".", ".."):
            sanitized_parts.append(part)

    if not sanitized_parts:
        raise HTTPException(status_code=400, detail="Invalid file path")

    return "/".join(sanitized_parts)


def _resolve_artifact_path(storage: str, filepath: str, roots: dict) -> str:
    """Resolve an artifact path inside its storage root."""
    if storage not in roots:
        raise HTTPException(status_code=404, detail="Unknown artifact storage")

    safe = _sanitize_artifact_path(filepath)
    root = os.path.normpath(roots[storage])
    full = os.path.normpath(os.path.join(root, safe))
    if os.path.commonpath([root, full]) != root:
        raise HTTPException(status_code=400, detail="Invalid file path")
    return full


def _render_mode(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".html":
        return "html"
    if ext in {".md", ".markdown"}:
        return "markdown"
    if ext in {".txt", ".json", ".yaml", ".yml", ".csv", ".log", ".py", ".js", ".css", ".ts", ".tsx"}:
        return "text"
    return "download"


class SaveHtmlRequest(BaseModel):
    filename: str
    content: str


class HtmlFileInfo(BaseModel):
    filename: str
    size: int
    created_at: float
    updated_at: float


class HtmlFileListResponse(BaseModel):
    files: List[HtmlFileInfo]


class SaveHtmlResponse(BaseModel):
    success: bool
    filename: str
    message: str


class ArtifactFileInfo(BaseModel):
    storage: Literal["preview", "doc"]
    filename: str
    path: str
    size: int
    created_at: float
    updated_at: float
    extension: str
    render_mode: str


class ArtifactFileListResponse(BaseModel):
    files: List[ArtifactFileInfo]


class ArtifactContentResponse(BaseModel):
    success: bool
    storage: Literal["preview", "doc"]
    filename: str
    content: str
    render_mode: str


@router.get("/api/artifacts", response_model=ArtifactFileListResponse)
async def list_artifacts(
    conversation_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """List preview HTML and document artifacts for current user."""
    roots = _get_user_artifact_roots(user["id"], conversation_id)
    files = []

    for storage, root_dir in roots.items():
        for root, _dirs, filenames in os.walk(root_dir):
            for name in filenames:
                filepath = os.path.join(root, name)
                if not os.path.isfile(filepath):
                    continue
                rel_path = os.path.relpath(filepath, root_dir).replace("\\", "/")
                stat = os.stat(filepath)
                files.append(ArtifactFileInfo(
                    storage=storage,
                    filename=rel_path,
                    path=f"{storage}/{rel_path}",
                    size=stat.st_size,
                    created_at=stat.st_ctime,
                    updated_at=stat.st_mtime,
                    extension=os.path.splitext(name)[1].lower(),
                    render_mode=_render_mode(name),
                ))

    files.sort(key=lambda f: f.updated_at, reverse=True)
    return ArtifactFileListResponse(files=files)


@router.get("/api/artifacts/{storage}/{filepath:path}/content", response_model=ArtifactContentResponse)
async def get_artifact_content(
    storage: str,
    filepath: str,
    conversation_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Get raw content for a document or preview artifact."""
    roots = _get_user_artifact_roots(user["id"], conversation_id)
    full_path = _resolve_artifact_path(storage, filepath, roots)

    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        return ArtifactContentResponse(
            success=True,
            storage=storage,
            filename=filepath,
            content=content,
            render_mode=_render_mode(filepath),
        )
    except UnicodeDecodeError:
        raise HTTPException(status_code=415, detail="Unsupported binary artifact")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")


@router.delete("/api/artifacts/{storage}/{filepath:path}")
async def delete_artifact(
    storage: str,
    filepath: str,
    conversation_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Delete a document or preview artifact."""
    roots = _get_user_artifact_roots(user["id"], conversation_id)
    full_path = _resolve_artifact_path(storage, filepath, roots)

    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        os.remove(full_path)
        root_dir = os.path.normpath(roots[storage])
        parent = os.path.dirname(full_path)
        while parent != root_dir and os.path.isdir(parent):
            try:
                os.rmdir(parent)
                parent = os.path.dirname(parent)
            except OSError:
                break
        return {"success": True, "message": f"Deleted: {storage}/{filepath}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {e}")


@router.get("/api/html-preview", response_model=HtmlFileListResponse)
async def list_html_files(
    conversation_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """List all HTML preview files for current user"""
    preview_dir = _get_user_preview_dir(user["id"], conversation_id)
    files = []

    for root, _dirs, filenames in os.walk(preview_dir):
        for name in filenames:
            if not name.endswith(".html"):
                continue
            filepath = os.path.join(root, name)
            if not os.path.isfile(filepath):
                continue
            rel_path = os.path.relpath(filepath, preview_dir)
            rel_path = rel_path.replace("\\", "/")
            stat = os.stat(filepath)
            files.append(HtmlFileInfo(
                filename=rel_path,
                size=stat.st_size,
                created_at=stat.st_ctime,
                updated_at=stat.st_mtime,
            ))

    files.sort(key=lambda f: f.updated_at, reverse=True)
    return HtmlFileListResponse(files=files)


@router.post("/api/html-preview", response_model=SaveHtmlResponse)
async def save_html_file(
    request: SaveHtmlRequest,
    conversation_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Save an HTML file to user's preview directory"""
    preview_dir = _get_user_preview_dir(user["id"], conversation_id)
    filename = _sanitize_path(request.filename)
    filepath = _resolve_path(filename, preview_dir)

    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(request.content)
        return SaveHtmlResponse(
            success=True,
            filename=filename,
            message=f"File saved: {filename}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")


@router.get("/api/html-preview/{filepath:path}/content")
async def get_html_content(
    filepath: str,
    conversation_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Get the raw content of an HTML file"""
    preview_dir = _get_user_preview_dir(user["id"], conversation_id)
    full_path = _resolve_path(filepath, preview_dir)

    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {"success": True, "filename": filepath, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")


@router.delete("/api/html-preview/{filepath:path}")
async def delete_html_file(
    filepath: str,
    conversation_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Delete an HTML preview file"""
    preview_dir = _get_user_preview_dir(user["id"], conversation_id)
    full_path = _resolve_path(filepath, preview_dir)

    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        os.remove(full_path)
        parent = os.path.dirname(full_path)
        while parent != preview_dir and os.path.isdir(parent):
            try:
                os.rmdir(parent)
                parent = os.path.dirname(parent)
            except OSError:
                break
        return {"success": True, "message": f"Deleted: {filepath}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {e}")


@router.get("/preview/{filepath:path}", response_class=HTMLResponse)
async def preview_html(
    filepath: str,
    conversation_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Serve an HTML file for preview (used by iframe)"""
    preview_dir = _get_user_preview_dir(user["id"], conversation_id)
    full_path = _resolve_path(filepath, preview_dir)

    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
        return HTMLResponse(content=content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {e}")
