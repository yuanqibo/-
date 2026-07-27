import { initAuthzSdk } from '@acg/ecp-auth'
import type { AuthzPermissionSnapshot, AuthzSessionContext } from '@acg/ecp-sdk'

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

const mergeCodes = (current: string[] | undefined, defaults: readonly string[]): string[] =>
  Array.from(new Set([...(current || []), ...defaults]))

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
