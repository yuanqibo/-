<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, toRaw, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Download, Edit, Plus, Refresh, Upload } from '@element-plus/icons-vue'
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

const kind = computed<'locations' | 'categories' | 'code-rules' | 'labels'>(() => {
  if (route.path.endsWith('/locations')) return 'locations'
  if (route.path.endsWith('/categories')) return 'categories'
  if (route.path.endsWith('/code-rules')) return 'code-rules'
  return 'labels'
})
const title = computed(() => ({ locations: '位置管理', categories: '资产分类', 'code-rules': '资产编码规则', labels: '标签模板设置' }[kind.value]))
const subtitle = computed(() => ({ locations: '维护公司、仓库、楼层等资产存放位置。', categories: '维护资产分类、编码、计量单位与启用状态。', 'code-rules': '配置资产自动编码字段和流水号长度。', labels: '配置资产标签尺寸、展示字段和打印布局。' }[kind.value]))
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
const can = (code: string): boolean => permissions.value.has(code)

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
const builtInTemplates = [{ key: 'standard', name: '标准标签' }, { key: 'compact', name: '紧凑标签' }, { key: 'full', name: '完整标签' }]
const templateOptions = computed(() => [...builtInTemplates, ...customTemplates.value.map((item) => ({ key: String(item.key || item.id), name: String(item.name || '自定义模板') }))])

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
  editNodeId.value = asChild ? '' : node?.id || ''
  editParentId.value = asChild ? node?.id || '' : findParent(catalog.value, node?.id || '')?.id || ''
  Object.assign(catalogForm, node && !asChild ? { name: node.name, code: node.code || '', unit: node.unit || '', usefulLife: node.usefulLife || '', enabled: node.enabled !== false } : { name: '', code: '', unit: kind.value === 'categories' ? '台' : '', usefulLife: '', enabled: true })
  catalogDialog.value = true
}

