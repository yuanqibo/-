import { computed, reactive, readonly } from 'vue'
import { createApproval, decideApproval, fetchApprovals } from '../api/approvals.api'
import type { ApprovalDecision, ApprovalRecord } from '../types/approval'

const state = reactive({ rows: [] as ApprovalRecord[], loading: false, errorMessage: '' })
let pending: Promise<void> | null = null
let requestPoll: ReturnType<typeof setTimeout> | null = null
let requestPollAttempt = 0
const openStatuses = new Set(['审批中', '待审批', '待执行'])
const MAX_REQUEST_POLLS = 300

const schedulePendingRefresh = (reset = false): void => {
  if (reset) requestPollAttempt = 0
  if (requestPoll || requestPollAttempt >= MAX_REQUEST_POLLS || !state.rows.some((item) => openStatuses.has(item.status))) return
  requestPoll = setTimeout(async () => {
    requestPoll = null
    requestPollAttempt += 1
    try {
      state.rows = await fetchApprovals()
    } catch {
      // Keep the last visible state and retry while a request is still open.
    } finally {
      if (state.rows.some((item) => openStatuses.has(item.status))) schedulePendingRefresh()
      else requestPollAttempt = 0
    }
  }, 2_000)
}

const load = async (): Promise<void> => {
  if (pending) return pending
  state.loading = true; state.errorMessage = ''
  pending = fetchApprovals().then((rows) => { state.rows = rows; schedulePendingRefresh(true) }).catch((error) => {
    state.errorMessage = error instanceof Error ? error.message : '审批数据加载失败'
  }).finally(() => { state.loading = false; pending = null })
  return pending
}

const decide = async (id: string, decision: ApprovalDecision, reason: string, operator: string): Promise<void> => {
  state.rows = await decideApproval(id, decision, reason, operator)
  const item = state.rows.find((row) => row.id === id)
  if (item && openStatuses.has(item.status)) schedulePendingRefresh(true)
}

const create = async (draft: Pick<ApprovalRecord, 'type' | 'applicant' | 'asset' | 'reason'> & { details?: Record<string, unknown> }): Promise<ApprovalRecord> => {
  const item = await createApproval(draft)
  state.rows = [item, ...state.rows]
  if (openStatuses.has(item.status)) schedulePendingRefresh(true)
  return item
}

export const useApprovals = () => ({ state: readonly(state), rows: computed(() => state.rows), load, decide, create })
