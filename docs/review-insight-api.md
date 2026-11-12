# 单题复习卡片接口

图片中的复习卡片对应以下接口，均要求登录，使用
`Authorization: Bearer <token>`。题目必须属于当前账号；题目不存在或属于其他账号
均返回 404。查看卡片不依赖 RAG 服务，也不修改复习数据。

当前“让助手安排复习”按钮已改用关联组题和确认接口，见 [关联复习题组](related-review-bundle.md)。
“学习此题知识点”继续调用下文的流式单题助手。原单题 arrange_review 接口保留兼容。

## 获取卡片

`GET /api/entries/{entry_id}/review-insight`

不需要请求体。即使题目安排在未来，也可以查看。首次查看的主要返回字段：

```json
{
  "entry_id": "entry-123",
  "notebook_id": "notebook-123",
  "as_of": "2026-10-13T10:00:00+08:00",
  "timezone": "Asia/Shanghai",
  "review_count": 0,
  "wrong_count": 0,
  "status": { "code": "unreviewed", "label": "尚未复习" },
  "recommendation": "先完成一次独立作答",
  "importance": {
    "code": "unassessed",
    "label": "尚未评估",
    "weight": null,
    "basis": "当前没有经过确认的教学重要性评估。"
  },
  "evidence": {
    "review_count": 0,
    "wrong_count": 0,
    "judged_count": 0,
    "recent_wrong_count": 0,
    "recent_judged_count": 0,
    "observed_error_rate": null,
    "explanation": "暂无作答记录，暂不判断个人薄弱程度。"
  },
  "risk": {
    "probability": null,
    "source": "beta_binomial",
    "model_version": null,
    "fallback_reason": "model_missing",
    "evidence_count": 0,
    "confidence": "no_record",
    "validated": false,
    "displayable": false
  },
  "due_status": "unscheduled",
  "next_review_date": null,
  "knowledge_points": [],
  "estimated_seconds": 300,
  "time_estimate_source": "default",
  "review_steps": ["独立作答", "核对关键步骤", "复述方法"],
  "review_hint": "复习安排提示：独立作答 → 核对关键步骤 → 复述方法。",
  "actions": [
    { "action": "arrange_review", "label": "让助手安排复习" },
    { "action": "learn_knowledge", "label": "学习此题知识点" }
  ]
}
```

页面字段映射：

| 图片区域 | 返回字段 |
| --- | --- |
| 复习次数、答错次数 | `review_count`、`wrong_count` |
| 右上角状态 | `status.label` |
| 复习建议 | `recommendation` |
| 教学重要性 | `importance.label` |
| 判断依据 | `evidence.explanation` |
| 底部安排提示 | `review_hint` |
| 两个按钮 | `actions` |

统计复用现有复习候选接口：复习次数取已保存累计次数与有效历史记录数的较大值；
只有 `is_correct=false` 才计入答错次数。未来日志不统计，未判定对错的记录不进入
错误率分母；近期记录指最近 30 天。掌握评级不代表对错。

`status.code` 有四种状态：

| code | 条件 | 展示 |
| --- | --- | --- |
| `unreviewed` | 无复习记录，也无已判定作答 | 尚未复习 |
| `unjudged` | 有累计复习次数，但无已判定作答 | 待判定对错 |
| `needs_review` | 有已判定作答，预测错误概率 ≥ 0.6 | 建议复习 |
| `consolidate` | 有已判定作答，预测错误概率 < 0.6 | 继续巩固 |

0.6 是展示建议的规则阈值。`risk` 复用已通过评估的 DAS3H 模型或
Beta-Binomial 回退估计，`evidence.observed_error_rate` 才是历史实际错误率。
没有已判定作答时 `risk.probability=null`、`displayable=false`，即使有模型也不显示
个人风险。`due_status` 单独描述排期，可为 `overdue/today/unscheduled/future`。

