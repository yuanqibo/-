import type { Page, Request } from '@playwright/test'

export type ApiMockOptions = {
  assets?: Array<Record<string, unknown>>
  categoryTree?: Array<Record<string, unknown>>
  locationTree?: Array<Record<string, unknown>>
  failAssets?: boolean
  handoverApprovalRequired?: boolean
  borrowApprovalRequired?: boolean
  borrowCategories?: string[]
  borrowEnabled?: boolean
  giveBackEnabled?: boolean
  receiveApprovalRequired?: boolean
  receiveCategories?: string[]
  receiveEnabled?: boolean
  returnEnabled?: boolean
  selfServiceEnabled?: boolean
}
export type ApiMockState = {
  requests: Array<{ method: string; path: string; body: unknown }>
  approvals: Array<Record<string, unknown>>
}

const assets = Array.from({ length: 45 }, (_, index) => ({
  id: `AST-${String(index + 1).padStart(4, '0')}`,
  name: index === 0 ? '测试笔记本' : `测试显示器 ${index + 1}`,
  status: index % 5 === 0 ? '在用' : index % 7 === 0 ? '借用中' : '闲置',
  category: index % 2 === 0 ? 'IT设备' : '显示器',
  type: '设备', owner: index % 5 === 0 ? '张三' : '未分配', ownerSubject: index % 5 === 0 ? 'sub-1' : '',
  department: index % 5 === 0 ? '研发部' : '', company: '示例公司', location: '杭州仓库', custodian: '管理员',
  model: `M-${index + 1}`, brand: '测试品牌', sn: `SN-${index + 1}`, assetTag: '', supplier: '测试供应商',
  price: 5000 + index, purchaseDate: '2026-07-01', warrantyDate: '2029-07-01', note: '', lifecycle: [['2026-07-01', '资产入库', '管理员']]
}))

const requests = [
  { id: 'REQ-001', type: '资产领用', applicant: '张三', asset: '测试笔记本', reason: '项目需要', status: '审批中', system: 'ECP审批', date: '2026-07-18', currentNode: '直属主管' },
  { id: 'REQ-002', type: '资产借用', applicant: '李四', asset: '测试显示器', reason: '', status: '已完成', system: 'ECP审批', date: '2026-07-17', currentNode: '已归档' }
]

const assetOperations = [
  { id: 'RK-001', type: 'INBOUND', assetId: 'AST-0001', status: '已入库', date: '2026-07-01', operator: '管理员', company: '示例公司', location: '杭州仓库', sourceType: '新增资产' },
  { id: 'LY-001', type: 'RECEIVE', assetId: 'AST-0001', status: '已完成', date: '2026-07-10', operator: '管理员', party: '张三', company: '示例公司', department: '研发部', location: '研发办公室' },
  { id: 'TK-001', type: 'RETURN', assetId: 'AST-0006', status: '已完成', date: '2026-07-16', operator: '管理员', party: '员工6', company: '示例公司', department: '综合部', location: '杭州仓库' },
  { id: 'JY-001', returnOrderId: 'GH-001', type: 'BORROW', assetId: 'AST-0008', status: '待归还', date: '2026-07-12', expectedReturnDate: '2026-07-22', operator: '管理员', party: '员工8', company: '示例公司', department: '综合部', location: '会议室' },
  { id: 'GH-002', type: 'BORROW_RETURN', assetId: 'AST-0015', status: '已完成', date: '2026-07-18', operator: '管理员', party: '员工15', company: '示例公司', department: '综合部', location: '杭州仓库' },
  { id: 'JJ-001', type: 'HANDOVER', assetId: 'AST-0001', status: '待签字', date: '2026-07-19', operator: '管理员', party: '李四', company: '示例公司', department: '研发部', location: '研发办公室', canSign: true }
]

