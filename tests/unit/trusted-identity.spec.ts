import { describe, expect, it } from 'vitest'
import type { AuthzPermissionSnapshot, AuthzSessionContext } from '@acg/ecp-sdk'
import {
  applyTrustedPermissionSnapshot,
  applyTrustedPortalIdentity
} from '../../src/core/auth/trusted-identity'

const session = {
  appCode: 'WLY5YG',
  sessionToken: 'token',
  user: { accountId: 'vlbe8nyybl35d17u', name: '袁其博', departments: [] },
  tenant: { authzTenantId: 'tenant' },
  roles: [{ code: 'JPNYHJ', name: '员工自助', type: 'VIEWER' }],
  permissionCodes: ['asset:item:view'],
  featureCodes: ['PORTAL_HOME']
} satisfies AuthzSessionContext

const snapshot = {
  permissionCodes: ['asset:item:view'],
  roleCodes: ['JPNYHJ'],
  roleNamesByCode: { JPNYHJ: '员工自助' },
  featureCodes: ['PORTAL_HOME'],
  source: 'REMOTE'
} satisfies AuthzPermissionSnapshot

describe('trusted portal identity', () => {
  it('restores an authoritative ECP application administrator', () => {
    const result = applyTrustedPortalIdentity(session, {
      roleCode: 'super_admin',
      permissionCodes: ['asset:item:create', 'authz:app_role:assign'],
      featureCodes: ['PORTAL_ASSETS', 'PORTAL_SETTINGS', 'APP_WORKSPACE']
    }, {
      permissionCodes: ['asset:disposal:view', 'asset:disposal:create'],
      featureCodes: ['PORTAL_REQUESTS']
    })

    expect(result.roles).toContainEqual({ code: 'APP_ADMIN', name: '应用管理员', type: 'APP_ADMIN' })
    expect(result.permissionCodes).toEqual(expect.arrayContaining([
      'asset:item:view', 'asset:item:create', 'authz:app_role:assign', 'asset:disposal:view', 'asset:disposal:create'
    ]))
    expect(result.featureCodes).toEqual(expect.arrayContaining([
      'PORTAL_HOME', 'PORTAL_SETTINGS', 'APP_WORKSPACE', 'PORTAL_REQUESTS'
    ]))
  })

  it('does not elevate an ordinary employee response', () => {
    expect(applyTrustedPortalIdentity(session, { roleCode: 'employee' })).toBe(session)
  })

  it('restores the same administrator grant in the route permission snapshot', () => {
    const result = applyTrustedPermissionSnapshot(snapshot, {
      roleCode: 'super_admin',
      permissionCodes: ['asset:employee:view', 'authz:app_role:assign'],
      featureCodes: ['PORTAL_SETTINGS', 'APP_WORKSPACE']
    }, {
      permissionCodes: ['asset:disposal:view', 'asset:disposal:complete'],
      featureCodes: ['PORTAL_ASSETS']
    })

    expect(result.roleCodes).toEqual(expect.arrayContaining(['JPNYHJ', 'APP_ADMIN']))
    expect(result.roleNamesByCode?.APP_ADMIN).toBe('应用管理员')
    expect(result.permissionCodes).toEqual(expect.arrayContaining([
      'asset:item:view', 'asset:employee:view', 'asset:disposal:view', 'asset:disposal:complete'
    ]))
    expect(result.featureCodes).toEqual(expect.arrayContaining(['PORTAL_HOME', 'PORTAL_SETTINGS', 'PORTAL_ASSETS']))
  })

  it('does not grant the local administrator catalog to a non-super administrator', () => {
    const result = applyTrustedPortalIdentity(session, {
      roleCode: 'admin',
      permissionCodes: ['asset:item:update']
    }, {
      permissionCodes: ['asset:disposal:view']
    })

    expect(result.permissionCodes).toContain('asset:item:update')
    expect(result.permissionCodes).not.toContain('asset:disposal:view')
  })

  it('does not elevate an ordinary employee permission snapshot', () => {
    expect(applyTrustedPermissionSnapshot(snapshot, { roleCode: 'employee' })).toBe(snapshot)
  })
})
