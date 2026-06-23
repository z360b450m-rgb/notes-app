# 从零做一遍这个项目 · 完整流程清单

把这套 **notes-app（Electron 错题本）+ RAG-AIAgent（云原生 RAG 服务）** 从空白机器一步一步搭起来要做什么，全在这。按顺序读。

---

## 〇、项目最终长什么样

- **前端**：Vue 3 + Electron 桌面错题本，内嵌 AI 问答侧栏，支持多知识库
- **后端**：Python FastAPI，跑云原生 RAG（DeepSeek + SiliconFlow + Qdrant Cloud），**本地零模型下载**
- **协作**：错题保存自动同步进 RAG 索引；提问可锁定单题或全库检索

部署形态：**两个服务都跑在本机**，前端 `localhost:5173`（或 5174），后端 `localhost:8000`。后端拨打的所有模型 / 向量库 API 都是云端。

---

## 一、前置软件准备（一次性）

| 软件 | 版本 | 干啥用 | 装法 |
|---|---|---|---|
| **Git** | 任意新版 | 版本控制 | https://git-scm.com/ |
| **Node.js** | ≥ 20 LTS | 前端构建 / Electron | https://nodejs.org/ ，含 npm |
| **Python** | ≥ 3.11 | 后端 RAG 服务 | https://www.python.org/ ；安装时勾上 "Add to PATH" |
| **VS Code** | 任意 | 编辑器 | https://code.visualstudio.com/ |
| **Chrome 或 Edge** | 任意 | 浏览器 + 调试 | 系统自带或下载 |

### 推荐 VS Code 插件

| 插件 | 作用 |
|---|---|
| Volar (Vue Official) | Vue 3 + TypeScript 支持 |
| Tailwind CSS IntelliSense | Tailwind 工具类补全 |
| ESLint | 代码规范 |
| Prettier | 自动格式化 |
| Python | 后端调试 |
| Pylance | Python 类型检查 |
| Even Better TOML | `.env` 高亮 |

### 命令行环境

Windows 用户推荐 **Git Bash**（Git 自带）或 **PowerShell 7+**，不要用 cmd（中文 emoji 编码会爆炸）。

---

## 二、申请外部服务（一次性，3 个云账号）

### 2.1 DeepSeek API Key（**必需，主 LLM**）

1. 打开 https://platform.deepseek.com/
2. 注册账号
3. 充值（最少 1 元就够测试用大半天）
4. 控制台 → API Keys → 创建 → 复制 `sk-xxxxx...`
5. **存好这个 key，下面要写进 `.env` 文件**

**成本**：`deepseek-chat` 输入 ¥0.5/M token、输出 ¥1.5/M token，日常对话一天几分钱。

---

### 2.2 SiliconFlow API Key（**必需，Embedding**）

1. 打开 https://cloud.siliconflow.cn/
2. 注册账号（手机号 / 邮箱）
3. 账户管理 → API 密钥 → 新建 → 复制 `sk-xxxxx...`
4. 模型市场搜 `BAAI/bge-large-zh-v1.5` 确认可用（应该免费）

**成本**：BGE embedding 模型免费调用，有 RPM 限制但小规模够用。

---

### 2.3 Qdrant Cloud Cluster（**必需，向量库**）

1. 打开 https://cloud.qdrant.io/
2. 注册账号
3. **重要：选 Region**
   - 国内访问选 `ap-southeast-1` (Singapore)、`ap-northeast-1` (Tokyo)、`australia-southeast1` (Sydney)
   - **千万别选南美 / 非洲**，跨大洲 SSL 经常断
4. 创建 Free Tier 集群（1GB 免费 = 约 100 万 chunk，够个人用）
5. 创建时弹窗给你的 **API Key 只显示一次**，立刻保存
6. Dashboard 复制 **Cluster URL**，形如 `https://xxx.region.aws.cloud.qdrant.io`

**成本**：免费 1GB。超出按使用量计费。

---

