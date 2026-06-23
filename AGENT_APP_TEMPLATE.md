# AI Agent + 应用开发 · 通用框架蓝本（云原生版）

> **这是什么**：一套从零搭建「云原生 AI Agent 后端 + 业务应用前端 + 实时双向同步」项目的通用模板。本地零模型下载，所有 LLM / Embedding / 向量库都在云端。
>
> **怎么用**：把整份文档直接喂给 AI（Claude / GPT / DeepSeek），让它按这个框架搭你自己的项目。替换其中 `<占位符>` 为你的业务即可。
>
> **来源**：基于 `notes-app（错题本）+ RAG-AIAgent` 实际落地的生产级 MVP 提炼。
>
> **vs 本地版**：项目根目录的 `TECH_OVERVIEW.md` 是同一套架构的具体实现。这份 TEMPLATE 是抽象出来给"做别的业务"用的蓝本。如果你要做的是「错题本」类似的应用，直接 fork 项目；如果是宠物记录 / 法律检索 / 读书笔记等其他业务，按这份蓝本喂给 AI 重新搭。

---

## 〇、给 AI 助手的 SYSTEM PROMPT

> 复制下面这一整段到 AI 对话开头，它就知道按这个框架干活。

```
你是一位资深全栈工程师，要按照《AI Agent + 应用开发通用框架蓝本（云原生版）》搭一个新项目。

工作原则：
1. 严格遵守本文档定义的目录结构、命名、依赖版本约束
2. 优先复用框架中给定的代码骨架，不要随意改架构
3. 用 LangChain 1.x 的 `create_agent`，不要自己装 LangGraph 节点
4. 涉及 LLM 调用必须支持流式 + 重试 + 失败兜底
5. Embedding 走云端 SiliconFlow / 阿里百炼，不在本地跑模型
6. 向量库默认 Qdrant Cloud（亚太区），提供切换到自建的最小改造
7. 前后端通过 SSE 流式通信，不用 WebSocket
8. 任何外部 API key 必须走 .env，绝不硬编码、绝不写进 .env.example
9. 每完成一个模块跑一次最小验证（curl / python -c "from X import Y"），通过再下一步
10. 遇到选择题主动用 AskUserQuestion 让用户决策，不要替用户选

我的项目主题：<在这里填你的业务>，例如「客户支持知识库问答 / 个人读书笔记助手 / 法律条文检索」。
我的数据形态：<描述你的核心数据对象>，例如「每条记录有 标题/正文/标签/创建时间」。
特殊要求：<列出非默认的需求>，例如「需要多用户隔离 / 需要支持图片 / 需要 OCR 扫描件」。

开始之前，请先确认上面三项信息，然后按照框架第一章开始搭建。
```

---

## 一、项目定位与适用场景

### 这个框架适合做的项目

| 场景 | 例子 |
|---|---|
| **私有知识库问答** | 客服 FAQ、产品手册、内部文档检索 |
| **个人记录类 + AI** | 笔记本、日记、读书摘录、错题本、运动日志、宠物健康 |
| **领域专家助手** | 法律条文、医学问答、代码库导览 |
| **学习辅助工具** | 复习卡、单词本、刷题、写作教练 |
| **轻量 CRM / 知识管理** | 个人维基、客户档案、项目跟踪 |

### 不适合的场景

- 数据强离线 / 强合规（云端不允许）→ 走本地版蓝本（chromadb + sentence-transformers + LangGraph）
- 重交易 / 强事务 → 传统 OLTP 架构
- 大规模并发用户 → 这套是单机本地优先，要扛量得加 Redis Session + 多 Worker
- 实时音视频 / 游戏 → WebRTC / 专用引擎
- 纯静态展示 → React + 静态托管就够

### 核心特征

```
┌──────────────────────┐         ┌──────────────────────┐
│   业务应用（前端）    │  HTTP   │  AI Agent（后端）     │
│ • Vue/React + 桌面壳 │ ─────► │ • FastAPI            │
│ • IndexedDB 本地数据 │ ◄──SSE  │ • LangChain create_agent│
│ • 实时同步 hook      │         │ • 两种 Agent 模式     │
└──────────────────────┘         └──────┬───────────────┘
                                        │
                       ┌────────────────┼────────────────┐
                       ▼                ▼                ▼
                  ┌──────────┐   ┌──────────────┐  ┌──────────┐
                  │ DeepSeek │   │ SiliconFlow  │  │ Qdrant   │
                  │  LLM     │   │  Embedding   │  │  Cloud   │
                  │  (云)    │   │     (云)     │  │  (云)    │
                  └──────────┘   └──────────────┘  └──────────┘
```

---

## 二、技术栈（默认选型）

### 后端（AI Agent 服务）

