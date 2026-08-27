<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePortalSession } from '../../../core/auth/portal-session'
import AssetQrGraphic from './AssetQrGraphic.vue'
import { buildCatalogWorkbook, mergeCatalogRows, parseCatalogWorkbook } from '../composables/catalogWorkbook'
import { useAssets } from '../composables/useAssets'
import { matchesPinyinSearch } from '../../../shared/search/pinyin-search'
import type { CatalogNode } from '../types/assets'

const route = useRoute()
const { user } = usePortalSession()
const { state, assets, store, load, saveCatalogValue, saveCodeRules, saveLabels } = useAssets()
const saving = ref(false)
const catalogBusy = ref(false)
const downloadUrl = ref('')
const downloadName = ref('')
const downloadLink = ref<HTMLAnchorElement>()
const selectedNode = ref<CatalogNode | null>(null)
const catalogDialog = ref(false)
const editParentId = ref('')
const editNodeId = ref('')
const catalogForm = reactive({ name: '', code: '', unit: '', usefulLife: '', enabled: true })
const templateDialog = ref(false)
const templateForm = reactive({ key: '', name: '' })
const catalogQuery = ref('')
const labelLogoInput = ref<HTMLInputElement>()
const togglingNodeIds = ref<Set<string>>(new Set())

const kind = computed<'locations' | 'categories' | 'code-rules' | 'labels'>(() => {
  if (route.path.endsWith('/locations')) return 'locations'
  if (route.path.endsWith('/categories')) return 'categories'
  if (route.path.endsWith('/code-rules')) return 'code-rules'
  if (route.path.endsWith('/label-templates')) return 'labels'
  return 'locations'
})
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
const can = (code: string): boolean => permissions.value.has(code)
const canCatalog = (action: string): boolean => can(`asset:${kind.value === 'locations' ? 'location_settings' : 'category_settings'}:${action}`)

