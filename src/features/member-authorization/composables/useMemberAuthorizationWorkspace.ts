import { onBeforeUnmount, reactive, ref } from 'vue'
import { memberAuthorizationWorkspaceUrl } from '../api/member-authorization.api'
import type { MemberAuthorizationWorkspaceState } from '../types/member-authorization'

const WORKSPACE_SURFACE_SELECTOR = [
  '.el-drawer',
  '.target-workspace-assignment-dialog',
  '.authz-code-selector-dialog'
].join(',')
const WORKSPACE_MUTATION_SELECTOR = `.el-overlay,${WORKSPACE_SURFACE_SELECTOR}`

const isElementNode = (node: Node): node is Element =>
  node.nodeType === 1 && typeof (node as Element).matches === 'function'

export const setClassState = (element: Element | null | undefined, className: string, active: boolean): boolean => {
  if (!element || element.classList.contains(className) === active) return false
  element.classList.toggle(className, active)
  return true
}

export const mutationTouchesWorkspaceOverlay = (mutation: MutationRecord): boolean => {
  if (mutation.type === 'attributes') {
    return isElementNode(mutation.target) && mutation.target.classList.contains('el-overlay')
  }
  if (mutation.type !== 'childList') return false
  return [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
    isElementNode(node) && (node.matches(WORKSPACE_MUTATION_SELECTOR) || Boolean(node.querySelector(WORKSPACE_MUTATION_SELECTOR)))
  )
}

export const useMemberAuthorizationWorkspace = () => {
  const frame = ref<HTMLIFrameElement>()
  const state = reactive<MemberAuthorizationWorkspaceState>({
    loaded: false,
    docked: false,
    overlayOpen: false,
    errorMessage: ''
  })
  const workspaceUrl = memberAuthorizationWorkspaceUrl()
  let drawerObserver: MutationObserver | null = null
  let anchorResizeObserver: ResizeObserver | null = null
  let dockedShell: HTMLElement | null = null
  let dockAnchor: HTMLElement | null = null
  let loadTimer: number | null = null
  let loadTimeout: number | null = null
  let syncFrame: number | null = null
  let positionFrame: number | null = null

  const positionDock = (): void => {
    if (!dockedShell || !dockAnchor?.isConnected || state.overlayOpen) return
    const rect = dockAnchor.getBoundingClientRect()
    dockedShell.style.setProperty('--authz-workspace-dock-left', `${Math.round(rect.left)}px`)
    dockedShell.style.setProperty('--authz-workspace-dock-top', `${Math.round(rect.top)}px`)
    dockedShell.style.setProperty('--authz-workspace-dock-width', `${Math.round(rect.width)}px`)
    dockedShell.style.setProperty('--authz-workspace-dock-height', `${Math.round(rect.height)}px`)
  }

  const schedulePositionDock = (): void => {
    if (positionFrame !== null) return
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = null
      positionDock()
    })
  }

  const setOverlay = (active: boolean, hideWorkspaceApp = active): void => {
    state.overlayOpen = active
    setClassState(dockedShell, 'is-workspace-drawer-open', active)
    setClassState(document.body, 'authz-workspace-overlay-active', active)
    try {
      setClassState(frame.value?.contentDocument?.body, 'authz-workspace-portal-overlay-active', hideWorkspaceApp)
    } catch {
      // Supported deployments render this iframe on the same origin.
    }
    if (!active) schedulePositionDock()
  }

  const observeFrame = (): void => {
    drawerObserver?.disconnect()
    setOverlay(false, false)
    try {
      const frameDocument = frame.value?.contentDocument
      const frameWindow = frame.value?.contentWindow
      if (!frameDocument?.body || !frameWindow) return
      const sync = (): void => {
        syncFrame = null
        const overlays = Array.from(frameDocument.getElementsByClassName('el-overlay'))
        overlays.forEach((overlay) => setClassState(overlay, 'authz-workspace-host', true))
        const activeOverlays = overlays.filter((overlay) => {
          if (!overlay.querySelector(WORKSPACE_SURFACE_SELECTOR)) return false
          const style = frameWindow.getComputedStyle(overlay)
          return style.display !== 'none' && style.visibility !== 'hidden'
        })
        setOverlay(activeOverlays.length > 0, activeOverlays.some((overlay) => !overlay.closest('#app')))
      }
      const scheduleSync = (): void => {
        if (syncFrame !== null) return
        syncFrame = frameWindow.requestAnimationFrame(sync)
      }
      const FrameMutationObserver = (frameWindow as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver
      drawerObserver = new FrameMutationObserver((mutations) => {
        if (mutations.some(mutationTouchesWorkspaceOverlay)) scheduleSync()
      })
      drawerObserver.observe(frameDocument.body, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        childList: true,
        subtree: true
      })
      sync()
    } catch (error) {
      state.errorMessage = error instanceof Error ? error.message : 'ECP 工作台抽屉联动不可用'
    }
  }

  const dockFrame = (element: HTMLIFrameElement): void => {
    const shell = element.closest<HTMLElement>('.account-management-frame-shell')
    const anchor = shell?.closest<HTMLElement>('.account-management-frame-anchor')
    if (!shell || !anchor) return
    dockedShell = shell
    dockAnchor = anchor
    state.docked = true
    shell.classList.add('is-workspace-docked')
    document.body.append(shell)
    window.addEventListener('resize', schedulePositionDock)
    window.addEventListener('scroll', schedulePositionDock, true)
    anchorResizeObserver = new ResizeObserver(schedulePositionDock)
    anchorResizeObserver.observe(anchor)
    positionDock()
  }

  const bindFrame = (element: unknown): void => {
    if (!(element instanceof HTMLIFrameElement) || frame.value === element) return
    frame.value = element
    loadTimer = window.setTimeout(() => {
      dockFrame(element)
      element.dataset.workspaceRequested = 'true'
      element.src = workspaceUrl
      loadTimeout = window.setTimeout(() => {
        if (!state.loaded) state.errorMessage = 'ECP 成员授权工作台加载超时，请刷新页面重试'
      }, 20_000)
    }, 0)
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
    observeFrame()
  }

  onBeforeUnmount(() => {
    if (loadTimer !== null) window.clearTimeout(loadTimer)
    if (loadTimeout !== null) window.clearTimeout(loadTimeout)
    drawerObserver?.disconnect()
    anchorResizeObserver?.disconnect()
    window.removeEventListener('resize', schedulePositionDock)
    window.removeEventListener('scroll', schedulePositionDock, true)
    if (positionFrame !== null) window.cancelAnimationFrame(positionFrame)
    setOverlay(false, false)
    dockedShell?.remove()
  })

  return { frame, state, bindFrame, frameLoaded }
}
