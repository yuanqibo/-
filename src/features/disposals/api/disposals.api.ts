import { apiRequest } from '../../../shared/api/http'
import { invalidateAssetDataCache } from '../../assets/api/assets.api'
import type { DisposalDraft, DisposalRecord } from '../types/disposal'

type DisposalListResponse = { items?: DisposalRecord[] }

export const fetchDisposals = async (): Promise<DisposalRecord[]> =>
  (await apiRequest<DisposalListResponse>('/api/asset-disposals')).items || []

export const createDisposal = async (draft: DisposalDraft): Promise<DisposalRecord> => {
  const item = (await apiRequest<{ item: DisposalRecord }>('/api/asset-disposals', { method: 'POST', body: draft })).item
  invalidateAssetDataCache()
  return item
}

export const completeDisposal = async (id: string): Promise<DisposalRecord[]> => {
  const items = (await apiRequest<DisposalListResponse>(`/api/asset-disposals/${encodeURIComponent(id)}/complete`, {
    method: 'PATCH'
  })).items || []
  invalidateAssetDataCache()
  return items
}

export const cancelDisposal = async (id: string, assetIds: string[], reason: string): Promise<DisposalRecord[]> => {
  const items = (await apiRequest<DisposalListResponse>(`/api/asset-disposals/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', body: { assetIds, reason }
  })).items || []
  invalidateAssetDataCache()
  return items
}
