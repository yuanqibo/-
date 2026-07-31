import { readonly, reactive, toRefs } from 'vue'
import { cancelDisposal, completeDisposal, createDisposal, fetchDisposals } from '../api/disposals.api'
import type { DisposalDraft, DisposalRecord } from '../types/disposal'

const state = reactive({
  items: [] as DisposalRecord[],
  loading: false,
  initialized: false,
  errorMessage: ''
})

let pending: Promise<void> | null = null

const load = async (force = false): Promise<void> => {
  if (state.initialized && !force) return
  if (pending) return pending
  state.loading = true
  state.errorMessage = ''
  pending = fetchDisposals()
    .then((items) => { state.items = items; state.initialized = true })
    .catch((error) => { state.errorMessage = error instanceof Error ? error.message : '处置单加载失败'; throw error })
    .finally(() => { state.loading = false; pending = null })
  return pending
}

const create = async (draft: DisposalDraft): Promise<DisposalRecord> => {
  const item = await createDisposal(draft)
  state.items = [item, ...state.items]
  return item
}

const complete = async (id: string): Promise<void> => { state.items = await completeDisposal(id) }
const cancel = async (id: string, assetIds: string[], reason: string): Promise<void> => {
  state.items = await cancelDisposal(id, assetIds, reason)
}

export const useDisposals = () => ({ ...toRefs(readonly(state)), load, create, complete, cancel })
