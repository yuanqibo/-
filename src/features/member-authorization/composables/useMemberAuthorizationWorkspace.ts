import { onActivated, onBeforeUnmount, onDeactivated, reactive, ref } from 'vue'
import { memberAuthorizationWorkspaceUrl } from '../api/member-authorization.api'
import type { MemberAuthorizationWorkspaceState } from '../types/member-authorization'

const WORKSPACE_SURFACE_SELECTOR = [
  '.el-drawer',
  '.target-workspace-assignment-dialog',
  '.authz-code-selector-dialog'
].join(',')

const WORKSPACE_PORTAL_SELECTOR = [
  '.el-overlay',
  '.el-popper',
  '.el-message',
  '.el-notification'
].map((selector) => `:scope > ${selector}`).join(',')

export const useMemberAuthorizationWorkspace = () => {
  const frame = ref<HTMLIFrameElement>()
  const state = reactive<MemberAuthorizationWorkspaceState>({
    loaded: false,
    errorMessage: ''
  })
  const workspaceUrl = memberAuthorizationWorkspaceUrl()
  let portalObserver: MutationObserver | null = null
  const portaledNodes = new Set<HTMLElement>()
  let loadTimer: number | null = null
  let loadTimeout: number | null = null
  let active = true

  const restorePortaledNodes = (): void => {
    try {
      const frameBody = frame.value?.contentDocument?.body
      portaledNodes.forEach((node) => {
        node.classList.remove('authz-workspace-host', 'authz-workspace-auxiliary')
        if (node.isConnected && frameBody) frameBody.appendChild(node)
        else if (node.isConnected) node.remove()
      })
    } catch {
      portaledNodes.forEach((node) => node.remove())
    }
    portaledNodes.clear()
  }

  const disconnectObserver = (): void => {
    portalObserver?.disconnect()
    portalObserver = null
    restorePortaledNodes()
  }

  const observeFrame = (): void => {
    disconnectObserver()
    try {
      const frameDocument = frame.value?.contentDocument
      const frameWindow = frame.value?.contentWindow
      if (!frameDocument?.body || !frameWindow) return

      const portalNode = (node: HTMLElement, primary: boolean): void => {
        node.classList.add(primary ? 'authz-workspace-host' : 'authz-workspace-auxiliary')
        const primaryHost = Array.from(portaledNodes).find((item) => item.classList.contains('authz-workspace-host'))
        if (primary) document.body.appendChild(node)
        else (primaryHost || document.body).appendChild(node)
        portaledNodes.add(node)
      }
      const sync = (): void => {
        portaledNodes.forEach((node) => {
          if (!node.isConnected) portaledNodes.delete(node)
        })

        const overlays = Array.from(frameDocument.querySelectorAll<HTMLElement>('.el-overlay'))
        overlays
          .filter((overlay) => overlay.querySelector(WORKSPACE_SURFACE_SELECTOR))
          .forEach((overlay) => portalNode(overlay, true))
        if (!Array.from(portaledNodes).some((node) => node.classList.contains('authz-workspace-host'))) return

        Array.from(frameDocument.body.querySelectorAll<HTMLElement>(WORKSPACE_PORTAL_SELECTOR))
          .forEach((node) => portalNode(node, false))
      }

      const FrameMutationObserver = (frameWindow as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver
      portalObserver = new FrameMutationObserver(sync)
      portalObserver.observe(frameDocument.body, { childList: true, subtree: true })
      sync()
    } catch (error) {
      state.errorMessage = error instanceof Error ? error.message : 'ECP 工作台浮层联动不可用'
    }
  }

  const requestWorkspace = (element: HTMLIFrameElement): void => {
    if (loadTimer !== null) window.clearTimeout(loadTimer)
    loadTimer = window.setTimeout(() => {
      loadTimer = null
      if (frame.value !== element || !element.isConnected) return
      element.dataset.workspaceRequested = 'true'
      element.src = workspaceUrl
      loadTimeout = window.setTimeout(() => {
        if (!state.loaded) state.errorMessage = 'ECP 成员授权工作台加载超时，请刷新页面重试'
      }, 20_000)
    }, 0)
  }

  const bindFrame = (element: unknown): void => {
    if (!(element instanceof HTMLIFrameElement) || frame.value === element) return
    frame.value = element
    requestWorkspace(element)
  }

  const frameLoaded = (): void => {
    const element = frame.value
    if (!element || element.dataset.workspaceRequested !== 'true') return
    try {
      if (element.contentWindow?.location.href === 'about:blank') return
    } catch {
      // A deployment origin mismatch is reported by observeFrame.
    }
    if (loadTimeout !== null) window.clearTimeout(loadTimeout)
    loadTimeout = null
    state.loaded = true
    state.errorMessage = ''
    if (active) observeFrame()
  }

  onBeforeUnmount(() => {
    if (loadTimer !== null) window.clearTimeout(loadTimer)
    if (loadTimeout !== null) window.clearTimeout(loadTimeout)
    disconnectObserver()
  })

  onDeactivated(() => {
    active = false
    disconnectObserver()
  })
  onActivated(() => {
    active = true
    const element = frame.value
    if (state.loaded) observeFrame()
    else if (element && element.dataset.workspaceRequested !== 'true') requestWorkspace(element)
  })

  return { frame, state, bindFrame, frameLoaded }
}
