import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }))
vi.mock('../../../src/shared/api/http', () => ({ apiRequest }))

import {
  copyAsset,
  createAsset,
  runAssetCommand,
  searchDirectoryPeople,
  updateStocktake
} from '../../../src/features/assets/api/assets.api'

describe('assets feature API', () => {
  beforeEach(() => apiRequest.mockReset())

  it('keeps create and copy payloads compatible with the Java API', async () => {
    apiRequest.mockResolvedValue({ item: { id: 'AST-1' } })
    const draft = { name: '笔记本', category: 'IT设备', location: '仓库' }
    await createAsset(draft)
    expect(apiRequest).toHaveBeenLastCalledWith('/api/assets', { method: 'POST', body: { item: draft } })

    await copyAsset('AST-1', draft)
    expect(apiRequest).toHaveBeenLastCalledWith('/api/assets', { method: 'POST', body: { sourceAssetId: 'AST-1', item: draft } })
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
})