const employees = Array.from({ length: 60 }, (_, index) => ({
  subject: `sub-${index + 1}`, unionId: `user-${index + 1}`, externalId: `ext-${index + 1}`, accountSetUnionId: 'set-1',
  name: index === 0 ? '张三' : `员工${index + 1}`, displayName: null, email: `user${index + 1}@example.com`, phone: '', employeeNo: `A${String(index + 1).padStart(4, '0')}`,
  jobTitle: index === 0 ? '工程师' : '员工', status: index === 2 ? 'disabled' : 'enabled',
  company: { unionId: 'company-1', externalId: null, name: '示例公司', accountSetUnionId: 'set-1' },
  departments: [{ unionId: 'dep-root', externalId: null, name: index === 0 ? '研发部' : '综合部', path: '/示例公司' }]
}))

const organization = {
  accountSets: [{ unionId: 'set-1', name: '飞书账号集', code: 'FS', status: 'enabled', sourceType: 'FEISHU', setType: 'internal', configStatus: 'ready', syncMode: 'auto', syncStatus: 'ok', syncVersion: 1, dataVersion: 1, lastSyncAt: '2026-07-19T10:00:00Z' }],
  roots: [{ key: 'root', unionId: 'dep-root', externalId: null, name: '示例公司', nodeType: 'company', path: '/', fullPath: '/示例公司', status: 'enabled', sourceType: 'FEISHU', accountSetUnionId: 'set-1', companyUnionId: 'company-1', parentUnionId: null, leaderName: '管理员', level: 0, directSubjects: ['sub-1'], memberSubjects: employees.slice(0, 45).map((item) => item.subject), children: [{ key: 'dep-rd', unionId: 'dep-rd', externalId: null, name: '研发部', nodeType: 'department', path: '/示例公司', fullPath: '/示例公司/研发部', status: 'enabled', sourceType: 'FEISHU', accountSetUnionId: 'set-1', companyUnionId: 'company-1', parentUnionId: 'dep-root', leaderName: '张三', level: 1, directSubjects: ['sub-1'], memberSubjects: ['sub-1'], children: [] }] }],
  users: employees.slice(0, 45).map((item) => ({ ...item, companyUnionId: 'company-1', companyName: '示例公司', departments: item.departments.map((department) => ({ ...department, nodeType: 'department', leaderName: '张三' })) })),
  capabilities: { sync: false, syncConfiguration: false, accountSetSettings: false, unavailableReason: null }, warnings: [], fetchedAt: '2026-07-19T10:00:00Z'
}

const storeValues = {
  assetCategoryTree: [{ id: 'cat-it', code: '01', name: 'IT设备', enabled: true, unit: '台', usefulLife: '36', children: [] }],
  assetLocationTree: [{ id: 'loc-hz', code: 'HZ', name: '杭州仓库', enabled: true, children: [] }],
  assetPortalAssetCodeRuleSettingsV1: { selectedFields: ['categoryCode'], serialLength: 5, customTexts: { customText: '' } },
  assetLabelPrintSettingsV2: { templateKey: 'standard', labelWidth: 40, labelHeight: 30, fields: ['name', 'id'], columns: 2, rows: 2, fontSize: 12, showLogo: false },
  assetLabelCustomTemplatesV1: [],
  assetPortalSelfServiceSettingsV9: { receiveAsset: { enabled: true, approvalRequired: true, remarkRequired: false, remarkPrompt: '', categories: ['IT设备'] }, returnAsset: { enabled: true, remarkRequired: false, remarkPrompt: '' }, borrowAsset: { enabled: true, approvalRequired: true, remarkRequired: false, remarkPrompt: '', categories: ['IT设备'] }, giveBackAsset: { enabled: true, remarkRequired: false, remarkPrompt: '' }, handoverAsset: { enabled: true, approvalRequired: true, remarkRequired: false, remarkPrompt: '' }, deviceRequest: { enabled: false, remarkRequired: false, remarkPrompt: '', allowEmployeeAddDevice: true }, signSettings: {} }
}

const jsonBody = (request: Request): unknown => {
  try { return request.postDataJSON() }
  catch { return null }
}

