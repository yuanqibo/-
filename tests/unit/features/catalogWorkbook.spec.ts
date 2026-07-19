import { reactive } from 'vue'
import { describe, expect, it } from 'vitest'
import { mergeCatalogRows } from '../../../src/features/assets/composables/catalogWorkbook'
import type { CatalogNode } from '../../../src/features/assets/types/assets'

describe('catalogWorkbook', () => {
  it('merges rows from a reactive catalog without mutating the source tree', () => {
    const source = reactive<CatalogNode[]>([
      { id: 'root', name: 'IT设备', code: '01', enabled: true, children: [] }
    ])

    const result = mergeCatalogRows(source, [{
      rowNumber: 2,
      code: '0101',
      name: '笔记本电脑',
      parent: 'IT设备',
      usefulLife: '36',
      unit: '台',
      enabled: true
    }], 'categories')

    expect(result[0].children[0]).toMatchObject({ name: '笔记本电脑', code: '0101', usefulLife: '36' })
    expect(source[0].children).toEqual([])
  })
})
