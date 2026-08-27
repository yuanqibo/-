import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('../../../src/shared/api/http', () => ({ apiRequest }))

import {
  copyAsset,
  createAsset,
  fetchAssetCatalog,
  fetchAssetOperations,
  fetchAssets,
  fetchBusinessData,
  fetchPortalStore,
  invalidateAssetDataCache,
  runAssetCommand,
  saveLabelSettings,
  searchDirectoryPeople,
  updateStocktake
} from '../../../src/features/assets/api/assets.api'

describe('assets feature API', () => {
  beforeEach(() => {
    apiRequest.mockReset()
    invalidateAssetDataCache()
  })

  it('keeps create and copy payloads compatible with the Java API', async () => {
    apiRequest.mockResolvedValue({ item: { id: 'AST-1' } })
    const draft = { name: '笔记本', category: 'IT设备', location: '仓库' }
    await createAsset(draft)
    expect(apiRequest).toHaveBeenLastCalledWith('/api/assets', { method: 'POST', body: { item: draft } })

    await copyAsset('AST-1', draft)
    expect(apiRequest).toHaveBeenLastCalledWith('/api/assets', { method: 'POST', body: { sourceAssetId: 'AST-1', item: draft } })
  })

  it('reuses recent asset reads and invalidates them after a write', async () => {
    apiRequest.mockResolvedValueOnce({ items: [{ id: 'AST-1' }], disposedCount: 2 })
    await fetchAssets()
    await expect(fetchAssetCatalog()).resolves.toEqual({ items: [{ id: 'AST-1' }], disposedCount: 2 })
    expect(apiRequest).toHaveBeenCalledTimes(1)

    apiRequest.mockResolvedValueOnce({ item: { id: 'AST-2' } })
    await createAsset({ name: '显示器', category: 'IT设备', location: '仓库' })
    apiRequest.mockResolvedValueOnce({ items: [{ id: 'AST-1' }, { id: 'AST-2' }] })
    await fetchAssets()
    expect(apiRequest).toHaveBeenCalledTimes(3)
  })

  it('normalizes empty successful catalog and business responses', async () => {
    apiRequest.mockResolvedValueOnce(null).mockResolvedValueOnce(null)

    await expect(fetchAssetCatalog()).resolves.toEqual({ items: [], disposedCount: 0 })
    await expect(fetchBusinessData()).resolves.toEqual({})
  })

  it('drops malformed collection values before pages consume them', async () => {
    apiRequest
      .mockResolvedValueOnce({ items: null, total: 2 })
      .mockResolvedValueOnce({ values: { requests: {}, stocktakes: [{ id: 'STK-1' }, null] } })
      .mockResolvedValueOnce({ values: [] })

    await expect(fetchAssetOperations()).resolves.toEqual([])
    await expect(fetchBusinessData()).resolves.toMatchObject({ values: { requests: [], stocktakes: [{ id: 'STK-1' }] } })
    await expect(fetchPortalStore()).resolves.toEqual({})
  })

  it('encodes command and stocktake identifiers', async () => {
    apiRequest.mockResolvedValue({ items: [] })
    await runAssetCommand('batch-edit', ['AST/1'], { location: '仓库' })
    expect(apiRequest).toHaveBeenLastCalledWith('/api/assets/commands/batch-edit', {
      method: 'POST', body: { assetIds: ['AST/1'], fields: { location: '仓库' } }
    })

    await updateStocktake('STK/1', { checked: 3, diff: 1 })
    expect(apiRequest).toHaveBeenLastCalledWith('/api/business-data/stocktakes/STK%2F1', {
      method: 'PATCH', body: { checked: 3, diff: 1 }
    })
  })

  it('writes label settings using the single-key Java API payload', async () => {
    apiRequest.mockResolvedValue({ ok: true })
    await saveLabelSettings({ assetLabelPrintSettingsV2: { templateKey: 'access' } }, 'save')
    expect(apiRequest).toHaveBeenLastCalledWith('/api/store', {
      method: 'POST',
      body: { key: 'assetLabelPrintSettingsV2', value: { templateKey: 'access' }, operation: 'save' }
    })
  })

  it('normalizes and filters ECP directory people', async () => {
    apiRequest.mockResolvedValue({ items: [
      { directorySubject: 'sub-1', displayName: '张三', employeeNo: 'A001', email: 'zs@example.com', company: { name: '示例公司' }, departments: [{ name: '研发部' }] },
      { displayName: '无标识账号' }
    ] })
    await expect(searchDirectoryPeople('研发')).resolves.toEqual([{
      subject: 'sub-1', name: '张三', account: 'A001', email: 'zs@example.com', department: '研发部', company: '示例公司'
    }])
    const requestUrl = new URL(String(apiRequest.mock.calls[0][0]), 'http://localhost')
    expect(requestUrl.pathname).toBe('/api/ecp/directory/users')
    expect(requestUrl.searchParams.get('query')).toBe('研发')
    expect(requestUrl.searchParams.has('q')).toBe(false)
  })

  it('falls back to local pinyin filtering when the directory does not index pinyin', async () => {
    apiRequest.mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [
      { directorySubject: 'sub-yqb', displayName: '袁其博', employeeNo: 'A002' }
    ] })

    await expect(searchDirectoryPeople('yqb')).resolves.toEqual([{
      subject: 'sub-yqb', name: '袁其博', account: 'A002', email: '', department: '', company: ''
    }])
    expect(new URL(String(apiRequest.mock.calls[1][0]), 'http://localhost').searchParams.get('query')).toBe('')
  })
})