const saveCatalogNode = async (): Promise<void> => {
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
  await ElMessageBox.confirm(`确定删除“${node.name}”及其下级节点吗？`, '删除确认', { type: 'warning' })
  const previous = clone(catalog.value)
  removeFrom(catalog.value, node.id)
  try { await saveCatalogValue(kind.value as 'categories' | 'locations', clone(catalog.value)); ElMessage.success('节点已删除') }
  catch (error) { catalog.value = previous; ElMessage.error(error instanceof Error ? error.message : '删除失败') }
}
const toggleNode = async (node: CatalogNode): Promise<void> => {
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
  const presets: Record<string, Record<string, unknown>> = {
    standard: { labelWidth: 40, labelHeight: 30, fontSize: 12, columns: 1, rows: 1 },
    compact: { labelWidth: 30, labelHeight: 20, fontSize: 10, columns: 2, rows: 3 },
    full: { labelWidth: 70, labelHeight: 45, fontSize: 13, columns: 1, rows: 1 }
  }
  const custom = customTemplates.value.find((item) => String(item.key || item.id) === key)
  Object.assign(labelSettings, clone(custom?.settings as Record<string, unknown> || presets[key] || {}), { templateKey: key })
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
  <section class="standard-business-view asset-settings-view">
    <header class="standard-page-header"><div><h1>{{ title }}</h1><p>{{ subtitle }}</p></div><div class="standard-header-actions"><el-button :icon="Refresh" @click="load(true)">刷新</el-button><template v-if="kind === 'locations' || kind === 'categories'"><el-button v-if="can(`asset:${kind === 'locations' ? 'location_settings' : 'category_settings'}:template`)" @click="downloadCatalogTemplate">下载模板</el-button><label v-if="can(`asset:${kind === 'locations' ? 'location_settings' : 'category_settings'}:import`)" class="el-button"><input type="file" accept=".xlsx" hidden @change="importCatalog"><el-icon><Upload /></el-icon><span>导入</span></label><el-button v-if="can(`asset:${kind === 'locations' ? 'location_settings' : 'category_settings'}:export`)" :icon="Download" @click="exportCatalog">导出</el-button><el-button v-if="can(`asset:${kind === 'locations' ? 'location_settings' : 'category_settings'}:create`)" type="primary" :icon="Plus" @click="openCatalogDialog()">新增{{ kind === 'locations' ? '位置' : '分类' }}</el-button></template></div></header>

    <a v-if="downloadUrl" ref="downloadLink" :href="downloadUrl" :download="downloadName" hidden>下载</a>

    <el-skeleton v-if="state.loading" :rows="8" animated />
    <div v-else-if="kind === 'locations' || kind === 'categories'" v-loading="catalogBusy" class="standard-catalog-layout">
      <div class="standard-catalog-tree"><el-tree :data="catalog" node-key="id" default-expand-all highlight-current :expand-on-click-node="false" @current-change="selectedNode = $event"><template #default="{ data }"><span class="standard-tree-node"><span>{{ data.name }}</span><small>{{ data.code || '' }}</small></span></template></el-tree></div>
      <div class="standard-catalog-detail">
        <template v-if="selectedNode"><div class="standard-section-title"><div><h2>{{ selectedNode.name }}</h2><p>{{ selectedNode.code || '未设置编码' }}</p></div><div><el-button v-if="can(`asset:${kind === 'locations' ? 'location_settings' : 'category_settings'}:create`)" :icon="Plus" @click="openCatalogDialog(selectedNode, true)">新增下级</el-button><el-button v-if="can(`asset:${kind === 'locations' ? 'location_settings' : 'category_settings'}:update`)" :icon="Edit" @click="openCatalogDialog(selectedNode)">编辑</el-button><el-button v-if="can(`asset:${kind === 'locations' ? 'location_settings' : 'category_settings'}:delete`)" type="danger" plain :icon="Delete" @click="removeNode(selectedNode)">删除</el-button></div></div>
          <el-descriptions :column="2" border><el-descriptions-item label="名称">{{ selectedNode.name }}</el-descriptions-item><el-descriptions-item label="编码">{{ selectedNode.code || '-' }}</el-descriptions-item><el-descriptions-item v-if="kind === 'categories'" label="计量单位">{{ selectedNode.unit || '-' }}</el-descriptions-item><el-descriptions-item v-if="kind === 'categories'" label="使用年限">{{ selectedNode.usefulLife || '0' }}</el-descriptions-item><el-descriptions-item label="启用状态"><el-switch :model-value="selectedNode.enabled !== false" :disabled="!can(`asset:${kind === 'locations' ? 'location_settings' : 'category_settings'}:toggleCode`)" @change="toggleNode(selectedNode)" /></el-descriptions-item><el-descriptions-item label="下级节点">{{ selectedNode.children?.length || 0 }}</el-descriptions-item></el-descriptions>
        </template><el-empty v-else description="请选择左侧节点" />
      </div>
    </div>

    <el-form v-else-if="kind === 'code-rules'" label-position="top" class="standard-settings-form" @submit.prevent="saveRules">
      <div class="standard-section-title"><div><h2>自动编码</h2><p>编码由选定字段和流水号组成。</p></div><el-button v-if="can('asset:code_rules:update')" type="primary" native-type="submit" :loading="saving">保存</el-button></div>
      <el-form-item label="编码字段"><el-checkbox-group v-model="codeRules.selectedFields"><el-checkbox value="categoryCode">资产分类编码</el-checkbox><el-checkbox value="purchaseDate">购置日期</el-checkbox><el-checkbox value="customText">自定义文本</el-checkbox></el-checkbox-group></el-form-item>
      <el-form-item label="流水号位数"><el-input-number v-model="codeRules.serialLength" :min="3" :max="12" /></el-form-item>
      <el-form-item label="自定义文本"><el-input v-model="(codeRules.customTexts as Record<string, string>).customText" maxlength="20" /></el-form-item>
      <el-form-item label="编码预览"><div class="standard-code-preview">01-20260717-00001</div></el-form-item>
    </el-form>

    <el-form v-else label-position="top" class="standard-settings-form" @submit.prevent="saveLabel">
      <div class="standard-section-title"><div><h2>标签版式</h2><p>设置标签尺寸、打印布局和显示字段。</p></div><el-button v-if="can('asset:label_template_settings:save')" type="primary" native-type="submit" :loading="saving">保存</el-button></div>
      <div class="standard-template-toolbar"><el-select :model-value="String(labelSettings.templateKey || 'standard')" @change="applyTemplate"><el-option v-for="item in templateOptions" :key="item.key" :label="item.name" :value="item.key" /></el-select><el-button v-if="can('asset:label_template_settings:create')" :icon="Plus" @click="openTemplateDialog()">保存为自定义模板</el-button></div>
      <div v-if="customTemplates.length" class="standard-custom-template-list"><span v-for="item in customTemplates" :key="String(item.key || item.id)"><button type="button" @click="applyTemplate(String(item.key || item.id))">{{ item.name }}</button><el-button v-if="can('asset:label_template_settings:update')" link :icon="Edit" aria-label="重命名模板" @click="openTemplateDialog(item)" /><el-button v-if="can('asset:label_template_settings:delete')" link type="danger" :icon="Delete" aria-label="删除模板" @click="removeCustomTemplate(item)" /></span></div>
      <div class="standard-form-grid"><el-form-item label="标签宽度（mm）"><el-input-number v-model="labelSettings.labelWidth" :min="20" :max="200" /></el-form-item><el-form-item label="标签高度（mm）"><el-input-number v-model="labelSettings.labelHeight" :min="15" :max="120" /></el-form-item><el-form-item label="列数"><el-input-number v-model="labelSettings.columns" :min="1" :max="6" /></el-form-item><el-form-item label="行数"><el-input-number v-model="labelSettings.rows" :min="1" :max="10" /></el-form-item><el-form-item label="列间距（mm）"><el-input-number v-model="labelSettings.columnGap" :min="0" :max="30" :step="0.5" /></el-form-item><el-form-item label="行间距（mm）"><el-input-number v-model="labelSettings.rowGap" :min="0" :max="30" :step="0.5" /></el-form-item><el-form-item label="字体大小"><el-input-number v-model="labelSettings.fontSize" :min="8" :max="28" /></el-form-item><el-form-item label="内容缩放（%）"><el-input-number v-model="labelSettings.contentScale" :min="50" :max="160" /></el-form-item><el-form-item label="X 偏移（mm）"><el-input-number v-model="labelSettings.offsetX" :min="-30" :max="30" :step="0.5" /></el-form-item><el-form-item label="Y 偏移（mm）"><el-input-number v-model="labelSettings.offsetY" :min="-30" :max="30" :step="0.5" /></el-form-item><el-form-item label="二维码尺寸（mm）"><el-input-number v-model="labelSettings.qrSize" :min="8" :max="60" /></el-form-item><el-form-item label="显示 Logo"><el-switch v-model="labelSettings.showLogo" /></el-form-item><el-form-item v-if="labelSettings.showLogo" label="Logo 文案"><el-input v-model="labelSettings.logoText" maxlength="12" /></el-form-item></div>
      <el-form-item label="显示字段"><el-checkbox-group v-model="labelSettings.fields"><el-checkbox value="name">资产名称</el-checkbox><el-checkbox value="id">资产编码</el-checkbox><el-checkbox value="category">资产分类</el-checkbox><el-checkbox value="owner">使用人</el-checkbox><el-checkbox value="location">所在位置</el-checkbox><el-checkbox value="sn">序列号</el-checkbox></el-checkbox-group></el-form-item>
      <el-form-item label="扫码显示字段"><el-checkbox-group v-model="labelSettings.scanFields"><el-checkbox value="name">资产名称</el-checkbox><el-checkbox value="id">资产编码</el-checkbox><el-checkbox value="category">资产分类</el-checkbox><el-checkbox value="owner">使用人</el-checkbox><el-checkbox value="location">所在位置</el-checkbox><el-checkbox value="sn">序列号</el-checkbox></el-checkbox-group></el-form-item>
      <el-form-item label="自定义字段"><el-input v-model="labelSettings.customFields" type="textarea" :rows="3" placeholder="每行一个，例如：管理员=custodian" /></el-form-item>
      <div class="standard-label-preview"><strong>{{ labelSettings.showLogo ? 'AM · ' : '' }}资产名称</strong><span>ASSET-00001</span><small>资产分类 · 所在位置</small><div class="standard-qr-placeholder">QR</div></div>
    </el-form>

    <el-dialog v-model="catalogDialog" :title="editNodeId ? '编辑节点' : '新增节点'" width="min(520px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="名称" required><el-input v-model="catalogForm.name" /></el-form-item><el-form-item label="编码"><el-input v-model="catalogForm.code" /></el-form-item><el-form-item v-if="kind === 'categories'" label="计量单位"><el-input v-model="catalogForm.unit" /></el-form-item><el-form-item v-if="kind === 'categories'" label="使用年限"><el-input v-model="catalogForm.usefulLife" /></el-form-item><el-form-item label="启用"><el-switch v-model="catalogForm.enabled" /></el-form-item></el-form><template #footer><el-button @click="catalogDialog = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveCatalogNode">保存</el-button></template></el-dialog>
    <el-dialog v-model="templateDialog" :title="templateForm.key ? '重命名自定义模板' : '保存为自定义模板'" width="min(480px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="模板名称" required><el-input v-model="templateForm.name" maxlength="30" /></el-form-item></el-form><template #footer><el-button @click="templateDialog = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveCustomTemplate">保存</el-button></template></el-dialog>
  </section>
</template>
