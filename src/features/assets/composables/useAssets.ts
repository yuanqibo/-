import { computed, reactive, readonly } from 'vue'
import {
  createAsset as createAssetRequest,
  copyAsset as copyAssetRequest,
  createStocktake as createStocktakeRequest,
  fetchAssetOperations,
  fetchAssets,
  fetchBusinessData,
  fetchPortalStore,
  importAssets as importAssetsRequest,
  replaceAssets as replaceAssetsRequest,
  runAssetCommand as runAssetCommandRequest,
  saveAssetCodeSettings,
  saveCatalog,
  saveLabelSettings,
  updateStocktake as updateStocktakeRequest
} from '../api/assets.api'
import type { AssetCommand, AssetDraft, AssetOperationRecord, AssetRecord, BusinessRecord, PortalStoreValues } from '../types/assets'

type AssetState = {
  assets: AssetRecord[]
  operations: AssetOperationRecord[]
  business: Record<string, BusinessRecord[]>
  store: PortalStoreValues
  loading: boolean
  initialized: boolean
  errorMessage: string
  assetsLoaded: boolean
  operationsLoaded: boolean
  businessLoaded: boolean
  storeLoaded: boolean
}

const state = reactive<AssetState>({
  assets: [],
  operations: [],
  business: {},
  store: {},
  loading: false,
  initialized: false,
  errorMessage: '',
  assetsLoaded: false,
  operationsLoaded: false,
  businessLoaded: false,
  storeLoaded: false
})

let pendingRequests = 0
let assetsPending: Promise<void> | null = null
let operationsPending: Promise<void> | null = null
let businessPending: Promise<void> | null = null
let storePending: Promise<void> | null = null

const syncInitialized = (): void => {
  state.initialized = state.assetsLoaded && state.operationsLoaded && state.businessLoaded && state.storeLoaded
}

const beginRequest = (): void => {
  pendingRequests += 1
  state.loading = pendingRequests > 0
}

const endRequest = (): void => {
  pendingRequests = Math.max(0, pendingRequests - 1)
  state.loading = pendingRequests > 0
}

const loadAssets = async (force = false): Promise<void> => {
  if (state.assetsLoaded && !force) return
  if (assetsPending && !force) return assetsPending
  assetsPending = (async () => {
    beginRequest()
    state.errorMessage = ''
    try {
      state.assets = await fetchAssets()
      state.assetsLoaded = true
      syncInitialized()
    } catch (error) {
      state.errorMessage = error instanceof Error ? error.message : '资产数据加载失败'
    } finally {
      assetsPending = null
      endRequest()
    }
  })()
  return assetsPending
}

const loadOperations = async (force = false): Promise<void> => {
  if (state.operationsLoaded && !force) return
  if (operationsPending && !force) return operationsPending
  operationsPending = (async () => {
    beginRequest()
    try {
      state.operations = await fetchAssetOperations()
      state.operationsLoaded = true
      syncInitialized()
    } catch {
      state.operations = []
    } finally {
      operationsPending = null
      endRequest()
    }
  })()
  return operationsPending
}

const loadBusiness = async (force = false): Promise<void> => {
  if (state.businessLoaded && !force) return
  if (businessPending && !force) return businessPending
  businessPending = (async () => {
    beginRequest()
    try {
      const business = await fetchBusinessData()
      state.business = business.values || {}
      state.businessLoaded = true
      syncInitialized()
    } catch {
      state.business = state.business || {}
    } finally {
      businessPending = null
      endRequest()
    }
  })()
  return businessPending
}

const loadStore = async (force = false): Promise<void> => {
  if (state.storeLoaded && !force) return
  if (storePending && !force) return storePending
  storePending = (async () => {
    beginRequest()
    try {
      state.store = await fetchPortalStore()
      state.storeLoaded = true
      syncInitialized()
    } catch {
      state.store = state.store || {}
    } finally {
      storePending = null
      endRequest()
    }
  })()
  return storePending
}

const load = async (force = false): Promise<void> => {
  await Promise.all([loadAssets(force), loadOperations(force), loadBusiness(force), loadStore(force)])
}

const replaceAssets = (items: AssetRecord[]): void => {
  const byId = new Map(state.assets.map((item) => [item.id, item]))
  items.forEach((item) => byId.set(item.id, item))
  state.assets = Array.from(byId.values())
}

const reloadOperations = async (): Promise<void> => {
  try { state.operations = await fetchAssetOperations() }
  catch { state.operations = [] }
}

const create = async (draft: AssetDraft): Promise<AssetRecord> => {
  const item = await createAssetRequest(draft)
  state.assets = [item, ...state.assets]
  await reloadOperations()
  return item
}

const importMany = async (drafts: AssetDraft[]): Promise<number> => {
  const items = await importAssetsRequest(drafts)
  state.assets = [...items, ...state.assets]
  await reloadOperations()
  return items.length
}

const replaceAll = async (drafts: AssetDraft[]): Promise<number> => {
  state.assets = await replaceAssetsRequest(drafts)
  await reloadOperations()
  return state.assets.length
}

const copy = async (sourceAssetId: string, draft: AssetDraft): Promise<AssetRecord> => {
  const item = await copyAssetRequest(sourceAssetId, draft)
  state.assets = [item, ...state.assets]
  await reloadOperations()
  return item
}

const command = async (action: AssetCommand, assetIds: string[], fields: Record<string, unknown>): Promise<void> => {
  const items = await runAssetCommandRequest(action, assetIds, fields)
  await reloadOperations()
  if (action === 'delete' || action === 'cancel-inbound') {
    const removed = new Set(assetIds)
    state.assets = state.assets.filter((item) => !removed.has(item.id))
    return
  }
  replaceAssets(items)
}

const saveCatalogValue = async (domain: 'categories' | 'locations', value: unknown): Promise<void> => {
  await saveCatalog(domain, value)
  if (domain === 'categories') state.store.assetCategoryTree = value as PortalStoreValues['assetCategoryTree']
  else state.store.assetLocationTree = value as PortalStoreValues['assetLocationTree']
}

const saveCodeRules = async (value: Record<string, unknown>): Promise<void> => {
  await saveAssetCodeSettings(value)
  state.store.assetPortalAssetCodeRuleSettingsV1 = value
}

const saveLabels = async (key: string, value: unknown, operation: 'save' | 'reset' | 'create' | 'update' | 'delete'): Promise<void> => {
  await saveLabelSettings({ [key]: value }, operation)
  state.store[key] = value
}

const createStocktake = async (value: Pick<BusinessRecord, 'name' | 'scope' | 'owner' | 'total' | 'date'>): Promise<void> => {
  const item = await createStocktakeRequest(value)
  state.business.stocktakes = [item, ...(state.business.stocktakes || [])]
}

const updateStocktake = async (id: string, value: Pick<BusinessRecord, 'checked' | 'diff'>): Promise<void> => {
  state.business.stocktakes = await updateStocktakeRequest(id, value)
}

export const useAssets = () => ({
  state: readonly(state),
  assets: computed(() => state.assets),
  operations: computed(() => state.operations),
  business: computed(() => state.business),
  store: computed(() => state.store),
  load,
  loadAssets,
  loadOperations,
  loadBusiness,
  loadStore,
  create,
  copy,
  importMany,
  replaceAll,
  command,
  saveCatalogValue,
  saveCodeRules,
  saveLabels,
  createStocktake,
  updateStocktake
})
