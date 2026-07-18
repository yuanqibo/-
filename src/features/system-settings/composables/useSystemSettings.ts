import { computed, reactive, readonly } from 'vue'
import { deleteForm as deleteFormRequest, fetchForms, fetchIntegrations, fetchSelfServiceSettings, saveForm as saveFormRequest, saveIntegration as saveIntegrationRequest, saveSelfServiceSettings } from '../api/system-settings.api'
import type { SelfServiceSettings, SystemFormDefinition, SystemIntegration } from '../types/system-settings'

const state = reactive({ integrations: [] as SystemIntegration[], forms: [] as SystemFormDefinition[], selfService: {} as SelfServiceSettings, loading: false, errorMessage: '' })

const run = async (work: () => Promise<void>): Promise<void> => {
  state.loading = true; state.errorMessage = ''
  try { await work() } catch (error) { state.errorMessage = error instanceof Error ? error.message : '系统配置请求失败'; throw error }
  finally { state.loading = false }
}

const loadIntegrations = () => run(async () => { state.integrations = await fetchIntegrations() })
const loadForms = () => run(async () => { state.forms = await fetchForms() })
const loadSelfService = () => run(async () => { state.selfService = await fetchSelfServiceSettings() })
const saveIntegration = async (value: Parameters<typeof saveIntegrationRequest>[0]): Promise<void> => {
  const saved = await saveIntegrationRequest(value)
  const index = state.integrations.findIndex((item) => item.id === saved.id)
  if (index >= 0) state.integrations[index] = saved; else state.integrations.push(saved)
}
const saveForm = async (value: Parameters<typeof saveFormRequest>[0]): Promise<void> => {
  const saved = await saveFormRequest(value)
  const index = state.forms.findIndex((item) => item.id === saved.id)
  if (index >= 0) state.forms[index] = saved; else state.forms.push(saved)
}
const removeForm = async (item: SystemFormDefinition): Promise<void> => { await deleteFormRequest(item.id, item.version); state.forms = state.forms.filter((row) => row.id !== item.id) }
const saveSelfService = async (value: SelfServiceSettings): Promise<void> => { await saveSelfServiceSettings(value); state.selfService = value }

export const useSystemSettings = () => ({ state: readonly(state), integrations: computed(() => state.integrations), forms: computed(() => state.forms), selfService: computed(() => state.selfService), loadIntegrations, loadForms, loadSelfService, saveIntegration, saveForm, removeForm, saveSelfService })
