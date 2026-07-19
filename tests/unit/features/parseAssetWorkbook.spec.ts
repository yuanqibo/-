import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { parseAssetWorkbook, type AssetImportMode } from '../../../src/features/assets/composables/parseAssetWorkbook'

const workbook = async (headers: string[], values: string[], mode: AssetImportMode) => {
  const zip = new JSZip()
  const cells = (row: number, items: string[]) => items.map((value, index) => {
    const column = String.fromCharCode(65 + index)
    return `<c r="${column}${row}" t="inlineStr"><is><t>${value}</t></is></c>`
  }).join('')
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData><row r="1">${cells(1, headers)}</row><row r="2">${cells(2, values)}</row></sheetData></worksheet>`)
  const bytes = await zip.generateAsync({ type: 'arraybuffer' })
  return parseAssetWorkbook(new File([bytes], 'import.xlsx'), mode)
}

describe('parseAssetWorkbook import modes', () => {
  it('accepts an update row with an asset id and only changed fields', async () => {
    const rows = await workbook(['资产编码', '资产名称'], ['AST-0001', '更新后的名称'], 'update')

    expect(rows).toHaveLength(1)
    expect(rows[0].errors).toEqual([])
    expect(rows[0].draft).toMatchObject({ id: 'AST-0001', name: '更新后的名称' })
  })

  it('requires the ECP recipient, date and location for receive imports', async () => {
    const rows = await workbook(['资产编码', '领用人', '领用日期', '领用后位置'], ['AST-0001', '张三', '2026-07-19', '杭州仓库'], 'receive')

    expect(rows).toHaveLength(1)
    expect(rows[0].errors).toEqual([])
    expect(rows[0].draft).toMatchObject({ id: 'AST-0001', owner: '张三', receiveDate: '2026-07-19', location: '杭州仓库' })
  })
})
