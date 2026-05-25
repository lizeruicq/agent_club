import axios from 'axios'
import type {
  ChatResponse,
  ChatMessage,
  AgentInfo,
  AgentResponse,
  AgentConfig,
  CreateAgentRequest,
  UpdateAgentRequest,
  TestConnectionResponse,
  ProviderType,
  Provider,
  CreateProviderRequest,
  UpdateProviderRequest,
  ToolConfig,
  ToolUpdateResponse,
  ManagerConfig,
  Skill,
  HtmlFileInfo,
  ConversationMeta,
} from '../types'
import type { GameConfig } from '../game/config'

// 自动检测环境：开发模式使用代理，生产模式使用相对路径
const isDev = import.meta.env.DEV
const baseURL = isDev ? '/api' : '/api'

const client = axios.create({
  baseURL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// ============ Token 管理 ============

const TOKEN_KEY = 'agent_club_token'
const USER_KEY = 'agent_club_user'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getSavedUser(): { id: string; username: string; nickname: string } | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function setSavedUser(user: { id: string; username: string; nickname: string }) {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

// axios 拦截器: 自动带 token
client.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// axios 拦截器: 401 时清除 token
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearToken()
      window.dispatchEvent(new Event('auth:logout'))
    }
    return Promise.reject(error)
  }
)

