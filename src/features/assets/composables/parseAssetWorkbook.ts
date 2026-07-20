import type { AssetDraft, AssetImportRow } from '../types/assets'

export type AssetImportMode = 'asset' | 'update' | 'receive'

const aliases: Record<keyof AssetDraft | string, string[]> = {
  id: ['资产编码', '资产编号', '编号', 'id'],
  name: ['资产名称', '名称', 'name'],
  category: ['资产分类', '分类', 'category'],
  location: ['所在位置', '资产位置', '位置', '领用后位置', '接收位置', 'location'],
  company: ['使用公司', '公司'],
  ownerCompany: ['所属/承租公司', '所属公司', '承租公司'],
  department: ['使用部门', '部门'],
  owner: ['使用人', '人员姓名', '领用人', '接收人'],
  ownerSubject: ['ECP人员Subject', '人员Subject', '使用人Subject', '领用人Subject', 'ownerSubject', 'receiverSubject', 'unionId'],
  receiveDate: ['领用日期'],
  custodian: ['管理员', '资产管理员', '管理员账号'],
  condition: ['资产状况', '状况'],
  usageMonths: ['使用期限(月)', '使用期限（月）', '使用期限'],
  brand: ['品牌'],
  model: ['型号'],
  sn: ['设备序列号', '序列号', 'sn'],
  supplier: ['供应商'],
  price: ['金额', '价格', 'price'],
  purchaseDate: ['购置/起租日期', '购置日期', '采购日期', '起租日期'],
  warrantyDate: ['维保到期时间', '维保到期日期'],
  purchaseMethod: ['购置方式'],
  orderNo: ['订单号'],
  unit: ['计量单位', '单位'],
  rent: ['租金'],
  note: ['备注']
}

const normalizedHeader = (value: string): string => value.trim().toLowerCase().replace(/[\s*_\-/（）()：:]/g, '')
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

type WorkbookRow = { rowNumber: number; values: string[] }

const parseRows = (xml: string, sharedStrings: string[]): WorkbookRow[] => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return Array.from(doc.getElementsByTagName('row')).map((row, rowIndex) => {
    const values: string[] = []
    Array.from(row.getElementsByTagName('c')).forEach((cell) => {
      values[columnIndex(cell.getAttribute('r') || 'A1')] = cellValue(cell, sharedStrings).trim()
    })
    return { rowNumber: Number(row.getAttribute('r')) || rowIndex + 1, values }
  })
}

const spreadsheetAttribute = (node: Element, name: string): string | null =>
  node.getAttribute(`ss:${name}`) || node.getAttribute(name) || node.getAttributeNS('urn:schemas-microsoft-com:office:spreadsheet', name)

const parseSpreadsheetXmlRows = (xml: string): WorkbookRow[] => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return Array.from(doc.getElementsByTagName('Row')).map((row, rowIndex) => {
    const values: string[] = []
    let cursor = 0
    Array.from(row.getElementsByTagName('Cell')).forEach((cell) => {
      const explicitIndex = Number(spreadsheetAttribute(cell, 'Index'))
      if (explicitIndex) cursor = explicitIndex - 1
      values[cursor] = cell.getElementsByTagName('Data')[0]?.textContent?.trim() || ''
      cursor += 1
    })
    return { rowNumber: Number(spreadsheetAttribute(row, 'Index')) || rowIndex + 1, values }
  })
}

const parseHtmlRows = (html: string): WorkbookRow[] => {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.querySelectorAll('tr')).map((row, rowIndex) => ({
    rowNumber: rowIndex + 1,
    values: Array.from(row.querySelectorAll('th,td')).map((cell) => cell.textContent?.trim() || '')
  }))
}

const readWorkbookRows = async (file: File): Promise<WorkbookRow[]> => {
  if (/\.xls$/i.test(file.name)) {
    const text = await file.text()
    if (text.includes('<Workbook')) return parseSpreadsheetXmlRows(text)
    if (/<table[\s>]/i.test(text)) return parseHtmlRows(text)
    throw new Error('暂不支持二进制 .xls，请另存为 .xlsx 后再导入')
  }
  if (!/\.xlsx$/i.test(file.name)) throw new Error('请上传 .xls 或 .xlsx 表格')
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const sharedEntry = zip.file('xl/sharedStrings.xml')
  const sharedXml = sharedEntry ? await sharedEntry.async('string') : ''
  const sharedDoc = new DOMParser().parseFromString(sharedXml || '<sst/>', 'application/xml')
  const sharedStrings = Array.from(sharedDoc.getElementsByTagName('si')).map((item) => textNodes(item, 't'))
  const sheetEntry = zip.file('xl/worksheets/sheet1.xml') || Object.values(zip.files).find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
  if (!sheetEntry) throw new Error('工作簿缺少可读取的工作表')
  return parseRows(await sheetEntry.async('string'), sharedStrings)
}

