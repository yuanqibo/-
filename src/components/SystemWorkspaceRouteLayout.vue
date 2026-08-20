<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import StandardPortalLayout from '../core/layout/StandardPortalLayout.vue'

const ecpOverlayContentSelector = [
  '.role-editor-wizard-drawer',
  '.target-workspace-assignment-dialog',
  '.target-workspace-subject-assignment-drawer',
  '.authz-code-selector-dialog'
].join(',')

const scopedOverlays = new Set<HTMLElement>()
let overlayObserver: MutationObserver | null = null

const scopeEcpOverlay = (node: Node): void => {
  if (!(node instanceof Element)) return
  const overlay = node.matches('.el-overlay')
    ? node
    : node.closest<HTMLElement>('.el-overlay')
  if (!(overlay instanceof HTMLElement) || !overlay.querySelector(ecpOverlayContentSelector)) return

  // ECP drawers are teleported to body. Give their overlay the SDK host scope
  // so strict workspace styles still apply without leaking into portal pages.
  overlay.classList.add('authz-workspace-host', 'authz-workspace-overlay')
  scopedOverlays.add(overlay)
}

onMounted(() => {
  document.querySelectorAll('.el-overlay').forEach(scopeEcpOverlay)
  overlayObserver = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        scopeEcpOverlay(node)
        if (node instanceof Element) node.querySelectorAll('.el-overlay').forEach(scopeEcpOverlay)
      })
    })
  })
  overlayObserver.observe(document.body, { childList: true, subtree: true })
})

onBeforeUnmount(() => {
  overlayObserver?.disconnect()
  overlayObserver = null
  scopedOverlays.forEach((overlay) => overlay.classList.remove('authz-workspace-host', 'authz-workspace-overlay'))
  scopedOverlays.clear()
})
</script>

<template>
  <StandardPortalLayout page-title="成员授权" section="system">
    <RouterView />
  </StandardPortalLayout>
</template>
