<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Edit, Plus, Refresh } from '@element-plus/icons-vue'
import { useAssets } from '../composables/useAssets'
import type { CatalogNode } from '../types/assets'

const route = useRoute()
const { state, store, load, saveCatalogValue, saveCodeRules, saveLabels } = useAssets()
const saving = ref(false)
const selectedNode = ref<CatalogNode | null>(null)
const catalogDialog = ref(false)
const editParentId = ref('')
const editNodeId = ref('')
const catalogForm = reactive({ name: '', code: '', unit: '', usefulLife: '', enabled: true })

const kind = computed<'locations' | 'categories' | 'code-rules' | 'labels'>(() => {
  if (route.path.endsWith('/locations')) return 'locations'
  if (route.path.endsWith('/categories')) return 'categories'
  if (route.path.endsWith('/code-rules')) return 'code-rules'
  return 'labels'
})
const title = computed(() => ({ locations: '位置管理', categories: '资产分类', 'code-rules': '资产编码规则', labels: '标签模板设置' }[kind.value]))
const subtitle = computed(() => ({ locations: '维护公司、仓库、楼层等资产存放位置。', categories: '维护资产分类、编码、计量单位与启用状态。', 'code-rules': '配置资产自动编码字段和流水号长度。', labels: '配置资产标签尺寸、展示字段和打印布局。' }[kind.value]))

const clone = <T,>(value: T): T => structuredClone(value)
const catalog = ref<CatalogNode[]>([])
const codeRules = reactive<Record<string, unknown>>({})
const labelSettings = reactive<Record<string, unknown>>({})

