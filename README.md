# 🤖 RPG Multi-Agent System

> ⚠️ **早期开发阶段** | 🚧 **持续开发中** | 📝 **API 可能变动**

一个基于 **RPG 像素风格** 的多 Agent 协作对话系统，支持 Manager-Worker 架构与作品发布平台

![Status](https://img.shields.io/badge/status-alpha-orange)
![Python](https://img.shields.io/badge/python-3.10+-blue)
![FastAPI](https://img.shields.io/badge/FastAPI-0.136+-green)
![React](https://img.shields.io/badge/React-18+-61dafb)

![img_2.png](img_2.png)
![img_3.png](img_3.png)
---

## ✨ 核心特性

### 🎮 RPG 像素风界面
- **2D 游戏场景**：基于 Phaser.js 的星露谷物语风格，支持多场景切换（图书馆 / 办公室）
- **Agent 形象**：Manager 与 Worker 均使用帧动画精灵图
  - 四方向行走/待机动画（如 girl、manager）
  - 单方向帧动画自动水平翻转兼容（如 mafia1）
- **按场景角色缩放**：不同场景可独立配置 `characterScales`，角色自动适配 tile 比例
- **动画状态**：待机 / 行走 / 思考 / 说话
- **对话气泡**：游戏风格的对话展示
- **点击移动**：选中角色后点击地图空地可移动，自动避障
- **历史会话**：支持保存、切换、删除历史对话，每次切换自动恢复当时的 Agent / Manager / 场景配置

### 🧠 多 Agent 架构
- **Manager-Worker 模式**：智能任务分派与结果整合
- **MsgHub 模式**：传统多 Agent 广播对话
- **独立模型配置**：每个 Agent 可配置不同的 LLM Provider

### 🏪 作品发布平台（新增）
- **发布功能**：将 Agent 产出的 HTML 作品一键发布到平台广场
- **作品广场**：所有用户可浏览、预览、使用已发布的作品
- **沙箱渲染**：作品在 iframe 沙箱中安全运行
- **搜索与排序**：支持关键词搜索、按最新/最热排序
- **标签分类**：支持自定义标签，便于作品分类发现

### 🔧 支持的模型提供商
| 提供商 | 状态 | 备注 |
|--------|------|------|
| DashScope (阿里云) | ✅ 已支持 | qwen 系列 |
| OpenAI | ✅ 已支持 | GPT 系列 |
| Anthropic | ✅ 已支持 | Claude 系列 |
| Kimi (Moonshot) | ✅ 已支持 | kimi 系列 |
| 自定义 Provider | ✅ 已支持 | 任意兼容 OpenAI API 的服务 |

### 🛠️ 技能系统
- **内置技能**：文件操作、浏览器自动化
- **技能管理**：通过 Skill 面板启用/禁用技能
- **可扩展**：支持自定义技能注册，自动加载 `skills/examples/` 目录下的技能文件
- **技能绑定**：每个 Agent 可独立配置启用的技能列表

### 🧰 工具系统
- 内置工具：文件操作、浏览器自动化、Shell 命令
- 可扩展：支持自定义工具注册

---

## 🏗️ 项目架构

```
┌─────────────────────────────────────────────────────────┐
│                    前端 (React + Phaser)                 │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Phaser 游戏场景                                  │   │
│  │  - ChatScene.ts (像素风办公室)                   │   │
│  │  - Agent 角色 (Manager/Worker)                   │   │
│  │  - 动画系统 (idle/thinking/speaking)             │   │
│  └─────────────────────────────────────────────────┘   │
│                         ↑↓                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │  React UI 组件                                   │   │
│  │  - 侧边栏导航                                    │   │
│  │  - 浮动聊天窗口                                  │   │
│  │  - Agent / Provider / Skill 配置面板              │   │
│  │  - 网页预览 & 发布                               │   │
│  │  - 作品广场                                      │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                            ↑↓ HTTP
┌─────────────────────────────────────────────────────────┐
│                   后端 (FastAPI)                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │  Chat API   │  │ Agent API   │  │  Provider API   │ │
│  │  /api/chat  │  │ /api/agents │  │ /api/providers  │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │ManagerAgent │  │ WorkerAgent │  │   ChatAgent     │ │
│  │  (任务协调)  │  │  (任务执行)  │  │  (普通对话)      │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
│  ┌─────────────────────────────────────────────────────┐│
│  │          平台子应用 (/platform)                      ││
│  │  - 作品发布 API                                     ││
│  │  - 广场列表 API                                     ││
│  │  - 作品渲染服务                                     ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                            ↑↓
┌─────────────────────────────────────────────────────────┐
│              基础设施层                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │
│  │   Qdrant    │  │   SQLite    │  │    工具系统      │ │
│  │  向量数据库  │  │  平台数据库  │  │  (内置+扩展)     │ │
│  └─────────────┘  └─────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### 环境要求
- Python 3.10+
- Node.js 18+
- Qdrant (向量数据库，可选 Docker)

### 1. 安装依赖

```bash
# 后端依赖
pip install -r requirements.txt

# 前端依赖
cd rpg-frontend
npm install
cd ..
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，配置 API 密钥
```

### 3. 启动服务

**开发模式**（推荐）：
```bash
# 终端 1: 启动后端（开发模式，带热重载）
python main.py --dev

# 终端 2: 启动前端（独立开发服务器）
cd rpg-frontend
npm run dev
```

**生产模式**：
```bash
# 单命令启动（自动构建前端）
python main.py
```

### 4. 访问应用

- 前端界面：http://localhost:5173 （开发模式）或 http://localhost:8000 （生产模式）
- API 文档：http://localhost:8000/docs

---

## 📁 项目结构

```
.
├── agents/                 # Agent 实现
│   ├── manager_agent.py   # Manager 智能体（任务协调）
│   ├── chat_agent.py      # 基础对话智能体
│   └── __init__.py
├── api/                   # FastAPI 接口
│   ├── api_server.py      # 主服务入口
│   ├── agents_api.py      # Agent 配置接口
│   ├── providers_api.py   # Provider 配置接口
│   ├── html_preview_api.py # HTML 预览接口
│   ├── conversations_api.py # 历史会话接口
│   ├── game_config_api.py # 游戏场景配置接口
│   ├── manager_api.py     # Manager 配置接口
│   ├── skills_api.py      # 技能管理接口
│   ├── tools_api.py       # 工具管理接口
│   └── session_manager.py # 会话管理器
├── auth/                  # 用户认证
│   ├── dependencies.py    # Token 校验
│   ├── user_data.py       # 用户目录与数据服务
│   └── user_managers.py   # 用户级管理器工厂
├── config/                # 配置管理
│   ├── agents_config.py       # Agent 配置
│   ├── manager_config.py      # Manager 配置
│   ├── conversations_manager.py # 历史会话管理器
│   └── ...
├── providers/             # LLM 提供商管理
│   ├── provider_manager.py
│   ├── dashscope_provider.py
│   ├── anthropic_provider.py
│   └── ...
├── plaza_platform/        # 作品发布平台（新增）
│   ├── server.py          # 平台 FastAPI 子应用
│   ├── models.py          # 数据模型 (Work)
│   ├── database.py        # SQLite + SQLAlchemy
│   ├── storage.py         # 文件存储抽象层
│   ├── works/             # 已发布作品文件存储
│   └── platform.db        # 平台数据库
├── tools/                 # 工具系统
│   ├── builtin/           # 内置工具
│   └── extensions/        # 扩展工具
├── skills/                # 技能系统
│   ├── skill_registry.py  # 技能注册器
│   └── examples/          # 技能定义 (Markdown)
├── rag_knowledge_base/    # RAG 知识库
├── rpg-frontend/          # 前端项目
│   ├── src/
│   │   ├── game/          # Phaser 游戏场景
│   │   │   └── ChatScene.ts
│   │   ├── components/    # React 组件
│   │   ├── pages/         # 页面组件
│   │   │   ├── AgentConfigPage.tsx
│   │   │   ├── ProviderConfigPage.tsx
│   │   │   ├── SceneSelectPage.tsx  # 场景切换
│   │   │   ├── HtmlPreviewPage.tsx
│   │   │   ├── PlazaPage.tsx        # 作品广场
│   │   │   └── ...
│   │   └── api/           # API 客户端
│   ├── public/
│   │   └── assets/
│   │       ├── characters/  # 角色帧动画精灵图
│   │       ├── maps/        # Tiled 地图资源
│   │       └── game-config.json # 公共场景/角色/动画配置
│   └── package.json
├── data/                  # 用户数据存储
│   └── users/
│       └── {user_id}/
│           ├── agents_config.json   # 用户 Agent 配置
│           ├── manager_config.json  # 用户 Manager 配置
│           ├── game_config.json     # 用户场景配置（currentScene、description）
│           ├── conversations/       # 历史会话快照
│           └── ...
├── output/                # Agent 产出文件
│   ├── doc/               # 文档类产出
│   └── preview/           # HTML 预览文件
├── main.py               # 主入口
└── requirements.txt      # Python 依赖
```

---

## ⚙️ 配置说明

### 创建 Agent

1. 进入 **"Provider 配置"** 页面，添加 LLM 提供商（如 DashScope、OpenAI）
2. 进入 **"Agent 配置"** 页面，创建 Worker Agent
3. 可选：在 **"Manager 配置"** 中启用 Manager 模式

### Manager-Worker 模式

启用后：
- Manager 分析用户请求，拆解为子任务
- 分派给合适的 Worker 执行
- 收集结果并整合回复

不启用时：
- 使用传统 MsgHub 模式
- 所有 Agent 同时收到消息并独立回复

### 作品发布平台

1. Agent 在对话中产出 HTML 文件，自动保存到 `output/preview/` 目录
2. 进入 **"网页预览"** 页面，选中文件后点击 **"发布到广场"**
3. 填写作品标题、简介、标签等信息后发布
4. 所有用户均可在 **"作品广场"** 浏览和使用已发布的作品

---

## 🔌 API 端点

### Agent 系统 API

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/chat` | POST | 发送消息，获取 Agent 响应 |
| `/api/chat/stream` | POST | 流式响应（SSE） |
| `/api/agents` | GET | 获取所有 Agent 列表 |
| `/api/agents-config` | GET/POST | Agent 配置 CRUD |
| `/api/providers` | GET/POST | Provider 配置 CRUD |
| `/api/tools` | GET/PUT | 工具管理 |
| `/api/skills` | GET/PUT | 技能管理 |
| `/api/manager` | GET/PUT | Manager 配置 |
| `/api/game-config` | GET/PUT | 游戏场景配置 |
| `/api/html-preview` | GET/POST/DELETE | HTML 预览文件管理 |
| `/api/conversations` | GET | 列出历史会话列表 |
| `/api/conversations/{id}` | GET | 获取历史会话详情 |
| `/api/conversations` | POST | 保存当前会话为历史会话 |
| `/api/conversations/{id}` | PUT | 更新已有历史会话 |
| `/api/conversations/{id}` | DELETE | 删除历史会话 |
| `/api/conversations/{id}/restore` | POST | 恢复历史会话（视图快照） |
| `/api/system/reinitialize` | POST | 重新初始化系统 |
| `/api/health` | GET | 健康检查 |

### 平台广场 API

| 端点 | 方法 | 描述 |
|------|------|------|
| `/platform/api/publish` | POST | 发布作品到广场 |
| `/platform/api/works` | GET | 获取广场作品列表（分页、排序、搜索） |
| `/platform/api/works/{id}` | GET | 获取作品详情 |
| `/platform/api/works/{id}/render` | GET | 渲染作品 HTML（iframe 加载） |
| `/platform/api/works/{id}` | DELETE | 删除作品 |
| `/platform/api/health` | GET | 平台健康检查 |

#### 发布作品示例

```bash
# 从本地预览文件发布
curl -X POST http://localhost:8000/platform/api/publish \
  -H "Content-Type: application/json" \
  -d '{
    "title": "我的作品",
    "description": "一个很酷的交互页面",
    "author": "用户名",
    "tags": "游戏,交互",
    "source_file": "index.html"
  }'

# 直接传 HTML 内容发布
curl -X POST http://localhost:8000/platform/api/publish \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Hello World",
    "content": "<!DOCTYPE html><html><body><h1>Hello!</h1></body></html>"
  }'
```

---

## 🐳 Docker 部署

```bash
# 启动 Qdrant 向量数据库
docker-compose up -d qdrant

# 或完整部署
docker-compose up -d
```

详细 Docker 配置参考 [DOCKER_SETUP.md](DOCKER_SETUP.md)

---

## 🗺️ 开发路线

- [x] RPG 像素风 2D 游戏场景
- [x] 多场景切换（图书馆 / 办公室）
- [x] 四方向 + 单方向帧动画兼容
- [x] Manager-Worker 多 Agent 协作
- [x] 多 LLM Provider 支持
- [x] 流式响应输出
- [x] 技能系统
- [x] 工具系统
- [x] HTML 预览与作品发布平台
- [x] 用户认证系统
- [x] 历史会话保存与恢复
- [ ] 作品点赞与评论
- [ ] 对象存储 & CDN 加速
- [ ] 更多游戏场景

---

## 📄 许可证

MIT License

---

## 🙏 致谢

- [AgentScope](https://github.com/modelscope/agentscope) - 多 Agent 框架
- [Phaser](https://phaser.io/) - 2D 游戏引擎
- [FastAPI](https://fastapi.tiangolo.com/) - 现代 Python Web 框架
- [React](https://react.dev/) - UI 框架
- [SQLAlchemy](https://www.sqlalchemy.org/) - Python ORM

---

> 🎮 **提示**：这是一个实验性项目，旨在探索多 Agent 协作的可视化交互方式。欢迎在 [Issues](../../issues) 中分享你的想法和建议！
