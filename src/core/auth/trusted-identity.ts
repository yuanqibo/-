import type { AuthzSessionContext } from '@acg/ecp-sdk'

export type TrustedPortalIdentity = {
  roleCode?: string
  permissionCodes?: string[]
  featureCodes?: string[]
}

const merge = (left: string[] | undefined, right: string[] | undefined): string[] =>
  Array.from(new Set([...(left || []), ...(right || [])].filter(Boolean)))

export const applyTrustedPortalIdentity = (
  session: AuthzSessionContext,
  identity: TrustedPortalIdentity | null | undefined
): AuthzSessionContext => {
  const roleCode = String(identity?.roleCode || '').trim().toLowerCase()
  if (roleCode !== 'super_admin' && roleCode !== 'admin' && roleCode !== 'auditor') return session

  const role = roleCode === 'super_admin'
    ? { code: 'APP_ADMIN', name: '应用管理员', type: 'APP_ADMIN' }
    : roleCode === 'auditor'
      ? { code: 'APP_AUDITOR', name: '应用审计员', type: 'AUDITOR' }
      : { code: 'OPERATOR', name: '资产运营', type: 'OPERATOR' }

  return {
    ...session,
    roles: [...session.roles.filter((item) => item.code !== role.code), role],
    permissionCodes: merge(session.permissionCodes, identity?.permissionCodes),
    featureCodes: merge(session.featureCodes, identity?.featureCodes)
  }
}
