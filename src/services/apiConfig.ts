import { localBackendTest } from './localMode'

const apiOrigin = localBackendTest
  ? 'http://127.0.0.1:8000'
  : (import.meta.env?.VITE_NOTES_API_URL?.trim() || 'http://localhost:8000').replace(/\/+$/, '')

export const API_BASE = `${apiOrigin}/api`
export const HEALTH_URL = `${apiOrigin}/health`

const loopbackOptions = { targetAddressSpace: 'loopback' } as const

export function fetchApi(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, localBackendTest ? { ...init, ...loopbackOptions } : init)
}
