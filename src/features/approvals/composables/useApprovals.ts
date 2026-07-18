import { computed, reactive, readonly } from 'vue'
import { decideApproval, fetchApprovals } from '../api/approvals.api'
import type { ApprovalDecision, ApprovalRecord } from '../types/approval'

const state = reactive({ rows: [] as ApprovalRecord[], loading: false, errorMessage: '' })
let pending: Promise<void> | null = null

const load = async (): Promise<void> => {
  if (pending) return pending
  state.loading = true; state.errorMessage = ''
  pending = fetchApprovals().then((rows) => { state.rows = rows }).catch((error) => {
    state.errorMessage = error instanceof Error ? error.message : '审批数据加载失败'
  }).finally(() => { state.loading = false; pending = null })
  return pending
}

const decide = async (id: string, decision: ApprovalDecision, reason: string, operator: string): Promise<void> => {
  state.rows = await decideApproval(id, decision, reason, operator)
}

export const useApprovals = () => ({ state: readonly(state), rows: computed(() => state.rows), load, decide })
