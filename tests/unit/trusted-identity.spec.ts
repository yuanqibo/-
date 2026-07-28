import { describe, expect, it } from 'vitest'
import type { AuthzSessionContext } from '@acg/ecp-sdk'
import { applyTrustedPortalIdentity } from '../../src/core/auth/trusted-identity'

const session = {
  appCode: 'WLY5YG',
  sessionToken: 'token',
  user: { accountId: 'vlbe8nyybl35d17u', name: '袁其博', departments: [] },
  tenant: { authzTenantId: 'tenant' },
  roles: [{ code: 'JPNYHJ', name: '员工自助', type: 'VIEWER' }],
  permissionCodes: ['asset:item:view'],
  featureCodes: ['PORTAL_HOME']
} satisfies AuthzSessionContext

describe('trusted portal identity', () => {
  it('restores an authoritative ECP application administrator', () => {
    const result = applyTrustedPortalIdentity(session, {
      roleCode: 'super_admin',
      permissionCodes: ['asset:item:create', 'authz:app_role:assign'],
      featureCodes: ['PORTAL_ASSETS', 'PORTAL_SETTINGS', 'APP_WORKSPACE']
    })

    expect(result.roles).toContainEqual({ code: 'APP_ADMIN', name: '应用管理员', type: 'APP_ADMIN' })
    expect(result.permissionCodes).toEqual(expect.arrayContaining(['asset:item:view', 'asset:item:create', 'authz:app_role:assign']))
    expect(result.featureCodes).toEqual(expect.arrayContaining(['PORTAL_HOME', 'PORTAL_SETTINGS', 'APP_WORKSPACE']))
  })

  it('does not elevate an ordinary employee response', () => {
    expect(applyTrustedPortalIdentity(session, { roleCode: 'employee' })).toBe(session)
  })
})
