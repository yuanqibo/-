import { computed, ref } from 'vue'
import { usePortalSession } from './portal-session'

export type PortalTerminalMode = 'management' | 'employee'

const storageKey = 'assetPortalTerminalMode'
const managementViewPermissions = new Set([
  'asset:employee:view',
  'asset:department:view',
  'authz:app_role:view',
  'asset:inbound:view',
  'asset:receive_return:view',
  'asset:borrow_return:view',
  'asset:stocktake:view',
  'asset:request:review',
  'asset:location_settings:view',
  'asset:category_settings:view',
  'asset:code_rules:view',
  'asset:label_template_settings:view',
  'asset:self_service:update',
  'asset:integration:view',
  'asset:form:view'
])

const loadPreferredMode = (): PortalTerminalMode => {
  try { return localStorage.getItem(storageKey) === 'employee' ? 'employee' : 'management' }
  catch { return 'management' }
}

const preferredMode = ref<PortalTerminalMode>(loadPreferredMode())

export const useTerminalMode = () => {
  const { user } = usePortalSession()
  const canSwitchTerminal = computed(() => (user.value?.permissionCodes || []).some((code) => managementViewPermissions.has(code)))
  const terminalMode = computed<PortalTerminalMode>(() => {
    if (!user.value) return preferredMode.value
    return canSwitchTerminal.value ? preferredMode.value : 'employee'
  })
  const isEmployeeTerminal = computed(() => terminalMode.value === 'employee')

  const setTerminalMode = (mode: PortalTerminalMode): boolean => {
    if (mode === 'management' && !canSwitchTerminal.value) return false
    preferredMode.value = mode
    try { localStorage.setItem(storageKey, mode) }
    catch { /* The active mode still changes when local persistence is unavailable. */ }
    return true
  }

  return { terminalMode, isEmployeeTerminal, canSwitchTerminal, setTerminalMode }
}