首次读取没有缓存时，`importance` 返回尚未评估与空权重；已有有效评估时返回 AI 建议。
不会根据个人答错次数把教学重要性自动评为高。知识点返回已有题目标签，尚未经过
独立知识点审核；讲解时会要求助手区分已有标签与从题目推断的知识点。

## 评估教学重要性

`POST /api/entries/{entry_id}/review-importance`

无需请求体，返回完整 `ReviewInsight`，可直接替换当前卡片数据。
业务后端调用查询服务的 `POST /review/importance`；仅转发题目 ID 和登录凭证，
查询服务重新验证身份并从业务库读取该用户的真实题目。

`importance` 增加以下字段：

```json
{
  "code": "foundational",
  "label": "基础关键方法（AI 建议）",
  "weight": 1.25,
  "basis": "说明原文如何支持这一建议",
  "evidence": ["题干、参考答案或公共材料中的逐字引文"],
  "source": "ai_suggestion",
  "assessed_at": "2026-10-13T10:00:00+08:00",
  "assessment_version": "teaching-importance-v1"
}
```

等级为 `unassessed/unknown/ordinary/foundational/integrative`。其中 `unknown` 显示
“证据不足”，权重为空；其他已评等级权重分别为 1、1.25、1.5，属于策略参数。
AI 建议不等于教师确认，也不代表考试频率或分值；作答计数不发送给重要性评估模型。
非未知等级必须有本题原文引文，正文为空、被截断或含未提供图形时降为未知。
模型不可用或输出不可靠时同样返回未知，不猜测重要性。

按账号、题目和正文指纹使用有上限的进程内缓存，正常结果有效 1 小时，未知结果
有效 1 分钟；重启或其他工作进程没有此缓存。后续普通 GET 不调用模型。
题干、材料、参考答案或标签改变会使旧结果失效；复习次数变化不会改变教学重要性。
评估期间题目被修改返回 409，不缓存旧结果。连接失败返回 503、超时 504、无效响应 502。
该接口不写入错题正文、复习日期、作答日志或掌握等级。

前端服务已导出 `assessReviewImportance(entryId, signal?)`，默认超时 65 秒。
页面需要在用户触发评估时调用它，并使用响应更新卡片；当前两个助手按钮的行为保持不变。

## 调用卡片助手

`POST /api/entries/{entry_id}/review-assistant`

```json
{
  "action": "arrange_review",
  "session_id": "6c94303d-4a34-49f2-ad7e-f3b29d5c6500",
  "kb_ids": [],
  "is_stream": true
}
```

- `action` 必填：`arrange_review` 为单题安排建议；`learn_knowledge` 为首次知识点讲解；`discuss_question` 为当前题目对话。
- `message` 仅用于 `discuss_question`，必填，去除首尾空白后 1～2000 字；其他动作不能携带。
- `session_id` 必填，为 UUID；沿用当前助手会话即可，服务端继续按账号隔离会话。
- `kb_ids` 可省略，最多 20 个知识库 UUID。
- `is_stream` 可省略，默认 `true`。

业务适配器额外构建结构化 `entry_request={entry_id, action}`，查询服务按操作直接
进入 `review_plan/learn` 分支，不让意图模型猜题号。该题的归属、最新正文及统计会再次
通过登录凭证读取；卡片操作以指定题目为准，聊天窗口其他知识库的选择不覆盖它。
这些操作不要求题目先向量入库，也不会因题目排期在未来而替换成其他题。
普通聊天接口不接受客户端构造此字段；直接调用查询服务时仍会重新校验题目归属。

服务端先验证题目归属，再从数据库构建题目、共享材料、参考答案、标签和复习统计
的上下文；客户端不能提交 `user_id` 或任意 `query`。上下文按长度截断并显式标记，
图片不直接传给模型。提示词要求助手在信息不足时说明局限，不编造题目内容。

连续对话请求示例：

```json
{
  "action": "discuss_question",
  "message": "因为等式两边减去同一个数，所以等式仍成立。",
  "session_id": "6c94303d-4a34-49f2-ad7e-f3b29d5c6500",
  "is_stream": true
}
```

