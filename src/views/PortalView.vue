<script setup lang="ts">
import { onActivated, onDeactivated, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import JSZip from 'jszip'
import PortalShell from '../components/PortalShell.vue'
import { getPortalContext } from '../core/auth/portal-context'
import { usePortalSession } from '../core/auth/portal-session'
import { isStandardVueRoute } from '../core/routing/standard-routes'
import '../styles/portal.css'

defineOptions({ name: 'PortalView' })

declare global {
  interface Window {
    JSZip: typeof JSZip
  }
}

const route = useRoute()
const { ready } = usePortalSession()
let active = true
let legacyStarted = false

window.JSZip = JSZip

const notifyLegacyRoute = (): void => {
  if (!active || !legacyStarted || isStandardVueRoute(route.path)) return
  const context = getPortalContext()
  const portalMenuId = String(route.meta.portalMenuId || '')
  const item = portalMenuId
    ? context?.getMenuItems().find((menuItem) => menuItem.id === portalMenuId)
    : context?.getCurrentMenu()
  if (item) window.dispatchEvent(new CustomEvent('asset-portal-route', { detail: item }))
}

const startLegacyPortal = async (): Promise<void> => {
  if (legacyStarted || !ready.value) return
  await import('../portal/app')
  legacyStarted = true
  window.assetPortalApplyEcpSession?.()
  window.dispatchEvent(new CustomEvent('asset-portal-ecp-session'))
  notifyLegacyRoute()
}

const stopReadyWatch = watch(ready, () => void startLegacyPortal(), { immediate: true })
const stopRouteWatch = watch(() => [route.path, route.meta.portalMenuId], notifyLegacyRoute)

onActivated(() => {
  active = true
  notifyLegacyRoute()
})

onDeactivated(() => {
  active = false
})

onUnmounted(() => {
  stopReadyWatch()
  stopRouteWatch()
})
</script>

<template>
  <PortalShell />
</template>
