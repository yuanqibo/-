export type EcpPortalRole = {
  code?: string
  type?: string
}

const normalizedRoleValues = (roles: EcpPortalRole[], field: keyof EcpPortalRole): Set<string> =>
  new Set(roles.map((role) => String(role[field] || '').trim().toUpperCase()).filter(Boolean))

export const resolvePortalRoleCode = (
  roles: EcpPortalRole[] | undefined
): 'super_admin' | 'admin' | 'auditor' | 'employee' => {
  const roleList = roles || []
  const roleCodes = normalizedRoleValues(roleList, 'code')
  const roleTypes = normalizedRoleValues(roleList, 'type')

  if (roleCodes.has('APP_ADMIN') || roleTypes.has('APP_ADMIN')) return 'super_admin'
  if (roleCodes.has('OPERATOR') || roleTypes.has('OPERATOR')) return 'admin'
  if (roleCodes.has('APP_AUDITOR') || roleTypes.has('AUDITOR')) return 'auditor'
  return 'employee'
}
