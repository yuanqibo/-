import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { ElPopover } from 'element-plus'
import { describe, expect, it } from 'vitest'
import OrganizationFilterSelect from '../../../src/features/organization/components/OrganizationFilterSelect.vue'

describe('OrganizationFilterSelect', () => {
  it('opens downward and emits the selected value', async () => {
    const wrapper = mount(OrganizationFilterSelect, {
      attachTo: document.body,
      props: {
        modelValue: 'all',
        label: '成员范围',
        options: [{ value: 'all', label: '展示全部成员' }, { value: 'direct', label: '仅直属成员' }]
      },
      global: { components: { ElPopover } }
    })
    expect(wrapper.getComponent(ElPopover).props('placement')).toBe('bottom-start')
    await wrapper.get('.ecp-org-filter-trigger').trigger('click')
    await nextTick()
    const options = wrapper.findAll('.ecp-org-filter-option')
    expect(options).toHaveLength(2)
    await options[1].trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['direct']])
    wrapper.unmount()
  })
})
