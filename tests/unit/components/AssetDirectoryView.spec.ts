import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const useAssetsMock = vi.hoisted(() => vi.fn())
const usePortalSessionMock = vi.hoisted(() => vi.fn())
const useTerminalModeMock = vi.hoisted(() => vi.fn())
const searchDirectoryPeopleMock = vi.hoisted(() => vi.fn())

vi.mock('../../../src/features/assets/composables/useAssets', () => ({ useAssets: useAssetsMock }))
vi.mock('../../../src/core/auth/portal-session', () => ({ usePortalSession: usePortalSessionMock }))
vi.mock('../../../src/core/auth/terminal-mode', () => ({ useTerminalMode: useTerminalModeMock }))
vi.mock('../../../src/features/assets/api/assets.api', () => ({ searchDirectoryPeople: searchDirectoryPeopleMock }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

import AssetDirectoryView from '../../../src/features/assets/components/AssetDirectoryView.vue'

const assets = Array.from({ length: 1832 }, (_, index) => ({
  id: `AST-${index + 1}`,
  name: `资产${index + 1}`,
  status: index % 5 === 0 ? '领用' : '空闲',
  category: 'IT设备', type: '设备', owner: index % 5 === 0 ? '张三' : '未分配', ownerSubject: '',
  department: '', company: '示例公司', location: '仓库', custodian: '管理员', model: 'M1', brand: '品牌', sn: `SN-${index + 1}`,
  assetTag: '', supplier: '', price: 1, purchaseDate: '2026-08-01', warrantyDate: '', note: ''
}))

const operations = [
  { id: 'RK-1', type: 'INBOUND', assetId: 'AST-1', status: '已入库', date: '2026-08-01', operator: '管理员', company: '示例公司', location: '仓库', sourceType: '新增资产' },
  { id: 'LY-1', type: 'RECEIVE', assetId: 'AST-1', status: '已完成', date: '2026-08-02', operator: '管理员', party: '张三', company: '示例公司', location: '办公室' },
  { id: 'TK-1', type: 'RETURN', assetId: 'AST-1', status: '已完成', date: '2026-08-03', operator: '管理员', party: '张三', company: '示例公司', location: '仓库' }
]

describe('asset directory render smoke', () => {
  it.each(['inbound', 'receive-return'] as const)('mounts %s with production-shaped data', async (mode) => {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
    useAssetsMock.mockReturnValue({
      state: { loading: false, errorMessage: '' }, assets: { value: assets }, operations: { value: operations },
      business: { value: { requests: [] } }, store: { value: { assetCategoryTree: [], assetLocationTree: [] } },
      load: vi.fn(), loadAssets: vi.fn(), loadOperations: vi.fn(), loadStore: vi.fn(), create: vi.fn(), copy: vi.fn(), importMany: vi.fn(), replaceAll: vi.fn(), command: vi.fn()
    })
    usePortalSessionMock.mockReturnValue({ user: { value: { name: '管理员', company: '示例公司', permissionCodes: ['asset:item:view', 'asset:inbound:view', 'asset:receive_return:view', 'asset:item:advancedSearch', 'asset:item:columnSettings'] } } })
    useTerminalModeMock.mockReturnValue({ isEmployeeTerminal: { value: false } })
    const errors: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => { errors.push(args); original(...args) }
    try {
      const wrapper = mount(AssetDirectoryView, {
        props: { mode },
        global: {
          stubs: { ElAlert: true, ElDropdown: true, ElDropdownMenu: true, ElDropdownItem: true, ElSelect: true, ElOption: true, ElDrawer: true, ElDialog: true, ElTable: true, ElTableColumn: true, ElPagination: true, ElForm: true, ElFormItem: true, ElInput: true, ElInputNumber: true, ElDatePicker: true, ElAutocomplete: true, ElButton: true, ElCheckbox: true, ElCheckboxGroup: true, ElRadio: true, ElRadioGroup: true, ElRadioButton: true, ElPopover: true, ElTreeSelect: true, ElTooltip: true, ElIcon: true, ElAvatar: true, ElEmpty: true, ElResult: true, ElProgress: true, ElSkeleton: true, ElSwitch: true, ElTabs: true, ElTabPane: true, ElTag: true },
          directives: { loading: {}, 'resizable-columns': {} }
        }
      })
      await wrapper.vm.$nextTick()
      expect(wrapper.find('section.asset-list-page').exists()).toBe(true)
      expect(wrapper.text()).toContain(mode === 'inbound' ? '入库状态' : '领用状态')
      wrapper.unmount()
    } finally {
      console.error = original
    }
    expect(errors.filter((args) => Array.isArray(args) && String(args[0]).includes('[Vue warn]')).length).toBe(0)
  })
})
