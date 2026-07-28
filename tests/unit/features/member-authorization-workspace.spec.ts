import { mount } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MemberAuthorizationView from '../../../src/features/member-authorization/components/MemberAuthorizationView.vue'

describe('member authorization workspace', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the iframe inside its route and removes it from the active page when navigating away', async () => {
    vi.useFakeTimers()
    const authorizationActive = ref(true)
    const AuthorizationRoute = defineComponent({
      name: 'AuthorizationRoute',
      setup: () => () => h(MemberAuthorizationView)
    })
    const OtherRoute = defineComponent({
      name: 'OtherRoute',
      setup: () => () => h('div', { class: 'other-route' }, '员工信息')
    })
    const wrapper = mount(defineComponent({
      setup: () => () => h(KeepAlive, null, {
        default: () => authorizationActive.value ? h(AuthorizationRoute) : h(OtherRoute)
      })
    }), {
      attachTo: document.body,
      global: { stubs: { ElAlert: true } }
    })

    await vi.advanceTimersByTimeAsync(0)
    const shell = wrapper.get('.account-management-frame-shell').element
    expect(shell.closest('.member-authorization-view')).not.toBeNull()
    expect(shell.parentElement?.classList.contains('account-management-panel')).toBe(true)
    expect(document.body.querySelector(':scope > .account-management-frame-shell')).toBeNull()

    authorizationActive.value = false
    await nextTick()
    expect(wrapper.find('.other-route').exists()).toBe(true)
    expect(document.body.querySelector('.account-management-frame-shell')).toBeNull()

    authorizationActive.value = true
    await nextTick()
    expect(wrapper.get('.account-management-frame-shell').element).toBe(shell)
    wrapper.unmount()
  })
})
