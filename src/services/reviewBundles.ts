import { getAccessToken } from './auth'

export interface ReviewBundle {
  anchor_entry_id: string
  notebook_id: string
  proposal_token: string
  expires_at: number
  estimated_seconds: number
  notices: string[]
  bundle_version: 'related-review-v1'
  retrieval?: {
    strategy: 'semantic-v2'
    status: 'complete' | 'partial' | 'unavailable' | 'no_index'
    candidate_count: number
    hydrated_count: number
    channels: ('stem' | 'structure' | 'graph')[]
    graph_available: boolean
    warnings: string[]
  } | null
  items: {
    entry_id: string
    title: string
    question_preview: string
    knowledge_points: string[]
    estimated_seconds: number
    review_count: number
    wrong_count: number
    relation: { relation: 'anchor' | 'recalled' | 'same_concept' | 'prerequisite' | 'transfer'; reason: string
                anchor_evidence: string[]; candidate_evidence: string[] }
    importance: { importance: 'unknown' | 'ordinary' | 'foundational' | 'integrative'; reason: string; evidence: string[] }
  }[]
}

export interface ConfirmedReviewBundle {
  anchor_entry_id: string
  notebook_id: string
  entry_ids: string[]
  confirmed_at: number
  bundle_version: 'related-review-v1'
}

async function post(entryId: string, suffix: string, body: unknown, signal: AbortSignal) {
  const token = getAccessToken()
  if (!token) throw new Error(localMode ? serverRequiredMessage : '请登录后安排关联复习')
  const response = await fetch(`http://localhost:8000/api/entries/${encodeURIComponent(entryId)}/${suffix}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : '关联复习请求失败，请重试')
  if (!data || data.anchor_entry_id !== entryId || data.bundle_version !== 'related-review-v1')
    throw new Error('关联复习返回范围无效')
  return data
}

export async function prepareReviewBundle(entryId: string, signal: AbortSignal): Promise<ReviewBundle> {
  const data = await post(entryId, 'review-bundle', { limit: 10 }, signal)
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 10 || data.items[0].entry_id !== entryId ||
      typeof data.proposal_token !== 'string' || new Set(data.items.map((row: {entry_id:string})=>row.entry_id)).size !== data.items.length)
    throw new Error('关联复习题目列表无效')
  return data as ReviewBundle
}

export async function confirmReviewBundle(entryId: string, bundle: ReviewBundle, signal: AbortSignal): Promise<ConfirmedReviewBundle> {
  const data = await post(entryId, 'review-bundle/confirm', { proposal_token: bundle.proposal_token }, signal)
  if (data.notebook_id !== bundle.notebook_id || !Array.isArray(data.entry_ids) ||
      JSON.stringify(data.entry_ids) !== JSON.stringify(bundle.items.map((item)=>item.entry_id)))
    throw new Error('确认返回的复习题目与预览不一致，请重新组题')
  return data as ConfirmedReviewBundle
}
import { localMode, serverRequiredMessage } from '@/services/localMode'
