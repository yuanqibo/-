import { computed, ref } from 'vue'
import { usePortalSession } from './portal-session'

export type PortalTerminalMode = 'management' | 'employee'

const storageKey = 'assetPortalTerminalMode'
const managementRoleCodes = new Set(['super_admin', 'admin', 'auditor'])

export const canUseManagementTerminal = (roleCode?: string): boolean =>
  managementRoleCodes.has(String(roleCode || '').trim().toLowerCase())

const loadPreferredMode = (): PortalTerminalMode => {
  try { return localStorage.getItem(storageKey) === 'employee' ? 'employee' : 'management' }
  catch { return 'management' }
}

const preferredMode = ref<PortalTerminalMode>(loadPreferredMode())

export const useTerminalMode = () => {
  const { user } = usePortalSession()
  const canSwitchTerminal = computed(() => canUseManagementTerminal(user.value?.roleCode))
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
