import { describe, expect, it } from 'vitest'
import { buildManagedCatalogTree, flattenManagedCatalog } from '../../../src/features/assets/composables/managedCatalog'

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

  it('keeps catalog hierarchy collapsed-ready while preserving stored values', () => {
    const nodes = [{
      id: 'root',
      name: '杭州公司',
      children: [{ id: 'child', name: '封存仓库', children: [] }]
    }]

    expect(buildManagedCatalogTree(nodes)).toEqual([{
      value: '杭州公司',
      label: '杭州公司',
      unit: undefined,
      usefulLife: undefined,
      children: [{
        value: '杭州公司 / 封存仓库',
        label: '封存仓库',
        unit: undefined,
        usefulLife: undefined
      }]
    }])
    expect(buildManagedCatalogTree(nodes, [], true)[0].children?.[0].value).toBe('封存仓库')
  })
})
