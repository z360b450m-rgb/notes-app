# notes-app + RAG-AIAgent 完整技术档案

> 错题本桌面应用 + 云原生 RAG Agent 后端的完整技术架构。**前端**在本目录，**后端**在并列的 `RAG-AIAgent/` 目录。

---

## 一、项目结构

```
notes-app/                          # 前端 Electron + Vue 应用
└── src/
    ├── components/                 # Vue 组件层
    ├── composables/                # 组合式逻辑 (Vue 3 composable)
    ├── services/                   # 数据持久化层
    ├── types/                      # TypeScript 类型
    └── utils/                      # 工具函数

RAG-AIAgent/                        # 后端 Python RAG 服务（云原生）
├── .env                            # DeepSeek + SiliconFlow + Qdrant 三套密钥
├── requirements.txt
├── data/
│   ├── kb_registry.json            # 知识库注册表
│   └── <kb_id>/                    # 各知识库源文档
└── src/
    ├── config.py                   # 环境变量 + 集合命名 (rag_kb_<kb_id>)
    ├── llm.py                      # DeepSeek (ChatOpenAI) + SiliconFlow Embedding
    ├── vector_store.py             # Qdrant 客户端 + 重试 + 每 KB 独立 collection
    ├── prompt.py                   # 三套 system prompt 集中管理
    ├── kb.py                       # 知识库注册表 + JSON 持久化
    ├── entries.py                  # 错题切 3 chunk + 跨 KB upsert/delete
    ├── ingest.py                   # 扫 data/<kb_id>/ 入库 PDF/TXT/MD
    ├── agent.py                    # KbAgent (create_agent) + EntryAgent
    └── api.py                      # 10 个 REST + SSE 端点
```

**没有**：本地 `chroma_db/`、`checkpoints.sqlite`、`sentence-transformers` 缓存等本地存储 —— 全部托管在云上。

---

## 二、技术栈

### 前端 (notes-app)

| 类别 | 技术 | 版本 / 说明 |
|---|---|---|
| 框架 | **Vue 3** | Composition API + `<script setup>` |
| 桌面壳 | **Electron 42** | 跨平台桌面应用 |
| 构建工具 | **Vite 6** | 开发服务器 + 打包 |
| 语言 | **TypeScript** | strict mode |
| 样式 | **Tailwind CSS 3.4** | dark mode |
| 本地存储 | **IndexedDB** | 错题主数据 (`db.ts`) |
| 偏好存储 | **localStorage** | AI Skills / 选中 KB |
| 代码规范 | ESLint + Prettier + Husky | Git hook 自动格式化 |
| 网络 | 原生 **fetch + ReadableStream** | 手写 SSE 解析，0 额外 HTTP 依赖 |
| 安全消毒 | **DOMPurify + marked** | 富文本 XSS 防护 |

### 后端 (RAG-AIAgent)

| 类别 | 技术 | 用途 |
|---|---|---|
| 语言 | **Python 3.11+** | |
| Web 框架 | **FastAPI** | REST + SSE 端点 |
| ASGI | **Uvicorn** | 单 worker 起步 |
| 流式响应 | **sse-starlette** | Server-Sent Events |
| Agent 编排 | **LangChain 1.x `create_agent`** | 内置状态机，0 LangGraph 手装 |
| LLM 客户端 | **langchain-openai** | OpenAI 兼容协议接 DeepSeek |
| 校验 | **Pydantic 2** | 请求体 / Schema |
| CORS | **FastAPI CORSMiddleware** | 开发期全开 |
| 环境配置 | **python-dotenv** | `.env` 加载 |

### 模型与算法依赖

| 类别 | 选型 | 备注 |
|---|---|---|
| 主 LLM | **DeepSeek `deepseek-chat`** | `https://api.deepseek.com/v1`，OpenAI 兼容 |
| 中文 Embedding | **BAAI/bge-large-zh-v1.5** (via SiliconFlow) | 1024 维，**远程调用**，无本地下载 |
| 向量库 | **Qdrant Cloud** | 全托管，免费 1GB，**每个 KB 一个 collection** |
| 文档切分 | **LangChain RecursiveCharacterTextSplitter** | chunk_size=500, overlap=80 |
| PDF 解析 | **pypdf** | 按页提取文本（文字层 PDF） |

