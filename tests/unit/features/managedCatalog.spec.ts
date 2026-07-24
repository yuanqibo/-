import { describe, expect, it } from 'vitest'
import { flattenManagedCatalog } from '../../../src/features/assets/composables/managedCatalog'

describe('flattenManagedCatalog', () => {
  it('keeps categories selectable when only their asset code is disabled', () => {
    const options = flattenManagedCatalog([{
      id: 'cat-it',
      code: '01',
      name: 'IT设备',
      enabled: false,
      unit: '台',
      usefulLife: '36',
      children: []
    }], [], true)

    expect(options).toEqual([{
      value: 'IT设备',
      label: 'IT设备',
      unit: '台',
      usefulLife: '36'
    }])
  })
})
