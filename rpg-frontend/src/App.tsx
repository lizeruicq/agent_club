import { useEffect, useRef, useState, useCallback } from 'react'
import Phaser from 'phaser'
import { ChatScene } from './game/ChatScene'
import { ChatInput } from './components/ChatInput'
import { AgentConfigPage } from './pages/AgentConfigPage'
import { ProviderConfigPage } from './pages/ProviderConfigPage'
import { ToolConfigPage } from './pages/ToolConfigPage'
import { SkillConfigPage } from './pages/SkillConfigPage'
import { SceneSelectPage } from './pages/SceneSelectPage'
import { HtmlPreviewPage } from './pages/HtmlPreviewPage'
import { PlazaPage } from './pages/PlazaPage'
import { LoginPage } from './pages/LoginPage'
import type { ChatMessage, RobotStatus, AgentInfo } from './types'
import type { GameConfig } from './game/config'
import { api, getToken, getSavedUser } from './api'

type Page = 'chat' | 'agents' | 'providers' | 'tools' | 'skills' | 'scenes' | 'preview' | 'plaza'

// 图标组件
const ChatIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
)

const ModelIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
  </svg>
)

const ProviderIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
    <path d="M2 17l10 5 10-5"/>
    <path d="M2 12l10 5 10-5"/>
  </svg>
)

const ToolIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
)

const SkillIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
)

const SceneIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
)

const PreviewIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

const PlazaIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
)

// 最大化图标
const MaximizeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </svg>
)

// 还原图标（小窗）
const RestoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="6" width="14" height="14" rx="2" />
    <path d="M6 10h-2a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2" />
  </svg>
)

// 最小化图标（横线）
const MinimizeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)

// 展开聊天图标（气泡）
const ChatBubbleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

type ChatSize = 'normal' | 'expanded' | 'hidden'

