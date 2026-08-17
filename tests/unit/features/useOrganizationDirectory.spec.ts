import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationConsole } from '../../../src/features/organization/types/organization-directory'

const { getOrganizationConsole, getAccountSetInitializationData } = vi.hoisted(() => ({ getOrganizationConsole: vi.fn(), getAccountSetInitializationData: vi.fn() }))
vi.mock('../../../src/features/organization/api/organization-directory.api', () => ({ getOrganizationConsole, getAccountSetInitializationData }))

import { useOrganizationDirectory } from '../../../src/features/organization/composables/useOrganizationDirectory'

const organization: OrganizationConsole = {
  accountSets: [{ unionId: 'set-1', name: '飞书账号集', code: 'FS', status: 'enabled', sourceType: 'FEISHU', setType: 'internal', configStatus: 'ready', syncMode: 'auto', syncStatus: 'ok', syncVersion: 1, dataVersion: 1, lastSyncAt: null }],
  roots: [{ key: 'root', unionId: 'dep-root', externalId: null, name: '示例公司', nodeType: 'company', path: '/', fullPath: '/', status: 'enabled', sourceType: 'FEISHU', accountSetUnionId: 'set-1', companyUnionId: 'company-1', parentUnionId: null, leaderName: null, level: 0, directSubjects: ['sub-1'], memberSubjects: ['sub-1', 'sub-2'], children: [] }],
  users: [
    { subject: 'sub-1', unionId: 'u1', externalId: null, accountSetUnionId: 'set-1', name: '张三', email: 'zs@example.com', phone: null, employeeNo: 'A001', jobTitle: '工程师', status: 'enabled', companyUnionId: 'company-1', companyName: '示例公司', departments: [{ unionId: 'dep-root', externalId: null, name: '研发部', nodeType: 'department', path: '/', leaderName: null }], leaderDepartmentNames: ['研发部'] },
    { subject: 'sub-2', unionId: 'u2', externalId: null, accountSetUnionId: 'set-1', name: '李四', email: 'ls@example.com', phone: null, employeeNo: 'A002', jobTitle: '设计师', status: 'disabled', companyUnionId: 'company-1', companyName: '示例公司', departments: [{ unionId: 'dep-root', externalId: null, name: '设计部', nodeType: 'department', path: '/', leaderName: null }], leaderDepartmentNames: [] }
  ],
  capabilities: { sync: false, syncConfiguration: false, accountSetSettings: false, unavailableReason: null },
  warnings: [],
  fetchedAt: null
}

describe('useOrganizationDirectory', () => {
  beforeEach(() => { vi.useFakeTimers(); getOrganizationConsole.mockResolvedValue(organization) })
  afterEach(() => { vi.useRealTimers() })

  it('loads hierarchy, filters status and supports pinyin search', async () => {
    let directory!: ReturnType<typeof useOrganizationDirectory>
    const wrapper = mount(defineComponent({ setup: () => { directory = useOrganizationDirectory(); return () => h('div') } }))
    await directory.load()
    expect(directory.selectedNode.value?.name).toBe('示例公司')
    expect(directory.total.value).toBe(2)

    directory.accountStatus.value = 'enabled'
    await nextTick()
    expect(directory.visibleMembers.value.map((item) => item.name)).toEqual(['张三'])

    directory.accountStatus.value = 'all'
    directory.keyword.value = 'zs'
    await vi.advanceTimersByTimeAsync(200)
    expect(directory.visibleMembers.value.map((item) => item.name)).toEqual(['张三'])
    wrapper.unmount()
  })

  it('reports API failures and preserves a retryable state', async () => {
    getOrganizationConsole.mockRejectedValue(new Error('组织接口失败'))
    let directory!: ReturnType<typeof useOrganizationDirectory>
    const wrapper = mount(defineComponent({ setup: () => { directory = useOrganizationDirectory(); return () => h('div') } }))
    await directory.load()
    expect(directory.errorMessage.value).toBe('组织接口失败')
    expect(directory.organization.value).toBeNull()
    wrapper.unmount()
  })
})
