import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import PortalView from './views/PortalView.vue'

const appCode = import.meta.env.VITE_ECP_APP_CODE || 'WLY5YG'
const apiBaseUrl = import.meta.env.VITE_ECP_API_BASE_URL || '/api/v1'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'ecp-login',
    component: () => import('@acg/ecp-auth-vue/login/vue'),
    props: (route) => ({
      appCode,
      apiBaseUrl,
      returnTo: typeof route.query.returnTo === 'string' ? route.query.returnTo : '/',
      locale: 'zh-CN',
      loginVariant: 'INNER',
      enableDevQuickLogin: import.meta.env.DEV
    }),
    meta: {
      title: '登录',
      public: true
    }
  },
  {
    path: '/login/callback/feishu',
    name: 'ecp-login-callback',
    component: () => import('@acg/ecp-auth-vue/login/vue'),
    props: (route) => ({
      appCode,
      apiBaseUrl,
      returnTo: typeof route.query.returnTo === 'string' ? route.query.returnTo : '/',
      locale: 'zh-CN',
      loginVariant: 'INNER'
    }),
    meta: {
      title: '登录回调',
      public: true
    }
  },
  {
    path: '/no-permission',
    name: 'ecp-no-permission',
    component: () => import('@acg/ecp-auth-vue/no-permission/vue'),
    props: {
      appCode,
      locale: 'zh-CN'
    },
    meta: {
      title: '无权限',
      public: true
    }
  },
  {
    path: '/',
    name: 'app-shell',
    component: PortalView,
    meta: {
      title: '资产管理',
      permissionCodes: ['asset:view'],
      featureCode: 'PORTAL_ASSETS'
    }
  }
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})
