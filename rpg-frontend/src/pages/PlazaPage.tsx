/**
 * 广场页面 - 浏览和使用平台上发布的作品
 */
import { useState, useEffect, useCallback } from 'react'
import { api, PlazaWork } from '../api'

export function PlazaPage() {
  const [works, setWorks] = useState<PlazaWork[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'latest' | 'popular'>('latest')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedWork, setSelectedWork] = useState<PlazaWork | null>(null)
  const [error, setError] = useState('')

  const pageSize = 12

  const fetchWorks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.getPlazaWorks({
        page,
        page_size: pageSize,
        sort,
        search: search || undefined,
      })
      setWorks(result.works)
      setTotal(result.total)
    } catch (err: any) {
      setError('加载失败: ' + (err.message || '未知错误'))
    } finally {
      setLoading(false)
    }
  }, [page, sort, search])

  useEffect(() => {
    fetchWorks()
  }, [fetchWorks])

  const handleSearch = () => {
    setSearch(searchInput)
    setPage(1)
  }

  const handleDelete = async (workId: string) => {
    if (!confirm('确定要删除这个作品吗？')) return
    try {
      await api.deletePlazaWork(workId)
      setSelectedWork(null)
      fetchWorks()
    } catch (err: any) {
      alert('删除失败: ' + (err.message || '未知错误'))
    }
  }

  const totalPages = Math.ceil(total / pageSize)

  // 作品详情/预览模式
  if (selectedWork) {
    return (
      <div className="plaza-page">
        <div className="plaza-detail">
          <div className="plaza-detail-header">
            <button className="btn-back" onClick={() => setSelectedWork(null)}>
              ← 返回广场
            </button>
            <div className="plaza-detail-info">
              <h2>{selectedWork.title}</h2>
              <span className="detail-meta">
                {selectedWork.author} · {selectedWork.view_count} 次浏览 · {new Date(selectedWork.created_at).toLocaleDateString()}
              </span>
            </div>
            <div className="plaza-detail-actions">
              <a
                href={`/platform/api/works/${selectedWork.id}/render`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-open"
              >
                新窗口打开
              </a>
              {selectedWork.is_mine && (
                <button className="btn-delete" onClick={() => handleDelete(selectedWork.id)}>
                  删除
                </button>
              )}
            </div>
          </div>
          <div className="plaza-detail-preview">
            <iframe
              src={`/platform/api/works/${selectedWork.id}/render`}
              sandbox="allow-scripts allow-same-origin allow-popups"
              title={selectedWork.title}
            />
          </div>
        </div>
      </div>
    )
  }

  // 广场列表模式
  return (
    <div className="plaza-page">
      {/* 顶部工具栏 */}
      <div className="plaza-toolbar">
        <div className="plaza-toolbar-left">
          <h2>作品广场</h2>
          <span className="plaza-count">{total} 个作品</span>
        </div>
        <div className="plaza-toolbar-center">
          <div className="plaza-search">
            <input
              type="text"
              placeholder="搜索作品..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button onClick={handleSearch}>搜索</button>
          </div>
        </div>
        <div className="plaza-toolbar-right">
          <select value={sort} onChange={(e) => { setSort(e.target.value as any); setPage(1) }}>
            <option value="latest">最新发布</option>
            <option value="popular">最多浏览</option>
          </select>
          <button className="btn-refresh" onClick={fetchWorks}>刷新</button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && <div className="plaza-error">{error}</div>}

      {/* 作品网格 */}
      {loading ? (
        <div className="plaza-loading">加载中...</div>
      ) : works.length === 0 ? (
        <div className="plaza-empty">
          <div className="empty-icon">🏪</div>
          <p>广场上还没有作品</p>
          <span>在「网页预览」页面发布你的第一个作品吧</span>
        </div>
      ) : (
        <div className="plaza-grid">
          {works.map((work) => (
            <div
              key={work.id}
              className="plaza-card"
              onClick={() => setSelectedWork(work)}
            >
              <div className="plaza-card-preview">
                <iframe
                  src={`/platform/api/works/${work.id}/render`}
                  sandbox=""
                  tabIndex={-1}
                  title={work.title}
                />
                <div className="plaza-card-overlay" />
              </div>
              <div className="plaza-card-info">
                <h3>{work.title}</h3>
                {work.description && (
                  <p className="plaza-card-desc">{work.description}</p>
                )}
                <div className="plaza-card-meta">
                  <span className="meta-author">{work.author}</span>
                  <span className="meta-views">{work.view_count} 浏览</span>
                </div>
                {work.tags && (
                  <div className="plaza-card-tags">
                    {work.tags.split(',').filter(Boolean).map((tag, i) => (
                      <span key={i} className="tag">{tag.trim()}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="plaza-pagination">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</button>
          <span>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</button>
        </div>
      )}
    </div>
  )
}