**关键变化**（vs 旧设计）：

| 旧 | 新 |
|---|---|
| 本地 sentence-transformers + bge-small-zh-v1.5 模型 (~100MB) | SiliconFlow 远程 BGE-large-zh-v1.5 |
| Chroma 本地文件 + 多 collection | Qdrant Cloud + 每 KB 一个 collection |
| Reranker (bge-reranker-base CrossEncoder) | 暂未启用（依赖召回质量 + LLM 自筛） |
| BM25 关键词检索 | 暂未启用（纯向量召回 + agent 自决策弥补） |
| LangGraph 5 节点状态机 | LangChain 1.x `create_agent`（内置 tool-calling loop） |
| LangChain checkpoint SQLite | 内存 dict 持久化对话（每会话 thread_id × kb_id 隔离） |
| 重排 + 评分 + fallback 三道节点 | 单一 agent + 工具函数描述驱动 LLM 决策 |

---

## 三、核心算法

### 1. 两种 Agent 模式

```
┌────────────────────────────────────────────────────────────┐
│ KbAgent — 全库 RAG，工具决策                                │
│                                                            │
│  LangChain create_agent (CompiledStateGraph 内部)          │
│    ├── LLM 决策：闲聊 → 直接答                              │
│    └── LLM 决策：要查 → 调 query_knowledge_base 工具         │
│         └── SiliconFlow embed → Qdrant 搜索 → 拼上下文      │
│              └── LLM 再次生成最终答案                        │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│ EntryAgent — 锁定单道错题，无检索                            │
│                                                            │
│  System Prompt 拼装：                                       │
│    ENTRY_LOCKED_PROMPT + 当前错题完整内容 + 可选 skill_prompt│
│    ↓                                                       │
│  LLM 流式生成（"思路 → 正确答案 → 易错点" 三段）              │
└────────────────────────────────────────────────────────────┘
```

| 模式 | 端点 | 何时用 | 是否检索 |
|---|---|---|---|
| **锁定错题** | `POST /chat/entry` | 用户打开某道错题在 AI 侧栏问 | 否（错题原文已塞 prompt） |
| **全库 RAG** | `POST /chat/stream` | 用户在错题本上不绑定具体错题时问 | 是（agent 自决策） |

### 2. Agent 决策由 system prompt 驱动

```python
# src/prompt.py
AGENT_SYSTEM_PROMPT = """你是一位严谨的学习助手...

你有一个工具 `query_knowledge_base(query)`，可以在当前知识库里做语义检索。

规则：
1. 用户闲聊（打招呼 / 道谢 / 总结刚才对话）→ 直接回答，不要调工具。
2. 用户问知识库内容（"这题怎么做"/"X 是什么"/"查一下 Y"）→ 调 query_knowledge_base。
3. 工具返回的 chunks 不相关或为空 → 诚实说"知识库里没找到相关内容"。
4. 引用知识库内容时简要标注来源（如"来自错题 #abc123"）。
5. 答案要简洁、聚焦学生需求；解题题答出"思路+答案+易错点"三段。"""
```

**关键**：所有 tool_calls / tool_call_id 配对、消息顺序、状态机流转都由 `CompiledStateGraph` 内部托管，业务代码**不手动拼 messages**。

### 3. 检索：纯向量召回 + 来源标注

```
查询 query
   ↓
SiliconFlow embedding (BGE-large-zh, 1024 维)
   ↓
Qdrant top_k=6 检索（cosine 相似度）
   ↓
按 entry_title → source 优先级标注来源
   ↓
拼成 markdown 上下文返回给 LLM
```

