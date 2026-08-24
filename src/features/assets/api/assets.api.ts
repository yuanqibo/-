import { apiRequest } from '../../../shared/api/http'
import { matchesPinyinSearch } from '../../../shared/search/pinyin-search'
import type { AssetCommand, AssetDraft, AssetOperationRecord, AssetRecord, BusinessRecord, DirectoryPerson, PortalStoreValues } from '../types/assets'

export type AssetCatalogResponse = { items: AssetRecord[]; disposedCount: number }
type AssetListResponse = { items: AssetRecord[] }
type BusinessDataResponse = {
  values?: Record<string, BusinessRecord[]>
  versions?: Record<string, number>
}
type StoreResponse = { values?: PortalStoreValues }
type DirectoryResponse = { items?: Array<Record<string, unknown>> }

const isObjectRecord = (value: unknown): value is Record<string, unknown> => Boolean(
  value && typeof value === 'object' && !Array.isArray(value)
)

const arrayValue = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : []

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

export const invalidateAssetDataCache = (): void => {
  invalidateReads('assets', 'operations', 'business')
}

export const fetchAssetCatalog = (): Promise<AssetCatalogResponse> => cachedRead('assets', async () => {
  const payload = await apiRequest<Partial<AssetCatalogResponse> | null>('/api/assets')
  const catalog = payload && typeof payload === 'object' ? payload : {}
  return {
    items: arrayValue<AssetRecord>(catalog.items).filter(isObjectRecord) as AssetRecord[],
    disposedCount: Math.max(0, Number(catalog.disposedCount || 0))
  }
})

export const fetchAssets = async (): Promise<AssetRecord[]> => (await fetchAssetCatalog()).items

export const fetchAssetOperations = (): Promise<AssetOperationRecord[]> => cachedRead('operations', async () => {
  const records: AssetOperationRecord[] = []
  const size = 500
  for (let page = 1; page <= 20; page += 1) {
    const payload = await apiRequest<{ items?: AssetOperationRecord[]; total?: number }>(`/api/asset-operations?page=${page}&size=${size}`)
    const response = isObjectRecord(payload) ? payload : {}
    const items = arrayValue<AssetOperationRecord>(response.items)
      .filter(isObjectRecord) as AssetOperationRecord[]
    records.push(...items)
    if (items.length < size || records.length >= Number(response.total || 0)) break
  }
  return records
})

export const createAsset = async (item: AssetDraft): Promise<AssetRecord> => {
  const created = (await apiRequest<{ item: AssetRecord }>('/api/assets', { method: 'POST', body: { item } })).item
  invalidateAssetDataCache()
  return created
}

export const copyAsset = async (sourceAssetId: string, item: AssetDraft): Promise<AssetRecord> => {
  const copied = (await apiRequest<{ item: AssetRecord }>('/api/assets', { method: 'POST', body: { sourceAssetId, item } })).item
  invalidateAssetDataCache()
  return copied
}

export const importAssets = async (items: AssetDraft[]): Promise<AssetRecord[]> => {
  const imported = (await apiRequest<{ items: AssetRecord[] }>('/api/assets/import', { method: 'POST', body: { items } })).items || []
  invalidateAssetDataCache()
  return imported
}

export const replaceAssets = async (items: AssetDraft[]): Promise<AssetRecord[]> => {
  const replaced = (await apiRequest<{ items: AssetRecord[] }>('/api/assets/replace', { method: 'POST', body: { items, resetHistory: true } })).items || []
  invalidateAssetDataCache()
  return replaced
}

export const runAssetCommand = async (action: AssetCommand, assetIds: string[], fields: Record<string, unknown>): Promise<AssetRecord[]> => {
  const updated = (await apiRequest<AssetListResponse>(`/api/assets/commands/${encodeURIComponent(action)}`, {
    method: 'POST',
    body: { assetIds, fields }
  })).items || []
  invalidateAssetDataCache()
  return updated
}

export const fetchBusinessData = (): Promise<BusinessDataResponse> =>
  cachedRead('business', async () => {
    const payload = await apiRequest<BusinessDataResponse | null>('/api/business-data')
    if (!isObjectRecord(payload)) return {}
    const rawValues = isObjectRecord(payload.values) ? payload.values : {}
    const values = Object.fromEntries(Object.entries(rawValues)
      .map(([key, value]) => [key, Array.isArray(value) ? value.filter(isObjectRecord) as BusinessRecord[] : []]))
    return {
      values,
      versions: isObjectRecord(payload.versions) ? payload.versions as Record<string, number> : {}
    }
  })

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
  cachedRead('store', async () => {
    const payload = await apiRequest<StoreResponse | null>('/api/store')
    return isObjectRecord(payload?.values) ? payload.values as PortalStoreValues : {}
  })

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
  const load = async (queryValue: string): Promise<DirectoryPerson[]> => {
    const query = new URLSearchParams({ page: '1', size: '100', query: queryValue })
    const payload = await apiRequest<DirectoryResponse>(`/api/ecp/directory/users?${query}`)
    return (payload.items || []).map(personFromPayload).filter((item) => item.subject && item.name && (
      matchesPinyinSearch([item.name, item.account, item.email, item.department], keyword)
    ))
  }

  const matched = await load(keyword)
  const compactKeyword = keyword.trim().replace(/\s+/g, '')
  const isPinyinLookup = /^[a-z]+$/i.test(compactKeyword) && compactKeyword.length >= 2
  return matched.length || !isPinyinLookup ? matched : load('')
}