| 类别 | 技术 | 替代项 |
|---|---|---|
| 语言 | Python 3.11+ | Node.js（如全栈一致性优先） |
| Web | FastAPI + Uvicorn | Flask、Hono（轻量） |
| Agent 编排 | **LangChain 1.x `create_agent`** | LangGraph 手装节点（更灵活但复杂） |
| LLM | DeepSeek（OpenAI 兼容） | Qwen / GPT-4o / Claude / 智谱 GLM |
| Embedding | **SiliconFlow** BGE-large-zh-v1.5 | 阿里百炼 / OpenAI text-embedding-3 |
| 向量库 | **Qdrant Cloud** | 自建 Qdrant Docker / Pinecone / 阿里 DashVector |
| Reranker | 默认无 | bge-reranker-base / Cohere Rerank（如召回质量差） |
| 文档解析 | pypdf | unstructured、pdfplumber、PyMuPDF |
| 流式 | sse-starlette | WebSocket |
| 持久化 | 内存 dict | Redis（多 worker 时必需） |
| 校验 | Pydantic 2 | - |

### 前端（业务应用）

| 类别 | 技术 | 替代项 |
|---|---|---|
| 框架 | Vue 3 (Composition API) | React 18、Svelte 5 |
| 语言 | TypeScript | - |
| 构建 | Vite 6 | Next.js / Nuxt |
| 桌面壳 | Electron | Tauri（更轻）、纯 PWA |
| 样式 | Tailwind CSS 3 | UnoCSS、原子化 CSS |
| 本地存储 | IndexedDB | SQLite (Tauri)、localStorage |
| 状态管理 | Composable / Hook | Pinia / Zustand（复杂场景） |
| HTTP | 原生 fetch | axios、ofetch |
| SSE | 原生 ReadableStream | EventSource（不支持 POST） |

### 工程化

- ESLint + Prettier + Husky pre-commit
- TypeScript 严格模式 + `vue-tsc --noEmit`
- GitHub Actions（CI 跑 lint + 类型检查）
- `.env` + `python-dotenv` / `dotenv` 管理密钥
- 推送前扫描 `sk-` 防 key 泄露

---

## 三、目录结构（强约束）

```
<project-root>/
├── README.md
├── TECH_OVERVIEW.md                     # 技术档案（每个项目都写）
├── HOW_TO_BUILD.md                      # 复现指南
│
├── <ai-backend>/                        # AI 服务后端，建议名 RAG-AIAgent
│   ├── .env                             # 密钥 ❗ 加 .gitignore
│   ├── .env.example                     # 模板，key 用占位符
│   ├── .gitignore
│   ├── requirements.txt
│   ├── README.md
│   ├── data/                            # 各 KB 文档目录
│   │   ├── kb_registry.json             # KB 元数据（gitignore）
│   │   └── <kb_id>/                     # KB 源文档
│   └── src/
│       ├── __init__.py
│       ├── config.py                    # 环境变量 + 集合命名规则
│       ├── llm.py                       # LLM 工厂 + Embedding 服务
│       ├── vector_store.py              # Qdrant 客户端 + @_retry()
│       ├── prompt.py                    # 三套 system prompt 集中管理
│       ├── kb.py                        # 知识库注册表
│       ├── entries.py                   # 业务对象 ↔ RAG 同步
│       ├── ingest.py                    # 文档入库脚本
│       ├── agent.py                     # KbAgent + EntryAgent
│       └── api.py                       # FastAPI 路由 + SSE
│
└── <business-app>/                      # 业务应用前端（可与后端嵌套或并列）
    ├── .gitignore
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── tsconfig.json
    ├── electron/
    │   ├── main.cjs
    │   └── preload.cjs
    └── src/
        ├── main.ts
        ├── App.vue
        ├── style.css
        ├── types/
        │   └── index.ts                 # 业务实体 + AI 实体
        ├── services/
        │   └── db.ts                    # IndexedDB 封装
        ├── composables/
        │   ├── use<Entity>.ts           # 业务 CRUD
        │   ├── useAiChat.ts             # SSE 流式问答
        │   ├── useAiSkills.ts           # Skill 系统
        │   ├── useKnowledgeBases.ts     # KB 管理
        │   └── useRagSync.ts            # 业务 ↔ RAG 静默同步
        ├── components/
        │   ├── AiChatSidebar.vue        # AI 问答侧栏
        │   ├── AiSkillsEditor.vue       # Skill 编辑器
        │   ├── KnowledgeBaseManager.vue # KB 管理 UI
        │   └── <Entity>Editor.vue       # 业务实体编辑器
        └── utils/
```

---

## 四、核心架构模式

### 4.1 用 `create_agent` 不要自己装 LangGraph（必备）

LangChain 1.3+ 的 `create_agent` 内部就是一个编译好的 `CompiledStateGraph`，已经处理好：
- tool_calls 状态判断
- tool_call_id 配对
- 多轮 tool 调用循环
- 异常恢复

