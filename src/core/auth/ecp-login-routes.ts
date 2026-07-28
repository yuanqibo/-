import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'

const loadEcpLoginView = () => import('@acg/ecp-auth-vue/login/vue').then((module) => module.default)

const normalizeReturnTo = (value: unknown): string => {
  const candidate = Array.isArray(value) ? value[0] : value
  if (typeof candidate !== 'string') return '/'
  const trimmed = candidate.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/'
  const path = trimmed.split('?')[0]?.split('#')[0] || ''
  if (/(^|\/)login(\/|$)/.test(path)) return '/'
  return trimmed
}

export const registerInternalEcpLoginRoutes = (
  router: Router,
  appCode: string,
  apiBaseUrl: string
): void => {
  const routeProps = (route: RouteLocationNormalizedLoaded) => ({
    appCode,
    apiBaseUrl,
    returnTo: normalizeReturnTo(route.query.returnTo),
    loginVariant: 'INNER' as const
  })

  const existingPaths = new Set(router.getRoutes().map((route) => route.path))
  for (const path of ['/login', '/login/callback/feishu']) {
    if (existingPaths.has(path)) continue
    router.addRoute({
      path,
      component: loadEcpLoginView,
      meta: { title: path === '/login' ? '登录' : '登录回调', public: true },
      props: routeProps
    })
  }
}
