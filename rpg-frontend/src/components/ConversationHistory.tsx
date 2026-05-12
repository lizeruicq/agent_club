import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'
import type { ConversationMeta } from '../types'

interface ConversationHistoryProps {
  open: boolean
  onClose: () => void
  onSelect: (convId: string) => void
  onDeleted?: (convId: string) => void
}

function formatTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const sameDay = d.toDateString() === now.toDateString()
    if (sameDay) {
      return `今天 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
    }
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  } catch {
    return iso
  }
}

export function ConversationHistory({ open, onClose, onSelect, onDeleted }: ConversationHistoryProps) {
  const [items, setItems] = useState<ConversationMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [max, setMax] = useState(10)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.listConversations()
      setItems(data.conversations || [])
      setMax(data.max || 10)
    } catch (err) {
      console.error('Failed to list conversations:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleDelete = async (e: React.MouseEvent, conv: ConversationMeta) => {
    e.stopPropagation()
    if (!window.confirm(`确定删除「${conv.title}」吗？此操作不可恢复。`)) return
    try {
      await api.deleteConversation(conv.id)
      onDeleted?.(conv.id)
      await load()
    } catch (err) {
      alert('删除失败: ' + (err as Error).message)
    }
  }

  if (!open) return null

  return (
    <div className="conv-history-overlay" onClick={onClose}>
      <div className="conv-history-panel" onClick={(e) => e.stopPropagation()}>
        <div className="conv-history-header">
          <h3>📚 历史会话</h3>
          <span className="conv-history-count">{items.length} / {max}</span>
          <button className="conv-history-close" onClick={onClose} title="关闭">✕</button>
        </div>

        <div className="conv-history-list">
          {loading ? (
            <div className="conv-history-empty">加载中...</div>
          ) : items.length === 0 ? (
            <div className="conv-history-empty">
              <div className="conv-history-empty-icon">🗂️</div>
              <p>暂无历史会话</p>
              <span className="conv-history-empty-hint">点击「新对话」按钮可以保存当前对话</span>
            </div>
          ) : (
            items.map((conv) => (
              <div
                key={conv.id}
                className="conv-history-item"
                onClick={() => onSelect(conv.id)}
                title="点击恢复此对话"
              >
                <div className="conv-history-item-main">
                  <div className="conv-history-item-title">{conv.title}</div>
                  <div className="conv-history-item-meta">
                    <span>{formatTime(conv.updated_at)}</span>
                    <span className="conv-history-dot">·</span>
                    <span>{conv.message_count} 条消息</span>
                  </div>
                </div>
                <button
                  className="conv-history-delete-btn"
                  onClick={(e) => handleDelete(e, conv)}
                  title="删除"
                >
                  🗑️
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