```python
from langchain.agents import create_agent

agent = create_agent(llm, tools=[...], system_prompt="...")
result = agent.invoke({"messages": [HumanMessage(...)]})
# result["messages"] 自动包含完整规范的对话链
```

**反模式**：自己写 `StateGraph().add_node().add_edge()` —— 除非你有特殊节点（如 grade_documents 评分），否则纯 RAG + tool-calling 用不到。

### 4.2 两种 Agent 模式（业务可裁剪）

| 模式 | 工具 | 检索 | 适用场景 |
|---|---|---|---|
| **全库 RAG（KbAgent）** | `query_knowledge_base` 等 | agent 自决策 | 用户没绑定具体实体，自由问 |
| **锁定实体（EntryAgent）** | 无 | 否 | 用户打开某条具体记录在问 |

```python
# 全库模式
class KbAgent:
    def __init__(self, kb_id, embedding, vector_store):
        self._graph = create_agent(
            build_llm(streaming=True),
            tools=self._build_tools(),  # 闭包绑 kb_id
            system_prompt=AGENT_SYSTEM_PROMPT,
        )

# 锁定模式
class EntryAgent:
    def generate(self, thread_id, question, entry, skill_prompt=None):
        sys_text = ENTRY_LOCKED_PROMPT + "\n\n" + self._format_entry(entry)
        if skill_prompt:
            sys_text += "\n\n## 用户自定义指令\n" + skill_prompt
        # 直接 self.llm.stream(messages)，不走 agent
```

### 4.3 流式 + 历史持久化（必备）

LangChain 的 `stream(stream_mode="messages")` 给的是**实时 token**，不是完整消息。流结束后**必须用 `invoke()` 拿规范化历史**，否则 tool_calls / ToolMessage 配对会丢，下一轮 400。

```python
def query_stream(self, user_input: str):
    messages = [*self.chat_history, HumanMessage(content=user_input)]
    printed = ""
    # 阶段 1：流给前端
    for chunk, _meta in self._graph.stream({"messages": messages}, stream_mode="messages"):
        if isinstance(chunk, AIMessage) and chunk.content:
            new = chunk.content[len(printed):]
            if new:
                yield new
            printed = chunk.content
    # 阶段 2：拿规范化历史
    final = self._graph.invoke({"messages": messages})
    self.chat_history = final["messages"]
```

**这是这个框架最容易踩的坑**，必须照抄。

### 4.4 工具用 `@tool` 装饰器声明（必备）

```python
from langchain_core.tools import tool

@tool
def query_knowledge_base(query: str) -> str:
    """语义检索本地知识库。
    用户问到文档内容、特定概念定义等时调用此工具。"""
    vec = embedding.embed_query(query)
    results = vector_store.search(kb_id, vec, top_k=6)
    return "\n\n---\n\n".join(f"[{r.metadata.get('source')}]\n{r.text}" for r in results)
```

**关键**：
- docstring 就是给 LLM 看的工具说明（自动转 JSON Schema）
- 参数类型注解必须给（LLM 看类型判断怎么调）
- 返回字符串（多模态返回得用 LangChain 特殊类型）
- 在 docstring 里说"什么时候用"，不要说"怎么实现"

### 4.5 云端 LLM + Embedding（必备）

**统一用 OpenAI 兼容协议**，所有调云端模型都走 `langchain_openai.ChatOpenAI` 或 `openai.OpenAI`：

```python
# LLM
ChatOpenAI(
    model="deepseek-chat",
    api_key=DEEPSEEK_KEY,
    base_url="https://api.deepseek.com/v1",
)

# Embedding
OpenAI(api_key=SILICONFLOW_KEY, base_url="https://api.siliconflow.cn/v1").embeddings.create(
    model="BAAI/bge-large-zh-v1.5",
    input=texts,
)
```

切换供应商**只改 base_url + model**，代码不动。

### 4.6 向量库重试包装（必备）

云端向量库 SSL 抖动是常态。用装饰器统一兜底：

```python
def _retry(max_attempts=4, base_delay=0.5):
    def deco(fn):
        @functools.wraps(fn)
        def wrap(*args, **kwargs):
            for i in range(max_attempts):
                try:
                    return fn(*args, **kwargs)
                except (ResponseHandlingException, OSError):
                    if i < max_attempts - 1:
                        time.sleep(base_delay * (2 ** i))
                        continue
                    raise
        return wrap
    return deco

class VectorStore:
    @_retry()
    def search(self, ...): ...
    @_retry()
    def add_chunks(self, ...): ...
```

### 4.7 业务 ↔ AI 双向同步（必备）

```typescript
// 业务对象保存成功后，静默触发 AI 索引更新
async function saveEntry() {
  await db.put(entry)               // 1. 先保证业务数据落地
  void ragSync.upsertEntry(entry)   // 2. 异步同步，失败不阻塞
}
```

后端 upsert 策略：**先全 KB 删旧 chunk，再写新 chunk** —— 处理跨 KB 迁移 / 字段变更。

