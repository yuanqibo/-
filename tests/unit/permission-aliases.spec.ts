import { describe, expect, it } from 'vitest'
import { hasPortalPermission } from '../../src/authz/permission-aliases'

describe('asset lifecycle permission aliases', () => {
  it('accepts legacy item permissions while ECP roles migrate', () => {
    const granted = new Set(['asset:item:receive', 'asset:item:borrowReturn'])

    expect(hasPortalPermission(granted, 'asset:receive_return:receive')).toBe(true)
    expect(hasPortalPermission(granted, 'asset:borrow_return:return')).toBe(true)
  })

  it('accepts the ECP business-domain permissions from the current catalog', () => {
    const granted = new Set(['asset:receive_return:handover', 'asset:borrow_return:borrow'])

    expect(hasPortalPermission(granted, 'asset:item:handover')).toBe(true)
    expect(hasPortalPermission(granted, 'asset:item:borrow')).toBe(true)
    expect(hasPortalPermission(granted, 'asset:item:delete')).toBe(false)
  })
})