**为什么去掉 BM25 / Reranker**：
- BGE-large-zh 召回质量已经显著优于 small 版本
- agent 模式下，LLM 看 chunks 自己会过滤掉无关内容（隐式重排）
- 简化栈，少装一份 ML 模型（在云原生场景下意义更大）
- 真有相关性问题再加 reranker（rerank 节点可以加在 query_knowledge_base 工具内部）

### 4. 错题 → RAG 的双向同步

```
notes-app（前端）保存错题
   ↓
useRagSync.upsertEntry(entry)（4 秒超时 / 静默失败）
   ↓
POST /entries/upsert
   ↓
EntrySync.upsert：
  1. 遍历所有 KB，按 entry_id 删除旧 chunks（处理跨 KB 迁移）
  2. 切成 3 个 chunks：题目 / 正确答案 / 错误答案
  3. SiliconFlow 批量 embed
  4. 用 UUID5(entry_id+chunk_index) 作为稳定 ID 写入 Qdrant
```

**切分策略**（每个错题最多 3 chunks）：

```python
def _build_chunks(entry):
    push(entry["question"], "题目")
    push(entry["correctAnswer"], "正确答案")
    push(entry["wrongAnswer"], "错误答案")
```

每个 chunk 的 metadata：

```json
{
  "source": "entry:abc123",
  "entry_id": "abc123",
  "entry_title": "概率题 - 二项分布",
  "entry_subject": "数学",
  "entry_tags": "概率,二项分布",
  "entry_source": "高考模拟卷",
  "kind": "题目|正确答案|错误答案",
  "chunk_index": 0,
  "text": "[标题]（学科） 题目: 实际内容..."
}
```

**为什么切 3 chunks 而不是 1 个长 chunk**：
- 用户问"这题易错点" → 检索时"错误答案" chunk 相关度最高
- 用户问"正确解法" → "正确答案" chunk 相关度最高
- 细粒度召回提升精度

### 5. 跨 KB 数据迁移

错题在 KB 间换归属时（前端改 `entry.kbId`）：

```python
def upsert(self, entry):
    # 先遍历所有 KB，删除这个 entry_id 的旧 chunks
    for kb in REGISTRY.list():
        self.vector_store.delete_by_entry(kb["id"], entry["id"])
    # 再写到目标 KB
    self.vector_store.add_chunks(entry["kbId"], ...)
```

这样无论用户怎么改归属，都不会产生 KB 间的 chunk 残留。

### 6. SSE 流式协议

```
event: node\r\n
data: {"node": "route_question"}\r\n
\r\n
event: node\r\n
data: {"node": "retrieve"}\r\n
\r\n
event: node\r\n
data: {"node": "generate_answer"}\r\n
\r\n
event: final\r\n
data: {"answer": "...", "sources": ["错题标题1", "错题标题2"], "confidence_score": 0.85}\r\n
\r\n
```

前端用 `fetch + ReadableStream` 手写解析，**同时兼容 `\r\n\r\n` 和 `\n\n`** 分隔符。

### 7. 多知识库

- 每个 KB = 独立 Qdrant collection `rag_kb_<kb_id>` + 独立 `data/<kb_id>/` 物理目录
- `kb_registry.json` 存元数据（id / name / description / created_at / is_default）
- 默认 `notes` 错题库不可删
- 删除 KB → 删 collection，**保留物理目录**防误删

### 8. 重试与降级

| 失败场景 | 策略 |
|---|---|
| Qdrant 网络抖动 / SSL 断 | `@_retry()` 装饰器：4 次指数退避 (0.5/1/2/4s) |
| SiliconFlow 限流 / 抖动 | OpenAI SDK 内置 max_retries=2 |
| LLM 调用失败 | `build_llm(max_retries=2)` + try/except → 流回 error 事件 |
| Qdrant collection 不存在 | `ensure_collection()` 自动创建 |
| KB 不存在 | API 层 raise 404 |
| 浏览器 GBK 终端 / `print` emoji | `sys.stdout = TextIOWrapper(..., encoding='utf-8', errors='replace')` |

### 9. 数据同步策略

