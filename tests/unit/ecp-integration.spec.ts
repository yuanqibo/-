import { createApp, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('ECP local integration', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('passes the real SDK local doctor with strict app-code matching', async () => {
    vi.stubEnv('VITE_ECP_AUTH_CONFIG_SOURCE_MODE', 'local')
    const { ecp } = await import('../../src/ecp')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{
        path: '/__test_layout',
        name: 'app-shell',
        component: defineComponent({ setup: () => () => h(RouterView) }),
        children: []
      }]
    })
    const app = createApp(defineComponent({ setup: () => () => h(RouterView) }))
    await ecp.setup({ app, router, locale: 'zh-CN' })
    const report = await ecp.auth?.doctor.run({ bundleAppCodeMismatchLevel: 'fail' })

    expect(report?.ok).toBe(true)
    expect(report?.checks.filter((check) => check.status === 'FAIL')).toEqual([])
    for (const path of ['/login', '/no-permission', '/workspace']) {
      expect(router.resolve(path).matched.some((route) => route.path === path)).toBe(true)
    }
    expect(router.getRoutes().some((route) => route.path === '/system/member-authorization')).toBe(false)
  }, 15_000)
})
