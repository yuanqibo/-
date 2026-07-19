import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '../../../src/features/assets/types/assets'

const asset = (id: string, name: string, status = '闲置'): AssetRecord => ({
  id, name, status, category: 'IT设备', type: '设备', owner: '未分配', department: '', company: '示例公司', location: '仓库', custodian: '管理员', model: '', brand: '', sn: '', assetTag: '', supplier: '', price: 0, purchaseDate: '2026-07-19', warrantyDate: ''
})

const api = vi.hoisted(() => ({
  createAsset: vi.fn(), copyAsset: vi.fn(), createStocktake: vi.fn(), fetchAssetOperations: vi.fn(), fetchAssets: vi.fn(), fetchBusinessData: vi.fn(), fetchPortalStore: vi.fn(), importAssets: vi.fn(), runAssetCommand: vi.fn(), saveAssetCodeSettings: vi.fn(), saveCatalog: vi.fn(), saveLabelSettings: vi.fn(), updateStocktake: vi.fn()
}))
vi.mock('../../../src/features/assets/api/assets.api', () => api)

import { useAssets } from '../../../src/features/assets/composables/useAssets'

describe('useAssets', () => {
  beforeEach(() => {
    Object.values(api).forEach((mock) => mock.mockReset())
    api.fetchAssets.mockResolvedValue([asset('AST-1', '笔记本')])
    api.fetchAssetOperations.mockResolvedValue([])
    api.fetchBusinessData.mockResolvedValue({ values: { stocktakes: [] } })
    api.fetchPortalStore.mockResolvedValue({})
  })

  it('loads all feature sources and keeps command updates in sync', async () => {
    const assets = useAssets()
    await assets.load(true)
    expect(assets.assets.value.map((item) => item.id)).toEqual(['AST-1'])

    api.createAsset.mockResolvedValue(asset('AST-2', '显示器'))
    await assets.create({ name: '显示器', category: 'IT设备', location: '仓库' })
    expect(assets.assets.value.map((item) => item.id)).toEqual(['AST-2', 'AST-1'])

    api.runAssetCommand.mockResolvedValue([{ ...asset('AST-1', '笔记本', '在用'), owner: '张三' }])
    await assets.command('receive', ['AST-1'], { receiver: '张三' })
    expect(assets.assets.value.find((item) => item.id === 'AST-1')).toMatchObject({ status: '在用', owner: '张三' })

    api.runAssetCommand.mockResolvedValue([])
    await assets.command('delete', ['AST-2'], {})
    expect(assets.assets.value.map((item) => item.id)).toEqual(['AST-1'])
  })

  it('surfaces failed primary asset loading', async () => {
    api.fetchAssets.mockRejectedValue(new Error('资产接口失败'))
    const assets = useAssets()
    await assets.load(true)
    expect(assets.state.errorMessage).toBe('资产接口失败')
    expect(assets.state.loading).toBe(false)
  })
})