const clone = <T,>(value: T): T => structuredClone(toRaw(value))
const defaultCodeRules = {
  selectedFields: ['categoryCode'],
  serialLength: 5,
  fieldOptions: { categoryCode: 'none' },
  customTexts: { customText: '' },
  dateFormats: { purchaseDate: 'yyyymmdd' }
}
const catalog = ref<CatalogNode[]>([])
const codeRules = reactive<Record<string, unknown>>(clone(defaultCodeRules))
const labelSettings = reactive<Record<string, unknown>>({})
const customTemplates = ref<Array<Record<string, unknown>>>([])
const accessTemplateUrl = '/assets/asset-code-template.svg'
const builtInTemplates = [
  { key: 'standard', name: '标准资产标签', settings: { labelWidth: 40, labelHeight: 30, logoWidth: 14, logoHeight: 8, logoScale: 80, logoText: 'AM', logoImage: '', qrSize: 13, qrTextGap: 2, contentScale: 80, offsetX: 0, offsetY: 0, fontSize: 12, fieldFontSizes: [], columns: 1, rows: 1, columnGap: 0, rowGap: 0, fields: ['name', 'id', 'category'], scanFields: [], customFields: '', showLogo: false } },
  { key: 'compact', name: '小型二维码标签', settings: { labelWidth: 60, labelHeight: 40, logoWidth: 10, logoHeight: 6, logoScale: 100, logoText: 'IT', logoImage: '', qrSize: 15, qrTextGap: 10, contentScale: 100, offsetX: 0, offsetY: 0, fontSize: 7, fieldFontSizes: [], columns: 1, rows: 1, columnGap: 5, rowGap: 5, fields: ['id', 'name', 'category', 'owner'], scanFields: [], customFields: '', showLogo: false } },
  { key: 'full', name: '大号信息标签', settings: { labelWidth: 60, labelHeight: 40, logoWidth: 18, logoHeight: 10, logoScale: 100, logoText: '资产云', logoImage: '', qrSize: 24, qrTextGap: 6, contentScale: 100, offsetX: 0, offsetY: 0, fontSize: 12, fieldFontSizes: [], columns: 1, rows: 1, columnGap: 5, rowGap: 5, fields: ['name', 'id'], scanFields: [], customFields: '管理员=custodian', showLogo: false } },
  { key: 'access', name: 'Access资产标签', settings: { labelWidth: 60, labelHeight: 40, logoWidth: 0, logoHeight: 0, logoScale: 100, logoText: '', logoImage: '', qrSize: 17, qrTextGap: 0, contentScale: 100, offsetX: 0, offsetY: 0, fontSize: 10, fieldFontSizes: [], columns: 1, rows: 1, columnGap: 0, rowGap: 0, fields: ['id', 'model'], scanFields: [], customFields: '', showLogo: false, ownershipText: '此资产归Access集团所有' } }
]
const templateOptions = computed(() => [
  ...builtInTemplates,
  ...customTemplates.value
    .map((item) => ({ key: String(item.key || item.id), name: String(item.name || '自定义模板'), settings: item.settings as Record<string, unknown> || {} }))
])
const supportedTemplateKey = (value: unknown): string => {
  const key = String(value || '').trim()
  return templateOptions.value.some((item) => item.key === key) ? key : 'standard'
}
const activeCustomTemplate = computed(() => customTemplates.value.find((item) => String(item.key || item.id) === String(labelSettings.templateKey || '')))
const labelFieldOptions = [
  { key: 'id', label: '资产编码' }, { key: 'name', label: '资产名称' }, { key: 'category', label: '资产分类' },
  { key: 'status', label: '资产状态' }, { key: 'owner', label: '使用人' }, { key: 'employeeCode', label: '工号' },
  { key: 'department', label: '所属部门' }, { key: 'location', label: '所在位置' }, { key: 'brand', label: '品牌' },
  { key: 'model', label: '型号' }, { key: 'sn', label: '序列号' }, { key: 'phone', label: '手机号' },
  { key: 'email', label: '电子邮箱' }, { key: 'receiveDate', label: '领用日期' }, { key: 'assetTag', label: '资产标签' },
  { key: 'price', label: '金额' }, { key: 'supplier', label: '供应商' }, { key: 'purchaseMethod', label: '购置方式' }
]
const labelFields = computed<string[]>(() => Array.isArray(labelSettings.fields) ? labelSettings.fields as string[] : [])
const activeBaseTemplateKey = computed(() => {
  const key = String(labelSettings.templateKey || 'standard')
  if (builtInTemplates.some((item) => item.key === key)) return key
  const storedBase = String(activeCustomTemplate.value?.baseTemplateKey || (activeCustomTemplate.value?.settings as Record<string, unknown> | undefined)?.templateKey || '')
  return builtInTemplates.some((item) => item.key === storedBase) ? storedBase : 'standard'
})
const labelFieldCount = computed(() => activeBaseTemplateKey.value === 'compact' ? 4 : activeBaseTemplateKey.value === 'full' || activeBaseTemplateKey.value === 'access' ? 2 : 3)
const labelPreviewFields = computed(() => Array.from({ length: labelFieldCount.value }, (_, index) => labelFields.value[index] || ''))
const labelFieldName = (key: string): string => labelFieldOptions.find((option) => option.key === key)?.label || '选择字段'
const setLabelField = (index: number, value: string): void => {
  const fields = [...labelPreviewFields.value]
  fields[index] = value
  labelSettings.fields = fields
}
const clampNumber = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback
}
const labelFieldFontSize = (index: number): number => {
  const sizes = Array.isArray(labelSettings.fieldFontSizes) ? labelSettings.fieldFontSizes as unknown[] : []
  return Math.round(clampNumber(sizes[index], Number(labelSettings.fontSize || 12), 5, 22))
}
const setLabelFieldFontSize = (index: number, value: unknown): void => {
  const sizes = Array.from({ length: labelFieldCount.value }, (_, fieldIndex) => labelFieldFontSize(fieldIndex))
  sizes[index] = Math.round(clampNumber(value, sizes[index], 5, 22))
  labelSettings.fieldFontSizes = sizes
}
const stepLabelFieldFontSize = (index: number, step: number): void => setLabelFieldFontSize(index, labelFieldFontSize(index) + step)
const stepLabelNumber = (key: string, step: number, min: number, max: number): void => {
  labelSettings[key] = clampNumber(Number(labelSettings[key] || 0) + step, Number(labelSettings[key] || min), min, max)
}
const firstLabelPreviewStyle = computed<Record<string, string>>(() => ({
  '--first-label-width': `${Number(labelSettings.labelWidth || 40)}mm`, '--first-label-height': `${Number(labelSettings.labelHeight || 30)}mm`,
  '--first-label-logo-width': `${Number(labelSettings.logoWidth || 14) * Number(labelSettings.logoScale || 100) / 100}mm`,
  '--first-label-logo-height': `${Number(labelSettings.logoHeight || 8) * Number(labelSettings.logoScale || 100) / 100}mm`,
  '--first-label-content-scale': String(Number(labelSettings.contentScale || 100) / 100), '--first-label-offset-x': `${Number(labelSettings.offsetX || 0)}mm`,
  '--first-label-offset-y': `${Number(labelSettings.offsetY || 0)}mm`, '--first-label-qr-size': `${Number(labelSettings.qrSize || 13)}mm`,
  '--first-label-qr-text-gap': `${Number(labelSettings.qrTextGap || 2)}mm`
}))
const templateListPreviewStyle = (): Record<string, string> => {
  // The template picker is an overview, so every thumbnail uses one stable frame.
  // The editor and print path continue to use each template's real dimensions.
  const previewWidth = 60
  const previewHeight = 40
  const millimetresToPixels = 96 / 25.4
  const scale = Math.min(0.96, 108 / (previewHeight * millimetresToPixels), 260 / (previewWidth * millimetresToPixels))
  return {
    '--label-template-width': `${previewWidth}mm`,
    '--label-template-height': `${previewHeight}mm`,
    '--label-template-preview-scale': String(Math.round(scale * 1000) / 1000)
  }
}
const labelPreviewStyle = computed<Record<string, string>>(() => ({
  '--label-width': `${Number(labelSettings.labelWidth || 60)}mm`, '--label-height': `${Number(labelSettings.labelHeight || 40)}mm`,
  '--label-qr-size': `${Number(labelSettings.qrSize || 18)}mm`, '--label-qr-text-gap': `${Number(labelSettings.qrTextGap || 2)}mm`,
  '--label-content-scale': String(Number(labelSettings.contentScale || 100) / 100), '--label-offset-x': `${Number(labelSettings.offsetX || 0)}mm`,
  '--label-offset-y': `${Number(labelSettings.offsetY || 0)}mm`
}))
const openLabelLogoPicker = (): void => labelLogoInput.value?.click()
const uploadLabelLogo = (event: Event): void => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) { ElMessage.warning('请选择图片文件'); return }
  const reader = new FileReader()
  reader.onload = () => {
    labelSettings.logoImage = String(reader.result || '')
    labelSettings.showLogo = true
    if (!String(labelSettings.logoText || '').trim()) labelSettings.logoText = file.name.replace(/\.[^.]+$/, '').slice(0, 12)
    ElMessage.success('Logo 已上传')
  }
  reader.readAsDataURL(file)
}
type FlatCatalogRow = CatalogNode & { parentId: string; parentName: string; path: string; level: number }
const flattenCatalog = (nodes: CatalogNode[], parent: CatalogNode | null = null, parentPath: string[] = []): FlatCatalogRow[] => nodes.flatMap((node) => {
  const pathParts = [...parentPath, node.name]
  return [
    { ...node, parentId: parent?.id || '', parentName: parent?.name || '暂无上级', path: pathParts.join(' / '), level: parentPath.length },
    ...flattenCatalog(node.children || [], node, pathParts)
  ]
})
const catalogRows = computed(() => {
  const rows = flattenCatalog(catalog.value)
  return rows.filter((row) => matchesPinyinSearch([row.name, row.code, row.parentName], catalogQuery.value))
})
const ruleFieldDefinitions = [
  { key: 'companyCode', label: '公司编码', width: 4 }, { key: 'purchaseDate', label: '购置/起租日期', width: 8 },
  { key: 'customText', label: '自定义文本', width: 0 }, { key: 'locationCode', label: '位置编码', width: 4 },
  { key: 'departmentCode', label: '部门编码', width: 4 }, { key: 'categoryCode', label: '资产分类编号', width: 6 }
]
const selectedRuleFields = computed<string[]>(() => Array.isArray(codeRules.selectedFields) ? codeRules.selectedFields as string[] : [])
const availableRuleFields = computed(() => ruleFieldDefinitions.filter((item) => !selectedRuleFields.value.includes(item.key)))
const ruleField = (key: string) => ruleFieldDefinitions.find((item) => item.key === key)
const ruleSeparator = (key: string): string => ({ dash: '-', slash: '/' }[(codeRules.fieldOptions as Record<string, string>)?.[key]] || '')
const rulePreview = computed(() => selectedRuleFields.value.map((key) => key === 'customText' ? String((codeRules.customTexts as Record<string, string>)?.customText || '自定义文本') : key === 'purchaseDate' ? String((codeRules.dateFormats as Record<string, string>)?.purchaseDate || 'yyyymmdd') : ruleField(key)?.label || key).map((value, index) => `${value}${ruleSeparator(selectedRuleFields.value[index]) || '+'}`).join('') + '流水号')
const ruleLength = computed(() => selectedRuleFields.value.reduce((total, key) => total + (key === 'customText' ? String((codeRules.customTexts as Record<string, string>)?.customText || '').length : ruleField(key)?.width || 0) + ruleSeparator(key).length, 0) + Number(codeRules.serialLength || 5))
const selectRuleField = (key: string): void => { codeRules.selectedFields = [...selectedRuleFields.value, key] }
const removeRuleField = (key: string): void => { codeRules.selectedFields = selectedRuleFields.value.filter((item) => item !== key) }

