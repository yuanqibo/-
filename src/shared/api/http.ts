import { getAuthzSessionToken, handleAuthzUnauthorized } from '@acg/ecp-auth'

type ApiErrorPayload = {
  error?: string
  message?: string
  detail?: string
  title?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly payload: unknown

  constructor(status: number, message: string, payload: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

export type ApiRequestOptions = Omit<RequestInit, 'body' | 'headers'> & {
  body?: unknown
  headers?: HeadersInit
}

const responseMessage = (payload: unknown, status: number): string => {
  if (payload && typeof payload === 'object') {
    const value = payload as ApiErrorPayload
    const message = value.error || value.message || value.detail || value.title
    if (message) return message
  }
  return `请求失败（HTTP ${status}）`
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = String(options.method || 'GET').toUpperCase()
  const token = String(getAuthzSessionToken() ?? '').trim()
  const headers = new Headers(options.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (options.body !== undefined) headers.set('content-type', 'application/json; charset=utf-8')

  const response = await fetch(path, {
    ...options,
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: method === 'GET' ? 'no-store' : options.cache
  })
  const payload = response.status === 204
    ? null
    : await response.json().catch(() => null)

  if (response.status === 401) handleAuthzUnauthorized()
  if (!response.ok) {
    throw new ApiError(response.status, responseMessage(payload, response.status), payload)
  }
  return payload as T
}