function App() {
  // ========== 认证状态 ==========
  const [currentUser, setCurrentUser] = useState<{ id: string; username: string; nickname: string } | null>(getSavedUser())
  const isLoggedIn = !!currentUser && !!getToken()

  // 监听登出事件（401 时自动触发）
  useEffect(() => {
    const handleLogout = () => setCurrentUser(null)
    window.addEventListener('auth:logout', handleLogout)
    return () => window.removeEventListener('auth:logout', handleLogout)
  }, [])

  const handleLoginSuccess = (user: { id: string; username: string; nickname: string }) => {
    setCurrentUser(user)
  }

  const handleLogout = () => {
    api.logout()
    setCurrentUser(null)
  }

  // 未登录 → 显示登录页（广场除外）
  // ==========

  const gameRef = useRef<Phaser.Game | null>(null)
  const sceneRef = useRef<ChatScene | null>(null)
  const agentsRef = useRef<AgentInfo[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [robotStatus, setRobotStatus] = useState<RobotStatus>('idle')
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentPage, setCurrentPage] = useState<Page>('chat')
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [activeAgents, setActiveAgents] = useState<string[]>([])
  const [gameConfig, setGameConfig] = useState<GameConfig | null>(null)

  // 加载游戏配置（登录后才加载）
  // 以前端本地 game-config.json 为准，只用后端的 currentScene 覆盖
  useEffect(() => {
    if (!isLoggedIn) return
    const loadConfig = async () => {
      try {
        const localResp = await fetch('/assets/game-config.json')
        const localConfig = await localResp.json() as GameConfig
        try {
          const serverConfig = await api.getGameConfig()
          if (serverConfig.currentScene && localConfig.scenes[serverConfig.currentScene]) {
            localConfig.currentScene = serverConfig.currentScene
          }
        } catch (err) {
          console.warn('Server game-config unavailable, using local only:', err)
        }
        setGameConfig(localConfig)
      } catch (err) {
        console.error('Failed to load game config:', err)
      }
    }
    loadConfig()
  }, [isLoggedIn])

  // 同步agents状态到ref，确保Phaser初始化时能获取最新值
  useEffect(() => {
    agentsRef.current = agents
  }, [agents])

  // 初始化 Phaser 游戏（需等配置加载完成后）
  useEffect(() => {
    if (currentPage !== 'chat' || !gameConfig) return

    const gameContainer = document.getElementById('game-container')
    const width = gameContainer?.clientWidth || window.innerWidth
    const height = gameContainer?.clientHeight || window.innerHeight

    const scene = new ChatScene(gameConfig)

    const phaserConfig: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      width: width,
      height: height,
      parent: 'game-container',
      pixelArt: true,
      backgroundColor: '#e8e8e8',
      scene: scene,
      physics: {
        default: 'arcade',
        arcade: { gravity: { x: 0, y: 0 } }
      }
    }

    gameRef.current = new Phaser.Game(phaserConfig)

    // 获取场景引用
    const checkScene = setInterval(() => {
      const s = gameRef.current?.scene.getScene('ChatScene') as ChatScene
      if (s) {
        sceneRef.current = s
        console.log('ChatScene initialized, agents count:', agents.length)
        // 传递 agents 信息（使用最新的agents状态）
        const currentAgents = agentsRef.current
        s.setAgents(currentAgents)
        clearInterval(checkScene)
      }
    }, 100)

    // 响应窗口大小变化
    const handleResize = () => {
      const gameContainer = document.getElementById('game-container')
      const width = gameContainer?.clientWidth || window.innerWidth
      const height = gameContainer?.clientHeight || window.innerHeight
      gameRef.current?.scale.resize(width, height)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      clearInterval(checkScene)
      gameRef.current?.destroy(true)
      gameRef.current = null
      sceneRef.current = null
    }
  }, [currentPage, gameConfig])

  // 聊天窗口尺寸状态: normal(小窗) | expanded(全屏) | hidden(隐藏)
  const [chatSize, setChatSize] = useState<ChatSize>('normal')

  // 获取 Agent 列表（登录后才获取）
  useEffect(() => {
    if (!isLoggedIn) return
    const fetchAgents = async () => {
      try {
        console.log('Fetching agents for page:', currentPage)
        const agentList = await api.getAgents()
        console.log('Fetched agents:', agentList.length, agentList)
        setAgents(agentList)
      } catch (err) {
        console.error('Failed to fetch agents:', err)
      }
    }
    fetchAgents()
  }, [currentPage, isLoggedIn])

  // 监听 agent 更新事件（从配置页面返回时刷新）
  useEffect(() => {
    const handleAgentUpdated = () => {
      console.log('Agent updated event received, refreshing...')
      const fetchAgents = async () => {
        try {
          const agentList = await api.getAgents()
          console.log('Refreshed agents after update:', agentList.length, agentList)
          setAgents(agentList)
        } catch (err) {
          console.error('Failed to refresh agents:', err)
        }
      }
      fetchAgents()
    }
    window.addEventListener('agentUpdated', handleAgentUpdated)
    return () => window.removeEventListener('agentUpdated', handleAgentUpdated)
  }, [])

  // 当 agents 变化时，更新场景
  useEffect(() => {
    if (sceneRef.current) {
      console.log('Setting agents to scene:', agents.length, agents)
      sceneRef.current.setAgents(agents)
    }
  }, [agents])

  // 处理玩家消息 - 使用流式输出
  const handlePlayerMessage = useCallback(async (text: string) => {
    if (!text.trim() || isProcessing) return

    console.log('🚀 开始流式请求:', text)

    // 添加玩家消息到列表
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: Date.now()
    }
    setMessages(prev => [...prev, userMessage])
    setIsProcessing(true)
    setRobotStatus('thinking')

    // 在场景中显示玩家对话气泡
    sceneRef.current?.showPlayerDialog(text)

    // 存储当前正在流式输出的消息
    const streamingMessages = new Map<string, string>() // agentName -> messageId
    const streamingContents = new Map<string, string>() // agentName -> accumulated content

    // 开始流式请求
    api.chatStream(
      text,
      (chunk) => {
        console.log('📦 收到流式数据:', chunk.type, chunk.agent_name, chunk.content?.slice(0, 20))

        switch (chunk.type) {
          case 'start':
          case 'agent_start':
            // 新 Agent 开始回复 - 创建空消息
            if (chunk.agent_name) {
              const messageId = `msg_${Date.now()}_${chunk.index}_${Math.random().toString(36).substr(2, 9)}`
              streamingMessages.set(chunk.agent_name, messageId)
              streamingContents.set(chunk.agent_name, '')

              // 添加活跃 Agent
              setActiveAgents(prev => {
                if (!prev.includes(chunk.agent_name!)) {
                  return [...prev, chunk.agent_name!]
                }
                return prev
              })
              setRobotStatus('speaking')

              // 创建新消息（空内容）
              const newMessage: ChatMessage = {
                id: messageId,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                agentName: chunk.agent_name,
                agentRole: chunk.agent_role,
                isStreaming: true
              }
              setMessages(prev => [...prev, newMessage])

              // 高亮当前说话的 Agent
              sceneRef.current?.highlightAgent(chunk.agent_name)
            }
            break

          case 'chunk':
            // 接收内容片段 - 追加到对应消息
            if (chunk.agent_name && chunk.content) {
              const messageId = streamingMessages.get(chunk.agent_name)
              if (messageId) {
                // 累计内容
                const prevContent = streamingContents.get(chunk.agent_name) || ''
                const newContent = prevContent + chunk.content
                streamingContents.set(chunk.agent_name, newContent)

                setMessages(prev =>
                  prev.map(msg =>
                    msg.id === messageId
                      ? { ...msg, content: msg.content + chunk.content }
                      : msg
                  )
                )
                // 更新场景中的对话气泡（用累计后的完整内容）
                sceneRef.current?.showNPCDialog(newContent, chunk.agent_name)
              }
            }
            break

          case 'done':
          case 'agent_done':
            // Agent 回复完成 - 标记为非流式
            if (chunk.agent_name) {
              const messageId = streamingMessages.get(chunk.agent_name)
              if (messageId) {
                setMessages(prev =>
                  prev.map(msg =>
                    msg.id === messageId
                      ? { ...msg, isStreaming: false }
                      : msg
                  )
                )
              }
            }
            break

          case 'all_done':
            // 全部完成 - 恢复状态
            setTimeout(() => {
              sceneRef.current?.resetAgentHighlight()
              setRobotStatus('idle')
              setActiveAgents([])
              setIsProcessing(false)
            }, 500)
            break

          case 'error': {
            // 错误处理
            console.error('流式输出错误:', chunk.message)
            const errorMsg: ChatMessage = {
              id: (Date.now() + 1).toString(),
              role: 'error',
              content: chunk.message || '请求失败',
              timestamp: Date.now(),
              isError: true
            }
            setMessages(prev => [...prev, errorMsg])
            setRobotStatus('idle')
            setActiveAgents([])
            setIsProcessing(false)
            break
          }
        }
      },
      (error) => {
        // 请求失败
        console.error('流式请求失败:', error)
        const errorMsg: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: 'error',
          content: error,
          timestamp: Date.now(),
          isError: true
        }
        setMessages(prev => [...prev, errorMsg])
        setRobotStatus('idle')
        setActiveAgents([])
        setIsProcessing(false)
      }
    )

  }, [isProcessing])

  // 同步机器人状态到场景 - 只对活跃 Agent 生效
  useEffect(() => {
    if (!sceneRef.current) return

    // 重置所有 agent 为 idle
    sceneRef.current.setRobotStatus('idle')

    // 只有活跃 agent 才设置新状态
    activeAgents.forEach(agentName => {
      sceneRef.current?.setRobotStatus(robotStatus, agentName)
    })
  }, [robotStatus, activeAgents])

  // 未登录时显示登录页
  if (!isLoggedIn) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />
  }

  return (
    <div className="app">
      {/* 侧边栏 */}
      <nav className="sidebar">
        <div className="sidebar-header">
          <h2>Agent Club</h2>
          <div className="user-info">
            <span className="user-nickname">{currentUser?.nickname || currentUser?.username}</span>
            <button className="logout-btn" onClick={handleLogout} title="退出登录">退出</button>
          </div>
        </div>
        <div className="sidebar-nav">
          <button
            className={`nav-item ${currentPage === 'chat' ? 'active' : ''}`}
            onClick={() => setCurrentPage('chat')}
          >
            <ChatIcon />
            <span>聊天</span>
          </button>
          <button
            className={`nav-item ${currentPage === 'agents' ? 'active' : ''}`}
            onClick={() => setCurrentPage('agents')}
          >
            <ModelIcon />
            <span>Agent 配置</span>
          </button>
          <button
            className={`nav-item ${currentPage === 'providers' ? 'active' : ''}`}
            onClick={() => setCurrentPage('providers')}
          >
            <ProviderIcon />
            <span>Provider 配置</span>
          </button>
          <button
            className={`nav-item ${currentPage === 'tools' ? 'active' : ''}`}
            onClick={() => setCurrentPage('tools')}
          >
            <ToolIcon />
            <span>工具管理</span>
          </button>
          <button
            className={`nav-item ${currentPage === 'skills' ? 'active' : ''}`}
            onClick={() => setCurrentPage('skills')}
          >
            <SkillIcon />
            <span>技能管理</span>
          </button>
          <button
            className={`nav-item ${currentPage === 'scenes' ? 'active' : ''}`}
            onClick={() => setCurrentPage('scenes')}
          >
            <SceneIcon />
            <span>场景切换</span>
          </button>
          <button
            className={`nav-item ${currentPage === 'preview' ? 'active' : ''}`}
            onClick={() => setCurrentPage('preview')}
          >
            <PreviewIcon />
            <span>网页预览</span>
          </button>
          <button
            className={`nav-item ${currentPage === 'plaza' ? 'active' : ''}`}
            onClick={() => setCurrentPage('plaza')}
          >
            <PlazaIcon />
            <span>作品广场</span>
          </button>
        </div>
      </nav>

      {/* 主内容区 */}
      <main className="main-content">
        {currentPage === 'chat' && (
          <div className="chat-layout">
            {/* 全屏 - AI 机器人场景 */}
            <div className="scene-panel" style={{ width: '100%', height: '100%' }}>
              <div id="game-container" className="game-container" />
            </div>

            {/* 隐藏状态下的悬浮按钮 */}
            {chatSize === 'hidden' && (
              <button
                className="chat-restore-fab"
                onClick={() => setChatSize('normal')}
                title="打开聊天"
              >
                <ChatBubbleIcon />
                {messages.length > 0 && (
                  <span className="chat-fab-badge">{messages.length}</span>
                )}
              </button>
            )}

            {/* 聊天窗口 */}
            {chatSize !== 'hidden' && (
            <div className={`chat-float-panel ${chatSize}`}>
              <div className="chat-header">
                <div className="chat-header-left">
                  <h3>💬 聊天记录</h3>
                  <span className="message-count">{messages.length} 条消息</span>
                </div>
                <div className="chat-window-controls">
                  {/* 最小化（隐藏） */}
                  <button
                    className="window-ctrl-btn"
                    onClick={() => setChatSize('hidden')}
                    title="隐藏聊天"
                  >
                    <MinimizeIcon />
                  </button>
                  {/* 最大化 / 还原 */}
                  <button
                    className="window-ctrl-btn"
                    onClick={() => setChatSize(chatSize === 'expanded' ? 'normal' : 'expanded')}
                    title={chatSize === 'expanded' ? '还原小窗' : '最大化'}
                  >
                    {chatSize === 'expanded' ? <RestoreIcon /> : <MaximizeIcon />}
                  </button>
                </div>
              </div>

              <div className="messages-list">
                {messages.length === 0 ? (
                  <div className="empty-chat">
                    <div className="empty-icon">🤖</div>
                    <p>开始与 AI 助手们对话吧！</p>
                    <span className="empty-hint">输入消息，多个 AI Agent 会为你解答问题</span>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`message ${msg.role} ${msg.isError ? 'error' : ''}`}
                    >
                      <div className="message-avatar">
                        {msg.role === 'user' ? '👤' : msg.isError ? '❌' : '🤖'}
                      </div>
                      <div className="message-content">
                        <div className="message-header">
                          <span className="message-author">
                            {msg.role === 'user'
                              ? '你'
                              : msg.isError
                                ? '错误'
                                : msg.agentName || 'AI 助手'}
                          </span>
                          {msg.agentRole && (
                            <span className="message-role">{msg.agentRole}</span>
                          )}
                          <span className="message-time">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="message-text">
                          {msg.isStreaming ? (
                            <span>
                              {msg.content}
                              <span className="streaming-cursor">▋</span>
                            </span>
                          ) : (
                            msg.content
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="chat-input-area">
                <ChatInput
                  onSend={handlePlayerMessage}
                  disabled={isProcessing}
                  placeholder={isProcessing ? 'AI 思考中...' : '输入消息...'}
                />
                <div className="input-hint">
                  {isProcessing ? (
                    <span className="thinking">AI 正在思考...</span>
                  ) : (
                    <span>按 Enter 发送消息</span>
                  )}
                </div>
              </div>
            </div>
            )}
          </div>
        )}

        {currentPage === 'agents' && <AgentConfigPage />}
        {currentPage === 'providers' && <ProviderConfigPage />}
        {currentPage === 'tools' && <ToolConfigPage />}
        {currentPage === 'skills' && <SkillConfigPage />}
        {currentPage === 'scenes' && gameConfig && (
          <SceneSelectPage
            config={gameConfig}
            onSceneChange={(newConfig) => {
              setGameConfig(newConfig)
              // 切回聊天页自动重建场景
              setCurrentPage('chat')
            }}
          />
        )}
        {currentPage === 'preview' && <HtmlPreviewPage />}
        {currentPage === 'plaza' && <PlazaPage />}
      </main>
    </div>
  )
}

export default App