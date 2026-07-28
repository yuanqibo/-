import { describe, expect, it } from 'vitest'
import { resolvePortalRoleCode } from '../../src/core/auth/portal-role'

describe('resolvePortalRoleCode', () => {
  it('recognizes a custom application-admin role by its ECP role type', () => {
    expect(resolvePortalRoleCode([{ code: '9DFZW6', type: 'APP_ADMIN' }])).toBe('super_admin')
  })

  it('keeps recognizing standard role codes', () => {
    expect(resolvePortalRoleCode([{ code: 'APP_ADMIN' }])).toBe('super_admin')
    expect(resolvePortalRoleCode([{ code: 'OPERATOR' }])).toBe('admin')
    expect(resolvePortalRoleCode([{ code: 'APP_AUDITOR' }])).toBe('auditor')
  })

  it('defaults to employee for unrelated roles', () => {
    expect(resolvePortalRoleCode([{ code: 'JPNYHJ', type: 'VIEWER' }])).toBe('employee')
  })
})
