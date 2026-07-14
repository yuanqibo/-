import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import AppRouteLayout from './components/AppRouteLayout.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/__asset_portal_layout',
    name: 'app-shell',
    component: AppRouteLayout,
    children: []
  }
]

export const router = createRouter({
  history: createWebHistory(),
  routes
})
