import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const browserQaApi = (): Plugin => {
  const assets: Array<Record<string, unknown>> = [
    { id: 'QA-LX-001', name: '凌雄租赁笔记本', status: '空闲', category: 'IT设备', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', ownerCompany: '示例公司', location: '杭州仓库', custodian: '测试管理员', model: 'ThinkBook 14+', brand: 'Lenovo', sn: 'LX-QA-001', assetTag: '', supplier: '凌雄租赁', price: 6800, purchaseDate: '2026-07-01', warrantyDate: '', note: '' },
    { id: 'QA-OWN-002', name: '自有显示器', status: '空闲', category: '显示器', type: '设备', owner: '未分配', ownerSubject: '', department: '', company: '示例公司', ownerCompany: '示例公司', location: '杭州仓库', custodian: '测试管理员', model: 'U2724D', brand: 'Dell', sn: 'QA-OWN-002', assetTag: '', supplier: '普通供应商', price: 3200, purchaseDate: '2026-07-01', warrantyDate: '', note: '' }
  ]
  const disposals: Array<Record<string, unknown>> = []
  const json = (response: import('node:http').ServerResponse, value: unknown, status = 200): void => {
    response.statusCode = status
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify(value))
  }
  const body = (request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> => new Promise((resolve) => {
    let value = ''
    request.on('data', (chunk) => { value += String(chunk) })
    request.on('end', () => { try { resolve(JSON.parse(value || '{}')) } catch { resolve({}) } })
  })

  return {
    name: 'browser-qa-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = String(request.url || '').split('?')[0]
        if (path === '/api/assets' && request.method === 'GET') return json(response, { items: assets, disposedCount: 1 })
        if (path === '/api/asset-operations') return json(response, { items: [], total: 0 })
        if (path === '/api/business-data') return json(response, { values: { requests: [], stocktakes: [] }, versions: {} })
        if (path === '/api/store') return json(response, { values: { assetCategoryTree: [], assetLocationTree: [] } })
        if (path === '/api/asset-disposals' && request.method === 'GET') return json(response, { items: disposals })
        if (path === '/api/asset-disposals' && request.method === 'POST') {
          const draft = await body(request)
          const ids = new Set(Array.isArray(draft.assetIds) ? draft.assetIds.map(String) : [])
          const lines: Array<Record<string, unknown>> = assets.filter((asset) => ids.has(String(asset.id))).map((asset) => ({ ...asset, assetId: asset.id, previousStatus: '空闲', status: '待处置' }))
          const lingxiongAssetIds = lines.filter((line) => String(line.supplier).includes('凌雄')).map((line) => String(line.assetId))
          const item = { ...draft, id: 'CZ202607310001', status: '待处置', createdAt: new Date().toISOString(), createdDate: '2026-07-31', assetCount: lines.length, assets: lines, lingxiongAssetIds, integrationRequired: lingxiongAssetIds.length > 0, syncStatus: lingxiongAssetIds.length ? '待推送' : '无需同步', managerReminderStatus: lingxiongAssetIds.length ? '待提醒' : '无需提醒' }
          disposals.unshift(item)
          assets.forEach((asset) => { if (ids.has(String(asset.id))) asset.status = '处置中' })
          return json(response, { item }, 201)
        }
        if (path.startsWith('/api/asset-disposals/') && path.endsWith('/complete')) {
          const id = path.split('/')[3]
          const item = disposals.find((candidate) => candidate.id === id) as { assets?: Array<Record<string, unknown>>; status?: string; completedAt?: string } | undefined
          item?.assets?.forEach((line) => { if (line.status === '待处置') line.status = '已处置' })
          if (item) {
            const statuses = new Set(item.assets?.map((line) => String(line.status)) || [])
            item.status = statuses.has('已取消') ? '部分取消' : '已处置'
            item.completedAt = new Date().toISOString()
          }
          return json(response, { items: disposals })
        }
        if (path.startsWith('/api/asset-disposals/') && path.endsWith('/cancel')) {
          const command = await body(request)
          const id = path.split('/')[3]
          const item = disposals.find((candidate) => candidate.id === id) as { assets?: Array<Record<string, unknown>>; status?: string } | undefined
          const ids = new Set(Array.isArray(command.assetIds) ? command.assetIds.map(String) : [])
          item?.assets?.forEach((line) => { if (ids.has(String(line.assetId))) line.status = '已取消' })
          const statuses = new Set(item?.assets?.map((line) => String(line.status)) || [])
          if (item) item.status = statuses.size === 1 && statuses.has('已取消') ? '已取消' : '部分取消'
          return json(response, { items: disposals })
        }
        next()
      })
    }
  }
}

export default defineConfig({
  plugins: [vue(), browserQaApi()],
  resolve: {
    alias: [
      { find: './ecp', replacement: new URL('./tests/e2e/mocks/ecp.ts', import.meta.url).pathname },
      { find: '../../ecp', replacement: new URL('./tests/e2e/mocks/ecp.ts', import.meta.url).pathname },
      { find: '@acg/ecp-auth-vue/workspace/vue', replacement: new URL('./tests/e2e/mocks/AuthzWorkspaceHost.vue', import.meta.url).pathname }
    ]
  },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true
  }
})