### 2.4 不需要 OpenAI Key / 不需要 HuggingFace

embedding 走 SiliconFlow，**不下载任何本地模型**。

---

## 三、初始化项目结构

```bash
mkdir -p E:/01_Dev_Projects/Vibe_Coding
cd E:/01_Dev_Projects/Vibe_Coding
```

两个项目嵌套存放（**后端在前端目录下**，这是当前项目的实际结构）：

```
E:/01_Dev_Projects/Vibe_Coding/notes-app/
├── (Vue + Electron 前端，本目录)
└── RAG-AIAgent/    # ← Python 后端，作为子目录
```

---

## 四、搭后端 RAG-AIAgent

### 4.1 建项目骨架

```bash
cd notes-app
mkdir -p RAG-AIAgent/src RAG-AIAgent/data/notes
cd RAG-AIAgent
```

### 4.2 装 Python 依赖

新建 `requirements.txt`：

```txt
# LLM + Agent
openai>=1.0.0,<2.0.0
langchain>=1.0.0,<2.0.0
langchain-openai>=0.2.0,<1.0.0
langchain-core>=0.3.0,<1.0.0
langchain-text-splitters>=0.3.0,<1.0.0

# Vector DB
qdrant-client>=1.10.0,<2.0.0

# Backend
fastapi>=0.110.0,<1.0.0
uvicorn[standard]>=0.27.0,<1.0.0
python-multipart>=0.0.9,<1.0.0
sse-starlette>=2.0.0,<3.0.0

# Document ingestion
pypdf>=4.0.0,<5.0.0

# Utilities
python-dotenv>=1.0.0,<2.0.0
```

执行：

```bash
pip install -r requirements.txt
```

**与旧设计的差异**：**不需要** `chromadb` / `sentence-transformers` / `torch` / `transformers` / `langchain-huggingface` —— 全部走云端调用，依赖大幅瘦身。

### 4.3 配置环境变量

新建 `.env`（**不要提交到 git**）：

```bash
# DeepSeek
DEEPSEEK_API_KEY=sk-你的deepseek-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat

# SiliconFlow（Embedding）
SILICONFLOW_API_KEY=sk-你的siliconflow-key
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
EMBEDDING_MODEL=BAAI/bge-large-zh-v1.5
EMBEDDING_DIM=1024

# Qdrant Cloud
QDRANT_URL=https://你的集群.region.aws.cloud.qdrant.io
QDRANT_API_KEY=你的qdrant-key
QDRANT_COLLECTION_PREFIX=rag_kb_

# RAG 参数（可选覆盖默认）
CHUNK_SIZE=500
CHUNK_OVERLAP=80
TOP_K=6
```

`.env.example` 同步用占位符版本（这个要 commit）。

### 4.4 写代码文件

按 [TECH_OVERVIEW.md](TECH_OVERVIEW.md) 第一章的目录结构写 `src/` 下的模块：

| 文件 | 职责 |
|---|---|
| `src/__init__.py` | 空文件，标记 package |
| `src/config.py` | 加载 `.env`、定义集合命名规则 `rag_kb_<kb_id>` |
| `src/llm.py` | `build_llm()` DeepSeek 工厂、`EmbeddingService` SiliconFlow 客户端 |
| `src/vector_store.py` | `VectorStore` 单例 + `@_retry()` 装饰器，每 KB 一个 Qdrant collection |
| `src/prompt.py` | 三套 system prompt：`AGENT_SYSTEM_PROMPT` / `ENTRY_LOCKED_SYSTEM_PROMPT` / `DIRECT_CHAT_SYSTEM_PROMPT` |
| `src/kb.py` | `KBRegistry` JSON 持久化注册表 + 默认 `notes` KB |
| `src/entries.py` | `EntrySync` 把错题切 3 chunks（题目 / 正确答案 / 错误答案）+ 跨 KB upsert/delete |
| `src/ingest.py` | `Ingester` 扫 `data/<kb_id>/` 入库 PDF/TXT/MD |
| `src/agent.py` | `KbAgent`（`create_agent` + `query_knowledge_base` 工具）+ `EntryAgent`（锁定模式） |
| `src/api.py` | FastAPI 10 个端点 + SSE 响应器 `_sse_dispatch` |