const syncFromStore = (): void => {
  catalog.value = clone(kind.value === 'locations' ? store.value.assetLocationTree || [] : store.value.assetCategoryTree || [])
  Object.keys(codeRules).forEach((key) => delete codeRules[key])
  const storedRules = clone(store.value.assetPortalAssetCodeRuleSettingsV1 || {})
  Object.assign(codeRules, clone(defaultCodeRules), storedRules, {
    fieldOptions: { ...defaultCodeRules.fieldOptions, ...(storedRules.fieldOptions as object || {}) },
    customTexts: { ...defaultCodeRules.customTexts, ...(storedRules.customTexts as object || {}) },
    dateFormats: { ...defaultCodeRules.dateFormats, ...(storedRules.dateFormats as object || {}) }
  })
  customTemplates.value = clone(store.value.assetLabelCustomTemplatesV1 || [])
  const storedLabelSettings = clone(store.value.assetLabelPrintSettingsV2 || {})
  const storedTemplateKey = String(storedLabelSettings.templateKey || '').trim()
  const templateKey = supportedTemplateKey(storedTemplateKey)
  Object.keys(labelSettings).forEach((key) => delete labelSettings[key])
  const selectedDefaults = builtInTemplates.find((item) => item.key === templateKey)?.settings || builtInTemplates[0].settings
  Object.assign(labelSettings, clone(selectedDefaults), { templateKey }, storedTemplateKey === 'defaultAsset' ? {} : storedLabelSettings, { templateKey })
}

watch(kind, syncFromStore)
watch(store, syncFromStore, { deep: false })

const findNode = (nodes: CatalogNode[], id: string): CatalogNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findNode(node.children || [], id)
    if (child) return child
  }
  return null
}

const findParent = (nodes: CatalogNode[], id: string): CatalogNode | null => {
  for (const node of nodes) {
    if ((node.children || []).some((child) => child.id === id)) return node
    const parent = findParent(node.children || [], id)
    if (parent) return parent
  }
  return null
}

const catalogDialogTitle = computed(() => `${editNodeId.value ? '编辑' : '新增'}${kind.value === 'locations' ? '位置' : '分类'}`)
const catalogParentOptions = computed(() => {
  const editing = editNodeId.value ? findNode(catalog.value, editNodeId.value) : null
  const blocked = new Set([
    editNodeId.value,
    ...flattenCatalog(editing?.children || []).map((node) => node.id)
  ].filter(Boolean))
  return [
    { value: '', label: '暂无上级' },
    ...flattenCatalog(catalog.value)
      .filter((node) => !blocked.has(node.id))
      .map((node) => ({ value: node.id, label: `${'　'.repeat(node.level)}${kind.value === 'locations' ? node.path : node.name}` }))
  ]
})

const openCatalogDialog = (node?: CatalogNode, asChild = false): void => {
  if (!canCatalog(node && !asChild ? 'update' : 'create')) return
  editNodeId.value = asChild ? '' : node?.id || ''
  editParentId.value = asChild ? node?.id || '' : findParent(catalog.value, node?.id || '')?.id || ''
  Object.assign(catalogForm, node && !asChild ? { name: node.name, code: node.code || '', unit: node.unit || '', usefulLife: node.usefulLife || '', enabled: node.enabled !== false } : { name: '', code: '', unit: kind.value === 'categories' ? '台' : '', usefulLife: '', enabled: true })
  catalogDialog.value = true
}

const takeNode = (nodes: CatalogNode[], id: string): CatalogNode | null => {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) return nodes.splice(index, 1)[0]
  for (const node of nodes) {
    const found = takeNode(node.children || [], id)
    if (found) return found
  }
  return null
}

const insertNode = (node: CatalogNode, parentId = ''): boolean => {
  if (!parentId) { catalog.value.push(node); return true }
  const parent = findNode(catalog.value, parentId)
  if (!parent) return false
  parent.children = parent.children || []
  parent.children.push(node)
  return true
}

