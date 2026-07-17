import { apiRequest } from '../../../shared/api/http'
import type { OrganizationConsole } from '../types/organization-directory'

export const getOrganizationConsole = (signal?: AbortSignal): Promise<OrganizationConsole> =>
  apiRequest<OrganizationConsole>('/api/ecp/organization', { signal })

export const getAccountSetInitializationData = (): Promise<unknown> =>
  apiRequest<unknown>('/api/ecp/control-plane/iam/account-sets?page=1&pageSize=100')
