import { useState } from 'react'
import type { GameConfig, SceneConfig } from '../game/config'
import { api } from '../api'

interface SceneSelectPageProps {
  config: GameConfig
  onSceneChange: (newConfig: GameConfig) => void
}

export const SceneSelectPage = ({ config, onSceneChange }: SceneSelectPageProps) => {
  const [saving, setSaving] = useState(false)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDescription, setEditDescription] = useState('')
  const scenes = Object.entries(config.scenes)

  const handleSelect = async (sceneKey: string) => {
    if (sceneKey === config.currentScene) return
    const sceneName = config.scenes[sceneKey]?.key || sceneKey
    if (!window.confirm(`确定要切换到场景 "${sceneName}" 吗？`)) return
    setSaving(true)
    try {
      await api.updateCurrentScene(sceneKey)
      // 前端本地更新 currentScene，保留完整的 scenes 配置
      const updated = { ...config, currentScene: sceneKey }
      onSceneChange(updated)
      alert(`已切换到场景 "${sceneName}"`)
    } catch (err) {
      console.error('Failed to switch scene:', err)
      alert('场景切换失败')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (key: string, scene: SceneConfig) => {
    setEditingKey(key)
    setEditDescription(scene.description || '')
  }

  const cancelEdit = () => {
    setEditingKey(null)
    setEditDescription('')
  }

  const saveDescription = async (sceneKey: string) => {
    setSaving(true)
    try {
      const updatedConfig = {
        ...config,
        scenes: {
          ...config.scenes,
          [sceneKey]: {
            ...config.scenes[sceneKey],
            description: editDescription.trim(),
          },
        },
      }
      const updated = await api.updateGameConfig(updatedConfig)
      onSceneChange(updated)
      setEditingKey(null)
    } catch (err) {
      console.error('Failed to update scene description:', err)
      alert('场景描述更新失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="providers-page">
      <div className="providers-header">
        <h2>场景配置</h2>
      </div>

      <div className="tab-description">
        <p>选择已配置的场景，切换后聊天页面将自动加载新场景。场景描述会作为提示词注入给 AI Agent，影响它们的回答风格。</p>
      </div>

      <div className="providers-list">
        {scenes.length === 0 ? (
          <div className="empty-state">
            <p>暂无配置的场景</p>
          </div>
        ) : (
          scenes.map(([key, scene]) => {
            const isActive = key === config.currentScene
            const isEditing = editingKey === key
            return (
              <div
                key={key}
                className={`provider-card ${isActive ? 'active' : ''}`}
                style={{
                  borderColor: isActive ? '#00b894' : 'var(--pixel-surface)',
                  cursor: isEditing ? 'default' : 'pointer',
                }}
                onClick={() => !saving && !isEditing && handleSelect(key)}
              >
                <div className="provider-info" style={{ flex: 1 }}>
                  <div className="provider-header">
                    <h4>{key}</h4>
                    {isActive && (
                      <span className="active-badge">当前场景</span>
                    )}
                  </div>
                  <div className="provider-details">
                    <span className="provider-type">地图: {scene.mapPath.split('/').pop()}</span>
                    <span className="model-name">图层: {scene.layers.length} 个</span>
                  </div>
                  <div className="provider-meta">
                    Tileset: {scene.tilesetName}
                  </div>
                  {/* 场景描述 */}
                  <div className="scene-description" style={{ marginTop: 12 }}>
                    {isEditing ? (
                      <div onClick={e => e.stopPropagation()}>
                        <textarea
                          value={editDescription}
                          onChange={e => setEditDescription(e.target.value)}
                          placeholder="描述当前场景的背景氛围，例如：这是一座安静的图书馆..."
                          rows={3}
                          style={{
                            width: '100%',
                            padding: 8,
                            borderRadius: 4,
                            border: '1px solid var(--pixel-border)',
                            background: 'var(--pixel-surface)',
                            color: 'var(--pixel-text)',
                            fontSize: 13,
                            resize: 'vertical',
                            fontFamily: 'inherit',
                          }}
                        />
                        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                          <button
                            className="btn primary"
                            onClick={() => saveDescription(key)}
                            disabled={saving}
                            style={{ padding: '4px 12px', fontSize: 12 }}
                          >
                            {saving ? '保存中...' : '保存'}
                          </button>
                          <button
                            className="btn secondary"
                            onClick={cancelEdit}
                            disabled={saving}
                            style={{ padding: '4px 12px', fontSize: 12 }}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize: 12, color: 'var(--pixel-muted)', marginBottom: 4 }}>
                          场景描述：
                        </div>
                        <div style={{
                          fontSize: 13,
                          color: scene.description ? 'var(--pixel-text)' : 'var(--pixel-muted)',
                          lineHeight: 1.5,
                          background: 'var(--pixel-surface)',
                          padding: '8px 10px',
                          borderRadius: 4,
                          border: '1px solid var(--pixel-border)',
                        }}>
                          {scene.description || '暂无场景描述，点击编辑按钮添加'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="provider-actions" style={{ flexDirection: 'column', gap: 8 }}>
                  {!isActive && !isEditing && (
                    <button className="edit-btn" disabled={saving}>
                      {saving ? '切换中...' : '切换'}
                    </button>
                  )}
                  {!isEditing && (
                    <button
                      className="edit-btn secondary"
                      onClick={(e) => {
                        e.stopPropagation()
                        startEdit(key, scene)
                      }}
                      disabled={saving}
                      style={{ background: 'transparent', border: '1px solid var(--pixel-border)' }}
                    >
                      编辑描述
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