| 触发 | 行为 |
|---|---|
| 错题保存 (`saveEntry`) | `POST /entries/upsert` —— 先全 KB 删旧 chunk，再写到目标 KB |
| 错题删除 (`deleteCurrent`) | `POST /entries/delete` —— 全 KB 删 |
| 错题改名 (`updateEntryTitle`) | `POST /entries/upsert` |
| KB 切换 | upsert 自动处理跨库迁移，不留残留 |
| 失败 | 静默 + `console.warn`，**不阻塞 IndexedDB 主流程** |

---

## 四、功能总览

### 1. notes-app 错题本

完整功能见 [FEATURES.md](./FEATURES.md)。核心：

- 多 Notebook + 错题 CRUD + 富文本编辑 + 图片粘贴/截图/拍照
- Canvas 手写绘图 + 复习模式 + SRS 间隔重复 + 复习历史
- 多 KB 切换 + PDF 批量导入 + 数据备份导出
- 暗黑模式 + 桌面 / Web 双模式

### 2. RAG 智能问答 ⭐

**两种问答模式**

| 模式 | 端点 | 检索 |
|---|---|---|
| **锁定当前错题** | `POST /chat/entry` | 否（错题原文做唯一上下文） |
| **全库 RAG** | `POST /chat/stream` | 是（agent 自决策） |

**侧栏 UI**

- 编辑模式自动出现 340px 侧栏
- 头部胶囊显示「当前错题 / 全库」scope
- 全库模式头部下拉切换 KB
- 流式输出 + 节点进度展示 + 来源 details 折叠
- 置信度显示
- 切换错题自动清空对话防串题

### 3. AI 指令库 / Skill 系统

- 输入 `/<触发词> <问题>` 触发自定义 system prompt
- localStorage 持久化
- 内置 3 个示例：`/讲解`（苏格拉底引导）、`/答`（极简）、`/口诀`（记忆口诀）
- 可视化编辑器（设置面板内）：名称 / 触发词 / 描述 / 适用范围 / system prompt
- 启用复选框 / 删除 / 重置
- JSON 导入导出（跨设备迁移）
- 输入框实时显示「✓ 已应用 XX」+ 可用指令速查列表
- skill 与默认 prompt 是**追加关系不是覆盖**，保留 RAG 上下文

### 4. 多知识库系统

- 每个 KB = 独立 Qdrant collection (`rag_kb_<id>`) + 独立 `data/<id>/` 目录
- 设置面板「知识库」区：列表 / 新建 / 改名 / 删除 / 复制路径到剪贴板 / 一键重建索引
- 默认 `notes` 错题库不可删
- 错题编辑页 📚 下拉选择归属 KB
- 全库聊天模式头部 📚 下拉切换检索范围
- KB 切换后聊天自动清空
- 删除 KB 自动清 collection 数据但**保留物理文件夹**防误删
- 跨 KB 错题迁移：upsert 自动清旧 chunk

### 5. 文档入库

- 支持 `.md` / `.txt` / `.markdown` / `.pdf`
- 命令行：`python -m src.ingest --kb <id> --reset`
- 或 HTTP：`POST /ingest {kb_id, reset}` —— 设置面板「重建」按钮
- 不带 reset 时按文件名 dedupe（先删同 source 再写）

### 6. 会话持久化

- 内存 dict 存 `{thread_id × kb_id: List[BaseMessage]}`
- 锁定错题模式按 `entry_id` 隔离
- 重启服务后清空（生产化要接 Redis）
- 前端 `notes-${uid}` 自动生成会话 ID

### 7. 跨域 / 工程化

- FastAPI CORS 全开（开发期）
- TypeScript 严格类型检查（vue-tsc）
- 前端零新增 HTTP 依赖（原生 fetch + SSE）
- `.env.example` + 路径常量集中管理
- `.env` 严格 gitignore，绝不入库

---

## 五、关键 API 速查

所有端点对接前端 `useAiChat.ts` / `useRagSync.ts` / `useKnowledgeBases.ts`，契约 100% 严格一致。

