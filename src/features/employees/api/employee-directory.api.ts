import { apiRequest } from '../../../shared/api/http'
import type { DirectoryEmployeePage, DirectoryEmployeeQuery } from '../types/employee-directory'

export const getDirectoryEmployees = (
  params: DirectoryEmployeeQuery,
  signal?: AbortSignal
): Promise<DirectoryEmployeePage> => {
  const query = new URLSearchParams({
    page: String(params.page),
    size: String(params.size)
  })
  const keyword = String(params.query || '').trim()
  if (keyword) query.set('query', keyword)
  return apiRequest<DirectoryEmployeePage>(`/api/ecp/directory/users?${query.toString()}`, { signal })
}