const normalizeDate = (value: string): string => {
  const text = value.trim()
  if (!text) return ''
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  const serial = Number(text)
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10)
  const match = text.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})/)
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : text
}

const parseNumber = (value: string): number => Number(value.replace(/[,\s￥¥元]/g, '')) || 0
const isInstructionRow = (raw: Record<string, string>): boolean => {
  const text = Object.values(raw).join(' ')
  return text.includes('必填项') || text.includes('请勿填写') || text.includes('仅可') || text.includes('格式YYYY')
}
const isTemplateSample = (raw: Record<string, string>): boolean => !raw.id && raw.name === 'Thinkpad T430' && raw.category === '笔记本电脑' && raw.brand === 'Thinkpad' && raw.model === 'T430'

const rowDraft = (headers: string[], values: string[], rowNumber: number, mode: AssetImportMode): AssetImportRow => {
  const raw: Record<string, string> = {}
  headers.forEach((header, index) => {
    const field = aliasLookup.get(normalizedHeader(header))
    if (field && values[index] !== undefined) raw[field] = values[index].trim()
  })
  if (!Object.values(raw).some(Boolean) || isInstructionRow(raw) || isTemplateSample(raw)) return { rowNumber, draft: null, errors: [] }
  const errors: string[] = []
  if (mode === 'asset' && !raw.category) errors.push('资产分类不能为空')
  if (mode === 'asset' && !raw.brand) errors.push('品牌不能为空')
  if (mode === 'asset' && !raw.purchaseMethod) errors.push('购置方式不能为空')
  if (mode === 'asset' && !raw.ownerCompany) errors.push('所属/承租公司不能为空')
  if (mode === 'asset' && !raw.purchaseDate) errors.push('购置/起租日期不能为空')
  if (mode === 'asset' && !raw.company) errors.push('使用公司不能为空')
  if (mode !== 'update' && !raw.location) errors.push('所在位置不能为空')
  if (mode !== 'asset' && !raw.id) errors.push('资产编码不能为空')
  if (mode === 'update' && Object.entries(raw).every(([field, value]) => field === 'id' || !value)) errors.push('没有可更新的字段')
  if (mode === 'receive' && !raw.owner && !raw.ownerSubject) errors.push('领用人不能为空')
  if (mode === 'receive' && !raw.receiveDate) errors.push('领用日期不能为空')
  const numericPrice = Number((raw.price || '').replace(/[,\s￥¥元]/g, '') || 0)
  if (!Number.isFinite(numericPrice) || numericPrice < 0) errors.push('金额格式不正确')
  const draft = errors.length ? null : (mode === 'asset' ? {
    ...raw,
    name: raw.name || `${raw.category}资产`,
    category: raw.category || '',
    location: raw.location || '',
    price: parseNumber(raw.price || ''),
    rent: parseNumber(raw.rent || ''),
    purchaseDate: normalizeDate(raw.purchaseDate || ''),
    receiveDate: normalizeDate(raw.receiveDate || ''),
    warrantyDate: normalizeDate(raw.warrantyDate || '') || '未设置',
    condition: raw.condition === '故障' ? '维修中' : raw.condition || '正常',
    owner: raw.owner || (raw.ownerSubject ? '待服务端解析' : '未分配'),
    status: raw.condition === '故障' || raw.condition === '维修中' ? '维修中' : raw.owner || raw.ownerSubject || raw.receiveDate ? '在用' : '空闲',
    type: raw.category
  } : {
    ...raw,
    name: raw.name || '',
    category: raw.category || '',
    location: raw.location || '',
    ...(raw.price ? { price: parseNumber(raw.price) } : {}),
    ...(raw.rent ? { rent: parseNumber(raw.rent) } : {}),
    ...(raw.purchaseDate ? { purchaseDate: normalizeDate(raw.purchaseDate) } : {}),
    ...(raw.receiveDate ? { receiveDate: normalizeDate(raw.receiveDate) } : {})
  }) as AssetDraft
  return { rowNumber, draft, errors }
}

export const parseAssetWorkbook = async (file: File, mode: AssetImportMode = 'asset'): Promise<AssetImportRow[]> => {
  const rows = await readWorkbookRows(file)
  if (rows.length < 2) throw new Error('导入文件没有可用数据')
  const header = rows.slice(0, 12)
    .map((row, index) => ({ row, index, score: new Set(row.values.map((value) => aliasLookup.get(normalizedHeader(value))).filter(Boolean)).size }))
    .filter((candidate) => candidate.score >= 2)
    .sort((left, right) => right.score - left.score)[0]
  if (!header) throw new Error('未识别到资产导入表头，请使用资产导入模板')
  const parsed = rows.slice(header.index + 1)
    .map((row) => rowDraft(header.row.values, row.values, row.rowNumber, mode))
    .filter((row) => row.draft || row.errors.length)
  if (parsed.length > 5000) throw new Error('最大数据行数不超过5000行')
  if (!parsed.length) throw new Error('模板中没有可导入的资产数据')
  return parsed
}
