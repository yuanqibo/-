import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/features/member-authorization/api/member-authorization.api', () => ({
  memberAuthorizationWorkspaceUrl: () => 'about:blank'
}))

import {
  mutationTouchesWorkspaceOverlay,
  setClassState,
  useMemberAuthorizationWorkspace
} from '../../../src/features/member-authorization/composables/useMemberAuthorizationWorkspace'

const attributeMutation = (target: Element): MutationRecord => ({
  type: 'attributes',
  target
} as unknown as MutationRecord)

const childMutation = (target: Element, addedNodes: Node[] = [], removedNodes: Node[] = []): MutationRecord => ({
  type: 'childList',
  target,
  addedNodes,
  removedNodes
} as unknown as MutationRecord)

describe('member authorization workspace bridge', () => {
  it('changes bridge classes only when their state actually changes', () => {
    const element = document.createElement('div')

    expect(setClassState(element, 'is-open', true)).toBe(true)
    expect(setClassState(element, 'is-open', true)).toBe(false)
    expect(setClassState(element, 'is-open', false)).toBe(true)
    expect(setClassState(element, 'is-open', false)).toBe(false)
  })

  it('ignores unrelated workspace mutations and the bridge body class', () => {
    const body = document.createElement('body')
    const unrelated = document.createElement('div')
    unrelated.append(document.createElement('span'))

    expect(mutationTouchesWorkspaceOverlay(attributeMutation(body))).toBe(false)
    expect(mutationTouchesWorkspaceOverlay(childMutation(body, [unrelated]))).toBe(false)
  })

  it('observes overlay visibility and nested drawer/dialog insertion', () => {
    const overlay = document.createElement('div')
    overlay.className = 'el-overlay'
    const wrapper = document.createElement('div')
    const drawer = document.createElement('div')
    drawer.className = 'el-drawer'
    wrapper.append(drawer)

    expect(mutationTouchesWorkspaceOverlay(attributeMutation(overlay))).toBe(true)
    expect(mutationTouchesWorkspaceOverlay(childMutation(overlay, [wrapper]))).toBe(true)
    expect(mutationTouchesWorkspaceOverlay(childMutation(overlay, [], [drawer]))).toBe(true)
  })

  it('keeps the workspace docked when Vue updates the drawer class', async () => {
    vi.useFakeTimers()
    let workspace!: ReturnType<typeof useMemberAuthorizationWorkspace>
    const wrapper = mount(defineComponent({
      setup() {
        workspace = useMemberAuthorizationWorkspace()
        return () => h('div', { class: 'account-management-frame-anchor' }, [
          h('div', {
            class: {
              'account-management-frame-shell': true,
              'is-workspace-docked': workspace.state.docked,
              'is-workspace-drawer-open': workspace.state.overlayOpen
            }
          }, [h('iframe', { ref: workspace.bindFrame, src: 'about:blank', onLoad: workspace.frameLoaded })])
        ])
      }
    }), { attachTo: document.body })

    await vi.advanceTimersByTimeAsync(1)
    await nextTick()
    const shell = document.querySelector('.account-management-frame-shell')
    expect(shell?.parentElement).toBe(document.body)
    expect(shell?.classList.contains('is-workspace-docked')).toBe(true)

    workspace.state.overlayOpen = true
    await nextTick()
    expect(shell?.classList.contains('is-workspace-docked')).toBe(true)
    expect(shell?.classList.contains('is-workspace-drawer-open')).toBe(true)

    workspace.state.overlayOpen = false
    await nextTick()
    expect(shell?.classList.contains('is-workspace-docked')).toBe(true)
    expect(shell?.classList.contains('is-workspace-drawer-open')).toBe(false)

    wrapper.unmount()
    expect(document.querySelector('.account-management-frame-shell')).toBeNull()
    vi.useRealTimers()
  })
})