```python
def upsert(self, entry):
    # 先遍历所有 KB，删除这个 entry_id 的旧 chunks
    for kb in REGISTRY.list():
        self.vector_store.delete_by_entry(kb["id"], entry["id"])
    # 再写到目标 KB
    self.vector_store.add_chunks(entry["kbId"], ...)
```

### 4.8 多知识库（按需）

每个 KB = 独立 Qdrant collection + 独立 `data/<id>/` 目录。
- collection_name 命名：`rag_kb_<kb_id>`
- 默认 KB（如 `notes`）不可删
- 删除 KB → 删 collection 但保留物理文件夹防误删

### 4.9 Skill 系统（按需）

用户在聊天输入 `/<触发词> <问题>` 触发自定义 system prompt：

```typescript
interface AiSkill {
  id: string
  trigger: string         // 不带斜杠
  systemPrompt: string    // 用户自己写
  scope: 'entry' | 'global' | 'both'
  enabled: boolean
}
```

后端把 skill prompt **追加**到默认 system 末尾，不是替换（保留 RAG 上下文约束）。

### 4.10 实体 → chunks 切片策略（按需）

业务实体往往结构化（不像纯文档）。错题本里我们把每条错题切成 3 个 chunks：

```python
def _build_chunks(entry):
    push(entry["question"], "题目")
    push(entry["correctAnswer"], "正确答案")
    push(entry["wrongAnswer"], "错误答案")
```

每个 chunk 带上下文前缀（`[标题](学科) 题目: ...`），提升检索准确性。

**别的业务怎么切**：
- 读书笔记 → 标题 + 正文 + 摘录
- 客户记录 → 基本信息 + 沟通历史摘要 + 标签
- 法律条文 → 条款编号 + 标题 + 正文

按"用户最可能搜哪个字段"决定切多少 chunks。

---

## 五、API 设计约定

| 端点 | 方法 | 用途 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/chat/stream` | POST | SSE 流式问答（全库 RAG） |
| `/chat/<entity>` | POST | SSE 锁定单个业务对象问答 |
| `/entries/upsert` | POST | 业务对象同步入库 |
| `/entries/delete` | POST | 业务对象删除 |
| `/ingest` | POST | 文档批量入库 |
| `/kbs` | GET/POST | 知识库列表/新建 |
| `/kbs/<id>` | PATCH/DELETE | 改名/删除 |
| `/kbs/<id>/data-dir` | GET | 取本地文档目录绝对路径 |

**请求体规范**：
- 所有 POST 用 JSON
- 可选参数都给默认值（`kb_id` 默认 = 主库 id）
- 路径不带版本号（小项目用不上 `/v1/`）

**响应规范**：
- 成功直接返回业务数据
- 错误用 HTTPException（FastAPI 自动 4xx/5xx + detail）
- 流式用 sse-starlette 的 `EventSourceResponse`

**SSE 事件流**：
```
event: node\r\n
data: {"node": "retrieve"}\r\n
\r\n
event: final\r\n
data: {"answer": "...", "sources": [...], "confidence_score": 0.85}\r\n
\r\n
event: error\r\n
data: {"message": "..."}\r\n
\r\n
```

前端 SSE 解析**必须同时支持 `\r\n\r\n` 和 `\n\n`**（sse-starlette 用前者）。用原生 `fetch + ReadableStream` 手写，不要用 `EventSource`（不支持 POST）。

---

## 六、代码骨架（直接复制）

### 6.1 后端 `src/config.py`

```python
import os
from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

DATA_DIR = PROJECT_ROOT / "data"
KB_REGISTRY_PATH = DATA_DIR / "kb_registry.json"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# LLM
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

# Embedding
SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY", "")
SILICONFLOW_BASE_URL = os.getenv("SILICONFLOW_BASE_URL", "https://api.siliconflow.cn/v1")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-large-zh-v1.5")
EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", "1024"))

# Vector DB
QDRANT_URL = os.getenv("QDRANT_URL", "")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY", "")
QDRANT_COLLECTION_PREFIX = os.getenv("QDRANT_COLLECTION_PREFIX", "rag_kb_")

# RAG params
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "500"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "80"))
TOP_K = int(os.getenv("TOP_K", "6"))


def validate_config():
    missing = []
    if not DEEPSEEK_API_KEY: missing.append("DEEPSEEK_API_KEY")
    if not SILICONFLOW_API_KEY: missing.append("SILICONFLOW_API_KEY")
    if not QDRANT_URL: missing.append("QDRANT_URL")
    if not QDRANT_API_KEY: missing.append("QDRANT_API_KEY")
    if missing:
        raise ValueError(f"Missing env vars: {', '.join(missing)}")


def collection_name(kb_id: str) -> str:
    safe = "".join(c for c in kb_id if c.isalnum() or c in ("_", "-"))
    return f"{QDRANT_COLLECTION_PREFIX}{safe}"
