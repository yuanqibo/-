import { describe, expect, it, vi } from 'vitest'
import type { AuthzPermissionSnapshot, AuthzSessionContext } from '@acg/ecp-sdk'
import {
  EMPLOYEE_SELF_SERVICE_FEATURE_CODES,
  EMPLOYEE_SELF_SERVICE_PERMISSION_CODES,
  withEmployeeSelfServiceSession,
  withEmployeeSelfServiceSnapshot
} from '../../src/core/auth/employee-self-service-access'

vi.mock('@acg/ecp-auth', () => ({ initAuthzSdk: vi.fn() }))

const session = (): AuthzSessionContext => ({
  appCode: 'WLY5YG',
  sessionToken: 'session-token',
  user: { accountId: 'employee-1', name: '普通员工', departments: [] },
  tenant: { authzTenantId: 'tenant-1' },
  roles: [],
  permissionCodes: []
})

describe('employee self-service access', () => {
  it('adds the minimal employee permissions and navigation features to an authenticated session', () => {
    const augmented = withEmployeeSelfServiceSession(session())

    expect(augmented.permissionCodes).toEqual(EMPLOYEE_SELF_SERVICE_PERMISSION_CODES)
    expect(augmented.featureCodes).toEqual(EMPLOYEE_SELF_SERVICE_FEATURE_CODES)
  })

  it('preserves permissions already granted by ECP and removes duplicates', () => {
    const source = session()
    source.permissionCodes = ['asset:item:view', 'asset:employee:view']
    source.featureCodes = ['PORTAL_HOME', 'PORTAL_SETTINGS']

    const augmented = withEmployeeSelfServiceSession(source)

    expect(augmented.permissionCodes).toContain('asset:employee:view')
    expect(augmented.permissionCodes.filter((code) => code === 'asset:item:view')).toHaveLength(1)
    expect(augmented.featureCodes).toContain('PORTAL_SETTINGS')
  })

  it('applies the same baseline to route permission snapshots', () => {
    const snapshot: AuthzPermissionSnapshot = {
      permissionCodes: [],
      roleCodes: [],
      source: 'REMOTE'
    }

    const augmented = withEmployeeSelfServiceSnapshot(snapshot)

    expect(augmented.permissionCodes).toEqual(EMPLOYEE_SELF_SERVICE_PERMISSION_CODES)
    expect(augmented.featureCodes).toEqual(EMPLOYEE_SELF_SERVICE_FEATURE_CODES)
  })
})
