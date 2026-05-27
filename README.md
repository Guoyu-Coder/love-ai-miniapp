# ♥ 小爱 AI 情侣伴侣小程序

基于 DeepSeek Function Calling 的 AI 情侣陪伴小程序，拥有"人格"的 AI 伴侣，支持 Agent 自主调用工具、流式聊天、主动服务提醒。

## 功能特点

- **AI 聊天伴侣**：具有温暖人格设定的 AI 伴侣"小爱"，支持多对话管理
- **Agent 自主推理**：基于 DeepSeek Function Calling 实现 ReAct 模式，AI 可自主调用 10 个情感管理工具
- **情感记录**：约会记录、愿望清单、心动瞬间、约定管理
- **成就系统**：9 种情感成就激励
- **双向绑定**：情侣邀请码绑定，解绑 24h 反悔期
- **AI 调解**：吵架时双方确认后 AI 介入调解
- **内容安全**：输入输出双向安全熔断过滤
- **主动提醒**：约会间隔提醒、愿望积压提醒、纪念日提醒

## 技术栈

| 层级 | 技术 |
|------|------|
| 小程序端 | 微信小程序原生 + 云开发 |
| AI 模型 | DeepSeek API（Function Calling） |
| 云函数 | Node.js 16 + wx-server-sdk |
| 云数据库 | 微信云数据库（MongoDB） |
| 本地服务器 | Node.js + Express + WebSocket |
| 部署 | Docker + Docker Compose |

## 项目结构

```
love-ai-miniapp/
├── miniprogram/              # 小程序前端
│   ├── app.js                # 入口，云开发初始化
│   ├── app.json              # 页面配置 + TabBar
│   ├── pages/
│   │   ├── index/            # 首页
│   │   ├── chat/             # AI 聊天页（核心）
│   │   ├── dates/            # 记忆馆（约会记录）
│   │   ├── wishes/           # 愿望清单
│   │   ├── moments/          # 心动瞬间
│   │   ├── promises/         # 约定
│   │   ├── reports/          # 学习报告
│   │   ├── achievements/     # 成就系统
│   │   ├── profile/          # 情侣档案
│   │   └── settings/         # 设置
│   ├── components/           # 公共组件
│   ├── utils/
│   │   ├── api.js            # API 封装（云函数优先 → 降级本地）
│   │   ├── agent.js          # Agent 对话管理器
│   │   └── audio.js          # 背景音乐管理
│   └── images/               # 图标资源
├── cloudfunctions/           # 云函数
│   ├── agentCore/            # 核心 Agent（聊天+工具调用）
│   ├── dailyGreeting/        # 每日问候
│   └── weeklyReport/         # 周报生成
├── server/                   # 本地开发服务器
│   ├── server.js             # Express + WebSocket 服务
│   ├── generate-music.js     # BGM 生成脚本
│   └── music/                # 背景音乐文件
├── docker-compose.yml
├── Dockerfile
└── .dockerignore
```

## 快速启动

### 方式一：云函数模式（线上/演示推荐）

1. **微信开发者工具**打开 `miniprogram/` 目录
2. **云开发控制台** → 数据库 → 创建以下 13 个集合：
   - `achievements` `bindings` `chat_history` `couples` `date_records`
   - `invite_codes` `mediation_sessions` `memory_facts` `moments`
   - `notification_state` `promises` `reports` `wishes`
3. 上传部署云函数（`agentCore`、`dailyGreeting`、`weeklyReport`）
4. 在云函数环境变量中配置 `DEEPSEEK_KEY`
5. `miniprogram/utils/api.js` 中确保 `USE_CLOUD = true`
6. 编译运行

### 方式二：Docker 本地服务器（开发调试推荐）

```bash
# 1. 配置 API Key
# 编辑 server/.env，填入：
DEEPSEEK_KEY=sk-your-key

# 2. 启动
docker-compose up -d

# 3. 设置前端使用本地服务器
# miniprogram/utils/api.js: USE_CLOUD = false

# 4. 微信开发者工具打开 miniprogram/ 目录，编译运行
```

### 方式三：直接运行本地服务器

```bash
cd server
npm install
set DEEPSEEK_KEY=sk-your-key   # Windows
node server.js
```

服务启动在 `http://localhost:3001`

## API 设计

### HTTP API

```
POST /api/agent     # 统一 Agent 接口
GET  /api/health    # 健康检查
POST /api/upload    # 图片上传
```

### WebSocket（本地服务器模式）

```
ws://localhost:3001/ws    # 流式聊天
```

### Agent 可调用工具（10 个）

| 工具 | 功能 |
|------|------|
| `add_date_record` | 记录约会 |
| `add_wish` | 添加愿望 |
| `add_moment` | 记录心动瞬间 |
| `add_promise` | 添加约定 |
| `search_date_records` | 搜索约会记录 |
| `get_wish_list` | 获取愿望清单 |
| `get_moments` | 获取心动瞬间 |
| `get_promises` | 获取约定列表 |
| `generate_blessing` | 生成祝福语 |
| `plan_date` | 策划约会方案 |

## 安全设计

- **内容安全**：输入输出双向正则熔断（暴力、色情、政治敏感、分手诱导）
- **API Key 保护**：`.env` 和 `config.json` 已加入 `.gitignore`，不会提交到仓库
- **解绑反悔期**：解绑请求 24h 反悔期，支持保留个人副本或彻底清空
- **AI 调解确认**：调解功能需双方 sessionId 确认
- **通知冷却**：每日问候限 1 条，避免骚扰

## License

MIT