代码逻辑直接看 `TECH_OVERVIEW.md` 第三章「核心算法」和第五章「API 速查」。

### 4.5 数据准备

```bash
# 默认错题库目录已经存在
ls data/notes
# 如果要加额外文档，扔进这里
# cp my-pdf.pdf data/notes/
```

### 4.6 首次启动 + 验证

```bash
# 验证配置 + Qdrant 连通
python -c "from src.config import validate_config; from src.vector_store import VectorStore; validate_config(); print(VectorStore().collection_stats('notes'))"

# 起服务
python -m uvicorn src.api:app --host 0.0.0.0 --port 8000
```

打开 http://localhost:8000/docs 看 Swagger，能看到 `/chat/stream`、`/kbs` 这些端点说明 OK。

测端点：

```bash
curl http://localhost:8000/health
# {"status":"ok","kbs":["notes"]}

curl http://localhost:8000/kbs
# [{"id":"notes","name":"错题库","is_default":true,...}]
```

### 4.7 常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| `Missing env vars: ...` | `.env` 没填全 | 检查 4 个必填项（DEEPSEEK / SILICONFLOW / QDRANT_URL / QDRANT_API_KEY） |
| `[SSL: UNEXPECTED_EOF_WHILE_READING]` | Qdrant 集群在跨大洲区域 | 重建集群到亚太区（Singapore / Tokyo / Sydney） |
| `AgentExecutor not found` | LangChain 0.x | `pip install -U "langchain>=1.0"`，改用 `create_agent` |
| `Address already in use ('0.0.0.0', 8000)` | 旧 uvicorn 没关 | `netstat -ano | grep :8000` → `taskkill /PID <pid> /F` |
| Windows 终端 emoji `UnicodeEncodeError` | GBK 不认 emoji | `sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')` |
| `Messages with role 'tool' must be a response to...` | `chat_history` 缺中间 tool 消息 | 流式生成后用 `invoke()` 拿规范化历史 |
| Qdrant 集合维度不对 | 换过 EMBEDDING_MODEL | `client.delete_collection('rag_kb_notes')` 重新跑 |
| `Method Not Allowed` | 浏览器直接 GET `/chat/stream` | `/chat/*` 是 POST，看 `/docs` 测试 |
| 答案是 "Connection error" 字符串 | DeepSeek 瞬时网络抖动 | 已内置 max_retries=2，再不行手动加重试 |

---

## 五、搭前端 notes-app

### 5.1 用脚手架建项目

```bash
cd E:/01_Dev_Projects/Vibe_Coding
npm create vite@latest notes-app -- --template vue-ts
cd notes-app
npm install
```

如果用现有项目，直接 `npm install` 在已有目录跑。

### 5.2 加 Electron + Tailwind + 工具链

```bash
# Electron
npm install -D electron electron-builder vite-plugin-electron vite-plugin-electron-renderer

# Tailwind
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p

# 代码规范
npm install -D eslint prettier eslint-plugin-vue @typescript-eslint/parser @typescript-eslint/eslint-plugin husky lint-staged

npx husky init
```

### 5.3 配置文件

| 文件 | 作用 | 关键配置 |
|---|---|---|
| `vite.config.ts` | Vite 配置 | 加 electron 插件，配 `@` 别名指向 `src/` |
| `tailwind.config.js` | Tailwind 配置 | `content: ['./index.html', './src/**/*.{vue,ts}']`，`darkMode: 'class'`，自定义 `accent` 色 |
| `postcss.config.js` | PostCSS | 引入 tailwindcss + autoprefixer |
| `tsconfig.json` / `tsconfig.app.json` | TS 配置 | `paths: { "@/*": ["./src/*"] }` |
| `eslint.config.js` | ESLint | Vue + TS 规则 |
| `.prettierrc` | Prettier | 项目格式风格 |
| `.husky/pre-commit` | Git hook | 跑 `npm run lint` 阻止脏代码进库 |
| `electron/main.cjs` | Electron 主进程 | 创建 BrowserWindow、加载 Vite dev URL 或打包后的 dist |
| `electron/preload.cjs` | Electron preload | 暴露安全 API 给 renderer |

