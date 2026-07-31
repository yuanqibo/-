import { apiRequest } from '../../../shared/api/http'
import type { DisposalDraft, DisposalRecord } from '../types/disposal'

type DisposalListResponse = { items?: DisposalRecord[] }

export const fetchDisposals = async (): Promise<DisposalRecord[]> =>
  (await apiRequest<DisposalListResponse>('/api/asset-disposals')).items || []

export const createDisposal = async (draft: DisposalDraft): Promise<DisposalRecord> =>
  (await apiRequest<{ item: DisposalRecord }>('/api/asset-disposals', { method: 'POST', body: draft })).item

export const completeDisposal = async (id: string): Promise<DisposalRecord[]> =>
  (await apiRequest<DisposalListResponse>(`/api/asset-disposals/${encodeURIComponent(id)}/complete`, {
    method: 'PATCH'
  })).items || []

export const cancelDisposal = async (id: string, assetIds: string[], reason: string): Promise<DisposalRecord[]> =>
  (await apiRequest<DisposalListResponse>(`/api/asset-disposals/${encodeURIComponent(id)}/cancel`, {
    method: 'POST', body: { assetIds, reason }
  })).items || []
