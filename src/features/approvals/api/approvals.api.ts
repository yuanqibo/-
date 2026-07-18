import { apiRequest } from '../../../shared/api/http'
import type { ApprovalDecision, ApprovalRecord } from '../types/approval'

type BusinessDataPayload = { values?: { requests?: ApprovalRecord[] }; versions?: { requests?: number } }

export const fetchApprovals = async (): Promise<ApprovalRecord[]> =>
  (await apiRequest<BusinessDataPayload>('/api/business-data')).values?.requests || []

export const decideApproval = async (id: string, decision: ApprovalDecision, reason: string, operator: string): Promise<ApprovalRecord[]> =>
  (await apiRequest<{ items: ApprovalRecord[] }>(`/api/business-data/requests/${encodeURIComponent(id)}/decision`, {
    method: 'POST', body: { decision, reason, operator }
  })).items || []

export const createApproval = async (draft: Pick<ApprovalRecord, 'type' | 'applicant' | 'asset' | 'reason'> & { details?: Record<string, unknown> }): Promise<ApprovalRecord> =>
  (await apiRequest<{ item: ApprovalRecord }>('/api/business-data/requests', { method: 'POST', body: draft })).item
