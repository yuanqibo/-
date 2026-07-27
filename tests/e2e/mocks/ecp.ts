import type { App as VueApp } from 'vue'
import type { RouteRecordRaw, Router } from 'vue-router'
import type { AuthzSessionContext } from '@acg/ecp-sdk'

export type { AuthzSessionContext } from '@acg/ecp-sdk'

type AccessInput = { permissions?: string[]; features?: string[] }
type TestMenu = { id: string; parentId?: string; title: string; path: string; pageKey: string; order: number; permissionCodes?: string[]; featureCodes?: string[]; permissionMode?: 'ANY' | 'ALL'; children?: TestMenu[] }

const allPermissions = [
  'asset:item:view', 'asset:item:create', 'asset:item:receive', 'asset:item:return', 'asset:item:borrow', 'asset:item:borrowReturn', 'asset:item:handover', 'asset:item:update', 'asset:item:delete', 'asset:item:copy', 'asset:item:batchUpdate', 'asset:item:assetImport', 'asset:item:updateImport', 'asset:item:receiveImport', 'asset:item:export', 'asset:item:printLabel', 'asset:item:advancedSearch', 'asset:item:columnSettings',
  'asset:inbound:view', 'asset:inbound:cancel', 'asset:receive_return:view', 'asset:receive_return:receive', 'asset:receive_return:return', 'asset:receive_return:handover', 'asset:receive_return:sign', 'asset:receive_return:cancel', 'asset:borrow_return:view', 'asset:borrow_return:borrow', 'asset:borrow_return:return', 'asset:borrow_return:extend', 'asset:stocktake:view', 'asset:stocktake:create', 'asset:stocktake:update',
  'asset:location_settings:view', 'asset:location_settings:create', 'asset:location_settings:update', 'asset:location_settings:delete', 'asset:location_settings:toggleCode', 'asset:location_settings:template', 'asset:location_settings:import', 'asset:location_settings:export',
  'asset:category_settings:view', 'asset:category_settings:create', 'asset:category_settings:update', 'asset:category_settings:delete', 'asset:category_settings:toggleCode', 'asset:category_settings:template', 'asset:category_settings:import', 'asset:category_settings:export',
  'asset:code_rules:view', 'asset:code_rules:update', 'asset:label_template_settings:view', 'asset:label_template_settings:create', 'asset:label_template_settings:update', 'asset:label_template_settings:delete', 'asset:label_template_settings:save',
  'asset:request:view', 'asset:request:create', 'asset:request:review', 'asset:employee:view', 'asset:department:view', 'asset:self_service:view', 'asset:self_service:update', 'asset:integration:view', 'asset:integration:create', 'asset:integration:update', 'asset:form:view', 'asset:form:create', 'asset:form:update', 'asset:form:delete',
  'authz:application:view', 'authz:application:edit', 'authz:model:view', 'authz:app_role:view', 'authz:app_role:assign'
]
const allFeatures = ['PORTAL_HOME', 'PORTAL_ASSETS', 'PORTAL_REQUESTS', 'PORTAL_SETTINGS', 'APP_WORKSPACE']

