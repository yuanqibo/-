import { describe, expect, it } from 'vitest'
import { buildManagedCatalogTree, flattenManagedCatalog, managedCatalogNames } from '../../../src/features/assets/composables/managedCatalog'

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
    expect(managedCatalogNames(nodes)).toEqual(['杭州公司', '封存仓库'])
  })

  it('ignores malformed roots and children instead of throwing', () => {
    const malformed = [{ id: 'bad', name: '有效节点', children: {} }, null, { id: 'bad-2', children: [] }] as never
    expect(flattenManagedCatalog(malformed)).toEqual([{
      value: '有效节点', label: '有效节点', unit: undefined, usefulLife: undefined
    }])
    expect(buildManagedCatalogTree(malformed)).toEqual([{
      value: '有效节点', label: '有效节点', unit: undefined, usefulLife: undefined
    }])
    expect(managedCatalogNames(malformed)).toEqual(['有效节点'])
  })
})
