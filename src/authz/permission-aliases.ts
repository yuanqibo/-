const permissionAliasGroups = [
  ['asset:receive_return:receive', 'asset:item:receive'],
  ['asset:receive_return:return', 'asset:item:return'],
  ['asset:borrow_return:borrow', 'asset:item:borrow'],
  ['asset:borrow_return:return', 'asset:item:borrowReturn'],
  ['asset:receive_return:handover', 'asset:item:handover']
] as const

const aliasesByPermission = new Map<string, readonly string[]>(
  permissionAliasGroups.flatMap((group) => group.map((permission) => [permission, group] as const))
)

export const hasPortalPermission = (granted: ReadonlySet<string>, permission: string): boolean =>
  (aliasesByPermission.get(permission) || [permission]).some((candidate) => granted.has(candidate))
