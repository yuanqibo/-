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

  it('forces a fresh snapshot before every protected route decision', async () => {
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
    expect(sdkMocks.loadPermissionSnapshot).toHaveBeenCalledWith(true)
    expect(result?.permissionCodes).toEqual(expect.arrayContaining(snapshot.permissionCodes))
    expect(result?.featureCodes).toEqual(expect.arrayContaining(snapshot.featureCodes || []))
    expect(result?.roleCodes).toEqual(snapshot.roleCodes)
    expect(result?.source).toBe(snapshot.source)
  })
})
