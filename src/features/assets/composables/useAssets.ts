import { computed, reactive, readonly } from 'vue'
import {
  createAsset as createAssetRequest,
  copyAsset as copyAssetRequest,
  createStocktake as createStocktakeRequest,
  fetchAssets,
  fetchBusinessData,
  fetchPortalStore,
  importAssets as importAssetsRequest,
  runAssetCommand as runAssetCommandRequest,
  saveAssetCodeSettings,
  saveCatalog,
  saveLabelSettings,
  updateStocktake as updateStocktakeRequest
} from '../api/assets.api'
import type { AssetCommand, AssetDraft, AssetRecord, BusinessRecord, PortalStoreValues } from '../types/assets'

type AssetState = {
  assets: AssetRecord[]
  business: Record<string, BusinessRecord[]>
  store: PortalStoreValues
  loading: boolean
  initialized: boolean
  errorMessage: string
}

const state = reactive<AssetState>({
  assets: [],
  business: {},
  store: {},
  loading: false,
  initialized: false,
  errorMessage: ''
})

let pending: Promise<void> | null = null

const load = async (force = false): Promise<void> => {
  if (state.initialized && !force) return
  if (pending && !force) return pending
  state.loading = true
  state.errorMessage = ''
  pending = Promise.allSettled([fetchAssets(), fetchBusinessData(), fetchPortalStore()])
    .then(([assets, business, store]) => {
      if (assets.status === 'fulfilled') state.assets = assets.value
      else throw assets.reason
      if (business.status === 'fulfilled') state.business = business.value.values || {}
      if (store.status === 'fulfilled') state.store = store.value
      state.initialized = true
    })
    .catch((error) => {
      state.errorMessage = error instanceof Error ? error.message : '资产数据加载失败'
    })
    .finally(() => {
      state.loading = false
      pending = null
    })
  return pending
}

const replaceAssets = (items: AssetRecord[]): void => {
  const byId = new Map(state.assets.map((item) => [item.id, item]))
  items.forEach((item) => byId.set(item.id, item))
  state.assets = Array.from(byId.values())
}

const create = async (draft: AssetDraft): Promise<AssetRecord> => {
  const item = await createAssetRequest(draft)
  state.assets = [item, ...state.assets]
  return item
}

const importMany = async (drafts: AssetDraft[]): Promise<number> => {
  const items = await importAssetsRequest(drafts)
  state.assets = [...items, ...state.assets]
  return items.length
}

const copy = async (sourceAssetId: string, draft: AssetDraft): Promise<AssetRecord> => {
  const item = await copyAssetRequest(sourceAssetId, draft)
  state.assets = [item, ...state.assets]
  return item
}

const command = async (action: AssetCommand, assetIds: string[], fields: Record<string, unknown>): Promise<void> => {
  const items = await runAssetCommandRequest(action, assetIds, fields)
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
  business: computed(() => state.business),
  store: computed(() => state.store),
  load,
  create,
  copy,
  importMany,
  command,
  saveCatalogValue,
  saveCodeRules,
  saveLabels,
  createStocktake,
  updateStocktake
})
