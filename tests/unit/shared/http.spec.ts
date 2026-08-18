import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthzSessionToken, handleAuthzUnauthorized } from '@acg/ecp-auth'
import { ApiError, ApiTimeoutError, apiRequest } from '../../../src/shared/api/http'

vi.mock('@acg/ecp-auth', () => ({
  getAuthzSessionToken: vi.fn(),
  handleAuthzUnauthorized: vi.fn()
}))

const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()

const response = (body: unknown, status = 200): Response => new Response(
  body === null ? null : JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json' } }
)

describe('apiRequest', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(getAuthzSessionToken).mockReturnValue('session-token')
    vi.mocked(handleAuthzUnauthorized).mockClear()
  })

  it('injects the ECP token and serializes JSON writes', async () => {
    fetchMock.mockResolvedValue(response({ ok: true }))

    await expect(apiRequest<{ ok: boolean }>('/api/assets', {
      method: 'POST',
      body: { name: '显示器' }
    })).resolves.toEqual({ ok: true })

    const [path, options] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/assets')
    expect(options?.method).toBe('POST')
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer session-token')
    expect(new Headers(options?.headers).get('content-type')).toContain('application/json')
    expect(options?.body).toBe(JSON.stringify({ name: '显示器' }))
  })

  it('uses no-store for reads and accepts empty responses', async () => {
    fetchMock.mockResolvedValue(response(null, 204))
    await expect(apiRequest('/api/store')).resolves.toBeNull()
    expect(fetchMock.mock.calls[0][1]?.cache).toBe('no-store')
  })

  it('normalizes API errors with status and payload', async () => {
    fetchMock.mockResolvedValue(response({ error: '权限不足' }, 403))
    const error = await apiRequest('/api/assets').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403, message: '权限不足', payload: { error: '权限不足' } })
  })

  it('delegates expired ECP sessions to the SDK unauthorized handler', async () => {
    fetchMock.mockResolvedValue(response({ error: 'ECP session is invalid' }, 401))

    await expect(apiRequest('/api/assets')).rejects.toMatchObject({ status: 401 })
    expect(handleAuthzUnauthorized).toHaveBeenCalledOnce()
  })

  it('aborts a stalled request and returns a recoverable timeout error', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_path, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))

    const pending = apiRequest('/api/assets').catch((reason: unknown) => reason)
    await vi.advanceTimersByTimeAsync(12_000)

    await expect(pending).resolves.toBeInstanceOf(ApiTimeoutError)
    vi.useRealTimers()
  })
})
