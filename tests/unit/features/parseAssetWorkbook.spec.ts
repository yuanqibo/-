import JSZip from 'jszip'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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

const workbookWithIntro = async (headers: string[], values: string[], mode: AssetImportMode) => {
  const zip = new JSZip()
  const cells = (row: number, items: string[]) => items.map((value, index) => {
    const column = String.fromCharCode(65 + index)
    return `<c r="${column}${row}" t="inlineStr"><is><t>${value}</t></is></c>`
  }).join('')
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData><row r="1">${cells(1, ['填写说明'])}</row><row r="2">${cells(2, headers)}</row><row r="3">${cells(3, values)}</row></sheetData></worksheet>`)
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

  it('accepts a complete replacement row without system-only location fields', async () => {
    const rows = await workbook(
      ['资产编码', '资产名称', '资产分类', '资产状态', '使用人'],
      ['AST-0001', '', '笔记本电脑', '领用', '张三'],
      'replace'
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].errors).toEqual([])
    expect(rows[0].draft).toMatchObject({ id: 'AST-0001', category: '笔记本电脑', status: '领用', owner: '张三' })
  })

  it('keeps the email used to disambiguate duplicate replacement owner names', async () => {
    const rows = await workbook(
      ['资产编码', '资产分类', '资产状态', '电子邮箱', '使用人'],
      ['AST-0001', '笔记本电脑', '领用', 'lihui4@accesscorporate.com.cn', '李慧'],
      'replace'
    )

    expect(rows[0].errors).toEqual([])
    expect(rows[0].draft).toMatchObject({
      id: 'AST-0001',
      owner: '李慧',
      email: 'lihui4@accesscorporate.com.cn'
    })
  })

  it('reads namespace-prefixed XLSX rows exported by spreadsheet tools', async () => {
    const zip = new JSZip()
    const row = (rowNumber: number, values: string[]) => values.map((value, index) => {
      const column = String.fromCharCode(65 + index)
      return `<x:c r="${column}${rowNumber}" t="inlineStr"><x:is><x:t>${value}</x:t></x:is></x:c>`
    }).join('')
    zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData><x:row r="1">${row(1, ['资产编码', '资产分类', '资产状态', '电子邮箱', '使用人'])}</x:row><x:row r="2">${row(2, ['AST-0001', '笔记本电脑', '领用', 'lihui4@accesscorporate.com.cn', '李慧'])}</x:row></x:sheetData></x:worksheet>`)
    const bytes = await zip.generateAsync({ type: 'arraybuffer' })

    const rows = await parseAssetWorkbook(new File([bytes], 'prefixed.xlsx'), 'replace')

    expect(rows).toHaveLength(1)
    expect(rows[0].errors).toEqual([])
    expect(rows[0].draft).toMatchObject({ id: 'AST-0001', owner: '李慧', email: 'lihui4@accesscorporate.com.cn' })
  })

  it('detects the real header below an introductory row and strips required markers', async () => {
    const rows = await workbookWithIntro(
      ['资产名称', '资产分类*', '品牌*', '购置方式*', '所属/承租公司*', '购置/起租日期*', '所在位置*', '使用公司*'],
      ['测试资产', 'IT设备', '测试品牌', '采购', '示例公司', '2026/07/19', '杭州仓库', '示例公司'],
      'asset'
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].errors).toEqual([])
    expect(rows[0].draft).toMatchObject({ name: '测试资产', category: 'IT设备', purchaseDate: '2026-07-19', ownerCompany: '示例公司' })
  })

  it('keeps Spreadsheet XML .xls templates compatible', async () => {
    const row = (values: string[]) => `<Row>${values.map((value) => `<Cell><Data ss:Type="String">${value}</Data></Cell>`).join('')}</Row>`
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="批量领用"><Table>${row(['资产编码*', '领用人', '领用日期*', '领用后位置*'])}${row(['AST-0001', '张三', '2026-07-19', '杭州仓库'])}</Table></Worksheet></Workbook>`
    const rows = await parseAssetWorkbook(new File([xml], 'receive.xls'), 'receive')

    expect(rows).toHaveLength(1)
    expect(rows[0].draft).toMatchObject({ id: 'AST-0001', owner: '张三', location: '杭州仓库' })
  })

  it('recognizes the bundled asset template instead of treating its instruction row as headers', async () => {
    const bytes = await readFile(resolve(process.cwd(), 'public/assets/asset-import-template.xlsx'))
    const file = new File([Uint8Array.from(bytes).buffer], 'asset-import-template.xlsx')

    await expect(parseAssetWorkbook(file, 'asset')).rejects.toThrow('模板中没有可导入的资产数据')
  })
})