| 端点 | 方法 | 用途 |
|---|---|---|
| `/health` | GET | 健康检查 |
| `/chat/stream` | POST | SSE 全库 RAG（带 kb_id） |
| `/chat/entry` | POST | SSE 锁定单题问答（支持 skill_prompt） |
| `/entries/upsert` | POST | 错题同步入 RAG（带 kbId） |
| `/entries/delete` | POST | 错题从 RAG 删除（跨 KB） |
| `/ingest` | POST | 文档入库（kb_id + reset） |
| `/kbs` | GET / POST | 知识库列表 / 新建 |
| `/kbs/<id>` | PATCH / DELETE | 改名 / 删除 |
| `/kbs/<id>/data-dir` | GET | 取该 KB 的本地数据目录绝对路径 |

请求体 / SSE 事件格式见 `src/api.py` 的 Pydantic Schema 定义。

---

## 六、数据流图

```
┌────────────────┐  保存错题   ┌────────────────┐  upsert   ┌──────────────────┐
│   NoteEditor   │ ─────────► │   IndexedDB    │ ────────► │ Qdrant (cloud)   │
│  (kbId 下拉)   │            │  useEntries.ts │           │ rag_kb_<kb_id>   │
└───────┬────────┘            └────────────────┘           └──────────┬───────┘
        │                                                              │
        │  打开错题                                                    │
        ▼                                                              │
┌────────────────┐  /chat/entry   ┌─────────────────────────────────┐ │
│ AiChatSidebar  │ ────────────► │  FastAPI + LangChain + DeepSeek │ │
│ (KB 选 / skill)│ ◄──── SSE ──── │  (锁定模式：无检索)              │ │
└───────┬────────┘                └─────────────────────────────────┘ │
        │  全库提问                                                    │
        ▼                                                              │
┌────────────────┐  /chat/stream  ┌─────────────────────────────────┐ │
│ AiChatSidebar  │ ────────────► │ FastAPI + create_agent + tool    │ │
│ (KB 选)        │ ◄──── SSE ──── │  ├─ query_knowledge_base ◄──────┼─┘
│                │                │  │     embedding → Qdrant 搜索   │
│                │                │  └─ LLM 基于结果生成答案          │
└────────────────┘                └─────────────────────────────────┘
                                              │
                                  ┌───────────┴───────────┬─────────────┐
                                  ▼                       ▼             ▼
                            ┌──────────┐         ┌──────────────┐ ┌──────────┐
                            │ DeepSeek │         │ SiliconFlow  │ │ Qdrant   │
                            │  LLM     │         │  Embedding   │ │  Cloud   │
                            │  (云)    │         │     (云)     │ │  (云)    │
                            └──────────┘         └──────────────┘ └──────────┘
```

---

## 七、扩展实施指南

按工程量从小到大排列，每一项给出：**目标 / 改哪些代码 / 关键变更点 / 工程量估计**。

### 7.1 全库模式接入 Skill（小）

**目标**：现在 `/<触发词>` 只在锁定模式生效，让全库 RAG 也能用 skill。

| 文件 | 改动 |
|---|---|
| `src/api.py` | `ChatStreamRequest` 加 `skill_prompt: Optional[str]` |
| `src/agent.py` | `KbAgent.generate(skill_prompt=None)`，命中时拼到 system prompt 末尾 |
| `src/composables/useAiChat.ts` | 去掉现有 `useEntryMode` 限制，全库模式也传 `skill_prompt` |

**注意**：skill 是追加到默认 system 末尾，不是替换 —— 防止丢掉 RAG 上下文约束。

**工程量**：~30 行，1 小时内。

---

### 7.2 LangSmith 追踪（小）

**目标**：可视化每次问答的全链路调用、token 消耗、节点耗时。

| 文件 | 改动 |
|---|---|
| `.env.example` | 加 `LANGCHAIN_TRACING_V2=true` / `LANGCHAIN_API_KEY=...` / `LANGCHAIN_PROJECT=notes-app` |
| `requirements.txt` | 加 `langsmith` |
| `src/config.py` | 启动时检查环境变量并 `print` 提示已开启 tracing |
| 无需改其他代码 | LangChain 自动捕获所有 chain/llm 调用 |

