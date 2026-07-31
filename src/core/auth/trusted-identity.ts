import type { AuthzPermissionSnapshot, AuthzSessionContext } from '@acg/ecp-sdk'
import { apiRequest } from '../../shared/api/http'

export type TrustedPortalIdentity = {
  roleCode?: string
  permissionCodes?: string[]
  featureCodes?: string[]
}

export type TrustedAppAdminAccess = {
  permissionCodes?: string[]
  featureCodes?: string[]
}

const merge = (left: string[] | undefined, right: string[] | undefined): string[] =>
  Array.from(new Set([...(left || []), ...(right || [])].filter(Boolean)))

const trustedRole = (roleCode: string) => roleCode === 'super_admin'
  ? { code: 'APP_ADMIN', name: '应用管理员', type: 'APP_ADMIN' }
  : roleCode === 'auditor'
    ? { code: 'APP_AUDITOR', name: '应用审计员', type: 'AUDITOR' }
    : roleCode === 'admin'
      ? { code: 'OPERATOR', name: '资产运营', type: 'OPERATOR' }
      : null

export const loadTrustedPortalIdentity = (): Promise<TrustedPortalIdentity | null> =>
  apiRequest<{ user?: TrustedPortalIdentity }>('/api/auth/ecp/me')
    .then((payload) => payload.user || null)
    .catch((error) => {
      console.warn('[asset-portal] trusted ECP identity unavailable', error)
      return null
    })

export const applyTrustedPortalIdentity = (
  session: AuthzSessionContext,
  identity: TrustedPortalIdentity | null | undefined,
  appAdminAccess?: TrustedAppAdminAccess
): AuthzSessionContext => {
  const roleCode = String(identity?.roleCode || '').trim().toLowerCase()
  const role = trustedRole(roleCode)
  if (!role) return session

  const elevatedAccess = roleCode === 'super_admin' ? appAdminAccess : undefined

  return {
    ...session,
    roles: [...session.roles.filter((item) => item.code !== role.code), role],
    permissionCodes: merge(merge(session.permissionCodes, identity?.permissionCodes), elevatedAccess?.permissionCodes),
    featureCodes: merge(merge(session.featureCodes, identity?.featureCodes), elevatedAccess?.featureCodes)
  }
}

export const applyTrustedPermissionSnapshot = (
  snapshot: AuthzPermissionSnapshot,
  identity: TrustedPortalIdentity | null | undefined,
  appAdminAccess?: TrustedAppAdminAccess
): AuthzPermissionSnapshot => {
  const roleCode = String(identity?.roleCode || '').trim().toLowerCase()
  const role = trustedRole(roleCode)
  if (!role) return snapshot

  const elevatedAccess = roleCode === 'super_admin' ? appAdminAccess : undefined

  return {
    ...snapshot,
    roleCodes: merge(snapshot.roleCodes, [role.code]),
    roleNamesByCode: { ...snapshot.roleNamesByCode, [role.code]: role.name },
    permissionCodes: merge(merge(snapshot.permissionCodes, identity?.permissionCodes), elevatedAccess?.permissionCodes),
    featureCodes: merge(merge(snapshot.featureCodes, identity?.featureCodes), elevatedAccess?.featureCodes)
  }
}
