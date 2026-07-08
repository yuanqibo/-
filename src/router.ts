import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import LegacyPortalView from './views/LegacyPortalView.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'app-shell',
    component: LegacyPortalView,
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
