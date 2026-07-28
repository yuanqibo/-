import { apiRequest } from '../../../shared/api/http'
import type { AssetCommand, AssetDraft, AssetOperationRecord, AssetRecord, BusinessRecord, DirectoryPerson, PortalStoreValues } from '../types/assets'

type AssetListResponse = { items: AssetRecord[] }
type BusinessDataResponse = {
  values?: Record<string, BusinessRecord[]>
  versions?: Record<string, number>
}
type StoreResponse = { values?: PortalStoreValues }
type DirectoryResponse = { items?: Array<Record<string, unknown>> }

const READ_CACHE_TTL_MS = 15_000
const readCache = new Map<string, { expiresAt: number; request: Promise<unknown> }>()

const cachedRead = <T>(key: string, loader: () => Promise<T>): Promise<T> => {
  const now = Date.now()
  const cached = readCache.get(key)
  if (cached && cached.expiresAt > now) return cached.request as Promise<T>
  const request = loader().catch((error) => {
    readCache.delete(key)
    throw error
  })
  readCache.set(key, { expiresAt: now + READ_CACHE_TTL_MS, request })
  return request
}

const invalidateReads = (...keys: string[]): void => {
  keys.forEach((key) => readCache.delete(key))
}

export const fetchAssets = async (): Promise<AssetRecord[]> =>
  cachedRead('assets', async () => (await apiRequest<AssetListResponse>('/api/assets')).items || [])

export const fetchAssetOperations = (): Promise<AssetOperationRecord[]> => cachedRead('operations', async () => {
  const records: AssetOperationRecord[] = []
  const size = 500
  for (let page = 1; page <= 20; page += 1) {
    const payload = await apiRequest<{ items?: AssetOperationRecord[]; total?: number }>(`/api/asset-operations?page=${page}&size=${size}`)
    const items = payload.items || []
    records.push(...items)
    if (items.length < size || records.length >= Number(payload.total || 0)) break
  }
  return records
})

export const createAsset = async (item: AssetDraft): Promise<AssetRecord> => {
  const created = (await apiRequest<{ item: AssetRecord }>('/api/assets', { method: 'POST', body: { item } })).item
  invalidateReads('assets', 'operations')
  return created
}

export const copyAsset = async (sourceAssetId: string, item: AssetDraft): Promise<AssetRecord> => {
  const copied = (await apiRequest<{ item: AssetRecord }>('/api/assets', { method: 'POST', body: { sourceAssetId, item } })).item
  invalidateReads('assets', 'operations')
  return copied
}

export const importAssets = async (items: AssetDraft[]): Promise<AssetRecord[]> => {
  const imported = (await apiRequest<{ items: AssetRecord[] }>('/api/assets/import', { method: 'POST', body: { items } })).items || []
  invalidateReads('assets', 'operations')
  return imported
}

export const runAssetCommand = async (action: AssetCommand, assetIds: string[], fields: Record<string, unknown>): Promise<AssetRecord[]> => {
  const updated = (await apiRequest<AssetListResponse>(`/api/assets/commands/${encodeURIComponent(action)}`, {
    method: 'POST',
    body: { assetIds, fields }
  })).items || []
  invalidateReads('assets', 'operations', 'business')
  return updated
}

export const fetchBusinessData = (): Promise<BusinessDataResponse> =>
  cachedRead('business', () => apiRequest<BusinessDataResponse>('/api/business-data'))

export const createStocktake = async (item: Pick<BusinessRecord, 'name' | 'scope' | 'owner' | 'total' | 'date'>): Promise<BusinessRecord> => {
  const created = (await apiRequest<{ item: BusinessRecord }>('/api/business-data/stocktakes', { method: 'POST', body: item })).item
  invalidateReads('business')
  return created
}

export const updateStocktake = async (id: string, value: Pick<BusinessRecord, 'checked' | 'diff'>): Promise<BusinessRecord[]> => {
  const updated = (await apiRequest<{ items: BusinessRecord[] }>(`/api/business-data/stocktakes/${encodeURIComponent(id)}`, { method: 'PATCH', body: value })).items || []
  invalidateReads('business')
  return updated
}

export const fetchPortalStore = async (): Promise<PortalStoreValues> =>
  cachedRead('store', async () => (await apiRequest<StoreResponse>('/api/store')).values || {})

export const saveCatalog = async (domain: 'categories' | 'locations', value: unknown): Promise<unknown> => {
  const saved = await apiRequest(`/api/config/catalog/${domain}`, { method: 'PUT', body: { value } })
  invalidateReads('store')
  return saved
}

export const saveAssetCodeSettings = async (value: unknown): Promise<unknown> => {
  const saved = await apiRequest('/api/config/settings/asset-code', { method: 'PUT', body: { value } })
  invalidateReads('store')
  return saved
}

export const saveLabelSettings = async (entries: Record<string, unknown>, operation: 'save' | 'reset' | 'create' | 'update' | 'delete'): Promise<unknown> => {
  const saved = await apiRequest('/api/store', { method: 'POST', body: { entries, operation } })
  invalidateReads('store')
  return saved
}

const relatedName = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return String((value as Record<string, unknown>).name || '')
  return ''
}

const personFromPayload = (item: Record<string, unknown>): DirectoryPerson => {
  const departments = Array.isArray(item.departments) ? item.departments as Array<Record<string, unknown>> : []
  return {
    subject: String(item.subject || item.directorySubject || item.externalId || item.account || ''),
    name: String(item.name || item.displayName || item.account || ''),
    account: String(item.account || item.employeeNo || ''),
    email: String(item.email || ''),
    department: String(item.departmentName || relatedName(item.department) || relatedName(departments[0])),
    company: String(item.companyName || relatedName(item.company))
  }
}

export const searchDirectoryPeople = async (keyword: string): Promise<DirectoryPerson[]> => {
  const query = new URLSearchParams({ page: '1', size: '100', query: keyword })
  const payload = await apiRequest<DirectoryResponse>(`/api/ecp/directory/users?${query}`)
  const normalized = keyword.trim().toLowerCase()
  return (payload.items || []).map(personFromPayload).filter((item) => item.subject && item.name && (
    !normalized || [item.name, item.account, item.email, item.department].some((value) => value.toLowerCase().includes(normalized))
  ))
}