```

### 6.2 后端 `src/llm.py`

```python
from typing import List
from langchain_openai import ChatOpenAI
from openai import OpenAI
from src.config import *


def build_llm(temperature=0.7, streaming=True):
    return ChatOpenAI(
        model=DEEPSEEK_MODEL,
        api_key=DEEPSEEK_API_KEY,
        base_url=DEEPSEEK_BASE_URL,
        temperature=temperature,
        streaming=streaming,
        timeout=60,
        max_retries=2,
    )


class EmbeddingService:
    def __init__(self):
        self.client = OpenAI(api_key=SILICONFLOW_API_KEY, base_url=SILICONFLOW_BASE_URL)
        self.model = EMBEDDING_MODEL

    def embed_query(self, q: str) -> List[float]:
        return self.client.embeddings.create(model=self.model, input=[q]).data[0].embedding

    def embed_texts(self, texts: List[str], batch_size=32) -> List[List[float]]:
        out = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i+batch_size]
            resp = self.client.embeddings.create(model=self.model, input=batch)
            out.extend([d.embedding for d in resp.data])
        return out
```

### 6.3 后端 `src/agent.py`（最关键的文件）

```python
from typing import Generator, Dict, Any, List
from langchain.agents import create_agent
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.tools import tool

from src.config import TOP_K
from src.llm import EmbeddingService, build_llm
from src.prompt import AGENT_SYSTEM_PROMPT, ENTRY_LOCKED_SYSTEM_PROMPT
from src.vector_store import VectorStore

_HISTORIES: Dict[str, List[BaseMessage]] = {}


class KbAgent:
    def __init__(self, kb_id, embedding, vector_store):
        self.kb_id = kb_id
        self.embedding = embedding
        self.vector_store = vector_store
        self.llm = build_llm(streaming=True)
        self._tools = self._build_tools()
        self._graph = create_agent(self.llm, tools=self._tools, system_prompt=AGENT_SYSTEM_PROMPT)
        self._last_sources = []

    def _build_tools(self):
        embedding, vs, kb_id = self.embedding, self.vector_store, self.kb_id
        holder = self

        @tool
        def query_knowledge_base(query: str) -> str:
            """语义检索本地知识库。"""
            vec = embedding.embed_query(query)
            results = vs.search(kb_id, vec, top_k=TOP_K)
            if not results:
                return "[知识库中暂无相关内容]"
            holder._last_sources = []
            parts = []
            for r in results:
                src = r.metadata.get("entry_title") or r.metadata.get("source") or "未命名"
                if src not in holder._last_sources:
                    holder._last_sources.append(src)
                parts.append(f"[{src}]\n{r.text}")
            return "\n\n---\n\n".join(parts)

        return [query_knowledge_base]

    def generate(self, thread_id, question) -> Generator[Dict[str, Any], None, None]:
        self._last_sources = []
        history = _HISTORIES.get(f"{thread_id}::{self.kb_id}", [])
        input_messages = [*history, HumanMessage(content=question)]

        yield {"type": "node", "data": {"node": "route_question"}}

        try:
            for chunk, _meta in self._graph.stream({"messages": input_messages}, stream_mode="messages"):
                if isinstance(chunk, AIMessage) and chunk.tool_calls:
                    yield {"type": "node", "data": {"node": "retrieve"}}
                    break

            yield {"type": "node", "data": {"node": "generate_answer"}}

            final = self._graph.invoke({"messages": input_messages})
            messages = final["messages"]
            _HISTORIES[f"{thread_id}::{self.kb_id}"] = messages

            answer = ""
            for m in reversed(messages):
                if isinstance(m, AIMessage) and m.content and not m.tool_calls:
                    answer = m.content if isinstance(m.content, str) else str(m.content)
                    break

            yield {
                "type": "final",
                "data": {
                    "answer": answer,
                    "sources": list(self._last_sources),
                    "confidence_score": 0.85 if self._last_sources else 0.5,
                },
            }
        except Exception as e:
            yield {"type": "error", "data": {"message": f"{type(e).__name__}: {e}"}}