const syncFromStore = (): void => {
  catalog.value = clone(kind.value === 'locations' ? store.value.assetLocationTree || [] : store.value.assetCategoryTree || [])
  Object.keys(codeRules).forEach((key) => delete codeRules[key])
  Object.assign(codeRules, clone(store.value.assetPortalAssetCodeRuleSettingsV1 || { selectedFields: ['categoryCode'], serialLength: 5, fieldOptions: { categoryCode: 'none' }, customTexts: { customText: '' }, dateFormats: { purchaseDate: 'yyyymmdd' } }))
  Object.keys(labelSettings).forEach((key) => delete labelSettings[key])
  Object.assign(labelSettings, clone(store.value.assetLabelPrintSettingsV2 || { templateKey: 'standard', labelWidth: 40, labelHeight: 30, fields: ['name', 'id', 'category'], columns: 1, rows: 1, fontSize: 12, showLogo: false }))
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

onMounted(async () => { await load(); syncFromStore() })
</script>

<template>
  <section class="standard-business-view asset-settings-view">
    <header class="standard-page-header"><div><h1>{{ title }}</h1><p>{{ subtitle }}</p></div><div class="standard-header-actions"><el-button :icon="Refresh" @click="load(true)">刷新</el-button><el-button v-if="kind === 'locations' || kind === 'categories'" type="primary" :icon="Plus" @click="openCatalogDialog()">新增{{ kind === 'locations' ? '位置' : '分类' }}</el-button></div></header>

    <el-skeleton v-if="state.loading" :rows="8" animated />
    <div v-else-if="kind === 'locations' || kind === 'categories'" class="standard-catalog-layout">
      <div class="standard-catalog-tree"><el-tree :data="catalog" node-key="id" default-expand-all highlight-current :expand-on-click-node="false" @current-change="selectedNode = $event"><template #default="{ data }"><span class="standard-tree-node"><span>{{ data.name }}</span><small>{{ data.code || '' }}</small></span></template></el-tree></div>
      <div class="standard-catalog-detail">
        <template v-if="selectedNode"><div class="standard-section-title"><div><h2>{{ selectedNode.name }}</h2><p>{{ selectedNode.code || '未设置编码' }}</p></div><div><el-button :icon="Plus" @click="openCatalogDialog(selectedNode, true)">新增下级</el-button><el-button :icon="Edit" @click="openCatalogDialog(selectedNode)">编辑</el-button><el-button type="danger" plain :icon="Delete" @click="removeNode(selectedNode)">删除</el-button></div></div>
          <el-descriptions :column="2" border><el-descriptions-item label="名称">{{ selectedNode.name }}</el-descriptions-item><el-descriptions-item label="编码">{{ selectedNode.code || '-' }}</el-descriptions-item><el-descriptions-item v-if="kind === 'categories'" label="计量单位">{{ selectedNode.unit || '-' }}</el-descriptions-item><el-descriptions-item v-if="kind === 'categories'" label="使用年限">{{ selectedNode.usefulLife || '0' }}</el-descriptions-item><el-descriptions-item label="启用状态"><el-switch :model-value="selectedNode.enabled !== false" @change="toggleNode(selectedNode)" /></el-descriptions-item><el-descriptions-item label="下级节点">{{ selectedNode.children?.length || 0 }}</el-descriptions-item></el-descriptions>
        </template><el-empty v-else description="请选择左侧节点" />
      </div>
    </div>

    <el-form v-else-if="kind === 'code-rules'" label-position="top" class="standard-settings-form" @submit.prevent="saveRules">
      <div class="standard-section-title"><div><h2>自动编码</h2><p>编码由选定字段和流水号组成。</p></div><el-button type="primary" native-type="submit" :loading="saving">保存</el-button></div>
      <el-form-item label="编码字段"><el-checkbox-group v-model="codeRules.selectedFields"><el-checkbox value="categoryCode">资产分类编码</el-checkbox><el-checkbox value="purchaseDate">购置日期</el-checkbox><el-checkbox value="customText">自定义文本</el-checkbox></el-checkbox-group></el-form-item>
      <el-form-item label="流水号位数"><el-input-number v-model="codeRules.serialLength" :min="3" :max="12" /></el-form-item>
      <el-form-item label="自定义文本"><el-input v-model="(codeRules.customTexts as Record<string, string>).customText" maxlength="20" /></el-form-item>
      <el-form-item label="编码预览"><div class="standard-code-preview">01-20260717-00001</div></el-form-item>
    </el-form>

    <el-form v-else label-position="top" class="standard-settings-form" @submit.prevent="saveLabel">
      <div class="standard-section-title"><div><h2>标签版式</h2><p>设置标签尺寸、打印布局和显示字段。</p></div><el-button type="primary" native-type="submit" :loading="saving">保存</el-button></div>
      <div class="standard-form-grid"><el-form-item label="标签宽度（mm）"><el-input-number v-model="labelSettings.labelWidth" :min="20" :max="200" /></el-form-item><el-form-item label="标签高度（mm）"><el-input-number v-model="labelSettings.labelHeight" :min="15" :max="120" /></el-form-item><el-form-item label="列数"><el-input-number v-model="labelSettings.columns" :min="1" :max="6" /></el-form-item><el-form-item label="行数"><el-input-number v-model="labelSettings.rows" :min="1" :max="10" /></el-form-item><el-form-item label="字体大小"><el-input-number v-model="labelSettings.fontSize" :min="8" :max="28" /></el-form-item><el-form-item label="显示 Logo"><el-switch v-model="labelSettings.showLogo" /></el-form-item></div>
      <el-form-item label="显示字段"><el-checkbox-group v-model="labelSettings.fields"><el-checkbox value="name">资产名称</el-checkbox><el-checkbox value="id">资产编码</el-checkbox><el-checkbox value="category">资产分类</el-checkbox><el-checkbox value="owner">使用人</el-checkbox><el-checkbox value="location">所在位置</el-checkbox><el-checkbox value="sn">序列号</el-checkbox></el-checkbox-group></el-form-item>
      <div class="standard-label-preview"><strong>{{ labelSettings.showLogo ? 'AM · ' : '' }}资产名称</strong><span>ASSET-00001</span><small>资产分类 · 所在位置</small><div class="standard-qr-placeholder">QR</div></div>
    </el-form>

    <el-dialog v-model="catalogDialog" :title="editNodeId ? '编辑节点' : '新增节点'" width="min(520px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="名称" required><el-input v-model="catalogForm.name" /></el-form-item><el-form-item label="编码"><el-input v-model="catalogForm.code" /></el-form-item><el-form-item v-if="kind === 'categories'" label="计量单位"><el-input v-model="catalogForm.unit" /></el-form-item><el-form-item v-if="kind === 'categories'" label="使用年限"><el-input v-model="catalogForm.usefulLife" /></el-form-item><el-form-item label="启用"><el-switch v-model="catalogForm.enabled" /></el-form-item></el-form><template #footer><el-button @click="catalogDialog = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveCatalogNode">保存</el-button></template></el-dialog>
  </section>
</template>
