import { API_BASE, fetchApi } from './apiConfig'
import { getAccessToken } from './auth'

export interface ReviewAttempt {
  attempt_id: string
  entry_id: string
  revision: number
  status: 'ready' | 'grading' | 'retryable' | 'awaiting_explanation' | 'needs_review' | 'final'
  is_correct: boolean | null
  answer_verdict: 'correct' | 'incorrect' | 'uncertain'
  explanation_verdict: 'missing' | 'valid' | 'invalid' | 'uncertain'
  answer_text: string
  explanation_text: string
  comment: string
  followup_question: string
  evaluation_completed?: boolean
  issue?: 'model_error' | 'insufficient_material' | 'unverified_evidence' | null
  grading_version: string
  review_log: null | {
    id: string
    entry_id: string
    timestamp: number
    quality: string
    is_correct: boolean
    elapsed_ms: number
    answer_text: string
    review_note: string
  }
  entry_review: null | {
    review_count: number
    wrong_count: number
    last_review_date: number
    updated_at: number
  }
}

const ENTRIES_API = `${API_BASE}/entries`

// A saved grade remains separate from a completed, but unjudged, single-pass attempt.
export function canAdvanceReviewAttempt(attempt: ReviewAttempt | null | undefined): boolean {
  if (
    !attempt ||
    attempt.status !== 'final' ||
    !['correct', 'incorrect'].includes(attempt.answer_verdict) ||
    !(
      ['valid', 'invalid'].includes(attempt.explanation_verdict) ||
      (attempt.grading_version === 'review-single-pass-v2' &&
        attempt.explanation_verdict === 'missing')
    ) ||
    typeof attempt.is_correct !== 'boolean' ||
    !attempt.review_log ||
    !attempt.entry_review
  )
    return false
  return (
    attempt.is_correct ===
      (attempt.answer_verdict === 'correct' && attempt.explanation_verdict !== 'invalid') &&
    attempt.review_log.id === attempt.attempt_id &&
    attempt.review_log.entry_id === attempt.entry_id
  )
}

export function isReviewAttemptComplete(attempt: ReviewAttempt | null | undefined): boolean {
  return (
    canAdvanceReviewAttempt(attempt) ||
    !!(
      (attempt?.evaluation_completed ||
        (attempt?.grading_version === 'review-answer-reason-v1' &&
          attempt.status === 'needs_review')) &&
      ['needs_review', 'awaiting_explanation'].includes(attempt.status) &&
      attempt.is_correct === null &&
      !attempt.review_log &&
      !attempt.entry_review
    )
  )
}

export class ReviewGradingError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}

async function request(
  entryId: string,
  suffix: string,
  body: unknown,
  signal: AbortSignal,
): Promise<ReviewAttempt> {
  const token = getAccessToken()
  if (!token) throw new Error('请登录后使用智能判卷')
  const response = await fetchApi(`${ENTRIES_API}/${encodeURIComponent(entryId)}/${suffix}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new ReviewGradingError(
      typeof data?.detail === 'string' ? data.detail : '判卷失败，作答已保留，请重试',
      response.status,
    )
  if (
    !data ||
    data.entry_id !== entryId ||
    typeof data.attempt_id !== 'string' ||
    !['ready', 'grading', 'retryable', 'awaiting_explanation', 'needs_review', 'final'].includes(
      data.status,
    ) ||
    (data.status === 'final' && !canAdvanceReviewAttempt(data))
  )
    throw new Error('判卷结果格式无效，请重试')
  return data as ReviewAttempt
}

export function submitReviewAnswer(
  entryId: string,
  attemptId: string,
  answerText: string,
  elapsedMs: number,
  signal: AbortSignal,
) {
  return request(
    entryId,
    'review-attempts',
    { attempt_id: attemptId, answer_text: answerText, elapsed_ms: elapsedMs },
    signal,
  )
}

export function submitReviewExplanation(
  entryId: string,
  attempt: ReviewAttempt,
  explanationText: string,
  signal: AbortSignal,
) {
  return request(
    entryId,
    `review-attempts/${encodeURIComponent(attempt.attempt_id)}/explanation`,
    { explanation_text: explanationText, expected_revision: attempt.revision },
    signal,
  )
}

export async function readReviewAttempt(
  entryId: string,
  attemptId: string,
  signal: AbortSignal,
): Promise<ReviewAttempt> {
  const token = getAccessToken()
  if (!token) throw new Error('请登录后查看判卷状态')
  const response = await fetchApi(
    `${ENTRIES_API}/${encodeURIComponent(entryId)}/review-attempts/${encodeURIComponent(attemptId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    },
  )
  const data = await response.json().catch(() => null)
  if (
    !response.ok ||
    data?.entry_id !== entryId ||
    data?.attempt_id !== attemptId ||
    (data.status === 'final' && !canAdvanceReviewAttempt(data))
  )
    throw new Error('暂时无法读取判卷状态，请重试')
  return data as ReviewAttempt
}