### 5.4 src 目录组织

```
src/
├── App.vue                  # 根组件
├── main.ts                  # 入口
├── style.css                # Tailwind @tailwind 指令
├── components/              # 所有 .vue 组件
├── composables/             # 组合式逻辑（useEntries / useAiChat / ...）
├── services/db.ts           # IndexedDB 封装
├── types/index.ts           # NoteEntry / AiSkill 等类型
└── utils/                   # 工具函数
```

### 5.5 关键 composable 写法（按顺序写）

1. **`useEntries`** — 错题 CRUD（IndexedDB）
2. **`useNotebooks`** — 笔记本切换
3. **`useReview`** — SRS 间隔重复
4. **`useDarkMode`** — 暗黑模式切换
5. **`useAiChat`** — 调 `/chat/stream` 或 `/chat/entry`，手写 SSE 解析（**关键**：分隔符要同时支持 `\r\n\r\n` 和 `\n\n`）
6. **`useAiSkills`** — Skill 系统，localStorage 持久化
7. **`useKnowledgeBases`** — KB 列表，调 `/kbs` 接口
8. **`useRagSync`** — 错题保存时静默同步 RAG，失败不阻塞

详见 `TECH_OVERVIEW.md` 第六章数据流图。

### 5.6 启动开发模式

```bash
npm run dev
# 或
npx vite
```

打开 http://localhost:5173/（5173 被占用会自动跳 5174）。

### 5.7 常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| `5173 / 5174 被占` | 旧 vite 没关 | `netstat -ano | grep :5173` 找 PID，`taskkill /PID N /F` |
| CORS 错 | 后端没装 CORSMiddleware | `api.py` 加 `app.add_middleware(CORSMiddleware, allow_origins=['*'], ...)` |
| AI 侧栏聊天显示 `[出错] HTTP 404` | 后端没起 / 端口错 | 检查 `uvicorn` 在 8000 跑、`useAiChat.ts` 的 `DEFAULT_BASE_URL` |
| AI 侧栏一直"思考中"不停 | SSE 解析卡 `\r\n\r\n` | 看 `useAiChat.ts` 的 `findSep` 函数 |
| AI 侧栏显示 "Connection error" | 后端 DeepSeek 抖动 | 重试 max_retries=2 起效，或前端重发 |
| Vue 响应式不更新 | 闭包持有原始对象 | push 进数组后用 `arr[arr.length-1]` 取代理引用 |
| TS 报 `Property 'at' does not exist` | tsconfig 没开 ES2022 | 改用 `arr[arr.length-1]` 替代 `arr.at(-1)` |
| `Property 'confirm' does not exist` | template 里直接用 `confirm()` | setup 里包一层 `function confirmAsk(msg) { return window.confirm(msg) }` |

---

## 六、前后端联调

### 6.1 启动顺序

```bash
# Terminal 1：后端
cd E:/01_Dev_Projects/Vibe_Coding/notes-app/RAG-AIAgent
python -m uvicorn src.api:app --host 0.0.0.0 --port 8000

# Terminal 2：前端
cd E:/01_Dev_Projects/Vibe_Coding/notes-app
npm run dev
```

### 6.2 验证清单

