import { onBeforeUnmount, reactive, ref } from 'vue'
import { memberAuthorizationWorkspaceUrl } from '../api/member-authorization.api'
import type { WorkspaceBridgeState } from '../types/member-authorization'

export const useMemberAuthorizationBridge = () => {
  const frame = ref<HTMLIFrameElement>()
  const state = reactive<WorkspaceBridgeState>({ loaded: false, overlayOpen: false, errorMessage: '' })
  let drawerObserver: MutationObserver | null = null

  const setOverlay = (active: boolean): void => {
    state.overlayOpen = active
    document.body.classList.toggle('authz-workspace-overlay-active', active)
    try { frame.value?.contentDocument?.body.classList.toggle('authz-workspace-portal-overlay-active', active) } catch { /* same-origin deployment is required for drawer docking */ }
  }

  const containsWorkspaceSurface = (element: Element): boolean =>
    element.getElementsByClassName('el-drawer').length > 0
      || element.getElementsByClassName('target-workspace-assignment-dialog').length > 0
      || element.getElementsByClassName('authz-code-selector-dialog').length > 0

  const observeFrame = (): void => {
    drawerObserver?.disconnect()
    setOverlay(false)
    try {
      const frameDocument = frame.value?.contentDocument
      const frameWindow = frame.value?.contentWindow
      if (!frameDocument?.body || !frameWindow) return
      const sync = (): void => {
        const overlays = Array.from(frameDocument.getElementsByClassName('el-overlay'))
        overlays.forEach((overlay) => overlay.classList.add('authz-workspace-host'))
        setOverlay(overlays.some((overlay) => {
          if (!containsWorkspaceSurface(overlay)) return false
          const style = frameWindow.getComputedStyle(overlay)
          return style.display !== 'none' && style.visibility !== 'hidden'
        }))
      }
      const observer = new MutationObserver(sync)
      drawerObserver = observer
      observer.observe(frameDocument.body, { attributes: true, attributeFilter: ['class', 'style'], childList: true, subtree: true })
      sync()
    } catch (error) {
      state.errorMessage = error instanceof Error ? error.message : 'ECP 工作台抽屉联动不可用'
    }
  }

  const frameLoaded = (): void => { state.loaded = true; state.errorMessage = ''; observeFrame() }
  onBeforeUnmount(() => { drawerObserver?.disconnect(); setOverlay(false) })
  return { frame, state, workspaceUrl: memberAuthorizationWorkspaceUrl(), frameLoaded }
}
