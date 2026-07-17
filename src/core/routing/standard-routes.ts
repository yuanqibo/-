const STANDARD_VUE_ROUTE_PATHS = new Set([
  '/system',
  '/system/employees'
])

const normalizedPath = (path: string): string => path.replace(/\/$/, '') || '/'

export const isStandardVueRoute = (path: string): boolean =>
  STANDARD_VUE_ROUTE_PATHS.has(normalizedPath(path))
