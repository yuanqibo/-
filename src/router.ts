import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import AppRouteLayout from './components/AppRouteLayout.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/__asset_portal_layout',
    name: 'app-shell',
    component: AppRouteLayout,
    children: [
      {
        path: '/__ecp_workspace_layout',
        name: 'system-workspace-shell',
        component: () => import('./components/SystemWorkspaceRouteLayout.vue'),
        children: []
      }
    ]
  }
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})