class EntryAgent:
    """单实体锁定问答，无检索。"""
    def __init__(self):
        self.llm = build_llm(streaming=True)

    def generate(self, thread_id, question, entry, skill_prompt=None):
        sys_text = ENTRY_LOCKED_SYSTEM_PROMPT + "\n\n" + self._format_entry(entry)
        if skill_prompt:
            sys_text += "\n\n## 用户自定义指令\n" + skill_prompt

        key = f"entry::{thread_id}::{entry.get('id')}"
        history = _HISTORIES.get(key, [])
        messages = [SystemMessage(content=sys_text), *history, HumanMessage(content=question)]

        yield {"type": "node", "data": {"node": "load_entry"}}
        yield {"type": "node", "data": {"node": "generate_answer"}}

        try:
            collected = ""
            for chunk in self.llm.stream(messages):
                if chunk.content:
                    collected += chunk.content
            history = [*history, HumanMessage(content=question), AIMessage(content=collected)][-20:]
            _HISTORIES[key] = history

            yield {
                "type": "final",
                "data": {
                    "answer": collected,
                    "sources": [f"实体 [{entry.get('title') or entry.get('id')}]"],
                    "confidence_score": 0.9,
                },
            }
        except Exception as e:
            yield {"type": "error", "data": {"message": f"{type(e).__name__}: {e}"}}

    @staticmethod
    def _format_entry(entry):
        # 业务定制：把实体字段拼成 markdown
        return "## 实体内容\n" + "\n".join(f"- **{k}**: {v}" for k, v in entry.items())
```

### 6.4 后端 `src/api.py`（最小可用版）

```python
import asyncio, json
from typing import Optional, Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from src.agent import EntryAgent, KbAgent
from src.config import validate_config
from src.kb import REGISTRY
from src.llm import EmbeddingService
from src.vector_store import VectorStore

validate_config()
EMB = EmbeddingService()
VEC = VectorStore()
ENTRY_AGENT = EntryAgent()
_KB_AGENTS: Dict[str, KbAgent] = {}

def get_kb_agent(kb_id: str) -> KbAgent:
    if kb_id not in _KB_AGENTS:
        _KB_AGENTS[kb_id] = KbAgent(kb_id, EMB, VEC)
    return _KB_AGENTS[kb_id]


app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class ChatStreamRequest(BaseModel):
    question: str
    thread_id: str
    kb_id: Optional[str] = None


class ChatEntryRequest(BaseModel):
    question: str
    entry: Dict[str, Any]
    thread_id: str
    skill_prompt: Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok"}


def _sse_dispatch(generator):
    async def event_gen():
        loop = asyncio.get_event_loop()
        queue = asyncio.Queue()

        def producer():
            try:
                for event in generator:
                    loop.call_soon_threadsafe(queue.put_nowait, event)
            finally:
                loop.call_soon_threadsafe(queue.put_nowait, None)

        loop.run_in_executor(None, producer)

        while True:
            event = await queue.get()
            if event is None:
                break
            yield {"event": event["type"], "data": json.dumps(event["data"], ensure_ascii=False)}
            if event["type"] in ("final", "error"):
                break

    return EventSourceResponse(event_gen())


@app.post("/chat/stream")
def chat_stream(req: ChatStreamRequest):
    kb_id = req.kb_id or "notes"
    agent = get_kb_agent(kb_id)
    return _sse_dispatch(agent.generate(req.thread_id, req.question))


@app.post("/chat/entry")
def chat_entry(req: ChatEntryRequest):
    return _sse_dispatch(ENTRY_AGENT.generate(req.thread_id, req.question, req.entry, req.skill_prompt))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### 6.5 前端 `useAiChat.ts`（关键：SSE 解析）

```typescript
import { ref } from 'vue'

const DEFAULT_BASE_URL = 'http://localhost:8000'

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: string[]
  confidence?: number
  streaming?: boolean
  nodes?: string[]
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function useAiChat() {
  const messages = ref<AiChatMessage[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const threadId = ref(`session-${uid()}`)

  async function send(question: string, entry?: Record<string, unknown> | null, skillPrompt?: string | null, kbId?: string | null) {
    if (!question.trim() || loading.value) return

    const userMsg: AiChatMessage = { id: uid(), role: 'user', content: question }
    const botSeed: AiChatMessage = { id: uid(), role: 'assistant', content: '', streaming: true, nodes: [] }
    messages.value.push(userMsg, botSeed)
    const botMsg = messages.value[messages.value.length - 1]
    loading.value = true
    error.value = null

    const useEntryMode = !!entry && typeof entry.id === 'string'
    const url = useEntryMode ? `${DEFAULT_BASE_URL}/chat/entry` : `${DEFAULT_BASE_URL}/chat/stream`
    const body: Record<string, unknown> = useEntryMode
      ? { question, entry, thread_id: threadId.value, ...(skillPrompt ? { skill_prompt: skillPrompt } : {}) }
      : { question, thread_id: threadId.value, ...(kbId ? { kb_id: kbId } : {}) }

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)

      const reader = resp.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buffer = ''

      const findSep = (s: string) => {
        const a = s.indexOf('\r\n\r\n')
        const b = s.indexOf('\n\n')
        if (a === -1 && b === -1) return { idx: -1, len: 0 }
        if (a === -1) return { idx: b, len: 2 }
        if (b === -1) return { idx: a, len: 4 }
        return a < b ? { idx: a, len: 4 } : { idx: b, len: 2 }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        while (true) {
          const { idx, len } = findSep(buffer)
          if (idx === -1) break
          handleEvent(buffer.slice(0, idx), botMsg)
          buffer = buffer.slice(idx + len)
        }
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      botMsg.content = botMsg.content || `[出错] ${error.value}`
    } finally {
      botMsg.streaming = false
      loading.value = false
    }
  }

  function handleEvent(raw: string, target: AiChatMessage) {
    let evtType = 'message'
    const dataLines: string[] = []
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('event:')) evtType = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
    const data = dataLines.join('\n')
    if (!data) return

    if (evtType === 'node') {
      try {
        const payload = JSON.parse(data) as { node: string }
        if (payload.node && !target.nodes!.includes(payload.node)) target.nodes!.push(payload.node)
      } catch {}
    } else if (evtType === 'final') {
      try {
        const payload = JSON.parse(data)
        target.content = payload.answer ?? ''
        target.sources = payload.sources ?? []
        target.confidence = payload.confidence_score
      } catch {
        target.content = data
      }
    } else if (evtType === 'error') {
      target.content = `[出错] ${data}`
    }
  }

  return { messages, loading, error, send }
}
```