const routes: Array<RouteRecordRaw & { path: string }> = [
  { path: '/', name: 'e2e-home', component: () => import('../../../src/views/HomePage.vue') },
  { path: '/assets', name: 'e2e-assets', component: () => import('../../../src/views/AssetListPage.vue') },
  { path: '/assets/inbound', name: 'e2e-inbound', component: () => import('../../../src/views/AssetInboundPage.vue') },
  { path: '/assets/receive-return', name: 'e2e-receive-return', component: () => import('../../../src/views/AssetReceiveReturnPage.vue') },
  { path: '/assets/borrow-return', name: 'e2e-borrow-return', component: () => import('../../../src/views/AssetBorrowReturnPage.vue') },
  { path: '/assets/stocktake', name: 'e2e-stocktake', component: () => import('../../../src/views/StocktakePage.vue') },
  { path: '/assets/settings', name: 'e2e-asset-settings', component: () => import('../../../src/views/AssetSettingsPage.vue') },
  { path: '/assets/settings/locations', name: 'e2e-locations', component: () => import('../../../src/views/AssetLocationSettingsPage.vue') },
  { path: '/assets/settings/categories', name: 'e2e-categories', component: () => import('../../../src/views/AssetCategorySettingsPage.vue') },
  { path: '/assets/settings/code-rules', name: 'e2e-code-rules', component: () => import('../../../src/views/AssetCodeRulesPage.vue') },
  { path: '/assets/settings/label-templates', name: 'e2e-labels', component: () => import('../../../src/views/AssetLabelTemplatesPage.vue') },
  { path: '/requests', name: 'e2e-requests', component: () => import('../../../src/views/ApprovalsPage.vue') },
  { path: '/system', name: 'e2e-system', component: () => import('../../../src/views/SystemIndexView.vue') },
  { path: '/system/employees', name: 'e2e-employees', component: () => import('../../../src/views/EmployeeDirectoryPage.vue') },
  { path: '/system/departments', name: 'e2e-departments', component: () => import('../../../src/views/OrganizationDirectoryPage.vue') },
  { path: '/system/self-service', name: 'e2e-self-service', component: () => import('../../../src/views/SelfServiceSettingsPage.vue') },
  { path: '/system/integrations', name: 'e2e-integrations', component: () => import('../../../src/views/SystemIntegrationsPage.vue') },
  { path: '/system/forms', name: 'e2e-forms', component: () => import('../../../src/views/SystemFormsPage.vue') }
]

const assetSettingsChildren: TestMenu[] = [
  { id: 'assetLocationSettings', parentId: 'assetSettings', title: '位置管理', path: '/assets/settings/locations', pageKey: 'asset.portal.settings.locations', order: 31, permissionCodes: ['asset:location_settings:view'], featureCodes: ['PORTAL_ASSETS'] },
  { id: 'assetCategorySettings', parentId: 'assetSettings', title: '资产分类', path: '/assets/settings/categories', pageKey: 'asset.portal.settings.categories', order: 32, permissionCodes: ['asset:category_settings:view'], featureCodes: ['PORTAL_ASSETS'] },
  { id: 'assetCodeRules', parentId: 'assetSettings', title: '资产编码规则', path: '/assets/settings/code-rules', pageKey: 'asset.portal.settings.code-rules', order: 33, permissionCodes: ['asset:code_rules:view'], featureCodes: ['PORTAL_ASSETS'] },
  { id: 'assetLabelTemplateSettings', parentId: 'assetSettings', title: '标签模板设置', path: '/assets/settings/label-templates', pageKey: 'asset.portal.settings.label-templates', order: 34, permissionCodes: ['asset:label_template_settings:view'], featureCodes: ['PORTAL_ASSETS'] }
]
const menuTree: TestMenu[] = [
  { id: 'home', title: '首页', path: '/', pageKey: 'asset.portal.home', order: 10, permissionCodes: ['asset:item:view'], featureCodes: ['PORTAL_HOME'] },
  { id: 'assets', title: '资产', path: '/assets', pageKey: 'asset.portal.assets', order: 20, permissionCodes: ['asset:item:view'], featureCodes: ['PORTAL_ASSETS'], children: [
    { id: 'assetInbound', parentId: 'assets', title: '资产入库', path: '/assets/inbound', pageKey: 'asset.portal.inbound', order: 21, permissionCodes: ['asset:inbound:view'], featureCodes: ['PORTAL_ASSETS'] },
    { id: 'assetReceiveReturn', parentId: 'assets', title: '领用退库', path: '/assets/receive-return', pageKey: 'asset.portal.receive-return', order: 22, permissionCodes: ['asset:receive_return:view'], featureCodes: ['PORTAL_ASSETS'] },
    { id: 'assetBorrowReturn', parentId: 'assets', title: '借用归还', path: '/assets/borrow-return', pageKey: 'asset.portal.borrow-return', order: 23, permissionCodes: ['asset:borrow_return:view'], featureCodes: ['PORTAL_ASSETS'] },
    { id: 'stocktake', parentId: 'assets', title: '资产盘点', path: '/assets/stocktake', pageKey: 'asset.portal.stocktake', order: 24, permissionCodes: ['asset:stocktake:view'], featureCodes: ['PORTAL_ASSETS'] },
    { id: 'assetSettings', parentId: 'assets', title: '资产设置', path: '/assets/settings', pageKey: 'asset.portal.settings', order: 30, permissionCodes: ['asset:location_settings:view'], featureCodes: ['PORTAL_ASSETS'], children: assetSettingsChildren }
  ] },
  { id: 'requests', title: '审批', path: '/requests', pageKey: 'asset.portal.requests', order: 40, permissionCodes: ['asset:request:view'], featureCodes: ['PORTAL_REQUESTS'] },
  { id: 'settings', title: '系统', path: '/system', pageKey: 'asset.portal.system', order: 50, permissionMode: 'ANY', permissionCodes: ['asset:employee:view', 'asset:department:view', 'asset:self_service:view', 'asset:integration:view', 'asset:form:view'], featureCodes: ['PORTAL_SETTINGS'], children: [
    { id: 'settingsEmployee', parentId: 'settings', title: '员工信息', path: '/system/employees', pageKey: 'asset.portal.system.employees', order: 51, permissionCodes: ['asset:employee:view'], featureCodes: ['PORTAL_SETTINGS'] },
    { id: 'settingsDepartment', parentId: 'settings', title: '组织架构', path: '/system/departments', pageKey: 'asset.portal.system.departments', order: 52, permissionCodes: ['asset:department:view'], featureCodes: ['PORTAL_SETTINGS'] },
    { id: 'authz.workspace', parentId: 'settings', title: '成员授权', path: '/workspace', pageKey: 'authz.workspace', order: 53, permissionCodes: ['authz:application:view', 'authz:model:view', 'authz:app_role:view'], featureCodes: ['APP_WORKSPACE'] },
    { id: 'settingsSelfService', parentId: 'settings', title: '员工自助', path: '/system/self-service', pageKey: 'asset.portal.system.self-service', order: 54, permissionCodes: ['asset:self_service:view'], featureCodes: ['PORTAL_SETTINGS'] },
    { id: 'settingsIntegration', parentId: 'settings', title: '系统对接', path: '/system/integrations', pageKey: 'asset.portal.system.integrations', order: 55, permissionCodes: ['asset:integration:view'], featureCodes: ['PORTAL_SETTINGS'] },
    { id: 'settingsForm', parentId: 'settings', title: '表单管理', path: '/system/forms', pageKey: 'asset.portal.system.forms', order: 56, permissionCodes: ['asset:form:view'], featureCodes: ['PORTAL_SETTINGS'] }
  ] }
]

