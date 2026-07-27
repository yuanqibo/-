import { initAuthzSdk } from '@acg/ecp-auth'
import type { AuthzPermissionSnapshot, AuthzSessionContext } from '@acg/ecp-sdk'
import type { PortalMenuItem } from './portal-context'

export const EMPLOYEE_SELF_SERVICE_PERMISSION_CODES = [
  'asset:item:view',
  'asset:receive_return:view',
  'asset:receive_return:sign',
  'asset:request:view',
  'asset:request:create',
  'asset:self_service:view'
] as const

export const EMPLOYEE_SELF_SERVICE_FEATURE_CODES = [
  'PORTAL_HOME',
  'PORTAL_ASSETS',
  'PORTAL_REQUESTS'
] as const

export const EMPLOYEE_SELF_SERVICE_MENU_ITEMS: readonly PortalMenuItem[] = [
  {
    id: 'home',
    parentId: '',
    title: '首页',
    path: '/',
    pageKey: 'asset.portal.home',
    order: 10
  },
  {
    id: 'requests',
    parentId: '',
    title: '审批',
    path: '/requests',
    pageKey: 'asset.portal.requests',
    order: 40
  }
] as const

const mergeCodes = (current: string[] | undefined, defaults: readonly string[]): string[] =>
  Array.from(new Set([...(current || []), ...defaults]))

export const ensureEmployeeSelfServiceMenu = (current: PortalMenuItem[]): PortalMenuItem[] => {
  const currentIds = new Set(current.map((item) => item.id))
  return [
    ...current,
    ...EMPLOYEE_SELF_SERVICE_MENU_ITEMS
      .filter((item) => !currentIds.has(item.id))
      .map((item) => ({ ...item }))
  ].sort((left, right) => left.order - right.order)
}

export const withEmployeeSelfServiceSession = (session: AuthzSessionContext): AuthzSessionContext => ({
  ...session,
  permissionCodes: mergeCodes(session.permissionCodes, EMPLOYEE_SELF_SERVICE_PERMISSION_CODES),
  featureCodes: mergeCodes(session.featureCodes, EMPLOYEE_SELF_SERVICE_FEATURE_CODES)
})

export const withEmployeeSelfServiceSnapshot = (
  snapshot: AuthzPermissionSnapshot
): AuthzPermissionSnapshot => ({
  ...snapshot,
  permissionCodes: mergeCodes(snapshot.permissionCodes, EMPLOYEE_SELF_SERVICE_PERMISSION_CODES),
  featureCodes: mergeCodes(snapshot.featureCodes, EMPLOYEE_SELF_SERVICE_FEATURE_CODES)
})

export const primeEmployeeSelfServiceSession = (session: AuthzSessionContext): AuthzSessionContext => {
  const augmented = withEmployeeSelfServiceSession(session)
  initAuthzSdk(augmented.appCode).primeSessionContext(augmented, augmented.sessionToken)
  return augmented
}
