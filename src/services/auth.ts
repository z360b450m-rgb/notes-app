import { API_BASE, fetchApi } from './apiConfig'
import { localMode } from './localMode'

const TOKEN_KEY = 'notes_app_access_token'
const USER_KEY = 'notes_app_current_user'
const REQUEST_TIMEOUT_MS = 5_000

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

async function requestJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchApi(url, { ...init, signal: controller.signal })
    const payload: unknown = await response.json()
    if (!response.ok)
      throw new AuthError(readError(payload, '请求失败，请稍后重试'), response.status)
    return payload
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError(
      controller.signal.aborted
        ? '连接超时，请确认后台服务已启动后重试'
        : '暂时无法连接后台服务，请稍后重试',
    )
  } finally {
    clearTimeout(timer)
  }
}

export interface AuthUser {
  id: string
  email: string
  full_name: string | null
  is_active: boolean
  created_at: number
}

type TokenResponse = { access_token: string; token_type: string }

function readError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object' && 'detail' in payload) {
    const detail = (payload as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) return '请检查邮箱、6 位验证码及密码长度（8–128 位）'
  }
  return fallback
}

export function getAccessToken(): string | null {
  if (localMode) return null
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): AuthUser | null {
  if (localMode) return null
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

function saveSession(token: string, user: AuthUser): AuthUser {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  return user
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const body = new URLSearchParams({ username: email.trim(), password })
  const payload = (await requestJson(`${API_BASE}/login/access-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })) as TokenResponse | { detail?: string }
  if (!('access_token' in payload)) throw new Error(readError(payload, '登录失败，请稍后重试'))
  const user = await fetchCurrentUser(payload.access_token)
  return saveSession(payload.access_token, user)
}

export async function signup(
  email: string,
  password: string,
  fullName: string,
  code: string,
): Promise<AuthUser> {
  await requestJson(`${API_BASE}/users/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email.trim(),
      password,
      full_name: fullName.trim() || null,
      code,
    }),
  })
  return login(email, password)
}

export async function sendEmailCode(email: string, purpose: 'signup' | 'reset_password') {
  return (await requestJson(
    `${API_BASE}/auth/email-code`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), purpose }),
    },
    30_000,
  )) as { message: string; retry_after: number }
}

export async function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await requestJson(`${API_BASE}/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), code, new_password: newPassword }),
  })
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = getAccessToken()
  if (!token) throw new AuthError('尚未登录', 401)
  await requestJson(`${API_BASE}/users/me/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  })
  clearSession()
}

export async function fetchCurrentUser(token = getAccessToken()): Promise<AuthUser> {
  if (!token) throw new AuthError('尚未登录', 401)
  return (await requestJson(`${API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })) as AuthUser
}
