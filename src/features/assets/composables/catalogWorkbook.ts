import type JSZipType from 'jszip'
import type { CatalogNode } from '../types/assets'

export type CatalogKind = 'categories' | 'locations'
export type CatalogImportRow = { rowNumber: number; code: string; name: string; parent: string; usefulLife: string; unit: string; enabled: boolean | null }

const escapeXml = (value: unknown): string => String(value ?? '').replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character] || character))
const columnName = (index: number): string => {
  let name = ''
  for (let current = index; current > 0; current = Math.floor((current - 1) / 26)) name = String.fromCharCode(65 + (current - 1) % 26) + name
  return name
}
const columnIndex = (reference: string): number => (reference.match(/^[A-Z]+/)?.[0] || 'A').split('').reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1
const textNodes = (element: Element, tag: string): string => Array.from(element.getElementsByTagName(tag)).map((node) => node.textContent || '').join('')

const readRows = async (file: File): Promise<Array<{ rowNumber: number; values: string[] }>> => {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const sharedEntry = zip.file('xl/sharedStrings.xml')
  const sharedDoc = new DOMParser().parseFromString(sharedEntry ? await sharedEntry.async('string') : '<sst/>', 'application/xml')
  const shared = Array.from(sharedDoc.getElementsByTagName('si')).map((item) => textNodes(item, 't'))
  const sheetEntry = zip.file('xl/worksheets/sheet1.xml') || Object.values(zip.files).find((entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
  if (!sheetEntry) throw new Error('未找到工作表')
  const sheet = new DOMParser().parseFromString(await sheetEntry.async('string'), 'application/xml')
  return Array.from(sheet.getElementsByTagName('row')).map((row, index) => {
    const values: string[] = []
    Array.from(row.getElementsByTagName('c')).forEach((cell) => {
      const raw = cell.getElementsByTagName('v')[0]?.textContent || ''
      values[columnIndex(cell.getAttribute('r') || 'A1')] = (cell.getAttribute('t') === 'inlineStr' ? textNodes(cell, 't') : cell.getAttribute('t') === 's' ? shared[Number(raw)] || '' : raw).trim()
    })
    return { rowNumber: Number(row.getAttribute('r') || index + 1), values }
  })
}

const normalized = (value: string): string => value.trim().toLowerCase().replace(/[\s_*（）()：:]/g, '')
const aliases = new Map([
  ['位置编码', 'code'], ['分类编码', 'code'], ['编码', 'code'], ['位置名称', 'name'], ['分类名称', 'name'], ['名称', 'name'],
  ['上级位置名称', 'parent'], ['上级分类名称', 'parent'], ['上级位置', 'parent'], ['上级分类', 'parent'],
  ['使用期限(月)', 'usefulLife'], ['使用期限（月）', 'usefulLife'], ['使用期限', 'usefulLife'], ['计量单位', 'unit'], ['单位', 'unit'],
  ['资产编码开关', 'enabled'], ['编码开关', 'enabled']
].map(([label, field]) => [normalized(label), field]))

const enabledValue = (value: string): boolean | null => {
  const item = value.trim().toLowerCase()
  if (!item) return null
  if (['关', '关闭', '停用', '否', 'false', '0', 'off'].includes(item)) return false
  if (['开', '开启', '启用', '是', 'true', '1', 'on'].includes(item)) return true
  throw new Error(`资产编码开关“${value}”无效，请填写开或关`)
}

export const parseCatalogWorkbook = async (file: File, kind: CatalogKind): Promise<CatalogImportRow[]> => {
  const rows = await readRows(file)
  let header = -1
  let columns: Record<string, number> = {}
  rows.slice(0, 12).forEach((row, index) => {
    const candidate: Record<string, number> = {}
    row.values.forEach((value, column) => { const field = aliases.get(normalized(value)); if (field && candidate[field] === undefined) candidate[field] = column })
    const valid = kind === 'categories' ? candidate.code !== undefined && candidate.name !== undefined : candidate.name !== undefined
    if (valid && Object.keys(candidate).length > Object.keys(columns).length) { header = index; columns = candidate }
  })
  if (header < 0) throw new Error(`未识别到${kind === 'categories' ? '分类' : '位置'}导入表头，请使用导入模板`)
  const cell = (values: string[], field: string): string => columns[field] === undefined ? '' : String(values[columns[field]] || '').trim()
  return rows.slice(header + 1).map((row) => ({ rowNumber: row.rowNumber, code: cell(row.values, 'code'), name: cell(row.values, 'name'), parent: cell(row.values, 'parent'), usefulLife: cell(row.values, 'usefulLife'), unit: cell(row.values, 'unit'), enabled: enabledValue(cell(row.values, 'enabled')) }))
    .filter((row) => [row.code, row.name, row.parent, row.usefulLife, row.unit].some(Boolean))
    .filter((row) => ![row.code, row.name, row.parent].join(' ').includes('必填'))
}

const flatten = (nodes: CatalogNode[], parent = ''): Array<CatalogNode & { parent: string }> => nodes.flatMap((node) => [{ ...node, parent }, ...flatten(node.children || [], node.name)])
const cloneNodes = (nodes: CatalogNode[]): CatalogNode[] => nodes.map((node) => ({ ...node, children: cloneNodes(node.children || []) }))
const removeNamed = (nodes: CatalogNode[], names: Set<string>): CatalogNode[] => nodes.filter((node) => !names.has(node.name)).map((node) => ({ ...node, children: removeNamed(node.children || [], names) }))
const includesName = (nodes: CatalogNode[], name: string): boolean => flatten(nodes).some((node) => node.name === name)
const insert = (nodes: CatalogNode[], node: CatalogNode, parent: string): boolean => {
  if (!parent) { nodes.push(node); return true }
  const target = flatten(nodes).find((item) => item.name === parent)
  if (!target) return false
  target.children = target.children || []
  target.children.push(node)
  return true
}

export const mergeCatalogRows = (source: CatalogNode[], rows: CatalogImportRow[], kind: CatalogKind): CatalogNode[] => {
  if (!rows.length) throw new Error('模板中没有可导入的数据')
  if (rows.length > 5000) throw new Error('最大数据行数不超过 5000 行')
  const names = new Map<string, number>()
  const codes = new Map<string, number>()
  const errors: string[] = []
  rows.forEach((row) => {
    if (!row.name) errors.push(`第 ${row.rowNumber} 行缺少${kind === 'categories' ? '分类' : '位置'}名称`)
    if (kind === 'categories' && !row.code) errors.push(`第 ${row.rowNumber} 行缺少分类编码`)
    if (row.name && names.has(row.name)) errors.push(`第 ${row.rowNumber} 行名称与第 ${names.get(row.name)} 行重复`)
    if (row.code && codes.has(row.code)) errors.push(`第 ${row.rowNumber} 行编码与第 ${codes.get(row.code)} 行重复`)
    if (row.parent && row.parent === row.name) errors.push(`第 ${row.rowNumber} 行上级节点不能等于自身`)
    if (row.name) names.set(row.name, row.rowNumber)
    if (row.code) codes.set(row.code, row.rowNumber)
  })
  const importedNames = new Set(rows.map((row) => row.name))
  const existing = flatten(source)
  const knownNames = new Set([...existing.map((item) => item.name), ...importedNames])
  const codeOwners = new Map(existing.filter((item) => item.code && !importedNames.has(item.name)).map((item) => [item.code as string, item.name]))
  rows.forEach((row) => {
    if (row.parent && !knownNames.has(row.parent)) errors.push(`第 ${row.rowNumber} 行上级节点“${row.parent}”不存在`)
    const owner = row.code ? codeOwners.get(row.code) : ''
    if (owner && owner !== row.name) errors.push(`第 ${row.rowNumber} 行编码已被“${owner}”使用`)
    if (row.code) codeOwners.set(row.code, row.name)
  })
  if (errors.length) throw new Error(errors.slice(0, 5).join('；'))
  const existingByName = new Map(existing.map((node) => [node.name, node]))
  const next = removeNamed(cloneNodes(source), importedNames)
  const nodes = new Map(rows.map((row) => {
    const previous = existingByName.get(row.name)
    const node: CatalogNode = {
      id: previous?.id || `${kind}-${crypto.randomUUID()}`,
      name: row.name,
      code: row.code || previous?.code || '',
      usefulLife: kind === 'categories' ? row.usefulLife || previous?.usefulLife || '0' : undefined,
      unit: kind === 'categories' ? row.unit || previous?.unit || '台' : undefined,
      enabled: row.enabled === null ? previous?.enabled !== false : row.enabled,
      children: removeNamed(cloneNodes(previous?.children || []), importedNames)
    }
    if (row.parent && includesName(node.children, row.parent)) throw new Error(`第 ${row.rowNumber} 行不能把节点移动到自己的下级`)
    return [row.name, node]
  }))
  const inserted = new Set<string>()
  while (inserted.size < rows.length) {
    let progressed = false
    rows.forEach((row) => {
      if (inserted.has(row.name) || row.parent && importedNames.has(row.parent) && !inserted.has(row.parent)) return
      if (!insert(next, nodes.get(row.name) as CatalogNode, row.parent)) throw new Error(`第 ${row.rowNumber} 行上级节点“${row.parent}”不存在`)
      inserted.add(row.name); progressed = true
    })
    if (!progressed) throw new Error('导入层级存在循环关系')
  }
  return next
}

export const buildCatalogWorkbook = async (nodes: CatalogNode[], kind: CatalogKind): Promise<Blob> => {
  const { default: JSZip } = await import('jszip')
  const headers = kind === 'categories' ? ['分类编码*', '分类名称*', '上级分类名称', '使用期限(月)', '计量单位', '资产编码开关'] : ['验证结果', '位置编码', '位置名称*', '上级位置名称']
  const notes = kind === 'categories' ? ['必填，不可重复', '必填，不可重复', '一级分类留空', '非必填，默认0', '非必填，默认台', '开/关，默认开'] : ['请勿填写', '非必填，不可重复', '必填，不可重复', '一级位置留空']
  const data = [headers, notes, ...flatten(nodes).map((node) => kind === 'categories' ? [node.code || '', node.name, node.parent, node.usefulLife || '0', node.unit || '台', node.enabled === false ? '关' : '开'] : ['', node.code || '', node.name, node.parent])]
  const strings: string[] = []
  const index = new Map<string, number>()
  const shared = (value: unknown): number => { const text = String(value ?? ''); if (!index.has(text)) { index.set(text, strings.length); strings.push(text) }; return index.get(text) as number }
  const rowXml = data.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, column) => `<c r="${columnName(column + 1)}${rowIndex + 1}" t="s"><v>${shared(cell)}</v></c>`).join('')}</row>`).join('')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')
  zip.folder('_rels')?.file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  const xl = zip.folder('xl') as JSZipType
  xl.file('workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
  xl.folder('_rels')?.file('workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
  xl.folder('worksheets')?.file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`)
  xl.file('sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((value) => `<si><t>${escapeXml(value)}</t></si>`).join('')}</sst>`)
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
