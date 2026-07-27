import { describe, expect, it, vi } from 'vitest'

vi.mock('../../src/core/auth/portal-session', () => ({ usePortalSession: vi.fn() }))

import { canUseManagementTerminal } from '../../src/core/auth/terminal-mode'

describe('terminal mode role boundary', () => {
  it.each(['super_admin', 'admin', 'auditor'])(
    'allows the %s role to use the management terminal',
    (roleCode) => {
      expect(canUseManagementTerminal(roleCode)).toBe(true)
    }
  )

  it.each(['employee', 'VIEWER', 'JPNYHJ', '', undefined])(
    'keeps the %s role in the employee terminal',
    (roleCode) => {
      expect(canUseManagementTerminal(roleCode)).toBe(false)
    }
  )
})