export const api = {
  // ========== 认证 API ==========

  async register(username: string, password: string, nickname?: string): Promise<{
    success: boolean; message: string; token?: string; user?: { id: string; username: string; nickname: string }
  }> {
    const response = await client.post('/auth/register', { username, password, nickname })
    if (response.data.token) {
      setToken(response.data.token)
      setSavedUser(response.data.user)
    }
    return response.data
  },

  async login(username: string, password: string): Promise<{
    success: boolean; message: string; token?: string; user?: { id: string; username: string; nickname: string }
  }> {
    const response = await client.post('/auth/login', { username, password })
    if (response.data.token) {
      setToken(response.data.token)
      setSavedUser(response.data.user)
    }
    return response.data
  },

  logout() {
    clearToken()
    window.dispatchEvent(new Event('auth:logout'))
  },

  async getMe(): Promise<{ success: boolean; user: { id: string; username: string; nickname: string } }> {
    const response = await client.get('/auth/me')
    return response.data
  },

  // ========== 聊天 API ==========

  // 聊天 - 返回多 Agent 响应
  async chat(message: string): Promise<AgentResponse[]> {
    const response = await client.post<ChatResponse>('/chat', { message })
    return response.data.responses
  },

  // 获取 Agent 列表（用于聊天）
  async getAgents(): Promise<AgentInfo[]> {
    const response = await client.get<{ agents: AgentInfo[] }>('/agents')
    return response.data.agents
  },

  // ========== 历史会话 API ==========

  async listConversations(): Promise<{ conversations: ConversationMeta[]; max: number }> {
    const response = await client.get<{ conversations: ConversationMeta[]; max: number }>('/conversations')
    return response.data
  },

  /**
   * 保存当前消息+配置为新会话。
   * 当达到 max 上限时后端返回 409，返回值中 requiresConfirmation=true 让调用方弹确认框，
   * 然后用 confirmDeleteOldest=true 重试，会删除最旧会话再创建。
   */
  async saveCurrentConversation(
    messages: ChatMessage[],
    confirmDeleteOldest: boolean = false
  ): Promise<{
    conversation?: ConversationMeta
    requiresConfirmation?: boolean
    oldest?: ConversationMeta
    max?: number
  }> {
    try {
      const response = await client.post<{ conversation: ConversationMeta }>(
        '/conversations',
        { messages, confirm_delete_oldest: confirmDeleteOldest }
      )
      return { conversation: response.data.conversation }
    } catch (err: any) {
      if (err.response?.status === 409 && err.response.data?.detail?.requires_confirmation) {
        const d = err.response.data.detail
        return { requiresConfirmation: true, oldest: d.oldest, max: d.max }
      }
      throw err
    }
  },

  /**
   * 更新已有历史会话的消息与快照（title 不变）。
   * 当前会话是从某条历史恢复来的，再次切换/新建时调用此接口而不是 saveCurrentConversation。
   */
  async updateConversation(
    convId: string,
    messages: ChatMessage[]
  ): Promise<{ conversation: ConversationMeta }> {
    const response = await client.put<{ conversation: ConversationMeta }>(
      `/conversations/${convId}`,
      { messages }
    )
    return response.data
  },

  async deleteConversation(convId: string): Promise<void> {
    await client.delete(`/conversations/${convId}`)
  },

  async restoreConversation(convId: string): Promise<{
    id: string
    title: string
    messages: ChatMessage[]
    game_config: any
  }> {
    const response = await client.post(`/conversations/${convId}/restore`)
    return response.data
  },

  // ========== Agent 配置 API（每个 Agent 独立配置） ==========

  // 获取所有 Agent 配置
  async getAgentConfigs(includeInactive: boolean = false): Promise<AgentConfig[]> {
    const response = await client.get<{ agents: AgentConfig[] }>('/agents-config', {
      params: { include_inactive: includeInactive }
    })
    return response.data.agents
  },

  // 获取单个 Agent 配置
  async getAgentConfig(agentId: string): Promise<AgentConfig> {
    const response = await client.get<AgentConfig>(`/agents-config/${agentId}`)
    return response.data
  },

  // 创建新 Agent
  async createAgentConfig(data: CreateAgentRequest): Promise<AgentConfig> {
    const response = await client.post<AgentConfig>('/agents-config', data)
    return response.data
  },

  // 更新 Agent 配置
  async updateAgentConfig(agentId: string, data: UpdateAgentRequest): Promise<AgentConfig> {
    const response = await client.put<AgentConfig>(`/agents-config/${agentId}`, data)
    return response.data
  },

  // 删除 Agent
  async deleteAgentConfig(agentId: string): Promise<{ success: boolean }> {
    const response = await client.delete<{ success: boolean }>(`/agents-config/${agentId}`)
    return response.data
  },

  // 测试 Agent 模型连接
  async testAgentConnection(agentId: string): Promise<TestConnectionResponse> {
    const response = await client.post<TestConnectionResponse>(`/agents-config/${agentId}/test`)
    return response.data
  },

  // 临时测试连接（不保存）
  async testConnectionTemp(data: {
    provider_type: ProviderType
    api_key: string
    model_id: string
    base_url?: string
  }): Promise<TestConnectionResponse> {
    const response = await client.post<TestConnectionResponse>('/agents-config/test-connection', {
      ...data,
      name: 'Test',
      role: 'Test',
      personality: 'Test',
      avatar_type: 'aiden',
      model_name: data.model_id,
    })
    return response.data
  },

  // 获取提供商类型列表
  async getProviderTypes(): Promise<{ types: ProviderTypeInfo[] }> {
    const response = await client.get('/agents-config/provider-types')
    return response.data
  },

  // 获取推荐模型列表
  async getProviderModels(): Promise<{ models: Record<string, ProviderModel[]> }> {
    const response = await client.get('/agents-config/provider-models')
    return response.data
  },

  // ========== Provider API ==========

  // 获取所有 Provider
  async getProviders(): Promise<Provider[]> {
    const response = await client.get<{ providers: Provider[] }>('/providers')
    return response.data.providers
  },

  // 创建新 Provider
  async createProvider(data: CreateProviderRequest): Promise<Provider> {
    const response = await client.post<Provider>('/providers', data)
    return response.data
  },

  // 更新 Provider
  async updateProvider(providerId: string, data: UpdateProviderRequest): Promise<Provider> {
    const response = await client.put<Provider>(`/providers/${providerId}`, data)
    return response.data
  },

  // 删除 Provider
  async deleteProvider(providerId: string): Promise<{ success: boolean }> {
    const response = await client.delete<{ success: boolean }>(`/providers/${providerId}`)
    return response.data
  },

  // 测试 Provider 连接
  async testProvider(providerId: string): Promise<TestConnectionResponse> {
    const response = await client.post<TestConnectionResponse>(`/providers/${providerId}/test`)
    return response.data
  },

  // ========== 系统 API ==========

  // 重新初始化系统（在 Agent 变更后调用）
  async reinitializeSystem(): Promise<{ success: boolean; message: string; agent_count: number }> {
    const response = await client.post('/system/reinitialize')
    return response.data
  },

  // ========== 工具管理 API ==========

  // 获取所有工具列表
  async getTools(): Promise<ToolConfig[]> {
    const response = await client.get<{ tools: ToolConfig[] }>('/tools')
    return response.data.tools
  },

  // 更新单个工具状态
  async updateTool(toolName: string, enabled: boolean): Promise<ToolUpdateResponse> {
    const response = await client.put<ToolUpdateResponse>(`/tools/${toolName}`, { enabled })
    return response.data
  },

  // 批量更新工具状态
  async updateToolsBatch(tools: Record<string, boolean>): Promise<ToolUpdateResponse> {
    const response = await client.put<ToolUpdateResponse>('/tools', { tools })
    return response.data
  },

  // ========== 流式聊天 API ==========

  chatStream(
    message: string,
    onChunk: (chunk: { type: string; content?: string; agent_name?: string; agent_role?: string; index?: number; message?: string }) => void,
    onError?: (error: string) => void
  ): () => void {
    const controller = new AbortController()

    const fetchStream = async () => {
      try {
        const token = getToken()
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        }
        if (token) {
          headers['Authorization'] = `Bearer ${token}`
        }

        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers,
          body: JSON.stringify({ message }),
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim()
              if (data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                onChunk(parsed)
              } catch (e) {
                // ignore parse errors
              }
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          onError?.(err.message || '流式请求失败')
        }
      }
    }

    fetchStream()
    return () => controller.abort()
  },

  // ========== Skill 管理 API ==========

  // 获取所有技能列表
  async getSkills(includeDisabled: boolean = false): Promise<Skill[]> {
    const response = await client.get<{ skills: Skill[]; total: number }>('/skills', {
      params: { include_disabled: includeDisabled },
    })
    return response.data.skills
  },

  // 获取单个技能详情
  async getSkill(skillId: string): Promise<Skill> {
    const response = await client.get<Skill>(`/skills/${skillId}`)
    return response.data
  },

  // 更新技能启用状态
  async updateSkill(skillId: string, enabled: boolean): Promise<{ success: boolean; skill: Skill | null }> {
    const response = await client.put(`/skills/${skillId}`, { is_enabled: enabled })
    return response.data
  },

  // 启用技能
  async enableSkill(skillId: string): Promise<{ success: boolean; skill: Skill | null }> {
    const response = await client.post(`/skills/${skillId}/enable`)
    return response.data
  },

  // 禁用技能
  async disableSkill(skillId: string): Promise<{ success: boolean; skill: Skill | null }> {
    const response = await client.post(`/skills/${skillId}/disable`)
    return response.data
  },

  // ========== Manager Agent API ==========

  // 获取 Manager 配置
  async getManagerConfig(): Promise<ManagerConfig> {
    const response = await client.get<ManagerConfig>('/manager')
    return response.data
  },

  // 更新 Manager 配置
  async updateManagerConfig(data: {
    name?: string
    role?: string
    personality?: string
    avatar_type?: string
    provider_id?: string
    is_active?: boolean
  }): Promise<ManagerConfig> {
    const response = await client.put<ManagerConfig>('/manager', data)
    return response.data
  },

  // 测试 Manager 连接
  async testManagerConnection(): Promise<TestConnectionResponse> {
    const response = await client.post<TestConnectionResponse>('/manager/test')
    return response.data
  },

  // ========== 游戏配置 API ==========

  // 获取游戏配置
  async getGameConfig(): Promise<GameConfig> {
    const response = await client.get<GameConfig>('/game-config')
    return response.data
  },

  // 更新游戏配置（全量）
  async updateGameConfig(config: GameConfig): Promise<GameConfig> {
    const response = await client.put<GameConfig>('/game-config', config)
    return response.data
  },

  // 更新当前场景
  async updateCurrentScene(currentScene: string): Promise<GameConfig> {
    const response = await client.put<GameConfig>('/game-config/current-scene', { currentScene })
    return response.data
  },

  // ========== HTML Preview API ==========

  // 获取所有 HTML 预览文件
  async getHtmlPreviews(): Promise<HtmlFileInfo[]> {
    const response = await client.get<{ files: HtmlFileInfo[] }>('/html-preview')
    return response.data.files
  },

  // 保存 HTML 文件
  async saveHtmlPreview(data: { filename: string; content: string }): Promise<{ success: boolean; filename: string; message: string }> {
    const response = await client.post('/html-preview', data)
    return response.data
  },

  // 获取 HTML 文件内容
  async getHtmlPreviewContent(filename: string): Promise<{ success: boolean; filename: string; content: string }> {
    const response = await client.get(`/html-preview/${encodeURIComponent(filename)}/content`)
    return response.data
  },

  // 删除 HTML 文件
  async deleteHtmlPreview(filename: string): Promise<{ success: boolean; message: string }> {
    const response = await client.delete(`/html-preview/${encodeURIComponent(filename)}`)
    return response.data
  },

  // ========== 平台广场 API ==========

  // 发布作品到平台
  async publishWork(data: {
    title: string
    description?: string
    author?: string
    tags?: string
    source_file?: string
    content?: string
  }): Promise<{ success: boolean; work_id: string; title: string; message: string }> {
    const response = await axios.post('/platform/api/publish', data)
    return response.data
  },

  // 获取广场作品列表
  async getPlazaWorks(params?: {
    page?: number
    page_size?: number
    sort?: 'latest' | 'popular'
    tag?: string
    search?: string
  }): Promise<{ works: PlazaWork[]; total: number; page: number; page_size: number }> {
    const response = await axios.get('/platform/api/works', { params })
    return response.data
  },

  // 获取单个作品详情
  async getPlazaWork(workId: string): Promise<PlazaWork> {
    const response = await axios.get(`/platform/api/works/${workId}`)
    return response.data
  },

  // 删除广场作品
  async deletePlazaWork(workId: string): Promise<{ success: boolean; message: string }> {
    const response = await axios.delete(`/platform/api/works/${workId}`)
    return response.data
  },
}

// 广场作品类型
export interface PlazaWork {
  id: string
  title: string
  description: string
  author: string
  tags: string
  file_size: number
  view_count: number
  status: string
  created_at: string
  updated_at: string
}

// Provider 类型信息
export interface ProviderTypeInfo {
  id: ProviderType
  name: string
  description: string
  required_fields: string[]
  optional_fields?: string[]
  default_base_url?: string
}

// 提供商模型
export interface ProviderModel {
  id: string
  name: string
  description: string
}
