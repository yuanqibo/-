import type { AssetDraft, AssetImportRow } from '../types/assets'

export type AssetImportMode = 'asset' | 'update' | 'receive'

const aliases: Record<keyof AssetDraft | string, string[]> = {
  id: ['资产编码', '资产编号', '编号', 'id'],
  name: ['资产名称', '名称', 'name'],
  category: ['资产分类', '分类', 'category'],
  location: ['所在位置', '资产位置', '位置', '领用后位置', '接收位置', 'location'],
  company: ['所属公司', '使用公司', '公司'],
  department: ['使用部门', '部门'],
  owner: ['使用人', '人员姓名', '领用人', '接收人'],
  ownerSubject: ['ECP人员Subject', '人员Subject', '使用人Subject', '领用人Subject', 'ownerSubject', 'receiverSubject', 'unionId'],
  receiveDate: ['领用日期'],
  custodian: ['管理员', '资产管理员'],
  brand: ['品牌'], model: ['型号'], sn: ['设备序列号', '序列号', 'sn'],
  supplier: ['供应商'], price: ['金额', '价格', 'price'], purchaseDate: ['购置日期', '采购日期'],
  purchaseMethod: ['购置方式'], orderNo: ['订单号'], unit: ['计量单位', '单位'], rent: ['租金'], note: ['备注']
}

const normalizedHeader = (value: string): string => value.trim().toLowerCase().replace(/[\s_\-/（）()：:]/g, '')
const aliasLookup = new Map(Object.entries(aliases).flatMap(([field, values]) => values.map((value) => [normalizedHeader(value), field])))
const columnIndex = (reference: string): number => {
  const letters = reference.match(/^[A-Z]+/)?.[0] || 'A'
  return letters.split('').reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1
}

const textNodes = (element: Element, tag: string): string =>
  Array.from(element.getElementsByTagName(tag)).map((node) => node.textContent || '').join('')

const cellValue = (cell: Element, sharedStrings: string[]): string => {
  if (cell.getAttribute('t') === 'inlineStr') return textNodes(cell, 't')
  const raw = cell.getElementsByTagName('v')[0]?.textContent || ''
  return cell.getAttribute('t') === 's' ? sharedStrings[Number(raw)] || '' : raw
}

const parseRows = (xml: string, sharedStrings: string[]): string[][] => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return Array.from(doc.getElementsByTagName('row')).map((row) => {
    const values: string[] = []
    Array.from(row.getElementsByTagName('c')).forEach((cell) => { values[columnIndex(cell.getAttribute('r') || 'A1')] = cellValue(cell, sharedStrings).trim() })
    return values
  })
}

const rowDraft = (headers: string[], values: string[], rowNumber: number, mode: AssetImportMode): AssetImportRow => {
  const raw: Record<string, string> = {}
  headers.forEach((header, index) => {
    const field = aliasLookup.get(normalizedHeader(header))
    if (field && values[index] !== undefined) raw[field] = values[index].trim()
  })
  if (!Object.values(raw).some(Boolean)) return { rowNumber, draft: null, errors: [] }
  const errors: string[] = []
  if (mode === 'asset' && !raw.name) errors.push('资产名称不能为空')
  if (mode === 'asset' && !raw.category) errors.push('资产分类不能为空')
  if (mode !== 'update' && !raw.location) errors.push('所在位置不能为空')
  if (mode !== 'asset' && !raw.id) errors.push('资产编码不能为空')
  if (mode === 'update' && Object.entries(raw).every(([field, value]) => field === 'id' || !value)) errors.push('没有可更新的字段')
  if (mode === 'receive' && !raw.owner && !raw.ownerSubject) errors.push('领用人不能为空')
  if (mode === 'receive' && !raw.receiveDate) errors.push('领用日期不能为空')
  const price = Number(raw.price || 0)
  if (!Number.isFinite(price) || price < 0) errors.push('金额格式不正确')
  const draft = errors.length ? null : (mode === 'asset' ? {
    ...raw,
    name: raw.name || '',
    category: raw.category || '',
    location: raw.location || '',
    price,
    owner: '未分配',
    status: '空闲',
    type: raw.category
  } : {
    ...raw,
    name: raw.name || '',
    category: raw.category || '',
    location: raw.location || '',
    ...(raw.price ? { price } : {})
  }) as AssetDraft
  return { rowNumber, draft, errors }
}

export const parseAssetWorkbook = async (file: File, mode: AssetImportMode = 'asset'): Promise<AssetImportRow[]> => {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const sharedEntry = zip.file('xl/sharedStrings.xml')
  const sharedXml = sharedEntry ? await sharedEntry.async('string') : ''
  const sharedDoc = new DOMParser().parseFromString(sharedXml || '<sst/>', 'application/xml')
  const sharedStrings = Array.from(sharedDoc.getElementsByTagName('si')).map((item) => textNodes(item, 't'))
  const sheetEntry = zip.file('xl/worksheets/sheet1.xml')
  if (!sheetEntry) throw new Error('工作簿缺少第一个工作表')
  const rows = parseRows(await sheetEntry.async('string'), sharedStrings)
  if (rows.length < 2) throw new Error('导入文件没有可用数据')
  return rows.slice(1).map((values, index) => rowDraft(rows[0], values, index + 2, mode)).filter((row) => row.draft || row.errors.length)
}
