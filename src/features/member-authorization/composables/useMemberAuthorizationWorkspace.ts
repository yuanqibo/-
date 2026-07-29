import { onActivated, onBeforeUnmount, onDeactivated, reactive, ref } from 'vue'
import { memberAuthorizationWorkspaceUrl } from '../api/member-authorization.api'
import type { MemberAuthorizationWorkspaceState } from '../types/member-authorization'

const WORKSPACE_SURFACE_SELECTOR = [
  '.el-drawer',
  '.target-workspace-assignment-dialog',
  '.authz-code-selector-dialog'
].join(',')

export const setClassState = (element: Element | null | undefined, className: string, active: boolean): boolean => {
  if (!element || element.classList.contains(className) === active) return false
  element.classList.toggle(className, active)
  return true
}

export const useMemberAuthorizationWorkspace = () => {
  const frame = ref<HTMLIFrameElement>()
  const state = reactive<MemberAuthorizationWorkspaceState>({
    loaded: false,
    errorMessage: ''
  })
  const workspaceUrl = memberAuthorizationWorkspaceUrl()
  let drawerObserver: MutationObserver | null = null
  let frameShell: HTMLElement | null = null
  let viewportHost: HTMLElement | null = null
  let loadTimer: number | null = null
  let loadTimeout: number | null = null
  let active = true

  const setViewportOverlay = (overlayOpen: boolean, hideWorkspaceApp = overlayOpen): void => {
    frameShell ||= frame.value?.closest<HTMLElement>('.account-management-frame-shell') || null
    viewportHost ||= frame.value?.closest<HTMLElement>('.standard-system-content') || null
    setClassState(frameShell, 'is-workspace-overlay-open', overlayOpen)
    setClassState(viewportHost, 'has-authz-workspace-overlay', overlayOpen)
    setClassState(document.body, 'authz-workspace-overlay-active', overlayOpen)
    try {
      setClassState(frame.value?.contentDocument?.body, 'authz-workspace-portal-overlay-active', hideWorkspaceApp)
    } catch {
      // Supported deployments render this iframe on the same origin.
    }
  }

  const disconnectObserver = (): void => {
    drawerObserver?.disconnect()
    drawerObserver = null
    setViewportOverlay(false, false)
  }

  const observeFrame = (): void => {
    disconnectObserver()
    try {
      const frameDocument = frame.value?.contentDocument
      const frameWindow = frame.value?.contentWindow
      if (!frameDocument?.body || !frameWindow) return
      const sync = (): void => {
        const overlays = Array.from(frameDocument.getElementsByClassName('el-overlay'))
        overlays.forEach((overlay) => {
          setClassState(overlay, 'authz-workspace-host', Boolean(overlay.querySelector(WORKSPACE_SURFACE_SELECTOR)))
        })
        const activeOverlays = overlays.filter((overlay) => {
          if (!overlay.querySelector(WORKSPACE_SURFACE_SELECTOR)) return false
          const style = frameWindow.getComputedStyle(overlay)
          return style.display !== 'none' && style.visibility !== 'hidden'
        })
        setViewportOverlay(
          activeOverlays.length > 0,
          activeOverlays.some((overlay) => !overlay.closest('#app'))
        )
      }
      const FrameMutationObserver = (frameWindow as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver
      drawerObserver = new FrameMutationObserver(sync)
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
    frameShell = element.closest<HTMLElement>('.account-management-frame-shell')
    viewportHost = element.closest<HTMLElement>('.standard-system-content')
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
    frameShell = null
    viewportHost = null
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
