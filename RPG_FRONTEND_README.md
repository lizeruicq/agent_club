# RPG Frontend

`rpg-frontend` 是当前项目的 React + Phaser 前端。它负责 RPG 场景渲染、聊天窗口、配置页面、HTML 预览和作品广场。

## 启动

```bash
cd rpg-frontend
npm install
npm run dev
```

开发模式访问：

```text
http://localhost:5173
```

构建：

```bash
npm run build
```

## 当前页面

主入口是 `src/App.tsx`，当前页面包括：

- `chat`：RPG 场景和浮动聊天窗口。
- `agents`：Agent 配置。
- `providers`：Provider 配置。
- `tools`：工具开关。
- `skills`：技能配置。
- `scenes`：场景配置。
- `preview`：当前会话产物和 HTML 预览。
- `plaza`：作品广场。

## 聊天流式展示

前端通过 `src/api/index.ts` 中的 `api.chatStream()` 请求：

```text
POST /api/chat/stream
```

请求会携带：

```json
{
  "message": "...",
  "conversation_id": "conv_xxx"
}
```

`src/App.tsx` 会按 SSE 事件更新 `messages`：

- `start` / `agent_start`：创建一条空消息。
- `chunk`：向已有消息追加文本。
- `done` / `agent_done`：结束该消息的流式状态。
- `all_done`：恢复空闲状态。
- `error`：显示错误消息。

因此，普通文本要显示在聊天框中，通常需要先收到 `start` 或 `agent_start`，再收到同一 `agent_name` 的 `chunk`。

Manager-Worker 模式下，目前聊天框会显示：

- 用户消息。
- Manager 规划原文，前缀为 `【Manager规划原文】`。
- Worker 的执行结果。
- Manager 复盘和追加任务提示。
- Manager 最终整合回复。

## 会话与产物

前端会在新会话开始时生成 `conversation_id`，并在聊天、预览、发布等接口中传给后端。

当前会话产物通过 `HtmlPreviewPage.tsx` 展示，接口主要使用：

- `/api/artifacts`
- `/api/artifacts/{storage}/{filepath}/content`
- `/api/artifacts/{storage}/{filepath}`
- `/preview/{filepath}`

这些接口都依赖当前 `conversation_id`，因此不同会话看到的产物列表不同。

## 作品广场

`PlazaPage.tsx` 展示 `/platform/api/works` 返回的作品。发布入口在 `HtmlPreviewPage.tsx`。

广场 API 客户端使用单独的 `platformClient`，会自动携带登录 token。因此后端可以返回正确的 `is_mine` 字段，前端只对自己的作品显示删除按钮。

发布当前会话中的 HTML 文件时，请求会带上：

```json
{
  "source_file": "index.html",
  "conversation_id": "conv_xxx"
}
```

## 游戏资源

公共资源位于：

```text
rpg-frontend/public/assets/
├── characters/
│   ├── boy_idle.png
│   ├── boy_walk.png
│   ├── girl_idle.png
│   ├── girl_walk.png
│   ├── mafia1_idle.png
│   ├── mafia1_walk.png
│   ├── mafia2_idle.png
│   ├── mafia2_walk.png
│   ├── mafia3_idle.png
│   └── mafia3_walk.png
├── maps/
│   ├── library.tmj
│   ├── office.tmj
│   └── ...
└── game-config.json
```

`src/game/ChatScene.ts` 会读取 `game-config.json` 中的角色、动画和场景配置。旧的 `manager` / `worker1` 角色引用在前端中有兼容映射，分别指向当前的 `boy` / `girl`。

## 目录结构

```text
rpg-frontend/
├── src/
│   ├── App.tsx                 # 主 UI、导航、聊天流式事件处理
│   ├── api/index.ts            # API 客户端
│   ├── game/
│   │   ├── ChatScene.ts        # Phaser 场景
│   │   └── config.ts           # 游戏配置读取
│   ├── pages/
│   │   ├── AgentConfigPage.tsx
│   │   ├── ProviderConfigPage.tsx
│   │   ├── ToolConfigPage.tsx
│   │   ├── SkillConfigPage.tsx
│   │   ├── SceneSelectPage.tsx
│   │   ├── HtmlPreviewPage.tsx
│   │   ├── PlazaPage.tsx
│   │   └── LoginPage.tsx
│   ├── components/
│   │   ├── ChatInput.tsx
│   │   ├── ConversationHistory.tsx
│   │   ├── StatusBar.tsx
│   │   └── ...
│   ├── types/index.ts
│   └── index.css
├── public/assets/
├── package.json
├── vite.config.ts
└── index.html
```

## 技术栈

- React 18
- TypeScript
- Vite
- Phaser 3
- Axios / Fetch
