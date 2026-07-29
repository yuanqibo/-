import { onActivated, onBeforeUnmount, onDeactivated, reactive, ref } from 'vue'
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
    errorMessage: '',
    assignmentOpen: false
  })
  const workspaceUrl = memberAuthorizationWorkspaceUrl()
  let drawerObserver: MutationObserver | null = null
  let loadTimer: number | null = null
  let loadTimeout: number | null = null
  let syncFrame: number | null = null
  let active = true

  const disconnectObserver = (): void => {
    drawerObserver?.disconnect()
    drawerObserver = null
    const frameWindow = frame.value?.contentWindow
    if (syncFrame !== null && frameWindow) frameWindow.cancelAnimationFrame(syncFrame)
    syncFrame = null
  }

  const observeFrame = (): void => {
    disconnectObserver()
    try {
      const frameDocument = frame.value?.contentDocument
      const frameWindow = frame.value?.contentWindow
      if (!frameDocument?.body || !frameWindow) return
      const sync = (): void => {
        syncFrame = null
        const overlays = Array.from(frameDocument.getElementsByClassName('el-overlay'))
        state.assignmentOpen = overlays.some((overlay) => Boolean(overlay.querySelector('.target-workspace-assignment-dialog')))
        overlays.forEach((overlay) => {
          setClassState(overlay, 'authz-workspace-host', Boolean(overlay.querySelector(WORKSPACE_SURFACE_SELECTOR)))
        })
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
    state.assignmentOpen = false
  })

  onDeactivated(() => {
    active = false
    disconnectObserver()
    state.assignmentOpen = false
  })
  onActivated(() => {
    active = true
    const element = frame.value
    if (state.loaded) observeFrame()
    else if (element && element.dataset.workspaceRequested !== 'true') requestWorkspace(element)
  })

  return { frame, state, bindFrame, frameLoaded }
}
