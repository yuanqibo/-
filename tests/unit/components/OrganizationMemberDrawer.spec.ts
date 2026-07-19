import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import OrganizationMemberDrawer from '../../../src/features/organization/components/OrganizationMemberDrawer.vue'
import type { OrganizationMember } from '../../../src/features/organization/types/organization-directory'

const member: OrganizationMember = {
  subject: 'sub-1',
  unionId: 'union-1',
  externalId: 'external-1',
  accountSetUnionId: 'set-1',
  name: '张三',
  email: 'zhangsan@example.com',
  phone: '13800000000',
  employeeNo: 'A0001',
  jobTitle: '工程师',
  status: 'enabled',
  companyUnionId: 'company-1',
  companyName: '示例公司',
  departments: [{ unionId: 'dep-1', externalId: null, name: '研发部', nodeType: 'department', path: '/', leaderName: '李经理' }],
  company: '示例公司',
  department: '研发部',
  accountSetName: '飞书账号集',
  accountSetSourceType: 'FEISHU',
  accountSetSyncMode: 'auto'
}

describe('OrganizationMemberDrawer', () => {
  it('renders member fields and emits close from the accessible drawer', async () => {
    const wrapper = mount(OrganizationMemberDrawer, {
      attachTo: document.body,
      props: { modelValue: true, member },
      global: { plugins: [ElementPlus], stubs: { Teleport: true } }
    })
    await nextTick()

    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('成员详情')
    expect(wrapper.text()).toContain('张三')
    expect(wrapper.text()).toContain('zhangsan@example.com')
    await wrapper.get('button[aria-label="关闭"]').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    wrapper.unmount()
  })
})