**工程量**：~5 行配置 + 注册 LangSmith 账号，半天。

---

### 7.3 切换到自建 Qdrant（小）

**目标**：成本零 / 数据不出境 / 完全离线。

| 文件 | 改动 |
|---|---|
| `docker-compose.yml`（新建） | 起一个 Qdrant 容器：`image: qdrant/qdrant`，端口 6333 |
| `.env` | `QDRANT_URL=http://localhost:6333`，留空 `QDRANT_API_KEY` |
| `src/vector_store.py` | 无需改 —— 接口一致 |

**坑**：需要本地装 Docker Desktop。

**工程量**：10 分钟。

---

### 7.4 重新加入 Reranker（中）

**目标**：检索质量提升，特别在文档密集 KB 上。

| 文件 | 改动 |
|---|---|
| `requirements.txt` | 加 `sentence-transformers` `torch` |
| `src/llm.py` | 加 `Reranker` 类，懒加载 `BAAI/bge-reranker-base` CrossEncoder |
| `src/agent.py` | `query_knowledge_base` 工具内：先召回 top_k=20，再 rerank 取 top_k=6 |
| `src/config.py` | 加 `RERANKER_ENABLED` / `RERANKER_MODEL` 环境变量 |

**注意**：模型加载失败要 fallback 用原始向量序，不能阻塞链路。重新引入本地模型会让镜像变大 ~150MB。

**工程量**：~100 行，半天。

---

### 7.5 OCR 扫描件 PDF（中）

**目标**：图片型 PDF 也能入库。

| 文件 | 改动 |
|---|---|
| `requirements.txt` | 加 `paddleocr>=2.7` 或 `pytesseract` |
| `src/ingest.py` | `_load_pdf`：先 `page.extract_text()`，空字符串则用 `pdfplumber` 提图 + OCR |
| `src/config.py` | 新增 `OCR_ENABLED` 环境变量 |
| 新增 `src/ocr.py` | OCR 单独模块，封装初始化（重资源，要 `lru_cache`） |

**注意**：PaddleOCR 首次跑会下 ~50MB 模型；速度比纯 pypdf 慢 100x，**只在 pypdf 提取为空时兜底**。

**工程量**：~150 行 + 模型下载，1-2 天。

---

### 7.6 Ragas 自动评测（中）

**目标**：跑测试集，量化 faithfulness（忠实度）/ answer relevancy / context precision 等指标。

| 文件 | 改动 |
|---|---|
| 新增 `evals/dataset.json` | 50-100 条 `{question, ground_truth}` |
| 新增 `evals/run_evals.py` | 跑 dataset → 调 `/chat/stream` → 收集 `{question, answer, contexts, ground_truth}` → 喂给 ragas |
| `requirements.txt` | 加 `ragas>=0.2` `datasets` |
| 新增 `evals/report.md` | 生成 markdown 报告 |

**工程量**：构造测试集是大头（要手写 ground truth），代码本身半天。

---

### 7.7 Redis 多用户 Session（中）

**目标**：会话历史从内存挪到 Redis，支持多 worker 横向扩展。

| 文件 | 改动 |
|---|---|
| `requirements.txt` | 加 `redis` |
| 新增 `src/session_store.py` | 用 `redis.from_url(REDIS_URL)`，序列化 BaseMessage 列表 |
| `src/agent.py` | 把 `_HISTORIES` dict 换成 `SessionStore.load/save` |
| `.env` | 加 `REDIS_URL=redis://localhost:6379` |
| `docker-compose.yml` | 加 redis 容器 |

**工程量**：~80 行，半天。

---

### 7.8 多模态（图片 / 表格独立索引）（大）

**目标**：错题里的图（截图、手写、几何图）也能被检索。