export const installApiMocks = async (page: Page, options: ApiMockOptions = {}): Promise<ApiMockState> => {
  const currentAssets: Array<Record<string, unknown>> = (options.assets || assets).map((item) => ({ ...item }))
  const businessRequests: Array<Record<string, unknown>> = requests.map((item) => ({ ...item }))
  const state: ApiMockState = { requests: [], approvals: businessRequests }
  const approvalRequired = options.handoverApprovalRequired !== false
  const borrowApprovalRequired = options.borrowApprovalRequired !== false
  const receiveApprovalRequired = options.receiveApprovalRequired !== false
  const returnEnabled = options.returnEnabled !== false
  const selfServiceEnabled = options.selfServiceEnabled !== false
  const currentStoreValues = {
    ...storeValues,
    assetCategoryTree: options.categoryTree || storeValues.assetCategoryTree,
    assetLocationTree: options.locationTree || storeValues.assetLocationTree,
    assetPortalSelfServiceSettingsV9: {
      ...storeValues.assetPortalSelfServiceSettingsV9,
      receiveAsset: {
        ...storeValues.assetPortalSelfServiceSettingsV9.receiveAsset,
        enabled: selfServiceEnabled && options.receiveEnabled !== false,
        approvalRequired: receiveApprovalRequired,
        categories: options.receiveCategories || storeValues.assetPortalSelfServiceSettingsV9.receiveAsset.categories
      },
      returnAsset: { ...storeValues.assetPortalSelfServiceSettingsV9.returnAsset, enabled: selfServiceEnabled && returnEnabled },
      borrowAsset: {
        ...storeValues.assetPortalSelfServiceSettingsV9.borrowAsset,
        enabled: selfServiceEnabled && options.borrowEnabled !== false,
        approvalRequired: borrowApprovalRequired,
        categories: options.borrowCategories || storeValues.assetPortalSelfServiceSettingsV9.borrowAsset.categories
      },
      giveBackAsset: { ...storeValues.assetPortalSelfServiceSettingsV9.giveBackAsset, enabled: selfServiceEnabled && options.giveBackEnabled !== false },
      handoverAsset: { ...storeValues.assetPortalSelfServiceSettingsV9.handoverAsset, enabled: selfServiceEnabled, approvalRequired }
    }
  }
  await page.route('http://127.0.0.1:4174/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const path = `${url.pathname}${url.search}`
    const body = jsonBody(request)
    state.requests.push({ method, path, body })
    const fulfill = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) })

    if (url.pathname === '/api/auth/ecp/me' && method === 'GET') {
      return fulfill({ user: { roleCode: 'super_admin', permissionCodes: [], featureCodes: [] } })
    }
    if (url.pathname === '/api/assets' && method === 'GET') return options.failAssets ? fulfill({ error: '资产服务暂不可用' }, 503) : fulfill({ items: currentAssets })
    if (url.pathname === '/api/asset-operations' && method === 'GET') return fulfill({ items: assetOperations, total: assetOperations.length, page: 1, size: 500 })
    if (url.pathname === '/api/assets' && method === 'POST') return fulfill({ item: { ...assets[0], ...(body as { item?: object })?.item, id: 'AST-NEW' } }, 201)
    if (url.pathname === '/api/assets/import') return fulfill({ items: [] }, 201)
    if (url.pathname.startsWith('/api/assets/commands/')) return fulfill({ items: currentAssets.slice(0, 1) })
    if (url.pathname === '/api/business-data' && method === 'GET') return fulfill({ values: { requests: businessRequests, stocktakes: [{ id: 'STK-001', name: '季度盘点', scope: '全部资产', owner: '管理员', progress: '盘点中', total: 45, checked: 20, diff: 1, date: '2026-07-20' }], consumables: [], repairs: [], contracts: [] }, versions: {} })
    if (url.pathname === '/api/business-data/requests' && method === 'POST') {
      const draft = body as { type?: string; applicant?: string; asset?: string; reason?: string; details?: Record<string, unknown> }
      const handover = draft.type === '资产交接'
      const selfServiceReturn = draft.type === '资产退还'
      const selfServiceGiveBack = draft.type === '资产归还'
      const selfServiceReceive = draft.type === '资产领用'
      const selfServiceBorrow = draft.type === '资产借用'
      const immediate = handover && !approvalRequired || selfServiceReceive && !receiveApprovalRequired || selfServiceBorrow && !borrowApprovalRequired
      const selfServiceRequest = handover || selfServiceReturn || selfServiceGiveBack || selfServiceReceive || selfServiceBorrow
      const item: Record<string, unknown> = {
        id: 'REQ-NEW',
        ...draft,
        ...(draft.details || {}),
        selfServiceRequest,
        status: selfServiceRequest ? immediate ? '已同意' : '待审批' : '审批中',
        system: immediate ? '系统自动审批' : selfServiceRequest ? '资产管理员审批' : 'ECP审批',
        currentNode: immediate ? '已归档' : selfServiceRequest ? '管理员审批' : '直属主管',
        date: '2026-07-22'
      }
      businessRequests.unshift(item)
      if (immediate) {
        const ids = new Set(Array.isArray(draft.details?.assetIds) ? draft.details.assetIds.map(String) : [])
        currentAssets.forEach((asset) => {
          if (!ids.has(String(asset.id))) return
          if (selfServiceReceive) {
            asset.owner = String(draft.applicant || '')
            asset.ownerSubject = 'E2E001'
            asset.status = '在用'
            asset.location = String(draft.details?.receiveLocation || asset.location || '')
            asset.receiveDate = String(draft.details?.receiveDate || '')
          } else if (selfServiceBorrow) {
            asset.owner = String(draft.applicant || '')
            asset.ownerSubject = 'E2E001'
            asset.status = '借用中'
            asset.location = String(draft.details?.borrowLocation || asset.location || '')
            asset.borrowDate = String(draft.details?.borrowDate || '')
            asset.expectedReturnDate = String(draft.details?.expectedReturnDate || '')
          } else {
            asset.owner = String(draft.details?.receiverName || '')
            asset.ownerSubject = String(draft.details?.receiverSubject || '')
            asset.location = String(draft.details?.handoverLocation || asset.location || '')
          }
        })
      }
      return fulfill({ item }, 201)
    }
    if (url.pathname.includes('/api/business-data/requests/') && url.pathname.endsWith('/decision')) return fulfill({ items: requests.map((item) => item.id === 'REQ-001' ? { ...item, status: '已完成', currentNode: '已归档' } : item) })
    if (url.pathname === '/api/business-data/stocktakes' && method === 'POST') return fulfill({ item: { id: 'STK-NEW', ...(body as object) } }, 201)
    if (url.pathname.startsWith('/api/business-data/stocktakes/') && method === 'PATCH') return fulfill({ items: [] })
    if (url.pathname === '/api/store' && method === 'GET') return fulfill({ values: currentStoreValues })
    if (url.pathname === '/api/store' && method === 'POST') return fulfill({ values: currentStoreValues })
    if (url.pathname.startsWith('/api/config/')) return fulfill({ ok: true })
    if (url.pathname === '/api/ecp/organization') return fulfill(organization)
    if (url.pathname.includes('/api/ecp/control-plane/iam/account-sets')) return fulfill({ items: organization.accountSets })
    if (url.pathname === '/api/ecp/directory/users') {
      const query = (url.searchParams.get('query') || '').toLowerCase()
      const current = Number(url.searchParams.get('page') || 1)
      const size = Number(url.searchParams.get('size') || 50)
      const filtered = employees.filter((item) => !query || [item.name, item.employeeNo, item.email].some((value) => value.toLowerCase().includes(query)))
      const start = (current - 1) * size
      return fulfill({ items: filtered.slice(start, start + size), current, size, total: filtered.length, totalPages: Math.ceil(filtered.length / size), hasNext: start + size < filtered.length })
    }
    if (url.pathname === '/api/system/integrations' && method === 'GET') return fulfill({ items: [{ id: 'int-1', code: 'ECP', name: 'ECP平台', provider: 'ECP', baseUrl: 'https://ecp.example.com', enabled: true, config: {}, secretConfigured: true, version: 1, updatedAt: '2026-07-19T10:00:00Z' }] })
    if (url.pathname === '/api/system/forms' && method === 'GET') return fulfill({ items: [{ id: 'form-1', code: 'ASSET_APPLY', name: '资产申请表', description: '资产申请', enabled: true, schema: {}, version: 1, updatedAt: '2026-07-19T10:00:00Z' }] })
    return fulfill({ error: `Unhandled test API: ${method} ${path}` }, 501)
  })
  return state
}
