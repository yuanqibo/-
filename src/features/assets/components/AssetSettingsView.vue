<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePortalSession } from '../../../core/auth/portal-session'
import { buildCatalogWorkbook, mergeCatalogRows, parseCatalogWorkbook } from '../composables/catalogWorkbook'
import { useAssets } from '../composables/useAssets'
import type { CatalogNode } from '../types/assets'

const route = useRoute()
const { user } = usePortalSession()
const { state, store, load, saveCatalogValue, saveCodeRules, saveLabels } = useAssets()
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
const builtInTemplates = [
  { key: 'standard', name: '标准资产标签', settings: { labelWidth: 40, labelHeight: 30, logoWidth: 14, logoHeight: 8, logoScale: 80, logoText: 'AM', qrSize: 13, qrTextGap: 2, contentScale: 80, offsetX: 0, offsetY: 0, fontSize: 12, columns: 1, rows: 1, columnGap: 0, rowGap: 0, fields: ['name', 'id', 'category'], scanFields: [], customFields: '', showLogo: false } },
  { key: 'compact', name: '小型二维码标签', settings: { labelWidth: 60, labelHeight: 40, logoWidth: 10, logoHeight: 6, logoScale: 100, logoText: 'IT', qrSize: 15, qrTextGap: 10, contentScale: 100, offsetX: 0, offsetY: 0, fontSize: 7, columns: 1, rows: 1, columnGap: 5, rowGap: 5, fields: ['id', 'name', 'category', 'owner'], scanFields: [], customFields: '', showLogo: false } },
  { key: 'full', name: '大号信息标签', settings: { labelWidth: 60, labelHeight: 40, logoWidth: 18, logoHeight: 10, logoScale: 100, logoText: '资产云', qrSize: 24, qrTextGap: 6, contentScale: 100, offsetX: 0, offsetY: 0, fontSize: 12, columns: 1, rows: 1, columnGap: 5, rowGap: 5, fields: ['name', 'id'], scanFields: [], customFields: '管理员=custodian', showLogo: false } },
  { key: 'defaultAsset', name: '默认资产标签', settings: { labelWidth: 60, labelHeight: 40, logoWidth: 14, logoHeight: 8, logoScale: 100, logoText: 'AM', qrSize: 18, qrTextGap: 2, contentScale: 100, offsetX: 0, offsetY: 0, fontSize: 9, columns: 3, rows: 8, columnGap: 3, rowGap: 2, fields: ['id', 'name', 'category', 'owner', 'location'], scanFields: ['id', 'name', 'owner', 'phone', 'location'], customFields: '', showLogo: true } }
]
const templateOptions = computed(() => [...builtInTemplates, ...customTemplates.value.map((item) => ({ key: String(item.key || item.id), name: String(item.name || '自定义模板'), settings: item.settings as Record<string, unknown> || {} }))])
const activeCustomTemplate = computed(() => customTemplates.value.find((item) => String(item.key || item.id) === String(labelSettings.templateKey || '')))
const labelFieldOptions = [{ key: '', label: '选择字段' }, { key: 'name', label: '资产名称' }, { key: 'id', label: '资产编码' }, { key: 'category', label: '资产分类' }, { key: 'owner', label: '使用人' }, { key: 'location', label: '所在位置' }, { key: 'sn', label: '序列号' }]
const labelFields = computed<string[]>(() => Array.isArray(labelSettings.fields) ? labelSettings.fields as string[] : [])
const labelScanFields = computed<string[]>({ get: () => Array.isArray(labelSettings.scanFields) ? labelSettings.scanFields as string[] : [], set: (value) => { labelSettings.scanFields = value } })
const labelCustomFields = computed<string>({ get: () => String(labelSettings.customFields || ''), set: (value) => { labelSettings.customFields = value } })
const setLabelField = (index: number, value: string): void => { const fields = [...labelFields.value]; fields[index] = value; labelSettings.fields = fields.filter((field, fieldIndex) => field || fieldIndex < index) }
type FlatCatalogRow = CatalogNode & { parentName: string }
const flattenCatalog = (nodes: CatalogNode[], parentName = '暂无上级'): FlatCatalogRow[] => nodes.flatMap((node) => [
  { ...node, parentName },
  ...flattenCatalog(node.children || [], node.name)
])
const catalogRows = computed(() => {
  const keyword = catalogQuery.value.trim().toLowerCase()
  const rows = flattenCatalog(catalog.value)
  return keyword ? rows.filter((row) => [row.name, row.code, row.parentName].some((value) => String(value || '').toLowerCase().includes(keyword))) : rows
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
  Object.keys(labelSettings).forEach((key) => delete labelSettings[key])
  Object.assign(labelSettings, { templateKey: 'standard', labelWidth: 40, labelHeight: 30, logoWidth: 18, logoHeight: 8, logoText: '资产云管家', qrSize: 18, contentScale: 100, offsetX: 0, offsetY: 0, fields: ['name', 'id', 'category'], scanFields: ['name', 'id', 'category', 'owner', 'location'], customFields: '', columns: 1, rows: 1, columnGap: 2, rowGap: 2, fontSize: 12, showLogo: false }, clone(store.value.assetLabelPrintSettingsV2 || {}))
  customTemplates.value = clone(store.value.assetLabelCustomTemplatesV1 || [])
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

const openCatalogDialog = (node?: CatalogNode, asChild = false): void => {
  if (!canCatalog(node && !asChild ? 'update' : 'create')) return
  editNodeId.value = asChild ? '' : node?.id || ''
  editParentId.value = asChild ? node?.id || '' : findParent(catalog.value, node?.id || '')?.id || ''
  Object.assign(catalogForm, node && !asChild ? { name: node.name, code: node.code || '', unit: node.unit || '', usefulLife: node.usefulLife || '', enabled: node.enabled !== false } : { name: '', code: '', unit: kind.value === 'categories' ? '台' : '', usefulLife: '', enabled: true })
  catalogDialog.value = true
}

const saveCatalogNode = async (): Promise<void> => {
  if (!canCatalog(editNodeId.value ? 'update' : 'create')) return
  if (!catalogForm.name.trim()) { ElMessage.warning('请输入名称'); return }
  if (editNodeId.value) {
    const node = findNode(catalog.value, editNodeId.value)
    if (node) Object.assign(node, catalogForm)
  } else {
    const node: CatalogNode = { id: `${kind.value}-${Date.now()}`, ...catalogForm, children: [] }
    const parent = findNode(catalog.value, editParentId.value)
    if (parent) parent.children.push(node)
    else catalog.value.push(node)
  }
  saving.value = true
  try { await saveCatalogValue(kind.value as 'categories' | 'locations', clone(catalog.value)); catalogDialog.value = false; ElMessage.success('配置已保存') }
  catch (error) { syncFromStore(); ElMessage.error(error instanceof Error ? error.message : '保存失败') }
  finally { saving.value = false }
}

const removeFrom = (nodes: CatalogNode[], id: string): boolean => {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) { nodes.splice(index, 1); return true }
  return nodes.some((node) => removeFrom(node.children || [], id))
}
const removeNode = async (node: CatalogNode): Promise<void> => {
  if (!canCatalog('delete')) return
  await ElMessageBox.confirm(`确定删除“${node.name}”及其下级节点吗？`, '删除确认', { type: 'warning' })
  const previous = clone(catalog.value)
  removeFrom(catalog.value, node.id)
  try { await saveCatalogValue(kind.value as 'categories' | 'locations', clone(catalog.value)); ElMessage.success('节点已删除') }
  catch (error) { catalog.value = previous; ElMessage.error(error instanceof Error ? error.message : '删除失败') }
}
const toggleNode = async (node: CatalogNode): Promise<void> => {
  if (!canCatalog('toggleCode')) return
  const previous = node.enabled
  node.enabled = node.enabled === false
  try { await saveCatalogValue(kind.value as 'categories' | 'locations', clone(catalog.value)) }
  catch (error) { node.enabled = previous; ElMessage.error(error instanceof Error ? error.message : '状态更新失败') }
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
  const preset = builtInTemplates.find((item) => item.key === key)?.settings
  const custom = customTemplates.value.find((item) => String(item.key || item.id) === key)
  Object.assign(labelSettings, clone(custom?.settings as Record<string, unknown> || preset || {}), { templateKey: key })
}
const resetLabel = (): void => applyTemplate(String(labelSettings.templateKey || 'standard'))
const openTemplateDialog = (template?: Record<string, unknown>): void => {
  Object.assign(templateForm, { key: String(template?.key || template?.id || ''), name: String(template?.name || '') })
  templateDialog.value = true
}
const saveCustomTemplate = async (): Promise<void> => {
  if (!templateForm.name.trim()) { ElMessage.warning('请输入模板名称'); return }
  const existing = customTemplates.value.findIndex((item) => String(item.key || item.id) === templateForm.key)
  const key = templateForm.key || `custom-${crypto.randomUUID()}`
  const existingSettings = existing >= 0 ? customTemplates.value[existing].settings as Record<string, unknown> : null
  const item = { key, id: key, name: templateForm.name.trim(), settings: { ...clone(existingSettings || labelSettings), templateKey: key } }
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
  <section class="asset-settings-view">
    <a v-if="downloadUrl" ref="downloadLink" :href="downloadUrl" :download="downloadName" hidden>下载</a>
    <el-skeleton v-if="state.loading" :rows="8" animated />

    <section v-else-if="kind === 'locations' || kind === 'categories'" v-loading="catalogBusy" class="location-settings-shell" :class="{ 'asset-category-settings-shell': kind === 'categories' }">
      <aside class="location-settings-tree-panel" :class="{ 'asset-category-tree-panel': kind === 'categories' }"><h2>{{ kind === 'locations' ? '位置' : '分类' }}</h2><label class="location-search"><input v-model="catalogQuery" type="search" :placeholder="kind === 'locations' ? '模糊查询' : '模糊搜索'"><span aria-hidden="true">⌕</span></label><div class="location-tree-list" :class="{ 'asset-category-tree-list': kind === 'categories' }"><el-tree :data="catalog" node-key="id" default-expand-all highlight-current :expand-on-click-node="false" @current-change="selectedNode = $event"><template #default="{ data }"><span>{{ data.name }}</span></template></el-tree></div></aside>
      <article class="location-settings-table-panel" :class="{ 'asset-category-table-panel': kind === 'categories' }"><div class="location-settings-toolbar" :class="{ 'asset-category-toolbar': kind === 'categories' }"><div class="asset-list-actions"><button v-if="canCatalog('create')" class="table-action primary" type="button" @click="openCatalogDialog()">＋ 新增{{ kind === 'locations' ? '位置' : '分类' }}</button><el-dropdown v-if="canCatalog('template') || canCatalog('import') || canCatalog('export')" placement="bottom-start" trigger="click"><button class="table-action has-caret" type="button">导入/导出<span class="action-caret" aria-hidden="true"></span></button><template #dropdown><el-dropdown-menu><el-dropdown-item v-if="canCatalog('template')" @click="downloadCatalogTemplate">下载模板</el-dropdown-item><el-dropdown-item v-if="canCatalog('import')"><label><input type="file" accept=".xlsx" hidden @change="importCatalog">导入{{ kind === 'locations' ? '位置' : '分类' }}</label></el-dropdown-item><el-dropdown-item v-if="canCatalog('export')" @click="exportCatalog">导出{{ kind === 'locations' ? '位置' : '分类' }}</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div></div>
        <div class="location-table-wrap" :class="{ 'asset-category-table-wrap': kind === 'categories' }"><table class="location-settings-table" :class="{ 'asset-category-settings-table': kind === 'categories' }"><thead><tr v-if="kind === 'locations'"><th>位置名称</th><th>位置编码</th><th>上级位置</th><th>资产编码开关</th><th>操作</th></tr><tr v-else><th>分类编码</th><th>分类名称</th><th>上级分类</th><th>使用期限</th><th>计量单位</th><th>资产编码开关 ⓘ</th><th>操作</th></tr></thead><tbody><tr v-for="row in catalogRows" :key="row.id"><template v-if="kind === 'locations'"><td>{{ row.name }}</td><td>{{ row.code || '-' }}</td><td>{{ row.parentName }}</td><td><button class="asset-code-switch-button" type="button" @click="toggleNode(row)"><span class="asset-code-switch" :class="{ on: row.enabled !== false }"><i></i></span></button></td><td><button class="link" type="button" @click="openCatalogDialog(row)">编辑</button><span class="action-separator">|</span><button class="link" type="button" @click="removeNode(row)">删除</button></td></template><template v-else><td>{{ row.code || '-' }}</td><td>{{ row.name }}</td><td>{{ row.parentName }}</td><td>{{ row.usefulLife || '0' }}</td><td>{{ row.unit || '台' }}</td><td><button class="asset-code-switch-button" type="button" @click="toggleNode(row)"><span class="asset-code-switch" :class="{ on: row.enabled !== false }"><i></i></span></button></td><td><button class="link" type="button" @click="openCatalogDialog(row)">编辑</button><span class="action-separator">|</span><button class="link" type="button" @click="removeNode(row)">删除</button></td></template></tr><tr v-if="!catalogRows.length"><td :colspan="kind === 'locations' ? 5 : 7" class="empty-cell">暂无匹配{{ kind === 'locations' ? '位置' : '分类' }}</td></tr></tbody></table></div>
      </article>
    </section>

    <form v-else-if="kind === 'code-rules'" class="asset-code-rule-page" @submit.prevent="saveRules"><header class="asset-code-rule-title"><h1>资产编码规则</h1></header><div class="asset-code-rule-workspace"><section class="asset-code-rule-box"><h2>可选字段</h2><div class="asset-code-rule-list"><button v-for="field in availableRuleFields" :key="field.key" class="asset-code-rule-field" type="button" @click="selectRuleField(field.key)"><span class="asset-code-rule-field-name">{{ field.label }}</span></button></div></section><div class="asset-code-rule-transfer" aria-hidden="true"><strong>⇆</strong><span>左右拖拽</span></div><section class="asset-code-rule-box"><h2>已选字段</h2><div class="asset-code-rule-list"><div v-for="field in selectedRuleFields" :key="field" class="asset-code-rule-field selected"><button class="asset-code-rule-field-name" type="button" @click="removeRuleField(field)">{{ ruleField(field)?.label || field }}</button><span class="asset-code-rule-field-controls"><input v-if="field === 'customText'" v-model="(codeRules.customTexts as Record<string, string>).customText" class="asset-code-rule-custom-input" aria-label="自定义文本内容" placeholder="请输入文本" maxlength="16"><select v-if="field === 'purchaseDate'" v-model="(codeRules.dateFormats as Record<string, string>).purchaseDate" class="asset-code-rule-date-format" aria-label="购置起租日期格式"><option value="yyyymmdd">yyyymmdd(例:20190801)</option><option value="yyyymm">yyyymm(例:201908)</option><option value="yymmdd">yymmdd(例:190801)</option><option value="yymm">yymm(例:1908)</option></select><select v-model="(codeRules.fieldOptions as Record<string, string>)[field]" :aria-label="`${ruleField(field)?.label || field}规则选项`"><option value="none">无</option><option value="dash">-</option><option value="slash">/</option></select></span></div></div></section></div><div class="asset-code-rule-serial"><label><span>流水号：</span><select v-model.number="codeRules.serialLength"><option v-for="length in [3,4,5,6,7]" :key="length" :value="length">{{ length }}</option></select></label><span>流水号可选范围为3-7位</span></div><section class="asset-code-rule-preview"><p>规则预览：<strong>{{ rulePreview }}</strong></p><p>当前编码规则下资产编码长度：<b>{{ ruleLength }}位</b></p></section><div class="asset-code-rule-actions"><button v-if="can('asset:code_rules:update')" class="btn primary" type="submit">{{ saving ? '保存中...' : '保存' }}</button></div></form>

    <section v-else class="asset-label-template-page">
      <aside class="asset-label-template-left"><header class="asset-code-rule-title"><h1>标签模板设置</h1></header><div class="asset-label-template-list">
        <article v-for="item in templateOptions" :key="item.key" class="asset-label-template-card" :class="{ active: String(labelSettings.templateKey || 'standard') === item.key }" @click="applyTemplate(item.key)">
          <button class="asset-label-template-radio" type="button" :aria-label="`选择${item.name}`" :aria-pressed="String(labelSettings.templateKey || 'standard') === item.key"><span></span></button>
          <header class="asset-label-template-card-head"><strong>{{ Number(item.settings.labelWidth || 40) }}*{{ Number(item.settings.labelHeight || 30) }}mm</strong><i aria-hidden="true"></i><strong>{{ item.name }}</strong></header>
          <div class="asset-label-template-preview is-default"><div class="asset-label-template-ticket"><div class="asset-label-template-qr">QR</div><div class="asset-label-template-fields"><strong>资产名称</strong><span>ASSET-00001</span><span>资产分类 · 所在位置</span></div></div></div>
        </article>
      </div></aside>
      <div class="asset-label-template-right"><form class="asset-label-template-config-form first-template-config-form" @submit.prevent="saveLabel">
        <div class="asset-label-template-config-tabs"><button class="asset-label-template-config-tab active" type="button">配置1 <span aria-hidden="true">✎</span></button><div class="asset-label-template-tab-actions"><button v-if="activeCustomTemplate && can('asset:label_template_settings:delete')" class="asset-label-template-delete" type="button" @click="removeCustomTemplate(activeCustomTemplate)">删除模板</button><button v-if="can('asset:label_template_settings:create')" class="asset-label-template-add" type="button" @click="openTemplateDialog(activeCustomTemplate)">{{ activeCustomTemplate ? '重命名' : '＋新增' }}</button></div></div>
        <div class="asset-label-template-stage"><div class="asset-label-template-config-preview is-sample"><div class="asset-label-template-ticket"><div class="asset-label-template-qr">QR</div><div class="asset-label-template-fields"><strong>资产名称</strong><span>ASSET-00001</span><span>{{ labelFields.map(field => labelFieldOptions.find(option => option.key === field)?.label).filter(Boolean).join(' · ') }}</span></div></div></div></div>
        <section class="asset-label-template-config-section first-config-section"><h2>标签logo设置</h2><label class="asset-label-template-toggle"><input v-model="labelSettings.showLogo" type="checkbox"><span>显示 Logo</span></label><div class="first-config-two-cols"><label class="first-config-input"><span>Logo 文案：</span><input v-model="labelSettings.logoText" type="text" maxlength="12"></label><label class="first-config-input"><span>Logo 缩放（%）：</span><input v-model.number="labelSettings.logoScale" type="number" min="50" max="160"></label></div></section>
        <section class="asset-label-template-config-section first-config-section"><h2>标签尺寸</h2><div class="first-config-two-cols"><label class="first-config-input"><span>标签宽度（mm）：</span><input v-model.number="labelSettings.labelWidth" type="number" min="20" max="160"></label><label class="first-config-input"><span>标签高度（mm）：</span><input v-model.number="labelSettings.labelHeight" type="number" min="12" max="120"></label><label class="first-config-input"><span>内容缩放（%）：</span><input v-model.number="labelSettings.contentScale" type="number" min="50" max="160"></label><label class="first-config-input"><span>字体大小：</span><input v-model.number="labelSettings.fontSize" type="number" min="5" max="28"></label></div></section>
        <section class="asset-label-template-config-section first-config-section"><h2>位置调整</h2><div class="first-config-two-cols"><label class="first-config-input"><span>左右位移（mm）：</span><input v-model.number="labelSettings.offsetX" type="number" min="-30" max="30" step="0.5"></label><label class="first-config-input"><span>上下位移（mm）：</span><input v-model.number="labelSettings.offsetY" type="number" min="-30" max="30" step="0.5"></label><label class="first-config-input"><span>码字间距（mm）：</span><input v-model.number="labelSettings.qrTextGap" type="number" min="0" max="30" step="0.5"></label><label class="first-config-input"><span>二维码大小（mm）：</span><input v-model.number="labelSettings.qrSize" type="number" min="8" max="60" step="0.5"></label></div></section>
        <section class="asset-label-template-config-section first-config-section"><h2>字段</h2><div class="asset-label-template-field-list"><div v-for="index in 5" :key="index" class="asset-label-template-field-row"><select :value="labelFields[index - 1] || ''" :aria-label="`第${index}行字段`" @change="setLabelField(index - 1, ($event.target as HTMLSelectElement).value)"><option v-for="field in labelFieldOptions" :key="field.key" :value="field.key">{{ field.label }}</option></select><div class="asset-label-template-stepper"><button type="button" @click="labelSettings.fontSize = Math.max(5, Number(labelSettings.fontSize || 12) - 1)">−</button><input v-model.number="labelSettings.fontSize" type="number" min="5" max="28" :aria-label="`第${index}行字号`"><button type="button" @click="labelSettings.fontSize = Math.min(28, Number(labelSettings.fontSize || 12) + 1)">＋</button></div></div></div></section>
        <section class="asset-label-template-config-section first-config-section"><h2>打印排列</h2><div class="first-config-two-cols"><label class="first-config-input"><span>打印列数：</span><input v-model.number="labelSettings.columns" type="number" min="1" max="8"></label><label class="first-config-input"><span>打印行数：</span><input v-model.number="labelSettings.rows" type="number" min="1" max="14"></label><label class="first-config-input"><span>上下间距：</span><input v-model.number="labelSettings.rowGap" type="number" min="0" max="30" step="0.5"></label><label class="first-config-input"><span>左右间距：</span><input v-model.number="labelSettings.columnGap" type="number" min="0" max="30" step="0.5"></label></div></section>
        <section class="asset-label-template-config-section first-config-section"><h2>扫码展示字段</h2><div class="asset-label-template-field-list"><label v-for="field in labelFieldOptions.filter(item => item.key)" :key="field.key" class="asset-label-template-check"><input v-model="labelScanFields" type="checkbox" :value="field.key"><span>{{ field.label }}</span></label></div><label class="first-config-input"><span>自定义字段：</span><textarea v-model="labelCustomFields" rows="3" placeholder="每行一个，例如：管理员=custodian"></textarea></label></section>
        <div class="first-template-actions"><button class="btn" type="button" @click="resetLabel">重 置</button><button v-if="can('asset:label_template_settings:save')" class="btn primary" type="submit">{{ saving ? '保存中...' : '保 存' }}</button></div>
      </form></div>
    </section>

    <el-dialog v-model="catalogDialog" :title="editNodeId ? '编辑节点' : '新增节点'" width="min(520px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="名称" required><el-input v-model="catalogForm.name" /></el-form-item><el-form-item label="编码"><el-input v-model="catalogForm.code" /></el-form-item><el-form-item v-if="kind === 'categories'" label="计量单位"><el-input v-model="catalogForm.unit" /></el-form-item><el-form-item v-if="kind === 'categories'" label="使用年限"><el-input v-model="catalogForm.usefulLife" /></el-form-item><el-form-item label="启用"><el-switch v-model="catalogForm.enabled" /></el-form-item></el-form><template #footer><el-button @click="catalogDialog = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveCatalogNode">保存</el-button></template></el-dialog>
    <el-dialog v-model="templateDialog" :title="templateForm.key ? '重命名自定义模板' : '保存为自定义模板'" width="min(480px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="模板名称" required><el-input v-model="templateForm.name" maxlength="30" /></el-form-item></el-form><template #footer><el-button @click="templateDialog = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveCustomTemplate">保存</el-button></template></el-dialog>
  </section>
</template>