| 文件 | 改动 |
|---|---|
| `notes-app/src/types/index.ts` | `NoteEntry` 已有 `drawing?: string`，复用 |
| `src/entries.py` | `EntryUpsertPayload` 加 `images: List[str]`（data URL 列表）；upsert 时调用 vision 模型生成 caption 写入 chunk |
| `src/config.py` | 加 vision LLM（`qwen-vl-max`，要走非 DeepSeek 接口） |
| 新增 `src/multimodal.py` | 图片 → caption / OCR 文本提取 |
| 新增独立 collection `rag_kb_<id>_images` | 图描述独立向量库，检索时合并两路结果 |

**前端配套**：`useRagSync.ts` 上传时把 `entry.drawing` 也塞进 payload。

**工程量**：~400 行 + vision 模型成本评估，3-5 天。

---

### 7.9 知识库导入 PDF UI（小，但用户感知大）

**目标**：在设置面板「知识库」区直接拖拽上传 PDF，不用手动拷文件。

| 文件 | 改动 |
|---|---|
| `src/api.py` | 新增 `POST /kbs/<id>/upload`，接受 `multipart/form-data`，保存到 `data/<id>/`，然后调 `ingest_kb` |
| `notes-app/src/components/KnowledgeBaseManager.vue` | 每个 KB 行加 `<input type="file" multiple accept=".pdf,.md,.txt">`；选择文件后 `FormData` 上传 |
| `notes-app/src/composables/useKnowledgeBases.ts` | 加 `async upload(kbId, files: File[])` 方法 |

**工程量**：~100 行，半天。

---

### 7.10 错题批量迁移到别的库（小）

**目标**：选中多个错题一次性移到另一个 KB。

| 文件 | 改动 |
|---|---|
| `notes-app/src/components/BatchBar.vue` | 已有批量选择 UI，加「移到 KB」按钮 |
| `notes-app/src/composables/useEntries.ts` | 加 `bulkMoveToKb(ids: string[], kbId: string)`：循环改 `entry.kbId` → db.put → `ragSync.upsertEntry` |
| 无需后端改动 | upsert 端点已经处理跨 KB 迁移 |

**工程量**：~60 行，半天。

---

## 八、扩展建议优先级

按"投入 / 收益"排序：

1. **7.2 LangSmith Tracing** — 5 分钟，调试效率指数级提升
2. **7.3 切自建 Qdrant** — 10 分钟，免运维 + 免出境合规风险
3. **7.9 PDF 拖拽上传 UI** — 半天，体验大幅提升
4. **7.1 全库模式接 Skill** — 1 小时，对称性补齐
5. **7.6 Ragas 评测** — 1 天，建立质量基线
6. **7.4 Reranker** — 半天，文档密集 KB 效果显著
7. **7.7 Redis Session** — 半天，准备生产化
8. **7.10 批量迁移** — 半天，用户增长后的刚需
9. **7.5 OCR PDF** — 1-2 天，特定场景刚需
10. **7.8 多模态** — 3-5 天，质变功能

---

## 九、扩展面（其他想到没想到的方向）

- 知识库**共享 / 同步**（云端备份 KB 元数据 + 文档）
- 错题**自动标注**（AI 看完错题自动生成 tags / subject）
- 错题**相似度推荐**（基于 embedding 相似度推送相关题）
- **跨用户 Skill 市场**（Skill JSON 上传 / 下载 / 评分）
- 复习时调 AI 生成**变式题**（基于错题原题生成同知识点新题）
- 错题**知识图谱**（提取实体 + 关系，可视化学科网络）
- 语音输入（Web Speech API → 转文本 → 调 RAG）
- 移动端适配（Capacitor 或纯 PWA）
- HyDE / 子问题拆解（复杂多跳问题召回提升）
- DeepSeek Prompt Caching（长上下文命中能省 ~90% token 成本）

---

整套系统已经从单文件原型走到 **生产级 MVP**：覆盖了云端 LLM / 云端 Embedding / 云端向量库、Agent 决策、双模式问答、流式接口、多会话、多知识库、错题同步、Skill 调教、桌面端 UI 完整闭环。后续扩展按上面 7 / 8 章节路线图推进即可。
