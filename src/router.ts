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

// A tab can keep an older immutable entry chunk while the server has already
// deployed a new build. Recover from a missing lazy route chunk by loading the
// no-store HTML entry once, instead of leaving the shell with an empty slot.
let chunkReloadScheduled = false
router.onError((error) => {
  const message = error instanceof Error ? error.message : String(error)
  const isChunkLoadFailure = /(?:dynamically imported module|Loading chunk|Importing a module script failed|module script failed)/i.test(message)
  if (!isChunkLoadFailure || chunkReloadScheduled) return
  chunkReloadScheduled = true
  try {
    const key = `asset-portal:chunk-reload:${window.location.pathname}`
    if (sessionStorage.getItem(key)) {
      sessionStorage.removeItem(key)
      return
    }
    sessionStorage.setItem(key, '1')
  } catch {
    // Reloading remains useful when storage is unavailable.
  }
  window.location.reload()
})