### 6.6 前端 `useRagSync.ts`（业务 ↔ AI 同步）

```typescript
async function post(path: string, body: unknown, timeoutMs = 4000): Promise<void> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const resp = await fetch(`http://localhost:8000${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!resp.ok) console.warn(`[RAG sync] ${path} HTTP ${resp.status}`)
  } catch (e) {
    console.warn(`[RAG sync] ${path} 失败:`, e)
  } finally {
    clearTimeout(t)
  }
}

export function useRagSync() {
  return {
    upsertEntry: (entry: any) => post('/entries/upsert', entry),
    deleteEntry: (id: string) => post('/entries/delete', { id }),
  }
}
```

---

## 七、踩坑清单（每个项目都会遇到）

| # | 现象 | 根因 | 解决 |
|---|---|---|---|
| 1 | `Messages with role 'tool' must be a response to...` | 手动拼 chat_history，丢了中间 tool 消息 | 流结束后 `invoke()` 拿规范化历史 |
| 2 | `[SSL: UNEXPECTED_EOF_WHILE_READING]` 连云端向量库 | 集群跨大洲 | 改区域到亚太，或自建 Docker |
| 3 | `ImportError: cannot import name 'X' from 'config'` | 旧 `__pycache__/config.cpython-X.pyc` 残留 | 别用 `config` 作包名（用 `app_config` / `src.config`），清缓存 |
| 4 | `AgentExecutor not found` | 装的是 LangChain 0.x | `pip install -U "langchain>=1.0"`，改用 `create_agent` |
| 5 | Qdrant 集合维度不匹配 | 换 Embedding 模型后没重建 | `client.delete_collection(name)` 重新跑 |
| 6 | SSE 一直「思考中」不显示结果 | 前端按 `\n\n` 切，后端发 `\r\n\r\n` | 解析器同时支持两种分隔符 |
| 7 | Vue 更新闭包变量但 UI 不刷新 | push 后闭包持有原对象，不是响应式代理 | `messages.value[messages.value.length - 1]` 取代理引用 |
| 8 | TS 报 `Property 'at' does not exist` | tsconfig target 不够新 | 改 `arr[arr.length - 1]` |
| 9 | TS 报 `'confirm' does not exist` | template 不能直接用全局 `confirm()` | setup 里 `function confirmAsk(m) { return window.confirm(m) }` |
| 10 | Windows 终端打印 emoji 报 `UnicodeEncodeError` | GBK 不认 emoji | print 不用 emoji；或 `sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')` |
| 11 | SiliconFlow 调用返回 401 | Key 拼错 / 末尾换行 | 检查 `.env` 末尾空白 |
| 12 | CORS 错 | FastAPI 默认不开 | `app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)` |
| 13 | 浏览器 405 Method Not Allowed | 直接 GET `/chat/stream` | 提示用 `/docs` 或写聊天 UI |
| 14 | LLM 调用挂在 stream | 启动时 streaming=False，调用 stream() | `build_llm(streaming=True)` |
| 15 | 上传大 PDF OOM | 一次性 embed | `embed_texts` 加 `batch_size=32` |
| 16 | `.env` 不小心 commit | .gitignore 漏配 | 立即 revoke key + `git filter-repo` 清历史 |
| 17 | `.env.example` 直接被改成真 key | 复制粘贴时手快 | 推之前 `grep -r "sk-"` 全项目扫一遍 |
| 18 | Port 8000 already in use | 旧 uvicorn 没关 | `netstat -ano | grep :8000` → `taskkill /PID <pid> /F` |

---

## 八、可选扩展（按需开关）

