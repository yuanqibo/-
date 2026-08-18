import type { AuthzPermissionSnapshot } from '@acg/ecp-sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdkMocks = vi.hoisted(() => ({
  loadPermissionSnapshot: vi.fn(),
  initAuthzSdk: vi.fn()
}))

vi.mock('@acg/ecp-auth', async () => {
  const actual = await vi.importActual<typeof import('@acg/ecp-auth')>('@acg/ecp-auth')
  return { ...actual, initAuthzSdk: sdkMocks.initAuthzSdk }
})

describe('ECP permission snapshot loading', () => {
  beforeEach(() => {
    sdkMocks.loadPermissionSnapshot.mockReset()
    sdkMocks.initAuthzSdk.mockReset()
    sdkMocks.initAuthzSdk.mockReturnValue({
      loadPermissionSnapshot: sdkMocks.loadPermissionSnapshot
    })
  })

  it('reuses a cached snapshot so protected-route rendering is not blocked by ECP', async () => {
    const snapshot = {
      permissionCodes: ['asset:employee:view'],
      featureCodes: ['PORTAL_SETTINGS'],
      roleCodes: ['APP_ADMIN'],
      source: 'REMOTE'
    } as AuthzPermissionSnapshot
    sdkMocks.loadPermissionSnapshot.mockResolvedValue(snapshot)

    const { loadPortalPermissionSnapshot } = await import('../../src/ecp')
    const result = await loadPortalPermissionSnapshot('WLY5YG')

    expect(sdkMocks.initAuthzSdk).toHaveBeenCalledWith('WLY5YG')
    expect(sdkMocks.loadPermissionSnapshot).toHaveBeenCalledWith(false)
    expect(result?.permissionCodes).toEqual(expect.arrayContaining([
      ...snapshot.permissionCodes,
      'asset:disposal:view',
      'asset:disposal:create',
      'asset:disposal:complete',
      'asset:disposal:cancel',
      'asset:disposal:export'
    ]))
    expect(result?.featureCodes).toEqual(expect.arrayContaining([
      ...(snapshot.featureCodes || []),
      'PORTAL_ASSETS',
      'APP_WORKSPACE'
    ]))
    expect(result?.roleCodes).toEqual(snapshot.roleCodes)
    expect(result?.source).toBe(snapshot.source)
  })

  it('does not expand permissions for non-administrator snapshots', async () => {
    sdkMocks.loadPermissionSnapshot.mockResolvedValue({
      permissionCodes: ['asset:item:view'],
      featureCodes: ['PORTAL_ASSETS'],
      roleCodes: ['VIEWER'],
      source: 'REMOTE'
    } as AuthzPermissionSnapshot)

    const { loadPortalPermissionSnapshot } = await import('../../src/ecp')
    const result = await loadPortalPermissionSnapshot('WLY5YG')

    expect(result?.permissionCodes).not.toContain('asset:disposal:view')
    expect(result?.permissionCodes).toEqual(expect.arrayContaining(['asset:item:view']))
  })
})