1. `curl http://localhost:8000/health` → `{"status":"ok","kbs":["notes"]}`
2. `curl http://localhost:8000/kbs` → 返回默认 `notes` 库
3. 浏览器 http://localhost:5173/ → 能看到笔记本界面
4. 新建一条错题 → 保存 → 后端控制台看到 `POST /entries/upsert 200`
5. 打开任意错题 → 右侧 AI 侧栏顶部显示「当前错题」蓝色 chip
6. 输入"这题怎么做"→ 流式输出能看到节点进度（load_entry → generate_answer）→ 最终给出答案 + 置信度
7. 全库模式问"我有哪些错题"→ 进度条出现 `route_question → retrieve → generate_answer`，答案引用错题标题

### 6.3 验证多知识库

1. 设置面板 → 知识库 → 新建 ID=`test`、名称=`测试库`
2. 点这一行的「路径」按钮 → 剪贴板得到 `E:\...\RAG-AIAgent\data\test\` 路径
3. 文件资源管理器粘贴打开 → 拷个 PDF 进去
4. 设置面板 → 点这一行「重建」按钮（调 `POST /ingest {kb_id:'test', reset:true}`）
5. 错题编辑页顶部 KB 下拉切到「测试库」→ 保存
6. AI 侧栏（全库模式）顶部 KB 选「测试库」→ 提问命中新 PDF

---

## 七、打包发布

### 7.1 后端打包（可选）

后端是 Python，**通常不打包**，直接配 `requirements.txt` + 启动脚本就行。需要分发给非技术用户时才考虑 PyInstaller：

```bash
pip install pyinstaller
pyinstaller --onefile --add-data ".env;." -n rag-server src/api.py
```

但有几个坑：
- LangChain 动态 import 多，要加 `--collect-all langchain`
- Qdrant client 含 protobuf 编译依赖
- `.env` 路径要硬编码或运行时读环境变量

**推荐做法**：写一个 `start.bat` / `start.sh` 启动脚本，配 README 让用户装 Python + 拷 `.env` 再跑。

### 7.2 前端打包（Electron）

`package.json` 配置 `build` 字段：

```json
{
  "scripts": {
    "build": "vue-tsc --noEmit && vite build && electron-builder"
  },
  "build": {
    "appId": "com.yourname.notesapp",
    "productName": "错题本",
    "directories": { "output": "dist-electron" },
    "files": ["dist/**/*", "electron/**/*"],
    "win": { "target": "nsis" },
    "mac": { "target": "dmg" },
    "linux": { "target": "AppImage" }
  }
}
```

执行：

```bash
npm run build
```

产物在 `dist-electron/` —— Windows 是 `.exe` 安装包，Mac 是 `.dmg`。

### 7.3 桌面端访问后端

**默认 Electron 应用打开后**会调 `http://localhost:8000` —— 用户必须先跑后端。

更友好的做法：让 Electron 主进程**自动起 Python 后端子进程**。在 `electron/main.cjs`：

```js
const { spawn } = require('child_process')
const py = spawn('python', ['-m', 'uvicorn', 'src.api:app'], { cwd: '...' })
app.on('quit', () => py.kill())
```

但这需要用户机器装好 Python 环境。**最简单：先让用户手动起两个进程**，等用户量起来再做合包。

---

## 八、Git 工作流

### 8.1 两个仓库还是一个 monorepo？

**推荐**：一个 monorepo（后端就在前端子目录），方便联调和文档同步。

```bash
cd notes-app
git init
git add .
git commit -m "init"
```

### 8.2 `.gitignore` 必须包含

**根目录 .gitignore**：
```
node_modules/
dist/
dist-electron/
.vite/
*.tsbuildinfo
.env.local

# 后端
RAG-AIAgent/.env
RAG-AIAgent/__pycache__/
RAG-AIAgent/**/*.pyc
RAG-AIAgent/.venv/
RAG-AIAgent/data/kb_registry.json
RAG-AIAgent/data/*/
!RAG-AIAgent/data/.gitkeep
```

### 8.3 推 GitHub

```bash
gh repo create your-name/notes-app --private --source=. --push
```

### 8.4 关键：永远不要把 `.env` 推上去

```bash
# 推之前扫一遍
grep -rE "sk-[a-zA-Z0-9]{30,}" --include="*.py" --include="*.ts" --include="*.vue" --include="*.md" .
```

