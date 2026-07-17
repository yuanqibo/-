const STANDARD_VUE_ROUTE_PATHS = new Set([
  '/system',
  '/system/employees',
  '/system/departments'
])

export const MEMBER_AUTHORIZATION_PORTAL_PATH = '/system/member-authorization'
export const MEMBER_AUTHORIZATION_WORKSPACE_PATH = '/workspace'
export const MEMBER_AUTHORIZATION_EMBED_PATH = `${MEMBER_AUTHORIZATION_WORKSPACE_PATH}?embedded=1`

const normalizedPath = (path: string): string => path.replace(/\/$/, '') || '/'

export const isStandardVueRoute = (path: string): boolean =>
  STANDARD_VUE_ROUTE_PATHS.has(normalizedPath(path))
