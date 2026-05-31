import { useState, useEffect, useCallback } from 'react'
import type { ArtifactFileInfo } from '../types'
import { api } from '../api'

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
)

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>
)

const FileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
)

const NewFileIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="12" y1="18" x2="12" y2="12"/>
    <line x1="9" y1="15" x2="15" y2="15"/>
  </svg>
)

const WorkspaceIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <path d="M8 13h8"/>
    <path d="M8 16h5"/>
  </svg>
)

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString()
}

function storageLabel(file: ArtifactFileInfo): string {
  return file.storage === 'preview' ? 'HTML' : '文档'
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

interface HtmlPreviewPageProps {
  conversationId: string
}

export function HtmlPreviewPage({ conversationId }: HtmlPreviewPageProps) {
  const [files, setFiles] = useState<ArtifactFileInfo[]>([])
  const [selectedFile, setSelectedFile] = useState<ArtifactFileInfo | null>(null)
  const [artifactContent, setArtifactContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isContentLoading, setIsContentLoading] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [newFilename, setNewFilename] = useState('')
  const [newContent, setNewContent] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<ArtifactFileInfo | null>(null)
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [publishTitle, setPublishTitle] = useState('')
  const [publishDesc, setPublishDesc] = useState('')
  const [publishAuthor, setPublishAuthor] = useState('')
  const [publishTags, setPublishTags] = useState('')
  const [isPublishing, setIsPublishing] = useState(false)

  const loadFiles = useCallback(async () => {
    setIsLoading(true)
    try {
      const list = await api.getArtifacts(conversationId)
      setFiles(list)
      if (selectedFile && !list.find(f => f.path === selectedFile.path)) {
        setSelectedFile(null)
      }
    } catch (err) {
      console.error('Failed to load artifacts:', err)
    } finally {
      setIsLoading(false)
    }
  }, [selectedFile, conversationId])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  useEffect(() => {
    if (!selectedFile || selectedFile.render_mode === 'html') {
      setArtifactContent('')
      return
    }

    let cancelled = false
    setIsContentLoading(true)
    api.getArtifactContent(selectedFile.storage, selectedFile.filename, conversationId)
      .then(result => {
        if (!cancelled) {
          setArtifactContent(result.content)
        }
      })
      .catch(err => {
        console.error('Failed to load artifact content:', err)
        if (!cancelled) {
          setArtifactContent('无法读取该文件内容')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsContentLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [selectedFile, conversationId])

  const handleDelete = async (file: ArtifactFileInfo) => {
    try {
      await api.deleteArtifact(file.storage, file.filename, conversationId)
      setShowDeleteConfirm(null)
      if (selectedFile?.path === file.path) {
        setSelectedFile(null)
      }
      loadFiles()
    } catch (err) {
      console.error('Failed to delete artifact:', err)
      alert('删除失败')
    }
  }

  const handleCreate = async () => {
    const name = newFilename.trim()
    if (!name) return
    try {
      await api.saveHtmlPreview({ filename: name, content: newContent }, conversationId)
      setShowNewModal(false)
      setNewFilename('')
      setNewContent('')
      loadFiles()
    } catch (err) {
      console.error('Failed to save file:', err)
      alert('保存失败')
    }
  }

  const canPublish = selectedFile?.storage === 'preview' && selectedFile.render_mode === 'html'

  const handlePublish = async () => {
    if (!selectedFile || !canPublish || !publishTitle.trim()) return
    setIsPublishing(true)
    try {
      const result = await api.publishWork({
        title: publishTitle.trim(),
        description: publishDesc.trim(),
        author: publishAuthor.trim() || '匿名用户',
        tags: publishTags.trim(),
        source_file: selectedFile.filename,
        conversation_id: conversationId,
      })
      if (result.success) {
        alert(`发布成功！作品: ${result.title}`)
        setShowPublishModal(false)
        setPublishTitle('')
        setPublishDesc('')
        setPublishAuthor('')
        setPublishTags('')
      }
    } catch (err: any) {
      alert('发布失败: ' + (err?.response?.data?.detail || err.message || '未知错误'))
    } finally {
      setIsPublishing(false)
    }
  }

  const openPublishModal = () => {
    if (!canPublish || !selectedFile) {
      alert('只有 HTML 预览文件可以发布到广场')
      return
    }
    setPublishTitle(selectedFile.filename.replace(/\.html$/i, ''))
    setShowPublishModal(true)
  }

  const previewUrl = selectedFile && canPublish
    ? `/preview/${encodePath(selectedFile.filename)}?conversation_id=${encodeURIComponent(conversationId)}`
    : ''

  return (
    <div className="html-preview-page">
      <div className="html-preview-header">
        <h2>产物预览</h2>
        <p className="header-desc">查看 Agent 生成的 HTML 和文档产物</p>
      </div>

      <div className="html-preview-layout">
        <div className="html-preview-sidebar">
          <div className="sidebar-toolbar">
            <button
              className="toolbar-btn primary"
              onClick={() => setShowNewModal(true)}
              title="新建 HTML 文件"
            >
              <NewFileIcon />
              <span>新建</span>
            </button>
            <button
              className="toolbar-btn"
              onClick={loadFiles}
              disabled={isLoading}
              title="刷新列表"
            >
              <RefreshIcon />
            </button>
          </div>

          <div className="file-list">
            {files.length === 0 ? (
              <div className="file-list-empty">
                <WorkspaceIcon />
                <p>暂无产物</p>
                <span>Agent 生成的 HTML 和文档会显示在这里</span>
              </div>
            ) : (
              files.map(file => (
                <div
                  key={file.path}
                  className={`file-item ${selectedFile?.path === file.path ? 'active' : ''}`}
                  onClick={() => setSelectedFile(file)}
                >
                  <div className="file-icon">
                    <FileIcon />
                  </div>
                  <div className="file-info">
                    <div className="file-name" title={file.path}>
                      <span className={`artifact-badge ${file.storage}`}>{storageLabel(file)}</span>
                      {file.filename}
                    </div>
                    <div className="file-meta">
                      {formatFileSize(file.size)} · {formatTime(file.updated_at)}
                    </div>
                  </div>
                  <button
                    className="file-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowDeleteConfirm(file)
                    }}
                    title="删除"
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="html-preview-content">
          {selectedFile ? (
            <>
              <div className="preview-toolbar">
                <span className="preview-filename">{selectedFile.path}</span>
                {canPublish && (
                  <>
                    <button className="toolbar-btn publish" onClick={openPublishModal}>
                      发布到广场
                    </button>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="toolbar-link"
                    >
                      新窗口打开
                    </a>
                  </>
                )}
              </div>
              {canPublish ? (
                <div className="preview-iframe-wrapper">
                  <iframe
                    src={previewUrl}
                    title={selectedFile.filename}
                    className="preview-iframe"
                    sandbox="allow-scripts allow-same-origin allow-popups"
                  />
                </div>
              ) : (
                <div className="preview-iframe-wrapper artifact-text-wrapper">
                  {isContentLoading ? (
                    <div className="preview-placeholder">
                      <WorkspaceIcon />
                      <p>正在读取文件</p>
                    </div>
                  ) : (
                    <pre className="artifact-text-content">{artifactContent}</pre>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="preview-placeholder">
              <WorkspaceIcon />
              <p>选择左侧文件进行预览</p>
              <span>HTML 会以网页方式展示，文档会以文本方式展示</span>
            </div>
          )}
        </div>
      </div>

      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>新建 HTML 文件</h3>
            <div className="form-group">
              <label>文件名</label>
              <input
                type="text"
                value={newFilename}
                onChange={e => setNewFilename(e.target.value)}
                placeholder="example.html"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>HTML 内容</label>
              <textarea
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder="<!DOCTYPE html>..."
                rows={12}
              />
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setShowNewModal(false)}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={handleCreate}
                disabled={!newFilename.trim()}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {showPublishModal && (
        <div className="modal-overlay" onClick={() => setShowPublishModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>发布到广场</h3>
            <div className="form-group">
              <label>作品标题 *</label>
              <input
                type="text"
                value={publishTitle}
                onChange={e => setPublishTitle(e.target.value)}
                placeholder="给作品起个名字"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label>作者</label>
              <input
                type="text"
                value={publishAuthor}
                onChange={e => setPublishAuthor(e.target.value)}
                placeholder="匿名用户"
              />
            </div>
            <div className="form-group">
              <label>简介</label>
              <textarea
                value={publishDesc}
                onChange={e => setPublishDesc(e.target.value)}
                placeholder="简单描述一下这个作品..."
                rows={3}
              />
            </div>
            <div className="form-group">
              <label>标签（逗号分隔）</label>
              <input
                type="text"
                value={publishTags}
                onChange={e => setPublishTags(e.target.value)}
                placeholder="游戏, 工具, 可视化"
              />
            </div>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setShowPublishModal(false)}>
                取消
              </button>
              <button
                className="btn primary"
                onClick={handlePublish}
                disabled={!publishTitle.trim() || isPublishing}
              >
                {isPublishing ? '发布中...' : '发布'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(null)}>
          <div className="modal-content small" onClick={e => e.stopPropagation()}>
            <h3>确认删除</h3>
            <p>确定要删除 <strong>{showDeleteConfirm.path}</strong> 吗？此操作不可撤销。</p>
            <div className="modal-actions">
              <button className="btn secondary" onClick={() => setShowDeleteConfirm(null)}>
                取消
              </button>
              <button
                className="btn danger"
                onClick={() => handleDelete(showDeleteConfirm)}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
