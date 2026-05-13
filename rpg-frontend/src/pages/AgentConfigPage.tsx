import { useState, useEffect } from 'react'
import type { AgentConfig, Provider, Skill } from '../types'
import type { GameConfig } from '../game/config'
import { api } from '../api'

interface AgentFormData {
  name: string
  role: string
  personality: string
  avatar_type: string
  provider_id: string
  specialty: string
  expertise: string
  skill_ids: string[]
}

interface ManagerFormData {
  name: string
  role: string
  personality: string
  avatar_type: string
  provider_id: string
  is_active: boolean
}

const initialAgentFormData: AgentFormData = {
  name: '',
  role: '',
  personality: '',
  avatar_type: 'girl',
  provider_id: '',
  specialty: '',
  expertise: '',
  skill_ids: [],
}

const initialManagerFormData: ManagerFormData = {
  name: '任务管理器',
  role: '项目协调经理',
  personality: '专业、有条理、善于规划和协调，能够准确分析需求并合理分配任务',
  avatar_type: 'manager',
  provider_id: '',
  is_active: false,
}

export const AgentConfigPage = () => {
  const [agents, setAgents] = useState<AgentConfig[]>([])
  const [manager, setManager] = useState<AgentConfig | null>(null)
  const [providers, setProviders] = useState<Provider[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [showAgentForm, setShowAgentForm] = useState(false)
  const [showManagerForm, setShowManagerForm] = useState(false)
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null)
  const [agentFormData, setAgentFormData] = useState<AgentFormData>(initialAgentFormData)
  const [managerFormData, setManagerFormData] = useState<ManagerFormData>(initialManagerFormData)
  const [saving, setSaving] = useState(false)
  const [reinitializing, setReinitializing] = useState(false)
  const [testingManager, setTestingManager] = useState(false)
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null)

  useEffect(() => {
    loadData()
    api.getGameConfig().then(setGameConfig).catch(() => {})
  }, [])

  const loadData = async () => {
    console.log('Loading agent and provider data...')
    setLoading(true)

    // 加载 Agents (包含 Manager)
    try {
      const agentsRes = await api.getAgentConfigs(true)
      console.log('Loaded agents:', agentsRes)

      // 分离 Manager 和 Worker
      const managerAgent = agentsRes.find((a: AgentConfig) => a.id === 'manager_default')
      const workerAgents = agentsRes.filter((a: AgentConfig) => a.id !== 'manager_default')

      if (managerAgent) {
        setManager(managerAgent)
        setManagerFormData({
          name: managerAgent.name,
          role: managerAgent.role,
          personality: managerAgent.personality,
          avatar_type: managerAgent.avatar_type || 'manager',
          provider_id: managerAgent.provider_id || '',
          is_active: managerAgent.is_active,
        })
      }
      setAgents(workerAgents)
    } catch (error) {
      console.error('Failed to load agents:', error)
      alert('加载 Agent 列表失败')
    }

    // 加载 Providers
    try {
      const providersRes = await api.getProviders()
      console.log('Loaded providers:', providersRes)
      setProviders(providersRes)
    } catch (error) {
      console.error('Failed to load providers:', error)
      alert('加载 Provider 列表失败，请先配置 Provider')
    }

    // 加载 Skills（只加载已启用的）
    try {
      const skillsRes = await api.getSkills(false)
      console.log('Loaded skills:', skillsRes)
      setSkills(skillsRes)
    } catch (error) {
      console.error('Failed to load skills:', error)
    }

    setLoading(false)
  }

  const handleAddAgentClick = () => {
    if (providers.length === 0) {
      alert('请先配置 Provider（模型），再创建 Agent')
      return
    }
    setEditingAgent(null)
    setAgentFormData({
      ...initialAgentFormData,
      provider_id: providers[0]?.id || '',
    })
    setShowAgentForm(true)
  }

  const handleEditAgentClick = (agent: AgentConfig) => {
    setEditingAgent(agent)
    setAgentFormData({
      name: agent.name,
      role: agent.role,
      personality: agent.personality,
      avatar_type: agent.avatar_type || 'girl',
      provider_id: agent.provider_id,
      specialty: agent.specialty || '',
      expertise: agent.expertise || '',
      skill_ids: agent.skill_ids || [],
    })
    setShowAgentForm(true)
  }

  const handleEditManagerClick = () => {
    if (manager) {
      setManagerFormData({
        name: manager.name,
        role: manager.role,
        personality: manager.personality,
        avatar_type: manager.avatar_type || 'manager',
        provider_id: manager.provider_id || '',
        is_active: manager.is_active,
      })
    }
    setShowManagerForm(true)
  }

  const handleCloseAgentForm = () => {
    setShowAgentForm(false)
    setEditingAgent(null)
    setAgentFormData(initialAgentFormData)
  }

  const handleCloseManagerForm = () => {
    setShowManagerForm(false)
  }

  const handleSaveAgent = async () => {
    if (!agentFormData.name || !agentFormData.role || !agentFormData.personality || !agentFormData.provider_id) {
      alert('请填写所有必填字段')
      return
    }

    const saveData = {
      name: agentFormData.name,
      role: agentFormData.role,
      personality: agentFormData.personality,
      avatar_type: agentFormData.avatar_type,
      provider_id: agentFormData.provider_id,
      specialty: agentFormData.specialty,
      expertise: agentFormData.expertise,
      skill_ids: agentFormData.skill_ids,
    }

    console.log('Saving agent data:', saveData)
    setSaving(true)
    try {
      if (editingAgent) {
        await api.updateAgentConfig(editingAgent.id, saveData)
      } else {
        const result = await api.createAgentConfig(saveData)
        console.log('Agent created:', result)
      }
      // 重新加载数据
      await loadData()
      // 自动重新初始化系统以加载新 Agent
      try {
        await api.reinitializeSystem()
        console.log('System reinitialized successfully')
      } catch (reinitError) {
        console.warn('System reinitialization failed:', reinitError)
      }
      // 通知 App.tsx 刷新 agents 列表
      window.dispatchEvent(new CustomEvent('agentUpdated'))
      handleCloseAgentForm()
      alert('保存成功')
    } catch (error: any) {
      console.error('Failed to save agent:', error)
      const errorMsg = error.response?.data?.detail || error.message || '保存失败'
      alert(`保存失败: ${errorMsg}`)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveManager = async () => {
    if (!managerFormData.name || !managerFormData.role || !managerFormData.personality || !managerFormData.provider_id) {
      alert('请填写所有必填字段')
      return
    }

    console.log('Saving manager config:', managerFormData)
    setSaving(true)
    try {
      const result = await api.updateManagerConfig({
        name: managerFormData.name,
        role: managerFormData.role,
        personality: managerFormData.personality,
        avatar_type: managerFormData.avatar_type,
        provider_id: managerFormData.provider_id,
        is_active: managerFormData.is_active,
      })
      console.log('Save result:', result)

      // 重新加载数据
      await loadData()
      // 重新初始化系统
      try {
        await api.reinitializeSystem()
        console.log('System reinitialized successfully')
      } catch (reinitError) {
        console.warn('System reinitialization failed:', reinitError)
      }
      // 通知 App.tsx 刷新
      window.dispatchEvent(new CustomEvent('agentUpdated'))
      handleCloseManagerForm()
      alert('Manager 配置已保存')
    } catch (error: any) {
      console.error('Failed to save manager config:', error)
      alert(`保存失败: ${error.response?.data?.detail || error.message || '未知错误'}`)
    } finally {
      setSaving(false)
    }
  }

  const handleTestManager = async () => {
    if (!managerFormData.provider_id) {
      alert('请先选择 Provider')
      return
    }

    setTestingManager(true)
    try {
      // 先保存当前配置
      await api.updateManagerConfig({
        provider_id: managerFormData.provider_id,
      })
      // 然后测试
      const result = await api.testManagerConnection()
      alert(result.message)
    } catch (error: any) {
      alert('测试连接失败: ' + (error.response?.data?.detail || error.message))
    } finally {
      setTestingManager(false)
    }
  }

  const handleDeleteAgent = async (agentId: string) => {
    if (!confirm('确定要删除这个 Agent 吗？')) return

    try {
      await api.deleteAgentConfig(agentId)
      await loadData()
      // 删除后重新初始化系统
      try {
        await api.reinitializeSystem()
        console.log('System reinitialized after deletion')
      } catch (reinitError) {
        console.warn('System reinitialization failed:', reinitError)
      }
      // 通知 App.tsx 刷新 agents 列表
      window.dispatchEvent(new CustomEvent('agentUpdated'))
    } catch (error) {
      console.error('Failed to delete agent:', error)
      alert('删除失败')
    }
  }

  const handleReinitialize = async () => {
    if (!confirm('重新初始化系统会重新加载所有 Agent 配置，确定继续吗？')) return

    setReinitializing(true)
    try {
      const result = await api.reinitializeSystem()
      alert(`系统已重新初始化，共加载 ${result.agent_count} 个 Agent`)
    } catch (error) {
      console.error('Failed to reinitialize:', error)
      alert('重新初始化失败')
    } finally {
      setReinitializing(false)
    }
  }

  const getProviderName = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId)
    return provider ? `${provider.name} (${provider.model_name || provider.model_id})` : providerId
  }

  if (loading) {
    return <div className="providers-page loading">加载中...</div>
  }

  return (
    <div className="providers-page">
      <div className="providers-header">
        <h2>Agent 配置</h2>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            className="test-btn"
            onClick={handleReinitialize}
            disabled={reinitializing}
          >
            {reinitializing ? '初始化中...' : '🔄 重新初始化系统'}
          </button>
          <button className="add-btn" onClick={handleAddAgentClick}>
            + 添加 Agent
          </button>
        </div>
      </div>

      <div className="tab-description">
        <p>
          配置 Manager（任务协调者）和 Worker Agents（任务执行者）。
          Manager 作为系统默认 Agent 不可删除，Worker Agents 可以自由创建和删除。
        </p>
      </div>

      {/* Manager Agent 区域 */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '16px', color: 'var(--pixel-text)', fontSize: '18px' }}>
          👔 Manager Agent
          <span style={{ fontSize: '13px', color: '#666', marginLeft: '12px', fontWeight: 'normal' }}>
            任务协调者，不可删除
          </span>
        </h3>

        {manager ? (
          <div
            className={`provider-card ${manager.is_active ? 'active' : ''}`}
            style={{ borderColor: manager.is_active ? '#00b894' : 'var(--pixel-surface)' }}
          >
            <div className="provider-info">
              <div className="provider-header">
                <h4>{manager.name}</h4>
                {manager.is_active ? (
                  <span className="active-badge">已启用</span>
                ) : (
                  <span style={{
                    padding: '4px 10px',
                    background: '#636e72',
                    borderRadius: '4px',
                    color: 'var(--pixel-text)',
                    fontSize: '12px',
                    fontWeight: 600,
                  }}>已停用</span>
                )}
              </div>
              <div className="provider-details">
                <span className="provider-type">{manager.role}</span>
                <span className="model-name">
                  使用: {manager.provider_id ? getProviderName(manager.provider_id) : '未配置'}
                </span>
              </div>
              <div className="provider-meta">
                <span>性格: {manager.personality.slice(0, 30)}...</span>
              </div>
              <div className="provider-meta" style={{ marginTop: '4px' }}>
                🎨 形象: {manager.avatar_type || '未设置'}
              </div>
              <div className="provider-meta" style={{ marginTop: '4px', color: '#00b894' }}>
                {manager.is_active
                  ? '✅ 启用后 Manager 将作为任务协调者，自动分派任务给 Workers'
                  : '⏸️ 停用后系统将使用传统 MsgHub 模式运行'}
              </div>
            </div>
            <div className="provider-actions">
              <button
                className="edit-btn"
                onClick={handleEditManagerClick}
              >
                配置
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '30px' }}>
            <p>正在加载 Manager 配置...</p>
          </div>
        )}
      </div>

      {/* Worker Agents 区域 */}
      <div>
        <h3 style={{ marginBottom: '16px', color: 'var(--pixel-text)', fontSize: '18px' }}>
          🛠️ Worker Agents
          <span style={{ fontSize: '13px', color: '#666', marginLeft: '12px', fontWeight: 'normal' }}>
            任务执行者 ({agents.length} 个)
          </span>
        </h3>

        <div className="providers-list">
          {agents.length === 0 ? (
            <div className="empty-state">
              <p>还没有配置任何 Worker Agent</p>
              {providers.length === 0 ? (
                <p style={{ color: '#999', fontSize: '14px', marginTop: '8px' }}>
                  请先前往 Provider 配置页面添加模型
                </p>
              ) : (
                <button className="add-btn" onClick={handleAddAgentClick}>
                  添加第一个 Worker
                </button>
              )}
            </div>
          ) : (
            agents.map(agent => (
              <div
                key={agent.id}
                className={`provider-card ${agent.is_active ? 'active' : ''}`}
              >
                <div className="provider-info">
                  <div className="provider-header">
                    <h4>🤖 {agent.name}</h4>
                    {agent.is_active && <span className="active-badge">已启用</span>}
                  </div>
                  <div className="provider-details">
                    <span className="provider-type">{agent.role}</span>
                    <span className="model-name">
                      使用: {getProviderName(agent.provider_id)}
                    </span>
                  </div>
                  <div className="provider-meta">
                    <span>性格: {agent.personality.slice(0, 30)}...</span>
                  </div>
                  <div className="provider-meta" style={{ marginTop: '4px' }}>
                    🎨 形象: {agent.avatar_type || '未设置'}
                  </div>
                  {agent.specialty && (
                    <div className="provider-meta" style={{ marginTop: '4px' }}>
                      🎯 专长: {agent.specialty}
                    </div>
                  )}
                  {agent.skills && agent.skills.length > 0 && (
                    <div className="provider-meta" style={{ marginTop: '8px' }}>
                      {agent.skills.map((skill, i) => (
                        <span
                          key={i}
                          style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            margin: '0 6px 4px 0',
                            background: 'rgba(0, 184, 148, 0.15)',
                            borderRadius: '4px',
                            fontSize: '12px',
                            color: '#00b894',
                          }}
                        >
                          {skill.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="provider-actions">
                  <button
                    className="edit-btn"
                    onClick={() => handleEditAgentClick(agent)}
                  >
                    编辑
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleDeleteAgent(agent.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Worker Agent Form Modal */}
      {showAgentForm && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>{editingAgent ? '编辑 Worker Agent' : '添加 Worker Agent'}</h3>
              <button className="close-btn" onClick={handleCloseAgentForm}>×</button>
            </div>

            <div className="modal-body">
              {/* 基本信息 */}
              <div className="form-section" style={{ marginBottom: '24px' }}>
                <h4 style={{ marginBottom: '12px', color: 'var(--pixel-accent)' }}>基本信息</h4>

                <div className="form-group">
                  <label>Agent 名称 *</label>
                  <input
                    type="text"
                    value={agentFormData.name}
                    onChange={e => setAgentFormData({ ...agentFormData, name: e.target.value })}
                    placeholder="例如：狗哥"
                  />
                </div>

                <div className="form-group">
                  <label>角色 *</label>
                  <input
                    type="text"
                    value={agentFormData.role}
                    onChange={e => setAgentFormData({ ...agentFormData, role: e.target.value })}
                    placeholder="例如：技术专家"
                  />
                </div>

                <div className="form-group">
                  <label>性格描述 *</label>
                  <textarea
                    value={agentFormData.personality}
                    onChange={e => setAgentFormData({ ...agentFormData, personality: e.target.value })}
                    placeholder="描述这个 Agent 的性格特点..."
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

                <div className="form-group">
                  <label>形象 *</label>
                  <select
                    value={agentFormData.avatar_type}
                    onChange={e => setAgentFormData({ ...agentFormData, avatar_type: e.target.value })}
                  >
                    {gameConfig
                      ? Object.entries(gameConfig.characters).map(([key, char]) => (
                          <option key={key} value={key}>
                            {key} ({char.type === 'spritesheet' ? '帧动画' : '代码生成'})
                          </option>
                        ))
                      : <option value="girl">girl</option>}
                  </select>
                  <span className="hint">选择 Agent 在游戏场景中的外观形象</span>
                </div>
              </div>

              {/* 专长配置（可选） */}
              <div className="form-section" style={{ marginBottom: '24px' }}>
                <h4 style={{ marginBottom: '12px', color: 'var(--pixel-accent)' }}>专长配置（可选）</h4>

                <div className="form-group">
                  <label>专业领域</label>
                  <input
                    type="text"
                    value={agentFormData.specialty}
                    onChange={e => setAgentFormData({ ...agentFormData, specialty: e.target.value })}
                    placeholder="例如：数据分析、文案写作、代码开发"
                  />
                  <span className="hint">
                    描述这个 Agent 的主要专业方向，Manager 会根据此分派任务
                  </span>
                </div>

                <div className="form-group">
                  <label>专长描述</label>
                  <textarea
                    value={agentFormData.expertise}
                    onChange={e => setAgentFormData({ ...agentFormData, expertise: e.target.value })}
                    placeholder="详细描述这个 Agent 的专长..."
                    rows={2}
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
                  <span className="hint">
                    详细描述专长，帮助 Manager 更准确地分派任务
                  </span>
                </div>
              </div>

              {/* Skill 选择 */}
              <div className="form-section" style={{ marginBottom: '24px' }}>
                <h4 style={{ marginBottom: '12px', color: 'var(--pixel-accent)' }}>技能配置</h4>

                {skills.length === 0 ? (
                  <div style={{ padding: '12px', background: 'rgba(99, 110, 114, 0.15)', borderRadius: '8px', fontSize: '13px', color: '#999' }}>
                    暂无可用的技能。请先前往「技能管理」页面启用技能。
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        maxHeight: '160px',
                        overflowY: 'auto',
                        border: '2px solid var(--pixel-surface)',
                        borderRadius: '8px',
                        padding: '10px',
                        background: 'rgba(99, 110, 114, 0.1)',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
                          gap: '8px',
                        }}
                      >
                        {skills.map(skill => {
                          const isSelected = agentFormData.skill_ids.includes(skill.name)
                          return (
                            <label
                              key={skill.name}
                              title={skill.name}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '13px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                background: isSelected
                                  ? 'rgba(0, 184, 148, 0.2)'
                                  : 'rgba(99, 110, 114, 0.2)',
                                border: isSelected
                                  ? '1px solid rgba(0, 184, 148, 0.5)'
                                  : '1px solid transparent',
                                color: isSelected ? '#00b894' : 'var(--pixel-text)',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={e => {
                                  if (e.target.checked) {
                                    setAgentFormData({
                                      ...agentFormData,
                                      skill_ids: [...agentFormData.skill_ids, skill.name],
                                    })
                                  } else {
                                    setAgentFormData({
                                      ...agentFormData,
                                      skill_ids: agentFormData.skill_ids.filter(id => id !== skill.name),
                                    })
                                  }
                                }}
                                style={{
                                  width: '14px',
                                  height: '14px',
                                  flexShrink: 0,
                                  cursor: 'pointer',
                                }}
                              />
                              <span
                                style={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {skill.name}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    </div>
                    {agentFormData.skill_ids.length > 0 && (
                      <div style={{ marginTop: '6px', fontSize: '12px', color: '#00b894' }}>
                        已选择 {agentFormData.skill_ids.length} 个技能
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Provider 选择 */}
              <div className="form-section" style={{ marginBottom: '24px' }}>
                <h4 style={{ marginBottom: '12px', color: 'var(--pixel-accent)' }}>模型配置</h4>

                <div className="form-group">
                  <label>选择 Provider *</label>
                  <select
                    value={agentFormData.provider_id}
                    onChange={e => setAgentFormData({ ...agentFormData, provider_id: e.target.value })}
                  >
                    <option value="">请选择 Provider</option>
                    {providers.map(provider => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name} - {provider.model_name || provider.model_id}
                      </option>
                    ))}
                  </select>
                  <span className="hint">
                    Provider 包含模型配置和 API 密钥，请在 Provider 配置页面管理
                  </span>
                </div>

                {agentFormData.provider_id && (
                  <div className="provider-info-box" style={{
                    marginTop: '12px',
                    padding: '12px',
                    background: 'rgba(0, 184, 148, 0.1)',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}>
                    {(() => {
                      const p = providers.find(pr => pr.id === agentFormData.provider_id)
                      return p ? (
                        <>
                          <div><strong>类型:</strong> {p.provider_type}</div>
                          <div><strong>模型:</strong> {p.model_name || p.model_id}</div>
                          <div><strong>Base URL:</strong> {p.base_url || '默认'}</div>
                        </>
                      ) : null
                    })()}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer">
              <div className="footer-actions">
                <button className="cancel-btn" onClick={handleCloseAgentForm}>
                  取消
                </button>
                <button
                  className="save-btn"
                  onClick={handleSaveAgent}
                  disabled={saving}
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manager Config Modal */}
      {showManagerForm && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>配置 Manager Agent</h3>
              <button className="close-btn" onClick={handleCloseManagerForm}>×</button>
            </div>

            <div className="modal-body">
              {/* 启用开关 */}
              <div style={{ marginBottom: '24px', padding: '16px', background: 'rgba(0, 184, 148, 0.1)', borderRadius: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={managerFormData.is_active}
                    onChange={e => setManagerFormData({ ...managerFormData, is_active: e.target.checked })}
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
              <div className="form-section" style={{ marginBottom: '24px' }}>
                <h4 style={{ marginBottom: '12px', color: 'var(--pixel-accent)' }}>基本信息</h4>

                <div className="form-group">
                  <label>Manager 名称 *</label>
                  <input
                    type="text"
                    value={managerFormData.name}
                    onChange={e => setManagerFormData({ ...managerFormData, name: e.target.value })}
                    placeholder="例如：任务管理器"
                  />
                </div>

                <div className="form-group">
                  <label>角色 *</label>
                  <input
                    type="text"
                    value={managerFormData.role}
                    onChange={e => setManagerFormData({ ...managerFormData, role: e.target.value })}
                    placeholder="例如：项目协调经理"
                  />
                </div>

                <div className="form-group">
                  <label>性格描述 *</label>
                  <textarea
                    value={managerFormData.personality}
                    onChange={e => setManagerFormData({ ...managerFormData, personality: e.target.value })}
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

                <div className="form-group">
                  <label>形象 *</label>
                  <select
                    value={managerFormData.avatar_type}
                    onChange={e => setManagerFormData({ ...managerFormData, avatar_type: e.target.value })}
                  >
                    {gameConfig
                      ? Object.entries(gameConfig.characters).map(([key, char]) => (
                          <option key={key} value={key}>
                            {key} ({char.type === 'spritesheet' ? '帧动画' : '代码生成'})
                          </option>
                        ))
                      : <option value="manager">manager</option>}
                  </select>
                  <span className="hint">选择 Manager 在游戏场景中的外观形象</span>
                </div>
              </div>

              {/* Provider 配置 */}
              <div className="form-section" style={{ marginBottom: '24px' }}>
                <h4 style={{ marginBottom: '12px', color: 'var(--pixel-accent)' }}>模型配置</h4>

                <div className="form-group">
                  <label>选择 Provider *</label>
                  <select
                    value={managerFormData.provider_id}
                    onChange={e => setManagerFormData({ ...managerFormData, provider_id: e.target.value })}
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

                {managerFormData.provider_id && (
                  <div className="provider-info-box" style={{
                    marginTop: '12px',
                    padding: '12px',
                    background: 'rgba(0, 184, 148, 0.1)',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}>
                    {(() => {
                      const p = providers.find(pr => pr.id === managerFormData.provider_id)
                      return p ? (
                        <>
                          <div><strong>类型:</strong> {p.provider_type}</div>
                          <div><strong>模型:</strong> {p.model_name || p.model_id}</div>
                          <div><strong>Base URL:</strong> {p.base_url || '默认'}</div>
                        </>
                      ) : null
                    })()}
                  </div>
                )}

                <div style={{ marginTop: '16px' }}>
                  <button
                    className="test-btn"
                    onClick={handleTestManager}
                    disabled={testingManager || !managerFormData.provider_id}
                  >
                    {testingManager ? '测试中...' : '测试连接'}
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <div className="footer-actions">
                <button className="cancel-btn" onClick={handleCloseManagerForm}>
                  取消
                </button>
                <button
                  className="save-btn"
                  onClick={handleSaveManager}
                  disabled={saving}
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
