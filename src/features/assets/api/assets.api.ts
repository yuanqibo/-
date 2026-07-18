import { apiRequest } from '../../../shared/api/http'
import type { AssetCommand, AssetDraft, AssetRecord, BusinessRecord, DirectoryPerson, PortalStoreValues } from '../types/assets'

type AssetListResponse = { items: AssetRecord[] }
type BusinessDataResponse = {
  values?: Record<string, BusinessRecord[]>
  versions?: Record<string, number>
}
type StoreResponse = { values?: PortalStoreValues }
type DirectoryResponse = { items?: Array<Record<string, unknown>> }

export const fetchAssets = async (): Promise<AssetRecord[]> =>
  (await apiRequest<AssetListResponse>('/api/assets')).items || []

export const createAsset = async (item: AssetDraft): Promise<AssetRecord> =>
  (await apiRequest<{ item: AssetRecord }>('/api/assets', { method: 'POST', body: { item } })).item

export const copyAsset = async (sourceAssetId: string, item: AssetDraft): Promise<AssetRecord> =>
  (await apiRequest<{ item: AssetRecord }>('/api/assets', { method: 'POST', body: { sourceAssetId, item } })).item

export const importAssets = async (items: AssetDraft[]): Promise<AssetRecord[]> =>
  (await apiRequest<{ items: AssetRecord[] }>('/api/assets/import', { method: 'POST', body: { items } })).items || []

export const runAssetCommand = async (action: AssetCommand, assetIds: string[], fields: Record<string, unknown>): Promise<AssetRecord[]> =>
  (await apiRequest<AssetListResponse>(`/api/assets/commands/${encodeURIComponent(action)}`, {
    method: 'POST',
    body: { assetIds, fields }
  })).items || []

export const fetchBusinessData = (): Promise<BusinessDataResponse> =>
  apiRequest<BusinessDataResponse>('/api/business-data')

export const createStocktake = async (item: Pick<BusinessRecord, 'name' | 'scope' | 'owner' | 'total' | 'date'>): Promise<BusinessRecord> =>
  (await apiRequest<{ item: BusinessRecord }>('/api/business-data/stocktakes', { method: 'POST', body: item })).item

export const updateStocktake = async (id: string, value: Pick<BusinessRecord, 'checked' | 'diff'>): Promise<BusinessRecord[]> =>
  (await apiRequest<{ items: BusinessRecord[] }>(`/api/business-data/stocktakes/${encodeURIComponent(id)}`, { method: 'PATCH', body: value })).items || []

export const fetchPortalStore = async (): Promise<PortalStoreValues> =>
  (await apiRequest<StoreResponse>('/api/store')).values || {}

export const saveCatalog = (domain: 'categories' | 'locations', value: unknown): Promise<unknown> =>
  apiRequest(`/api/config/catalog/${domain}`, { method: 'PUT', body: { value } })

export const saveAssetCodeSettings = (value: unknown): Promise<unknown> =>
  apiRequest('/api/config/settings/asset-code', { method: 'PUT', body: { value } })

export const saveLabelSettings = (entries: Record<string, unknown>, operation: 'save' | 'reset' | 'create' | 'update' | 'delete'): Promise<unknown> =>
  apiRequest('/api/store', { method: 'POST', body: { entries, operation } })

const personFromPayload = (item: Record<string, unknown>): DirectoryPerson => ({
  subject: String(item.subject || item.directorySubject || item.externalId || item.account || ''),
  name: String(item.name || item.displayName || item.account || ''),
  account: String(item.account || item.employeeNo || ''),
  email: String(item.email || ''),
  department: String(item.department || item.departmentName || ''),
  company: String(item.company || item.companyName || '')
})

export const searchDirectoryPeople = async (keyword: string): Promise<DirectoryPerson[]> => {
  const query = new URLSearchParams({ page: '1', size: '100', q: keyword })
  const payload = await apiRequest<DirectoryResponse>(`/api/ecp/directory/users?${query}`)
  const normalized = keyword.trim().toLowerCase()
  return (payload.items || []).map(personFromPayload).filter((item) => item.subject && item.name && (
    !normalized || [item.name, item.account, item.email, item.department].some((value) => value.toLowerCase().includes(normalized))
  ))
}
