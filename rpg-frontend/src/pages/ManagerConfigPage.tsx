import { useState, useEffect } from 'react'
import type { ManagerConfig, Provider } from '../types'
import { api } from '../api'

interface ManagerConfigPageProps {
  conversationId?: string
}

export const ManagerConfigPage = ({ conversationId }: ManagerConfigPageProps) => {
  const [, setManager] = useState<ManagerConfig | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // 表单数据
  const [formData, setFormData] = useState({
    name: '任务管理器',
    role: '项目协调经理',
    personality: '专业、有条理、善于规划和协调，能够准确分析需求并合理分配任务',
    provider_id: '',
    is_active: false,
  })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      // 加载 Manager 配置
      const managerRes = await api.getManagerConfig()
      console.log('Loaded manager config:', managerRes)
      setManager(managerRes)
      setFormData({
        name: managerRes.name,
        role: managerRes.role,
        personality: managerRes.personality,
        provider_id: managerRes.provider_id || '',
        is_active: managerRes.is_active,
      })
    } catch (error) {
      console.error('Failed to load manager config:', error)
      setMessage({ type: 'error', text: '加载 Manager 配置失败' })
    }

    // 加载 Providers
    try {
      const providersRes = await api.getProviders()
      setProviders(providersRes)
    } catch (error) {
      console.error('Failed to load providers:', error)
    }

    setLoading(false)
  }

  const handleSave = async () => {
    if (!formData.provider_id) {
      setMessage({ type: 'error', text: '请选择 Provider' })
      return
    }

    setSaving(true)
    setMessage(null)

    try {
      const result = await api.updateManagerConfig({
        name: formData.name,
        role: formData.role,
        personality: formData.personality,
        provider_id: formData.provider_id,
        is_active: formData.is_active,
      })

      setManager(result)
      setMessage({ type: 'success', text: '配置已保存' })

      // 重新初始化系统
      try {
        await api.reinitializeSystem(conversationId)
        console.log('System reinitialized successfully')
      } catch (reinitError) {
        console.warn('System reinitialization failed:', reinitError)
      }
    } catch (error: any) {
      console.error('Failed to save manager config:', error)
      setMessage({ type: 'error', text: error.response?.data?.detail || '保存失败' })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!formData.provider_id) {
      setMessage({ type: 'error', text: '请先选择 Provider' })
      return
    }

    setTesting(true)
    setMessage(null)

    try {
      const result = await api.testManagerConnection()
      setMessage({
        type: result.success ? 'success' : 'error',
        text: result.message,
      })
    } catch (error: any) {
      setMessage({ type: 'error', text: '测试连接失败' })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="providers-page loading">加载中...</div>
  }

  return (
    <div className="providers-page">
      <div className="providers-header">
        <div>
          <h2>Manager Agent 配置</h2>
          <p style={{ fontSize: '14px', color: '#666', marginTop: '4px' }}>
            Manager 是系统的任务协调者，负责分析需求并分派给 Worker Agents
          </p>
        </div>
        <button
          className="add-btn"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>

      {message && (
        <div
          className="alert"
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '20px',
            background: message.type === 'success' ? 'rgba(0, 184, 148, 0.15)' : 'rgba(214, 48, 49, 0.15)',
            border: `2px solid ${message.type === 'success' ? '#00b894' : '#d63031'}`,
            color: message.type === 'success' ? '#00b894' : '#ff6b6b',
          }}
        >
          {message.type === 'success' ? '✅' : '❌'} {message.text}
          <button
            onClick={() => setMessage(null)}
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              fontSize: '18px',
            }}
          >
            ×
          </button>
        </div>
      )}

      <div
        style={{
          background: 'rgba(0, 184, 148, 0.1)',
          border: '2px solid rgba(0, 184, 148, 0.3)',
          borderRadius: '12px',
          padding: '16px 20px',
          marginBottom: '24px',
        }}
      >
        <h4 style={{ color: '#00b894', marginBottom: '8px' }}>💡 Manager 功能说明</h4>
        <ul style={{ fontSize: '14px', lineHeight: '1.8', color: 'rgba(223, 230, 233, 0.8)' }}>
          <li>Manager 是系统级默认 Agent，不可删除</li>
          <li>启用 Manager 后，系统会自动进入 Manager-Worker 协作模式</li>
          <li>Manager 会分析用户请求，拆解任务并分派给合适的 Worker</li>
          <li>如果没有配置 Worker，Manager 会直接处理所有请求</li>
          <li>禁用 Manager 后，系统将使用传统的 MsgHub 协作模式</li>
        </ul>
      </div>

      <div className="provider-card" style={{ padding: '24px' }}>
        {/* 启用开关 */}
        <div style={{ marginBottom: '24px', paddingBottom: '20px', borderBottom: '2px solid var(--pixel-surface)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={formData.is_active}
              onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
              style={{ width: '20px', height: '20px' }}
            />
            <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--pixel-text)' }}>
              启用 Manager Agent
            </span>
          </label>
          <p style={{ marginTop: '8px', fontSize: '13px', color: 'rgba(223, 230, 233, 0.6)' }}>
            启用后，Manager 将作为任务协调者，自动分派任务给 Worker Agents
          </p>
        </div>

        {/* 基本信息 */}
        <div style={{ marginBottom: '24px' }}>
          <h4 style={{ marginBottom: '16px', color: 'var(--pixel-accent)' }}>基本信息</h4>

          <div className="form-group">
            <label>Manager 名称 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="例如：任务管理器"
            />
          </div>

          <div className="form-group">
            <label>角色 *</label>
            <input
              type="text"
              value={formData.role}
              onChange={e => setFormData({ ...formData, role: e.target.value })}
              placeholder="例如：项目协调经理"
            />
          </div>

          <div className="form-group">
            <label>性格描述 *</label>
            <textarea
              value={formData.personality}
              onChange={e => setFormData({ ...formData, personality: e.target.value })}
              placeholder="描述 Manager 的性格特点..."
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '14px',
                color: 'var(--pixel-text)',
                background: 'rgba(99, 110, 114, 0.3)',
                border: '2px solid var(--pixel-surface)',
                borderRadius: '6px',
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </div>
        </div>

        {/* Provider 配置 */}
        <div>
          <h4 style={{ marginBottom: '16px', color: 'var(--pixel-accent)' }}>模型配置</h4>

          <div className="form-group">
            <label>选择 Provider *</label>
            <select
              value={formData.provider_id}
              onChange={e => setFormData({ ...formData, provider_id: e.target.value })}
            >
              <option value="">请选择 Provider</option>
              {providers.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} - {provider.model_name || provider.model_id}
                </option>
              ))}
            </select>
            <span className="hint">选择用于 Manager 的语言模型</span>
          </div>

          {formData.provider_id && (
            <div
              style={{
                marginTop: '12px',
                padding: '12px',
                background: 'rgba(0, 184, 148, 0.1)',
                borderRadius: '8px',
                fontSize: '13px',
              }}
            >
              {(() => {
                const p = providers.find(pr => pr.id === formData.provider_id)
                return p ? (
                  <>
                    <div>
                      <strong>类型:</strong> {p.provider_type}
                    </div>
                    <div>
                      <strong>模型:</strong> {p.model_name || p.model_id}
                    </div>
                    <div>
                      <strong>Base URL:</strong> {p.base_url || '默认'}
                    </div>
                  </>
                ) : null
              })()}
            </div>
          )}

          <div style={{ marginTop: '20px' }}>
            <button
              className="test-btn"
              onClick={handleTest}
              disabled={testing || !formData.provider_id}
              style={{ marginRight: '12px' }}
            >
              {testing ? '测试中...' : '测试连接'}
            </button>
          </div>
        </div>
      </div>

      {/* 当前状态 */}
      <div
        style={{
          marginTop: '24px',
          padding: '16px 20px',
          background: formData.is_active ? 'rgba(0, 184, 148, 0.1)' : 'rgba(99, 110, 114, 0.2)',
          border: `2px solid ${formData.is_active ? '#00b894' : '#636e72'}`,
          borderRadius: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '24px' }}>{formData.is_active ? '✅' : '⏸️'}</span>
          <div>
            <div style={{ fontWeight: 600, color: formData.is_active ? '#00b894' : 'var(--pixel-text)' }}>
              当前状态: {formData.is_active ? '已启用' : '已禁用'}
            </div>
            <div style={{ fontSize: '13px', color: 'rgba(223, 230, 233, 0.6)', marginTop: '4px' }}>
              {formData.is_active
                ? 'Manager 将作为任务协调者运行'
                : '系统将使用传统 MsgHub 模式运行'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