const currentPermissions = (): string[] => {
  try { return JSON.parse(localStorage.getItem('e2e:permissions') || 'null') || allPermissions }
  catch { return allPermissions }
}
const allowed = (input: AccessInput, mode: 'all' | 'any'): boolean => {
  const permissions = currentPermissions()
  const checks = [...(input.permissions || []).map((item) => permissions.includes(item)), ...(input.features || []).map((item) => allFeatures.includes(item))]
  return !checks.length || (mode === 'all' ? checks.every(Boolean) : checks.some(Boolean))
}
const session = (): AuthzSessionContext => ({
  sessionToken: 'e2e-session-token',
  roles: [{ code: 'APP_ADMIN', name: '应用管理员' }],
  permissionCodes: currentPermissions(),
  user: { accountId: 'E2E001', name: '测试管理员', email: 'e2e@example.com', phone: '13800000000', companyName: '示例公司', accountSetName: '飞书', avatar: '', departments: [{ name: '研发部' }] }
} as unknown as AuthzSessionContext)

export const ecp = {
  auth: {
    permission: { all: (input: AccessInput) => allowed(input, 'all'), any: (input: AccessInput) => allowed(input, 'any') },
    menu: { getAccessibleNavTree: async () => menuTree },
    session: { load: async () => session(), clear: () => undefined, subscribe: () => () => undefined },
    login: { buildUrl: (returnTo: string) => `/login?returnTo=${encodeURIComponent(returnTo)}` },
    doctor: { run: async () => ({ ok: true, checks: [] }) }
  }
}

export const configureEcp = async (_app: VueApp, router: Router): Promise<void> => {
  routes.forEach((route) => { if (!router.hasRoute(String(route.name))) router.addRoute(route) })
}
export const waitForEcpReady = async (): Promise<void> => undefined
export const getLocalDoctorReport = () => ({ ok: true, checks: [] })