转发时用户消息原样进入当前题目的学习分支，不被改写成固定讲解提示词。
历史采用按账号隔离的服务端会话，客户端不能提交题目快照、聊天历史或评分结果。
首次讲解、后续提问与引导问题作答沿用同一会话；“先给提示，不要答案”也由该分支处理。
连续对话不保存作答日志、不修改复习次数；正式判卷继续使用复习窗口的作答接口。

卡片底部始终显示对话输入框，Enter 发送、Shift + Enter 换行，支持停止生成与原消息重试。
卡片只展示当前新生成的一轮回复；旧聊天保存在“对话历史（N）”中，默认不展开。
点击入口才弹出当前题目的完整对话，支持 Escape、关闭按钮或点击弹窗外关闭。
弹窗中可重试最后一轮未完成的回复、继续对话或清空当前题目对话；关闭不会删除历史。
切题和刷新不会自动弹出历史，切题时会关闭已打开的历史弹窗。
按账号和题目保存在当前浏览器的聊天记录、草稿和会话 ID，切题、组件重新挂载、刷新都保留。
切题中断未完成的回复并保留片段；返回后可重试。只有“清空对话”清除当前题目的本地对话并换新会话。
它不会删除其他题目的对话、复习记录或服务端历史。
正文修改后保留旧对话供查看，提示题目已变更并换新服务端会话，后续回复依据保存后的正文。
本地存储失败会显示提示，当前页面仍可继续聊天。

这个入口生成复习安排建议或知识点讲解。接口本身不保存排期；提示词也要求助手
不要调用写入工具。实际保存复习日期仍使用既有的
`PATCH /api/entries/{entry_id}`，提交 `next_review_date`（毫秒时间戳）。

助手调用依赖现有 `RAG_AGENT_URL` 配置的查询服务。流式响应与
`POST /api/review-agent/query` 相同，包含 `summary/delta/final` 等 SSE 事件；
设置 `is_stream=false` 时返回 JSON：

```json
{
  "session_id": "6c94303d-4a34-49f2-ad7e-f3b29d5c6500",
  "answer": "助手生成的复习安排或知识点讲解"
}
```

错误：401 未登录；404 题目不可用；422 参数不合法或有未知字段；
503 查询服务不可用；504 查询超时；502 上游响应无效。
流式响应建立后发生断连，会发送 SSE `error` 事件。

## 前端调用

`src/services/reviewInsights.ts` 提供类型和调用封装，复用现有助手流式解析器：

```ts
import { getReviewInsight, queryEntryReviewAssistant } from '@/services/reviewInsights'

const controller = new AbortController()
const card = await getReviewInsight(entryId, controller.signal)
const answer = await queryEntryReviewAssistant(
  entryId,
  'arrange_review',
  sessionId,
  controller.signal,
  {
    onAnswer: (text) => { /* 更新回答区域 */ },
    onSummary: (text) => { /* 更新处理说明 */ },
  },
  selectedKnowledgeBaseIds,
)
```

切换题目或关闭助手时可调用 `controller.abort()`。卡片查询未传 `signal` 时默认
10 秒超时。题目编辑页的 `EntryReviewInsightCard` 已接入卡片和助手接口，
支持展开/收起、加载重试、流式回复、停止生成与失败重试。
切换题目时取消旧请求并清空旧回复，复习次数或日志变化后自动刷新。
未登录或接口不可用时展示本地计数与明确的提示，不把本地记录冒充模型评估；
恢复连接并取得卡片后才启用助手按钮。原有复习时间线保留在“查看复习记录”中。

## 验证

```powershell
.\.venv\Scripts\python.exe -m unittest tests.backend.test_review_insights tests.backend.test_review_candidates tests.backend.test_review_agent
npm run typecheck
```

接口测试使用 SQLite 和模拟上游 HTTP，验证统计、无证据展示、账号隔离、
两个操作的上下文、参数校验、流式响应、超时和内容长度边界；不调用真实模型。