| 扩展 | 工程量 | 何时做 |
|---|---|---|
| **LangSmith Tracing** | 5 分钟 | 调试 / 量化 token 成本 |
| **自建 Qdrant Docker** | 10 分钟 | 不想付云费 / 出境合规 |
| **Skill 系统** | 半天 | 想让用户自定义 AI 行为 |
| **桌面端 Electron** | 半天 | 想脱离浏览器 |
| **多知识库** | 1 天 | 用户要按主题隔离 |
| **DeepSeek Prompt Caching** | 半天 | token 成本爆了 |
| **Reranker (CrossEncoder)** | 半天 | 文档密集 KB 召回不准 |
| **Ragas 自动评测** | 1 天 | 想量化 RAG 质量 |
| **Redis 多用户 Session** | 1 天 | 多 worker 横向扩容 |
| **HyDE / 子问题拆解** | 1-2 天 | 复杂问题召回不准 |
| **OCR 扫描 PDF** | 1-2 天 | 需要图片型文档 |
| **多模态（图片索引）** | 3-5 天 | 业务对象含截图/手写 |
| **OpenTelemetry 追踪** | 2-3 天 | 部署到生产环境 |

---

## 九、安全清单（推 git 前必查）

```bash
# 1. 检查 .gitignore 是否覆盖密钥
grep -E "^\.env$" .gitignore || echo "❌ 漏了 .env"

# 2. 扫全项目是否有真实 key 残留
grep -rE "sk-[a-zA-Z0-9]{30,}" --include="*.py" --include="*.ts" --include="*.vue" --include="*.md" .
# 应该只在 .env 里找到（被 ignore 了），其他地方都该是占位符

# 3. 看 git 即将提交的内容
git status
git diff --cached

# 4. .env.example 必须脱敏
cat .env.example | grep -E "sk-|password|secret|token"
# 应该都是 your-xxx-here 这样的占位符

# 5. 首选 Private 仓库
gh repo create <name> --private --source=. --push
```

---

## 十、典型对话流程（喂给 AI 时这样开场）

```
你好，我要用《AI Agent + 应用开发通用框架蓝本（云原生版）》搭一个项目。

业务主题：宠物健康记录助手
核心数据对象：每条记录有 宠物名/日期/症状/诊疗记录/食物/标签
特殊要求：
1. 单机本地运行 UI，但 AI 后端走云端
2. 支持图片附件（疫苗本扫描件）— 后续上 OCR

请按框架第三章给我目录结构（业务名为 pet-care），
然后第四章拆解 KbAgent 的工具要做什么（除了默认 query 还要不要 find_by_date），
然后第六章给出 src/agent.py 和 src/api.py 的具体代码（把 NoteEntry 换成 PetRecord）。
完成后告诉我下一步该装什么依赖、申请哪些云账号。
```

AI 会顺着这个 prompt：
1. 输出适配你业务的目录树
2. 列出工具（含 `find_by_date(date)` 之类）
3. 给出 `PetRecord` 类型 + Pydantic schema
4. 给出 `requirements.txt`
5. 提示你下一步装依赖、申请 DeepSeek + SiliconFlow + Qdrant 三个云账号

---

## 十一、复盘 · 这套框架解决了什么

| 痛点 | 解决方式 |
|---|---|
| LLM 输出不结构化、前端难解析 | SSE 流式 + 明确的 `final` JSON payload |
| 答案幻觉 | 检索 + 工具结果显式展示 + system prompt 约束 |
| 召回不准 | BGE-large-zh 默认就够（差时加 reranker） |
| 多轮对话丢上下文 | LangChain `create_agent` + 内存 history（接 Redis 可分布式） |
| API 抖动用户体验差 | 重试 + 异常兜底 + 明确错误前缀 |
| 业务数据和 AI 索引不同步 | 业务保存 hook 静默触发 upsert |
| 用户想调教 AI 行为 | Skill 系统 + 可视化编辑器 |
| 数据按主题隔离 | 多知识库 + 独立 collection |
| 桌面端发布 | Electron + electron-builder |
| 密钥泄露 | .env + .gitignore + 推前扫描 |
| 本地下模型麻烦 | 全云端，0 本地依赖 |
| 跨平台兼容 | HTTP API，平台无关 |

---

## 十二、参考资料（持续更新）

- [LangChain 1.x 文档](https://docs.langchain.com/oss/python/langchain/agents)
- [DeepSeek API 文档](https://api-docs.deepseek.com/)
- [SiliconFlow 文档](https://docs.siliconflow.cn/)
- [Qdrant Python Client](https://github.com/qdrant/qdrant-client)
- [Qdrant Cloud 文档](https://qdrant.tech/documentation/cloud/)
- [FastAPI + SSE 教程](https://fastapi.tiangolo.com/)
- [Vue 3 Composition API](https://vuejs.org/guide/extras/composition-api-faq.html)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Electron 文档](https://www.electronjs.org/docs/latest/)

---

> 本框架来源于真实生产 MVP 项目 `notes-app + RAG-AIAgent`，已经过端到端联调验证。
> 复用时记得替换业务实体名、调整 system prompt、按你的数据领域选 Embedding 模型。
