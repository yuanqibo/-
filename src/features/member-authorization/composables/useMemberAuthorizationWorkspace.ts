import { onActivated, onBeforeUnmount, onDeactivated, reactive, ref } from 'vue'
import { memberAuthorizationWorkspaceUrl } from '../api/member-authorization.api'
import { enhanceMemberSelector } from '../member-selector-enhancer'
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
  let hostObserver: MutationObserver | null = null
  const portaledNodes = new Set<HTMLElement>()
  const copiedThemeProperties = new WeakMap<HTMLElement, string[]>()
  const surfaceCleanups = new WeakMap<HTMLElement, () => void>()
  let loadTimer: number | null = null
  let loadTimeout: number | null = null
  let active = true

  const clearPortalState = (node: HTMLElement): void => {
    surfaceCleanups.get(node)?.()
    surfaceCleanups.delete(node)
    node.classList.remove('authz-workspace-host', 'authz-workspace-auxiliary')
    copiedThemeProperties.get(node)?.forEach((property) => node.style.removeProperty(property))
    copiedThemeProperties.delete(node)
    portaledNodes.delete(node)
  }

  const restoreNode = (node: HTMLElement, frameBody?: HTMLElement): void => {
    clearPortalState(node)
    if (node.isConnected && frameBody) frameBody.appendChild(node)
    else if (node.isConnected) node.remove()
  }

  const restorePortaledNodes = (): void => {
    try {
      const frameBody = frame.value?.contentDocument?.body
      const nodes = Array.from(portaledNodes)
        .sort((node) => node.classList.contains('authz-workspace-auxiliary') ? -1 : 1)
      nodes.forEach((node) => restoreNode(node, frameBody))
    } catch {
      portaledNodes.forEach((node) => node.remove())
      portaledNodes.clear()
    }
  }

  const disconnectObserver = (): void => {
    portalObserver?.disconnect()
    hostObserver?.disconnect()
    portalObserver = null
    hostObserver = null
    restorePortaledNodes()
  }

  const observeFrame = (): void => {
    disconnectObserver()
    try {
      const frameDocument = frame.value?.contentDocument
      const frameWindow = frame.value?.contentWindow
      if (!frameDocument?.body || !frameWindow) return

      const applyWorkspaceTheme = (node: HTMLElement): void => {
        const rootStyle = frameWindow.getComputedStyle(frameDocument.documentElement)
        const properties = Array.from(rootStyle).filter((property) => property.startsWith('--ecp-'))
        properties.forEach((property) => node.style.setProperty(property, rootStyle.getPropertyValue(property)))
        copiedThemeProperties.set(node, properties)
      }
      const portalNode = (node: HTMLElement, primary: boolean): void => {
        node.classList.add(primary ? 'authz-workspace-host' : 'authz-workspace-auxiliary')
        if (primary) {
          applyWorkspaceTheme(node)
        }
        const primaryHost = Array.from(portaledNodes).find((item) => item.classList.contains('authz-workspace-host'))
        if (primary) document.body.appendChild(node)
        else (primaryHost || document.body).appendChild(node)
        portaledNodes.add(node)
        if (primary) {
          if (!surfaceCleanups.has(node)) surfaceCleanups.set(node, enhanceMemberSelector(node))
          hostObserver?.observe(node, { attributes: true, attributeFilter: ['class', 'style'] })
        }
      }
      const sync = (): void => {
        portaledNodes.forEach((node) => {
          if (!node.isConnected) portaledNodes.delete(node)
        })

        const overlays = Array.from(frameDocument.querySelectorAll<HTMLElement>('.el-overlay'))
        overlays
          .filter((overlay) => {
            const style = frameWindow.getComputedStyle(overlay)
            return overlay.querySelector(WORKSPACE_SURFACE_SELECTOR)
              && style.display !== 'none'
              && style.visibility !== 'hidden'
          })
          .forEach((overlay) => portalNode(overlay, true))
        if (!Array.from(portaledNodes).some((node) => node.classList.contains('authz-workspace-host'))) return

        Array.from(frameDocument.body.querySelectorAll<HTMLElement>(WORKSPACE_PORTAL_SELECTOR))
          .forEach((node) => portalNode(node, false))
      }

      const syncHost = (): void => {
        portaledNodes.forEach((node) => {
          if (!node.isConnected) portaledNodes.delete(node)
        })
        const frameBody = frame.value?.contentDocument?.body
        Array.from(portaledNodes)
          .filter((node) => node.classList.contains('authz-workspace-host'))
          .filter((node) => {
            const style = window.getComputedStyle(node)
            return style.display === 'none' || style.visibility === 'hidden'
          })
          .forEach((node) => restoreNode(node, frameBody))
        if (Array.from(portaledNodes).some((node) => node.classList.contains('authz-workspace-host'))) return
        Array.from(portaledNodes).forEach((node) => restoreNode(node, frameBody))
      }

      const FrameMutationObserver = (frameWindow as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver
      portalObserver = new FrameMutationObserver(sync)
      portalObserver.observe(frameDocument.body, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        childList: true,
        subtree: true
      })
      hostObserver = new MutationObserver(syncHost)
      hostObserver.observe(document.body, { childList: true })
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
