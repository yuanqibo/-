import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import AppRouteLayout from './components/AppRouteLayout.vue'
import {
  MEMBER_AUTHORIZATION_PORTAL_PATH,
  MEMBER_AUTHORIZATION_WORKSPACE_PATH
} from './core/routing/standard-routes'

const routes: RouteRecordRaw[] = [
  {
    path: '/__asset_portal_layout',
    name: 'app-shell',
    component: AppRouteLayout,
    children: [
      {
        path: MEMBER_AUTHORIZATION_PORTAL_PATH,
        name: 'member-authorization-portal',
        component: () => import('./views/PortalView.vue'),
        meta: { portalMenuId: 'authz.workspace' }
      }
    ]
  }
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  if (to.path === MEMBER_AUTHORIZATION_WORKSPACE_PATH && to.query.embedded !== '1') {
    return { path: MEMBER_AUTHORIZATION_PORTAL_PATH, replace: true }
  }
  return true
})
