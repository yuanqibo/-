import { computed, reactive, readonly } from 'vue'
import { createApproval, decideApproval, fetchApprovals } from '../api/approvals.api'
import type { ApprovalDecision, ApprovalRecord } from '../types/approval'

const state = reactive({ rows: [] as ApprovalRecord[], loading: false, errorMessage: '' })
let pending: Promise<void> | null = null
const decisionPolls = new Map<string, ReturnType<typeof setTimeout>>()
const openStatuses = new Set(['审批中', '待执行'])
const MAX_DECISION_POLLS = 45

const scheduleDecisionRefresh = (id: string, attempt = 0): void => {
  const existing = decisionPolls.get(id)
  if (existing) clearTimeout(existing)
  if (attempt >= MAX_DECISION_POLLS) {
    decisionPolls.delete(id)
    return
  }
  const timer = setTimeout(async () => {
    try {
      state.rows = await fetchApprovals()
      const item = state.rows.find((row) => row.id === id)
      if (item?.decisionSubmitted && openStatuses.has(item.status)) {
        scheduleDecisionRefresh(id, attempt + 1)
      } else {
        decisionPolls.delete(id)
      }
    } catch {
      scheduleDecisionRefresh(id, attempt + 1)
    }
  }, 2_000)
  decisionPolls.set(id, timer)
}

const schedulePendingDecisions = (): void => {
  state.rows.filter((item) => item.decisionSubmitted && openStatuses.has(item.status))
    .forEach((item) => scheduleDecisionRefresh(item.id))
}

const load = async (): Promise<void> => {
  if (pending) return pending
  state.loading = true; state.errorMessage = ''
  pending = fetchApprovals().then((rows) => { state.rows = rows; schedulePendingDecisions() }).catch((error) => {
    state.errorMessage = error instanceof Error ? error.message : '审批数据加载失败'
  }).finally(() => { state.loading = false; pending = null })
  return pending
}

const decide = async (id: string, decision: ApprovalDecision, reason: string, operator: string): Promise<void> => {
  state.rows = await decideApproval(id, decision, reason, operator)
  const item = state.rows.find((row) => row.id === id)
  if (item?.decisionSubmitted && openStatuses.has(item.status)) scheduleDecisionRefresh(id)
}

const create = async (draft: Pick<ApprovalRecord, 'type' | 'applicant' | 'asset' | 'reason'> & { details?: Record<string, unknown> }): Promise<void> => {
  const item = await createApproval(draft)
  state.rows = [item, ...state.rows]
}

export const useApprovals = () => ({ state: readonly(state), rows: computed(() => state.rows), load, decide, create })