const saveCatalogNode = async (): Promise<void> => {
  if (!canCatalog(editNodeId.value ? 'update' : 'create')) return
  const name = String(catalogForm.name || '').trim()
  const code = String(catalogForm.code || '').trim()
  const unit = String(catalogForm.unit || '').trim()
  const usefulLife = String(catalogForm.usefulLife || '').trim()
  if (kind.value === 'categories' && (!code || !name)) { ElMessage.warning('请填写分类编码和分类名称'); return }
  if (kind.value === 'locations' && !name) { ElMessage.warning('请填写位置名称'); return }
  const rows = flattenCatalog(catalog.value)
  if (kind.value === 'categories') {
    const duplicateCode = rows.find((row) => row.code === code && row.id !== editNodeId.value)
    if (duplicateCode) { ElMessage.warning(`分类编码已被“${duplicateCode.name}”使用`); return }
    if (rows.some((row) => row.name === name && row.id !== editNodeId.value)) { ElMessage.warning(`分类名称已存在：${name}`); return }
  }
  const previous = clone(catalog.value)
  const values = kind.value === 'categories'
    ? { name, code, unit, usefulLife, enabled: catalogForm.enabled }
    : { name, code: code || `LOC-${String(rows.length + 1).padStart(2, '0')}`, enabled: catalogForm.enabled }
  if (editNodeId.value) {
    const node = findNode(catalog.value, editNodeId.value)
    if (!node) return
    Object.assign(node, values)
    if ((findParent(catalog.value, editNodeId.value)?.id || '') !== editParentId.value) {
      const moved = takeNode(catalog.value, editNodeId.value)
      if (moved && !insertNode(moved, editParentId.value)) catalog.value.push(moved)
    }
  } else {
    const prefix = kind.value === 'locations' ? 'loc' : 'cat'
    const node: CatalogNode = { id: `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ...values, children: [] }
    if (!insertNode(node, editParentId.value)) catalog.value.push(node)
  }
  saving.value = true
  try { await saveCatalogValue(kind.value as 'categories' | 'locations', clone(catalog.value)); catalogDialog.value = false; ElMessage.success('配置已保存') }
  catch (error) { catalog.value = previous; ElMessage.error(error instanceof Error ? error.message : '保存失败') }
  finally { saving.value = false }
}

const removeFrom = (nodes: CatalogNode[], id: string): boolean => {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) { nodes.splice(index, 1); return true }
  return nodes.some((node) => removeFrom(node.children || [], id))
}
const removeNode = async (node: CatalogNode): Promise<void> => {
  if (!canCatalog('delete')) return
  const descendantIds = new Set(flattenCatalog([node]).map((item) => item.id))
  const descendants = flattenCatalog(catalog.value).filter((item) => descendantIds.has(item.id))
  const referenced = kind.value === 'categories'
    ? assets.value.filter((asset) => descendants.some((item) => item.name === asset.category))
    : assets.value.filter((asset) => descendants.some((item) => item.path === asset.location))
  if (referenced.length) { ElMessage.warning(`已有 ${referenced.length} 个资产使用该${kind.value === 'categories' ? '分类' : '位置'}，不能删除`); return }
  const childCount = descendants.length - 1
  await ElMessageBox.confirm(`确定删除“${node.name}”吗？${childCount ? `这会同时删除 ${childCount} 个下级${kind.value === 'categories' ? '分类' : '位置'}。` : ''}`, '删除确认', { type: 'warning' })
  const previous = clone(catalog.value)
  removeFrom(catalog.value, node.id)
  try { await saveCatalogValue(kind.value as 'categories' | 'locations', clone(catalog.value)); ElMessage.success('节点已删除') }
  catch (error) { catalog.value = previous; ElMessage.error(error instanceof Error ? error.message : '删除失败') }
}
const toggleNode = async (node: CatalogNode): Promise<void> => {
  if (!canCatalog('toggleCode') || togglingNodeIds.value.has(node.id)) return
  const target = findNode(catalog.value, node.id)
  if (!target) { ElMessage.error('未找到对应配置，请刷新页面后重试'); return }
  const previous = target.enabled
  const enabled = target.enabled === false
  target.enabled = enabled
  togglingNodeIds.value = new Set(togglingNodeIds.value).add(node.id)
  try {
    await saveCatalogValue(kind.value as 'categories' | 'locations', clone(catalog.value))
    ElMessage.success(`已${enabled ? '开启' : '关闭'}“${target.name}”的资产编码`)
  } catch (error) {
    target.enabled = previous
    ElMessage.error(error instanceof Error ? error.message : '状态更新失败')
  } finally {
    const next = new Set(togglingNodeIds.value)
    next.delete(node.id)
    togglingNodeIds.value = next
  }
}

const triggerDownload = async (blob: Blob, name: string): Promise<void> => {
  downloadUrl.value = URL.createObjectURL(blob)
  downloadName.value = name
  await nextTick()
  downloadLink.value?.click()
  window.setTimeout(() => { URL.revokeObjectURL(downloadUrl.value); downloadUrl.value = '' }, 0)
}
const downloadCatalogTemplate = async (): Promise<void> => {
  const domain = kind.value as 'categories' | 'locations'
  await triggerDownload(await buildCatalogWorkbook([], domain), `${domain === 'categories' ? '资产分类' : '位置'}导入模板_${new Date().toISOString().slice(0, 10)}.xlsx`)
}
const exportCatalog = async (): Promise<void> => {
  const domain = kind.value as 'categories' | 'locations'
  await triggerDownload(await buildCatalogWorkbook(catalog.value, domain), `${domain === 'categories' ? '资产分类' : '位置'}导出_${new Date().toISOString().slice(0, 10)}.xlsx`)
  ElMessage.success(`已导出 ${domain === 'categories' ? '资产分类' : '位置'}`)
}
const importCatalog = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const domain = kind.value as 'categories' | 'locations'
  catalogBusy.value = true
  try {
    const rows = await parseCatalogWorkbook(file, domain)
    const next = mergeCatalogRows(catalog.value, rows, domain)
    await saveCatalogValue(domain, next)
    catalog.value = next
    selectedNode.value = null
    ElMessage.success(`已导入 ${rows.length} 条${domain === 'categories' ? '分类' : '位置'}`)
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '导入失败') }
  finally { catalogBusy.value = false }
}

const saveRules = async (): Promise<void> => {
  saving.value = true
  try { await saveCodeRules(clone(codeRules)); ElMessage.success('编码规则已保存') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存失败') }
  finally { saving.value = false }
}
const saveLabel = async (): Promise<void> => {
  saving.value = true
  try { await saveLabels('assetLabelPrintSettingsV2', clone(labelSettings), 'save'); ElMessage.success('标签设置已保存') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '保存失败') }
  finally { saving.value = false }
}
const applyTemplate = (key: string): void => {
  const templateKey = supportedTemplateKey(key)
  const preset = builtInTemplates.find((item) => item.key === templateKey)?.settings
  const custom = customTemplates.value.find((item) => String(item.key || item.id) === templateKey)
  Object.assign(labelSettings, clone(custom?.settings as Record<string, unknown> || preset || {}), { templateKey })
}
const resetLabel = async (): Promise<void> => {
  applyTemplate(String(labelSettings.templateKey || 'standard'))
  saving.value = true
  try { await saveLabels('assetLabelPrintSettingsV2', clone(labelSettings), 'reset'); ElMessage.success('标签模板配置已重置') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '重置失败') }
  finally { saving.value = false }
}
const openTemplateDialog = (template?: Record<string, unknown>): void => {
  Object.assign(templateForm, { key: String(template?.key || template?.id || ''), name: String(template?.name || '') })
  templateDialog.value = true
}
const saveCustomTemplate = async (): Promise<void> => {
  if (!templateForm.name.trim()) { ElMessage.warning('请输入模板名称'); return }
  const existing = customTemplates.value.findIndex((item) => String(item.key || item.id) === templateForm.key)
  const key = templateForm.key || `custom-${crypto.randomUUID()}`
  const existingSettings = existing >= 0 ? customTemplates.value[existing].settings as Record<string, unknown> : null
  const baseTemplateKey = activeBaseTemplateKey.value
  const item = { key, id: key, name: templateForm.name.trim(), baseTemplateKey, settings: { ...clone(existingSettings || labelSettings), templateKey: baseTemplateKey } }
  const operation = existing >= 0 ? 'update' : 'create'
  if (existing >= 0) customTemplates.value.splice(existing, 1, item)
  else customTemplates.value.push(item)
  saving.value = true
  try { await saveLabels('assetLabelCustomTemplatesV1', clone(customTemplates.value), operation); labelSettings.templateKey = key; templateDialog.value = false; ElMessage.success('自定义模板已保存') }
  catch (error) { syncFromStore(); ElMessage.error(error instanceof Error ? error.message : '模板保存失败') }
  finally { saving.value = false }
}
const removeCustomTemplate = async (template: Record<string, unknown>): Promise<void> => {
  await ElMessageBox.confirm(`确定删除“${String(template.name || '自定义模板')}”吗？`, '删除模板', { type: 'warning' })
  const key = String(template.key || template.id)
  const next = customTemplates.value.filter((item) => String(item.key || item.id) !== key)
  try { await saveLabels('assetLabelCustomTemplatesV1', clone(next), 'delete'); customTemplates.value = next; if (labelSettings.templateKey === key) applyTemplate('standard'); ElMessage.success('模板已删除') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '模板删除失败') }
}

onMounted(async () => { await load(); syncFromStore() })
</script>

<template>
  <section class="asset-settings-view" :class="{ 'asset-label-settings-view': kind === 'labels' }">
    <a v-if="downloadUrl" ref="downloadLink" :href="downloadUrl" :download="downloadName" hidden>下载</a>
    <el-skeleton v-if="state.loading" :rows="8" animated />

    <section v-else-if="kind === 'locations' || kind === 'categories'" v-loading="catalogBusy" class="location-settings-shell" :class="{ 'asset-category-settings-shell': kind === 'categories' }">
      <aside class="location-settings-tree-panel" :class="{ 'asset-category-tree-panel': kind === 'categories' }"><h2>{{ kind === 'locations' ? '位置' : '分类' }}</h2><label class="location-search"><input v-model="catalogQuery" type="search" :placeholder="kind === 'locations' ? '模糊查询' : '模糊搜索'"><span aria-hidden="true">⌕</span></label><div class="location-tree-list" :class="{ 'asset-category-tree-list': kind === 'categories' }"><el-tree :data="catalog" node-key="id" :default-expand-all="kind === 'locations'" highlight-current :expand-on-click-node="false" @current-change="selectedNode = $event"><template #default="{ data }"><span>{{ data.name }}</span></template></el-tree></div></aside>
      <article class="location-settings-table-panel" :class="{ 'asset-category-table-panel': kind === 'categories' }"><div class="location-settings-toolbar" :class="{ 'asset-category-toolbar': kind === 'categories' }"><div class="asset-list-actions"><button v-if="canCatalog('create')" class="table-action primary" type="button" @click="openCatalogDialog()">＋ 新增{{ kind === 'locations' ? '位置' : '分类' }}</button><el-dropdown v-if="canCatalog('template') || canCatalog('import') || canCatalog('export')" placement="bottom-start" trigger="click"><button class="table-action has-caret" type="button">导入/导出<span class="action-caret" aria-hidden="true"></span></button><template #dropdown><el-dropdown-menu><el-dropdown-item v-if="canCatalog('template')" @click="downloadCatalogTemplate">下载模板</el-dropdown-item><el-dropdown-item v-if="canCatalog('import')"><label><input type="file" accept=".xlsx" hidden @change="importCatalog">导入{{ kind === 'locations' ? '位置' : '分类' }}</label></el-dropdown-item><el-dropdown-item v-if="canCatalog('export')" @click="exportCatalog">导出{{ kind === 'locations' ? '位置' : '分类' }}</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div></div>
        <div class="location-table-wrap" :class="{ 'asset-category-table-wrap': kind === 'categories' }"><table v-resizable-columns="`assets:settings:${kind}`" class="location-settings-table" :class="{ 'asset-category-settings-table': kind === 'categories' }"><thead><tr v-if="kind === 'locations'"><th>位置名称</th><th>位置编码</th><th>上级位置</th><th>资产编码开关</th><th>操作</th></tr><tr v-else><th>分类编码</th><th>分类名称</th><th>上级分类</th><th>使用期限</th><th>计量单位</th><th>资产编码开关 ⓘ</th><th>操作</th></tr></thead><tbody><tr v-for="row in catalogRows" :key="row.id"><template v-if="kind === 'locations'"><td>{{ row.name }}</td><td>{{ row.code || '-' }}</td><td>{{ row.parentName }}</td><td><button class="asset-code-switch-button" type="button" :disabled="!canCatalog('toggleCode') || togglingNodeIds.has(row.id)" :aria-label="`${row.enabled === false ? '开启' : '关闭'}${row.name}位置编码`" :aria-pressed="row.enabled !== false" :aria-busy="togglingNodeIds.has(row.id)" :title="canCatalog('toggleCode') ? `${row.enabled === false ? '开启' : '关闭'}${row.name}位置编码` : '无切换位置编码权限'" @click="toggleNode(row)"><span class="asset-code-switch" :class="{ off: row.enabled === false, saving: togglingNodeIds.has(row.id) }"><i></i></span></button></td><td><button class="link" type="button" @click="openCatalogDialog(row)">编辑</button><span class="action-separator">|</span><button class="link" type="button" @click="removeNode(row)">删除</button></td></template><template v-else><td>{{ row.code || '-' }}</td><td>{{ row.name }}</td><td>{{ row.parentName }}</td><td>{{ row.usefulLife || '0' }}</td><td>{{ row.unit || '台' }}</td><td><button class="asset-code-switch-button" type="button" :disabled="!canCatalog('toggleCode') || togglingNodeIds.has(row.id)" :aria-label="`${row.enabled === false ? '开启' : '关闭'}${row.name}分类编码`" :aria-pressed="row.enabled !== false" :aria-busy="togglingNodeIds.has(row.id)" :title="canCatalog('toggleCode') ? `${row.enabled === false ? '开启' : '关闭'}${row.name}分类编码` : '无切换分类编码权限'" @click="toggleNode(row)"><span class="asset-code-switch" :class="{ off: row.enabled === false, saving: togglingNodeIds.has(row.id) }"><i></i></span></button></td><td><button class="link" type="button" @click="openCatalogDialog(row)">编辑</button><span class="action-separator">|</span><button class="link" type="button" @click="removeNode(row)">删除</button></td></template></tr><tr v-if="!catalogRows.length"><td :colspan="kind === 'locations' ? 5 : 7" class="empty-cell">暂无匹配{{ kind === 'locations' ? '位置' : '分类' }}</td></tr></tbody></table></div>
      </article>
    </section>

    <form v-else-if="kind === 'code-rules'" class="asset-code-rule-page" @submit.prevent="saveRules">
      <header class="asset-code-rule-title"><h1>资产编码规则</h1></header>
      <div class="asset-code-rule-workspace">
        <section class="asset-code-rule-box"><h2>可选字段</h2><div class="asset-code-rule-list"><button v-for="field in availableRuleFields" :key="field.key" class="asset-code-rule-field" type="button" @click="selectRuleField(field.key)"><span class="asset-code-rule-field-name">{{ field.label }}</span></button></div></section>
        <div class="asset-code-rule-transfer" aria-hidden="true"><strong>⇆</strong><span>左右拖拽</span></div>
        <section class="asset-code-rule-box">
          <h2>已选字段</h2>
          <div class="asset-code-rule-list">
            <div v-for="field in selectedRuleFields" :key="field" class="asset-code-rule-field selected">
              <button class="asset-code-rule-field-name" type="button" @click="removeRuleField(field)">{{ ruleField(field)?.label || field }}</button>
              <span class="asset-code-rule-field-controls">
                <input v-if="field === 'customText'" v-model="(codeRules.customTexts as Record<string, string>).customText" class="asset-code-rule-custom-input" aria-label="自定义文本内容" placeholder="请输入文本" maxlength="16">
                <el-select v-if="field === 'purchaseDate'" v-model="(codeRules.dateFormats as Record<string, string>).purchaseDate" class="asset-code-rule-date-format" aria-label="购置起租日期格式"><el-option label="yyyymmdd(例:20190801)" value="yyyymmdd" /><el-option label="yyyymm(例:201908)" value="yyyymm" /><el-option label="yymmdd(例:190801)" value="yymmdd" /><el-option label="yymm(例:1908)" value="yymm" /></el-select>
                <el-select v-model="(codeRules.fieldOptions as Record<string, string>)[field]" :aria-label="`${ruleField(field)?.label || field}规则选项`"><el-option label="无" value="none" /><el-option label="-" value="dash" /><el-option label="/" value="slash" /></el-select>
              </span>
            </div>
          </div>
        </section>
      </div>
      <div class="asset-code-rule-serial"><label><span>流水号：</span><el-select v-model="codeRules.serialLength" aria-label="流水号位数"><el-option v-for="length in [3,4,5,6,7]" :key="length" :label="String(length)" :value="length" /></el-select></label><span>流水号可选范围为3-7位</span></div>
      <section class="asset-code-rule-preview"><p>规则预览：<strong>{{ rulePreview }}</strong></p><p>当前编码规则下资产编码长度：<b>{{ ruleLength }}位</b></p></section>
      <div class="asset-code-rule-actions"><button v-if="can('asset:code_rules:update')" class="btn primary" type="submit">{{ saving ? '保存中...' : '保存' }}</button></div>
    </form>

    <section v-else class="asset-label-template-page">
      <aside class="asset-label-template-left"><header class="asset-code-rule-title"><h1>标签模板设置</h1></header><div class="asset-label-template-list">
        <article v-for="item in templateOptions" :key="item.key" class="asset-label-template-card" :class="{ active: String(labelSettings.templateKey || 'standard') === item.key }" @click="applyTemplate(item.key)">
          <button class="asset-label-template-radio" type="button" :aria-label="`选择${item.name}`" :aria-pressed="String(labelSettings.templateKey || 'standard') === item.key"><span></span></button>
          <header class="asset-label-template-card-head"><strong>{{ Number(item.settings.labelWidth || 40) }}*{{ Number(item.settings.labelHeight || 30) }}mm</strong><i aria-hidden="true"></i><strong>{{ item.name }}</strong></header>
          <div class="asset-label-template-preview"><div class="asset-label-template-ticket" :class="{ 'is-standard': item.key === 'standard', 'is-fields4': item.key === 'compact', 'is-topField': item.key === 'full', 'is-access': item.key === 'access' }" :style="templateListPreviewStyle()"><template v-if="item.key === 'access'"><div class="access-template-svg-preview"><img :src="accessTemplateUrl" alt="Access资产标签模板"></div></template><template v-else><div class="asset-label-template-qr"><AssetQrGraphic text="资产编码:010100012" /></div><div class="asset-label-template-fields"><p v-for="index in item.key === 'compact' ? 4 : item.key === 'full' ? 2 : 3" :key="index"><span>字段名称{{ index }}：</span><strong>xxxx</strong></p></div></template></div></div>
        </article>
      </div></aside>
      <div class="asset-label-template-right"><form class="asset-label-template-config-form first-template-config-form" @submit.prevent="saveLabel">
        <div class="asset-label-template-config-tabs"><button class="asset-label-template-config-tab active" type="button">配置1 <span aria-hidden="true">✎</span></button><div class="asset-label-template-tab-actions"><button v-if="activeCustomTemplate && can('asset:label_template_settings:delete')" class="asset-label-template-delete" type="button" @click="removeCustomTemplate(activeCustomTemplate)">删除模板</button><button v-if="can('asset:label_template_settings:create')" class="asset-label-template-add" type="button" @click="openTemplateDialog(activeCustomTemplate)">{{ activeCustomTemplate ? '重命名' : '＋新增' }}</button></div></div>
        <div class="asset-label-template-stage">
          <div v-if="activeBaseTemplateKey === 'standard'" class="first-label-config-preview" :style="firstLabelPreviewStyle" :aria-label="`配置1 ${labelSettings.labelWidth}*${labelSettings.labelHeight}mm 预览`"><div class="first-label-preview-card"><span v-if="labelSettings.showLogo" class="first-label-preview-logo" :class="{ 'has-image': labelSettings.logoImage }"><img v-if="labelSettings.logoImage" :src="String(labelSettings.logoImage)" :alt="String(labelSettings.logoText || 'Logo')"><template v-else>{{ labelSettings.logoText || 'AM' }}</template></span><div class="first-label-preview-content"><div class="first-label-preview-qr"><AssetQrGraphic text="资产编码:010100012" /></div><div class="first-label-preview-fields"><span v-for="(field, index) in labelPreviewFields" :key="index" :style="{ '--first-label-row-font-size': `${labelFieldFontSize(index)}px` }">{{ labelFieldName(field) }}</span></div></div></div></div>
          <div v-else-if="activeBaseTemplateKey === 'compact'" class="second-label-config-preview" :style="labelPreviewStyle" :aria-label="`配置1 ${labelSettings.labelWidth}*${labelSettings.labelHeight}mm 预览`"><div class="second-label-preview-card"><div class="second-label-preview-content"><div class="second-label-preview-qr"><AssetQrGraphic text="资产编码:010100012" /></div><div class="second-label-preview-fields"><span v-for="index in 4" :key="index" :style="{ '--second-label-row-font-size': `${labelFieldFontSize(index - 1)}px` }">字段名{{ index }}：xxxx</span></div></div></div></div>
          <div v-else-if="activeBaseTemplateKey === 'full'" class="third-label-config-preview" :style="labelPreviewStyle" :aria-label="`配置1 ${labelSettings.labelWidth}*${labelSettings.labelHeight}mm 预览`"><div class="third-label-preview-card"><div class="third-label-preview-body"><div class="third-label-preview-qr"><AssetQrGraphic text="资产编码:010100012" /></div><div class="third-label-preview-fields"><span :style="{ '--third-label-row-font-size': `${labelFieldFontSize(0)}px` }">资产名称</span><span :style="{ '--third-label-row-font-size': `${labelFieldFontSize(1)}px` }">资产编码</span></div></div></div></div>
          <div v-else-if="activeBaseTemplateKey === 'access'" class="access-label-config-preview" :style="labelPreviewStyle" :aria-label="`配置1 ${labelSettings.labelWidth}*${labelSettings.labelHeight}mm 预览`"><div class="access-template-svg-preview access-template-svg-stage"><img :src="accessTemplateUrl" alt="Access资产标签模板"></div></div>
        </div>
        <section class="asset-label-template-config-section first-config-section"><h2>标签logo设置</h2><div class="asset-label-template-logo-drop first-logo-drop" role="button" tabindex="0" @click="openLabelLogoPicker" @keydown.enter.prevent="openLabelLogoPicker" @keydown.space.prevent="openLabelLogoPicker"><input ref="labelLogoInput" type="file" accept="image/*" hidden @click.stop @change="uploadLabelLogo"><span :class="{ 'has-logo-image': labelSettings.logoImage }"><img v-if="labelSettings.logoImage" :src="String(labelSettings.logoImage)" :alt="String(labelSettings.logoText || 'Logo')"><template v-else>＋</template></span><strong>{{ labelSettings.logoImage ? '更换 Logo' : '上传 Logo' }}</strong></div><div class="asset-label-template-slider-row first-slider-row"><label><span>logo缩放（%）</span><input v-model.number="labelSettings.logoScale" type="range" min="50" max="160" step="1"></label><div class="asset-label-template-stepper"><button type="button" @click="stepLabelNumber('logoScale', -1, 50, 160)">−</button><span>{{ Number(labelSettings.logoScale || 100) }}</span><button type="button" @click="stepLabelNumber('logoScale', 1, 50, 160)">＋</button></div></div></section>
        <section class="asset-label-template-config-section first-config-section"><h2>标签尺寸</h2><div class="first-config-two-cols"><label class="first-inline-stepper"><span>标签宽度（mm）</span><div class="asset-label-template-stepper"><button type="button" @click="stepLabelNumber('labelWidth', -1, 20, 160)">−</button><input v-model.number="labelSettings.labelWidth" type="number" min="20" max="160"><button type="button" @click="stepLabelNumber('labelWidth', 1, 20, 160)">＋</button></div></label><label class="first-inline-stepper"><span>标签高度（mm）</span><div class="asset-label-template-stepper"><button type="button" @click="stepLabelNumber('labelHeight', -1, 12, 120)">−</button><input v-model.number="labelSettings.labelHeight" type="number" min="12" max="120"><button type="button" @click="stepLabelNumber('labelHeight', 1, 12, 120)">＋</button></div></label></div><div class="asset-label-template-slider-row first-slider-row"><label><span>内容缩放（%）</span><input v-model.number="labelSettings.contentScale" type="range" min="50" max="160" step="1"></label><div class="asset-label-template-stepper"><button type="button" @click="stepLabelNumber('contentScale', -1, 50, 160)">−</button><span>{{ Number(labelSettings.contentScale || 100) }}</span><button type="button" @click="stepLabelNumber('contentScale', 1, 50, 160)">＋</button></div></div></section>
        <section class="asset-label-template-config-section first-config-section"><h2>位置调整</h2><div class="first-config-two-cols"><label class="first-config-input"><span>左右位移（mm）：</span><input v-model.number="labelSettings.offsetX" type="number" min="-30" max="30" step="0.5"></label><label class="first-config-input"><span>上下位移（mm）：</span><input v-model.number="labelSettings.offsetY" type="number" min="-30" max="30" step="0.5"></label><label class="first-config-input"><span>码字间距（mm）：</span><input v-model.number="labelSettings.qrTextGap" type="number" min="0" max="30" step="0.5"></label><label class="first-config-input"><span>二维码大小（mm）：</span><input v-model.number="labelSettings.qrSize" type="number" min="8" max="60" step="0.5"></label></div></section>
        <section class="asset-label-template-config-section first-config-section"><h2>字段</h2><div class="asset-label-template-field-list"><div v-for="index in labelFieldCount" :key="index" class="asset-label-template-field-row"><el-select :model-value="labelPreviewFields[index - 1] || ''" :aria-label="`第${index}行字段`" placeholder="选择字段" @change="setLabelField(index - 1, String($event))"><el-option label="选择字段" value="" /><el-option v-for="field in labelFieldOptions" :key="field.key" :label="field.label" :value="field.key" /></el-select><div class="asset-label-template-stepper"><button type="button" @click="stepLabelFieldFontSize(index - 1, -1)">−</button><input :value="labelFieldFontSize(index - 1)" type="number" min="5" max="22" :aria-label="`第${index}行字号`" @input="setLabelFieldFontSize(index - 1, ($event.target as HTMLInputElement).value)"><button type="button" @click="stepLabelFieldFontSize(index - 1, 1)">＋</button></div><label class="asset-label-template-check" :class="{ checked: activeBaseTemplateKey === 'standard' || activeBaseTemplateKey === 'full' }"><input type="checkbox" :checked="activeBaseTemplateKey === 'standard' || activeBaseTemplateKey === 'full'"><span>隐藏字段名</span></label><label class="asset-label-template-check"><input type="checkbox"><span>字体加粗</span></label></div></div></section>
        <section class="asset-label-template-config-section first-config-section"><h2>打印排列</h2><div class="first-config-two-cols"><label class="first-config-input"><span>打印列数：</span><input v-model.number="labelSettings.columns" type="number" min="1" max="8"></label><label class="first-config-input"><span>打印行数：</span><input v-model.number="labelSettings.rows" type="number" min="1" max="14"></label><label class="first-config-input"><span>上下间距：</span><input v-model.number="labelSettings.rowGap" type="number" min="0" max="30" step="0.5"></label><label class="first-config-input"><span>左右间距：</span><input v-model.number="labelSettings.columnGap" type="number" min="0" max="30" step="0.5"></label></div></section>
        <section class="asset-label-template-config-section first-config-section"><h2>扫码展示字段 <button type="button" class="first-clear-link">清空</button></h2><button class="first-add-field" type="button">＋添加字段</button></section>
        <div class="first-template-actions"><button class="btn" type="button" @click="resetLabel">重 置</button><button v-if="can('asset:label_template_settings:save')" class="btn primary" type="submit">{{ saving ? '保存中...' : '保 存' }}</button></div>
      </form>
      </div>
    </section>

    <el-dialog v-model="catalogDialog" :title="catalogDialogTitle" width="min(680px, 94vw)" class="catalog-dialog" append-to-body>
      <form class="location-form" :class="{ 'asset-category-form': kind === 'categories' }" @submit.prevent="saveCatalogNode">
        <div class="location-form-body">
          <label v-if="kind === 'categories'" class="location-form-row"><span><em>*</em> 分类编码：</span><input v-model="catalogForm.code" required placeholder="请输入" autocomplete="off"></label>
          <label class="location-form-row"><span><em>*</em> {{ kind === 'locations' ? '位置名称' : '分类名称' }}：</span><input v-model="catalogForm.name" required placeholder="请输入" autocomplete="off"></label>
          <label class="location-form-row"><span>上级{{ kind === 'locations' ? '位置' : '分类' }}：</span><el-select v-model="editParentId" :aria-label="`上级${kind === 'locations' ? '位置' : '分类'}`"><el-option v-for="option in catalogParentOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select></label>
          <label v-if="kind === 'locations'" class="location-form-row"><span>位置编码：</span><input v-model="catalogForm.code" placeholder="请输入" autocomplete="off"></label>
          <label v-if="kind === 'categories'" class="location-form-row"><span>使用期限：</span><input v-model="catalogForm.usefulLife" type="number" min="0" step="1" placeholder="请输入" autocomplete="off"></label>
          <label v-if="kind === 'categories'" class="location-form-row"><span>计量单位：</span><input v-model="catalogForm.unit" placeholder="请输入" autocomplete="off"></label>
          <div class="location-form-row location-form-switch-row"><span>资产编码开关：</span><button class="location-switch" :class="{ on: catalogForm.enabled }" type="button" :aria-pressed="catalogForm.enabled" @click="catalogForm.enabled = !catalogForm.enabled"><strong>{{ catalogForm.enabled ? '开' : '关' }}</strong><b aria-hidden="true"></b></button></div>
        </div>
        <div class="modal-actions"><button class="btn" type="button" @click="catalogDialog = false">取消</button><button class="btn primary" type="submit" :disabled="saving">{{ saving ? '保存中...' : '确定' }}</button></div>
      </form>
    </el-dialog>
    <el-dialog v-model="templateDialog" :title="templateForm.key ? '重命名自定义模板' : '保存为自定义模板'" width="min(480px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="模板名称" required><el-input v-model="templateForm.name" maxlength="30" /></el-form-item></el-form><template #footer><el-button @click="templateDialog = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveCustomTemplate">保存</el-button></template></el-dialog>
  </section>
</template>
