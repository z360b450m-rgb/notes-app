import { getAccessToken } from './auth'
import { readReviewAgentResponse, type ReviewAgentCallbacks } from './reviewAgent'

export type ReviewInsightAction = 'arrange_review' | 'learn_knowledge' | 'discuss_question'

export interface ReviewInsight {
  entry_id: string
  notebook_id: string
  as_of: string
  timezone: 'Asia/Shanghai'
  review_count: number
  wrong_count: number
  status: {
    code: 'unreviewed' | 'unjudged' | 'needs_review' | 'consolidate'
    label: string
  }
  recommendation: string
  importance: {
    code: 'unassessed' | 'unknown' | 'ordinary' | 'foundational' | 'integrative'
    label: string
    weight: number | null
    basis: string
    evidence: string[]
    source: 'none' | 'ai_suggestion'
    assessed_at: string | null
    assessment_version: string | null
  }
  evidence: {
    review_count: number
    wrong_count: number
    judged_count: number
    recent_wrong_count: number
    recent_judged_count: number
    observed_error_rate: number | null
    explanation: string
  }
  risk: {
    probability: number | null
    source: 'das3h' | 'beta_binomial'
    model_version: string | null
    fallback_reason: string | null
    evidence_count: number
    confidence: 'no_record' | 'limited' | 'model_estimate'
    validated: boolean
    displayable: boolean
  }
  due_status: 'overdue' | 'today' | 'unscheduled' | 'future'
  next_review_date: number | null
  knowledge_points: string[]
  estimated_seconds: number
  time_estimate_source: 'history_median' | 'default'
  review_steps: string[]
  review_hint: string
  actions: { action: ReviewInsightAction; label: string }[]
}

const API_BASE = 'http://localhost:8000/api/entries'

function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  if (!token) throw new Error(localMode ? serverRequiredMessage : '请先登录后查看复习建议')
  return { Authorization: `Bearer ${token}` }
}

export async function getReviewInsight(
  entryId: string,
  signal?: AbortSignal,
): Promise<ReviewInsight> {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(entryId)}/review-insight`, {
    headers: authHeaders(),
    signal: signal ?? AbortSignal.timeout(10_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      typeof payload?.detail === 'string' ? payload.detail : '复习建议读取失败，请稍后重试',
    )
  if (!payload || payload.entry_id !== entryId || !payload.status || !payload.evidence)
    throw new Error('复习建议返回格式无效，请稍后重试')
  return payload as ReviewInsight
}

export async function queryEntryReviewAssistant(
  entryId: string,
  action: ReviewInsightAction,
  sessionId: string,
  signal: AbortSignal,
  callbacks: ReviewAgentCallbacks = {},
  kbIds: string[] = [],
  message?: string,
): Promise<string> {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(entryId)}/review-assistant`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action,
      message,
      session_id: sessionId,
      kb_ids: kbIds,
      is_stream: true,
    }),
    signal,
  })
  return readReviewAgentResponse(response, callbacks, '助手操作参数无效，请重新发起操作')
}

export async function assessReviewImportance(
  entryId: string,
  signal?: AbortSignal,
): Promise<ReviewInsight> {
  const response = await fetch(`${API_BASE}/${encodeURIComponent(entryId)}/review-importance`, {
    method: 'POST',
    headers: authHeaders(),
    signal: signal ?? AbortSignal.timeout(65_000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok)
    throw new Error(
      typeof payload?.detail === 'string' ? payload.detail : '教学重要性评估失败，请稍后重试',
    )
  if (!payload || payload.entry_id !== entryId || !payload.importance || !payload.evidence)
    throw new Error('教学重要性返回格式无效，请稍后重试')
  return payload as ReviewInsight
}
import { localMode, serverRequiredMessage } from '@/services/localMode'
