import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'
import { registerInternalEcpLoginRoutes } from '../../src/core/auth/ecp-login-routes'

const buildRouter = () => createRouter({ history: createMemoryHistory(), routes: [] })

describe('internal ECP login routes', () => {
  it.each(['/login', '/login/callback/feishu'])('forces %s to use the INNER identity resolver', (path) => {
    const router = buildRouter()
    registerInternalEcpLoginRoutes(router, 'WLY5YG', '/api/v1')

    const resolved = router.resolve(`${path}?returnTo=%2Fworkspace`)
    const props = resolved.matched[0]?.props.default

    expect(typeof props).toBe('function')
    expect((props as (route: typeof resolved) => Record<string, unknown>)(resolved)).toEqual({
      appCode: 'WLY5YG',
      apiBaseUrl: '/api/v1',
      returnTo: '/workspace',
      loginVariant: 'INNER'
    })
  })

  it('rejects external and recursive login return targets', () => {
    const router = buildRouter()
    registerInternalEcpLoginRoutes(router, 'WLY5YG', '/api/v1')
    const route = router.getRoutes().find((item) => item.path === '/login')
    const props = route?.props.default

    expect(typeof props).toBe('function')
    expect((props as (input: { query: Record<string, unknown> }) => Record<string, unknown>)({
      query: { returnTo: '//outside.example.com' }
    }).returnTo).toBe('/')
    expect((props as (input: { query: Record<string, unknown> }) => Record<string, unknown>)({
      query: { returnTo: '/login/callback/feishu' }
    }).returnTo).toBe('/')
  })
})