`.env` 里有 DeepSeek + SiliconFlow + Qdrant 三套 key —— 推上 GitHub 等于送钱 + 送数据。先确认 `.gitignore` 生效再 `git add`。

---

## 九、配置一份"AI 指令库"备份（可选但推荐）

调教好的 skill 存在 localStorage，换机器就丢。建议：

1. 在 notes-app 设置面板 → AI 指令库 → 点「导出」
2. 把下载的 JSON 拷到 `notes-app/skills-backup/my-skills.json`
3. git 提交（这个文件可以推）

新机器 git clone 之后，导入这个 JSON 就恢复了。

---

## 十、整体启动顺序（每天用的时候）

```bash
# 1. 起后端
cd E:/01_Dev_Projects/Vibe_Coding/notes-app/RAG-AIAgent
python -m uvicorn src.api:app --host 0.0.0.0 --port 8000
# 看到 "Uvicorn running on http://0.0.0.0:8000" 就 OK

# 2. 起前端（另开终端）
cd E:/01_Dev_Projects/Vibe_Coding/notes-app
npm run dev
# 看到 "Local: http://localhost:5173/" 就 OK

# 3. 浏览器打开 http://localhost:5173/
```

完事关掉两个终端就行（Ctrl + C）。

- 错题数据在浏览器 IndexedDB 里，重启不会丢
- RAG 索引在 **Qdrant Cloud**，重启不会丢，跨机器也不会丢（同一个 cluster）
- 会话历史在后端内存里，**后端重启就丢**（接 Redis 后可持久化，见 TECH_OVERVIEW 7.7）

---

## 十一、调试技巧

| 场景 | 工具 |
|---|---|
| 看 RAG 内部决策（agent 调没调工具） | 后端终端有 SSE node 事件日志；浏览器 F12 Network 看 `chat/stream` EventStream |
| 看前端 SSE 数据 | F12 → Network → 找 `chat/stream` 或 `chat/entry` → EventStream tab |
| 看 IndexedDB | F12 → Application → IndexedDB |
| 看 localStorage（skill / KB 选择） | F12 → Application → Local Storage |
| Vue 组件状态 | 装 Vue Devtools 浏览器扩展 |
| Python 类型 / 报错堆栈 | `uvicorn ... --log-level debug` |
| TS 类型检查 | `npx vue-tsc --noEmit -p tsconfig.app.json` |
| LangSmith 全链路 trace（需配置） | 网页 https://smith.langchain.com 看每次调用 |
| Qdrant 数据查看 | Qdrant Cloud Dashboard → Collections → Browse |

---

## 十二、再要扩展看哪里

`TECH_OVERVIEW.md` 第七章「扩展实施指南」—— 10 个常见扩展（LangSmith / 自建 Qdrant / Reranker / OCR / Redis Session / 多模态 / ...），每个都标了改哪些文件、工程量、关键代码点。

---

## 十三、备忘：项目复制粘贴清单

如果以后想在别的电脑搭一份：

1. 装好 Git / Node 20+ / Python 3.11+
2. `git clone` 项目（monorepo）
3. **RAG-AIAgent**：
   - 申请 DeepSeek / SiliconFlow / Qdrant 三个云账号（已有 key 直接复用）
   - 拷一份 `.env`
   - `pip install -r requirements.txt`
   - `python -m uvicorn src.api:app --host 0.0.0.0 --port 8000`
4. **notes-app**：
   - `npm ci`
   - `npm run dev`
5. 浏览器开 http://localhost:5173/
6. 如果有 skill 备份，设置面板 → AI 指令库 → 导入 JSON

**注意**：Qdrant 数据是云上的，新机器连同一个 cluster 就能看到原来的错题索引。如果想从头开始：
```bash
curl -X DELETE -H "api-key: $QDRANT_API_KEY" $QDRANT_URL/collections/rag_kb_notes
```

完事。
