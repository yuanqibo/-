<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleCheck, Close, Delete, Search, Upload } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePortalSession } from '../../../core/auth/portal-session'
import { useAssets } from '../../assets/composables/useAssets'
import type { AssetRecord } from '../../assets/types/assets'
import { useDisposals } from '../composables/useDisposals'
import type { DisposalDraft } from '../types/disposal'

const disposalTypes = ['退租', '报废', '捐赠', '其他']
const route = useRoute()
const router = useRouter()
const { user } = usePortalSession()
const { assets, load: loadAssets } = useAssets()
const { items, loading, errorMessage, load, create, complete, cancel } = useDisposals()
const query = ref('')
const createOpen = ref(false)
const assetPickerOpen = ref(false)
const detailId = ref('')
const submitting = ref(false)
const selectedAssetIds = ref<string[]>([])
const selectedAssetRowIds = ref<string[]>([])
const disposalImportInput = ref<HTMLInputElement>()
const pickerAssetIds = ref<string[]>([])
const pickerQuery = ref('')
const cancelAssetIds = ref<string[]>([])
const cancelReason = ref('')
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
const can = (permission: string): boolean => permissions.value.has(permission)

type DisposalColumn = { key: string; label: string; width: number; defaultWidth: number; minWidth: number }
type CancellableDisposal = {
  readonly id: string
  readonly assets: readonly { readonly assetId: string; readonly status: string }[]
}
const disposalColumns = reactive<DisposalColumn[]>([
  { key: 'status', label: '处置单状态', width: 112, defaultWidth: 112, minWidth: 72 },
  { key: 'id', label: '处置单号', width: 190, defaultWidth: 190, minWidth: 96 },
  { key: 'type', label: '处置类型', width: 112, defaultWidth: 112, minWidth: 68 },
  { key: 'company', label: '所属/承租公司', width: 170, defaultWidth: 170, minWidth: 88 },
  { key: 'operator', label: '经办人', width: 120, defaultWidth: 120, minWidth: 68 },
  { key: 'assets', label: '资产数', width: 90, defaultWidth: 90, minWidth: 56 },
  { key: 'amount', label: '处置金额', width: 120, defaultWidth: 120, minWidth: 72 },
  { key: 'fee', label: '处置费用', width: 120, defaultWidth: 120, minWidth: 72 },
  { key: 'createdAt', label: '创建时间', width: 170, defaultWidth: 170, minWidth: 100 },
  { key: 'completedAt', label: '完成时间', width: 170, defaultWidth: 170, minWidth: 100 },
  { key: 'actions', label: '操作', width: 190, defaultWidth: 190, minWidth: 126 }
])
const disposalTableWidth = computed(() => disposalColumns.reduce((total, column) => total + column.width, 0))
let columnResizeCleanup: (() => void) | null = null

const stopColumnResize = (): void => {
  columnResizeCleanup?.()
  columnResizeCleanup = null
}
const startColumnResize = (event: PointerEvent, column: DisposalColumn): void => {
  stopColumnResize()
  const startX = event.clientX
  const startWidth = column.width
  const handleMove = (moveEvent: PointerEvent): void => {
    column.width = Math.max(column.minWidth, Math.round(startWidth + moveEvent.clientX - startX))
  }
  const handleEnd = (): void => stopColumnResize()
  window.addEventListener('pointermove', handleMove)
  window.addEventListener('pointerup', handleEnd, { once: true })
  window.addEventListener('pointercancel', handleEnd, { once: true })
  columnResizeCleanup = () => {
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleEnd)
    window.removeEventListener('pointercancel', handleEnd)
  }
}
const resizeColumnByKeyboard = (event: KeyboardEvent, column: DisposalColumn): void => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'Home') { column.width = column.minWidth; return }
  if (event.key === 'End') { column.width = column.defaultWidth; return }
  const delta = event.key === 'ArrowRight' ? 12 : -12
  column.width = Math.max(column.minWidth, column.width + delta)
}

const today = (): string => new Date().toISOString().slice(0, 10)
const form = reactive<DisposalDraft>({
  disposalType: '', company: '', operator: '', amount: undefined, fee: undefined,
  description: '', returnDate: today(), assetIds: []
})

const availableAssets = computed(() => assets.value.filter((asset) => asset.status === '空闲'))
const selectedAssets = computed(() => availableAssets.value.filter((asset) => selectedAssetIds.value.includes(asset.id)))
const pickerAssets = computed(() => {
  const keyword = pickerQuery.value.trim().toLowerCase()
  if (!keyword) return availableAssets.value
  return availableAssets.value.filter((asset) => [asset.id, asset.name, asset.category, asset.brand, asset.model, asset.sn, asset.supplier, asset.location]
    .some((value) => String(value || '').toLowerCase().includes(keyword)))
})
const filteredRows = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return items.value.filter((item) => !keyword || [item.id, item.status, item.disposalType, item.company, item.operator, item.description]
    .some((value) => String(value || '').toLowerCase().includes(keyword)))
})
const detailCurrent = computed(() => items.value.find((item) => item.id === detailId.value) || null)
const cancellableLines = computed(() => detailCurrent.value?.assets.filter((line) => line.status !== '已取消') || [])
const allPickerAssetsSelected = computed(() => pickerAssets.value.length > 0
  && pickerAssets.value.every((asset) => pickerAssetIds.value.includes(asset.id)))
const allSelectedRowsMarked = computed(() => selectedAssets.value.length > 0
  && selectedAssets.value.every((asset) => selectedAssetRowIds.value.includes(asset.id)))

const statusClass = (status: string): string => ({
  待处置: 'pending', 已处置: 'done', 已取消: 'cancelled', 部分取消: 'partial'
}[status] || 'neutral')
const canComplete = (item: { readonly assets: readonly { readonly status: string }[] }): boolean =>
  item.assets.some((line) => line.status === '待处置')
const canCancel = (item: { readonly assets: readonly { readonly status: string }[] }): boolean =>
  item.assets.some((line) => line.status !== '已取消')
const money = (value?: number | null): string => `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
const timestamp = (value?: string): string => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'

const openCreate = (presetIds: string[] = []): void => {
  Object.assign(form, {
    disposalType: '', company: user.value?.company || '', operator: user.value?.name || '',
    amount: undefined, fee: undefined, description: '', returnDate: today(), assetIds: []
  })
  selectedAssetIds.value = presetIds.filter((id) => availableAssets.value.some((asset) => asset.id === id))
  selectedAssetRowIds.value = []
  createOpen.value = true
}

const openAssetPicker = (): void => {
  pickerAssetIds.value = [...selectedAssetIds.value]
  pickerQuery.value = ''
  assetPickerOpen.value = true
}
const togglePickerAsset = (asset: AssetRecord, checked: boolean): void => {
  pickerAssetIds.value = checked
    ? [...new Set([...pickerAssetIds.value, asset.id])]
    : pickerAssetIds.value.filter((id) => id !== asset.id)
}
const toggleAllPickerAssets = (checked: boolean): void => {
  const visibleIds = new Set(pickerAssets.value.map((asset) => asset.id))
  pickerAssetIds.value = checked
    ? [...new Set([...pickerAssetIds.value, ...visibleIds])]
    : pickerAssetIds.value.filter((id) => !visibleIds.has(id))
}
const confirmAssetPicker = (): void => {
  selectedAssetIds.value = [...pickerAssetIds.value]
  selectedAssetRowIds.value = selectedAssetRowIds.value.filter((id) => selectedAssetIds.value.includes(id))
  assetPickerOpen.value = false
}
const toggleSelectedAssetRow = (assetId: string, checked: boolean): void => {
  selectedAssetRowIds.value = checked
    ? [...new Set([...selectedAssetRowIds.value, assetId])]
    : selectedAssetRowIds.value.filter((id) => id !== assetId)
}
const toggleAllSelectedAssetRows = (checked: boolean): void => {
  selectedAssetRowIds.value = checked ? selectedAssets.value.map((asset) => asset.id) : []
}
const removeSelectedAssets = (): void => {
  const removed = new Set(selectedAssetRowIds.value)
  selectedAssetIds.value = selectedAssetIds.value.filter((id) => !removed.has(id))
  selectedAssetRowIds.value = []
}

const importDisposalAssets = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  try {
    const text = (await file.text()).replace(/^\uFEFF/, '')
    const headerNames = new Set(['资产编码', 'assetid', 'assetcode', 'id'])
    const requestedIds = [...new Set(text
      .split(/[\s,;，；]+/)
      .map((value) => value.trim())
      .filter((value) => value && !headerNames.has(value.toLowerCase())))]
    const availableIds = new Set(availableAssets.value.map((asset) => asset.id))
    const matchedIds = requestedIds.filter((id) => availableIds.has(id))
    const unmatchedCount = requestedIds.length - matchedIds.length

    if (!matchedIds.length) {
      ElMessage.warning(requestedIds.length ? '未匹配到可处置的空闲资产' : '导入文件中没有资产编码')
      return
    }

    const previousIds = new Set(selectedAssetIds.value)
    selectedAssetIds.value = [...new Set([...selectedAssetIds.value, ...matchedIds])]
    const addedCount = matchedIds.filter((id) => !previousIds.has(id)).length
    const message = unmatchedCount
      ? `已导入 ${addedCount} 项资产，${unmatchedCount} 个编码未匹配`
      : `已导入 ${addedCount} 项资产`
    ElMessage.success(message)
  } catch {
    ElMessage.error('资产编码文件读取失败')
  } finally {
    input.value = ''
  }
}

const submitCreate = async (): Promise<void> => {
  if (!form.disposalType || !form.company.trim() || !form.description.trim() || !selectedAssetIds.value.length) {
    ElMessage.warning('请填写必填信息并至少选择一项空闲资产')
    return
  }
  submitting.value = true
  try {
    const created = await create({
      ...form,
      returnDate: form.disposalType === '退租' ? form.returnDate : '',
      assetIds: [...selectedAssetIds.value]
    })
    createOpen.value = false
    detailId.value = created.id
    await loadAssets(true)
    ElMessage.success('处置单已提交')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '处置单提交失败')
  } finally { submitting.value = false }
}

const completeOrder = async (item: { readonly id: string; readonly assets: readonly { readonly status: string }[] }): Promise<void> => {
  try {
    await ElMessageBox.confirm(`确认 ${item.assets.filter((line) => line.status === '待处置').length} 项资产已处理完成？`, '完成处置', {
      type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消'
    })
    submitting.value = true
    await complete(item.id)
    await loadAssets(true)
    detailId.value = item.id
    ElMessage.success('处置单已完成')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '完成处置失败')
  } finally { submitting.value = false }
}

const openDetail = (item: { readonly id: string }): void => {
  detailId.value = item.id
  cancelAssetIds.value = []
  cancelReason.value = ''
}

const performCancellation = async (item: CancellableDisposal, ids: string[], reason = '', keepDetail = false): Promise<void> => {
  if (!ids.length) { ElMessage.warning('没有可取消的资产'); return }
  const cancellableCount = item.assets.filter((line) => line.status !== '已取消').length
  const entireOrder = ids.length === cancellableCount
  try {
    await ElMessageBox.confirm(`将取消 ${ids.length} 项资产的处置并恢复原状态，是否继续？`, '取消处置', {
      type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消'
    })
    submitting.value = true
    await cancel(item.id, ids, reason)
    await loadAssets(true)
    if (keepDetail) detailId.value = item.id
    cancelAssetIds.value = []
    cancelReason.value = ''
    ElMessage.success(entireOrder ? '整单处置已取消' : '所选资产已取消处置')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(error instanceof Error ? error.message : '取消处置失败')
  } finally { submitting.value = false }
}

const cancelSelected = async (): Promise<void> => {
  const item = detailCurrent.value
  if (!item) return
  const ids = cancelAssetIds.value.length ? cancelAssetIds.value : cancellableLines.value.map((line) => line.assetId)
  await performCancellation(item, ids, cancelReason.value, true)
}

const cancelOrder = async (item: CancellableDisposal): Promise<void> => {
  await performCancellation(item, item.assets.filter((line) => line.status !== '已取消').map((line) => line.assetId))
}

const exportRows = (): void => {
  const header = ['处置单号', '状态', '处置类型', '所属/承租公司', '经办人', '资产数', '处置金额', '处置费用', '创建时间', '完成时间']
  const csvCell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`
  const body = filteredRows.value.map((item) => [item.id, item.status, item.disposalType, item.company, item.operator,
    item.assetCount, item.amount, item.fee, timestamp(item.createdAt), timestamp(item.completedAt)].map(csvCell).join(','))
  const blob = new Blob([`\uFEFF${header.map(csvCell).join(',')}\n${body.join('\n')}`], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `资产处置_${today()}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}

const handleToolbarCommand = (command: string): void => {
  if (command === 'export') exportRows()
  else window.print()
}

const initialize = async (): Promise<void> => {
  try {
    await Promise.all([load(), loadAssets()])
    const preset = String(route.query.assetIds || '').split(',').map((id) => id.trim()).filter(Boolean)
    if (preset.length && can('asset:disposal:create')) {
      await nextTick()
      openCreate(preset)
      void router.replace({ path: route.path })
    }
  } catch { /* Error states are rendered in-page. */ }
}

onMounted(() => void initialize())
onBeforeUnmount(stopColumnResize)
</script>

<template>
  <section class="asset-disposal-view">
    <div class="disposal-toolbar">
      <div class="disposal-actions">
        <button v-if="can('asset:disposal:create')" class="table-action primary" type="button" @click="openCreate()">＋ 新增</button>
        <el-dropdown trigger="click" @command="handleToolbarCommand">
          <button class="table-action has-caret" type="button">打印<span class="action-caret" aria-hidden="true"></span></button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="print">打印当前列表</el-dropdown-item>
              <el-dropdown-item v-if="can('asset:disposal:export')" command="export">导出当前列表</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <div class="disposal-filters">
        <el-input v-model="query" clearable placeholder="模糊查询" aria-label="模糊查询处置单">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
      </div>
    </div>

    <el-alert v-if="errorMessage" type="error" :title="errorMessage" :closable="false" show-icon />
    <div v-loading="loading" class="disposal-table-shell">
      <div class="disposal-table-scroll">
        <table class="disposal-table" :style="{ width: `${disposalTableWidth}px`, minWidth: `${disposalTableWidth}px` }">
          <colgroup><col v-for="column in disposalColumns" :key="column.key" :style="{ width: `${column.width}px` }"></colgroup>
          <thead><tr><th v-for="column in disposalColumns" :key="column.key"><span>{{ column.label }}</span><button class="disposal-column-resizer" type="button" role="separator" :aria-label="`调整${column.label}列宽`" aria-orientation="vertical" :aria-valuemin="column.minWidth" :aria-valuenow="column.width" @pointerdown.stop.prevent="startColumnResize($event, column)" @keydown="resizeColumnByKeyboard($event, column)" @dblclick.stop="column.width = column.defaultWidth"></button></th></tr></thead>
          <tbody>
            <tr v-for="item in filteredRows" :key="item.id">
              <td><span class="disposal-status" :class="statusClass(item.status)">{{ item.status }}</span></td>
              <td><button class="disposal-link" type="button" @click="openDetail(item)">{{ item.id }}</button></td>
              <td>{{ item.disposalType }}</td><td>{{ item.company || '-' }}</td><td>{{ item.operator || '-' }}</td><td>{{ item.assetCount }}</td>
              <td>{{ money(item.amount) }}</td><td>{{ money(item.fee) }}</td><td>{{ timestamp(item.createdAt) }}</td><td>{{ timestamp(item.completedAt) }}</td>
              <td class="disposal-row-actions">
                <el-button v-if="canCancel(item) && can('asset:disposal:cancel')" link type="primary" @click="cancelOrder(item)">取消处置</el-button>
                <el-button v-if="canComplete(item) && can('asset:disposal:complete')" link type="primary" @click="completeOrder(item)">完成处置</el-button>
              </td>
            </tr>
            <tr v-if="!filteredRows.length"><td colspan="11"><el-empty description="暂无符合条件的处置单" :image-size="64" /></td></tr>
          </tbody>
        </table>
      </div>
      <div class="disposal-table-footer">共 {{ filteredRows.length }} 条处置单</div>
    </div>

    <el-drawer v-model="createOpen" title="新增处置单" size="min(1180px, 92vw)" class="disposal-create-drawer" append-to-body destroy-on-close>
      <el-form label-position="left" label-width="126px" class="disposal-create-form" @submit.prevent="submitCreate">
        <el-form-item label="处置类型" required><el-select v-model="form.disposalType" placeholder="请选择"><el-option v-for="option in disposalTypes" :key="option" :label="option" :value="option" /></el-select></el-form-item>
        <el-form-item label="经办人" required><el-input v-model="form.operator" disabled /></el-form-item>
        <el-form-item label="所属/承租公司" required><el-input v-model="form.company" maxlength="128" /></el-form-item>
        <el-form-item label="处置金额"><el-input-number v-model="form.amount" aria-label="处置金额" :min="0" :precision="2" :controls="false" placeholder="请输入" /></el-form-item>
        <el-form-item label="处置费用"><el-input-number v-model="form.fee" aria-label="处置费用" :min="0" :precision="2" :controls="false" placeholder="请输入" /></el-form-item>
        <el-form-item v-if="form.disposalType === '退租'" label="退租日期" required><el-date-picker v-model="form.returnDate" value-format="YYYY-MM-DD" /></el-form-item>
        <el-form-item class="disposal-form-wide disposal-description-field" label="处置说明" required><el-input v-model="form.description" type="textarea" :rows="3" maxlength="4000" show-word-limit placeholder="记录处置原因、设备处理方式或交接要求" /></el-form-item>
      </el-form>

      <section class="disposal-assets-section">
        <div class="disposal-section-tab">资产详情</div>
        <div class="disposal-assets-toolbar">
          <div class="disposal-asset-actions">
            <button class="table-action primary" type="button" @click="openAssetPicker">选择资产</button>
            <button class="table-action" type="button" :disabled="!selectedAssetRowIds.length" @click="removeSelectedAssets"><el-icon><Delete /></el-icon>删除资产</button>
            <button class="table-action" type="button" @click="disposalImportInput?.click()"><el-icon><Upload /></el-icon>导入资产</button>
            <input ref="disposalImportInput" class="disposal-import-input" type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="导入资产编码文件" @change="importDisposalAssets">
          </div>
          <span>仅可添加空闲资产，已加入 {{ selectedAssetIds.length }} 项</span>
        </div>
        <div class="disposal-picker-table selected-assets-table">
          <table><thead><tr><th class="check-cell"><input type="checkbox" :checked="allSelectedRowsMarked" aria-label="全选已加入资产" @change="toggleAllSelectedAssetRows(($event.target as HTMLInputElement).checked)"></th><th>资产编码</th><th>资产分类</th><th>资产名称</th><th>品牌 / 型号</th><th>设备序列号</th><th>供应商</th><th>所在位置</th></tr></thead>
            <tbody><tr v-for="asset in selectedAssets" :key="asset.id"><td class="check-cell"><input type="checkbox" :checked="selectedAssetRowIds.includes(asset.id)" :aria-label="`选择移除${asset.id}`" @change="toggleSelectedAssetRow(asset.id, ($event.target as HTMLInputElement).checked)"></td><td>{{ asset.id }}</td><td>{{ asset.category }}</td><td>{{ asset.name }}</td><td>{{ [asset.brand, asset.model].filter(Boolean).join(' / ') || '-' }}</td><td>{{ asset.sn || '-' }}</td><td>{{ asset.supplier || '-' }}</td><td>{{ asset.location || '-' }}</td></tr><tr v-if="!selectedAssets.length"><td colspan="8"><el-empty description="尚未选择资产" :image-size="56" /></td></tr></tbody>
          </table>
        </div>
      </section>
      <template #footer><div class="disposal-create-footer"><button class="table-action" type="button" @click="createOpen = false">关闭</button><button class="table-action primary" type="button" :disabled="submitting" @click="submitCreate">{{ submitting ? '提交中...' : '保存并提交' }}</button></div></template>
    </el-drawer>

    <el-dialog v-model="assetPickerOpen" title="选择处置资产" width="min(1040px, 94vw)" class="disposal-asset-picker-dialog" append-to-body destroy-on-close>
      <div class="disposal-asset-picker-toolbar"><div><strong>空闲资产</strong><span>搜索并勾选需要加入处置单的资产</span></div><el-input v-model="pickerQuery" clearable class="disposal-asset-picker-search" placeholder="搜索编码、名称、分类、品牌或供应商" aria-label="搜索可选资产"><template #prefix><el-icon><Search /></el-icon></template></el-input></div>
      <div class="disposal-picker-table disposal-asset-picker-table">
        <table><thead><tr><th class="check-cell"><input type="checkbox" :checked="allPickerAssetsSelected" aria-label="全选当前资产" @change="toggleAllPickerAssets(($event.target as HTMLInputElement).checked)"></th><th>资产编码</th><th>资产分类</th><th>资产名称</th><th>品牌 / 型号</th><th>设备序列号</th><th>供应商</th><th>所在位置</th></tr></thead>
          <tbody><tr v-for="asset in pickerAssets" :key="asset.id" :class="{ selected: pickerAssetIds.includes(asset.id) }"><td class="check-cell"><input type="checkbox" :checked="pickerAssetIds.includes(asset.id)" :aria-label="`选择资产${asset.id}`" @change="togglePickerAsset(asset, ($event.target as HTMLInputElement).checked)"></td><td>{{ asset.id }}</td><td>{{ asset.category }}</td><td>{{ asset.name }}</td><td>{{ [asset.brand, asset.model].filter(Boolean).join(' / ') || '-' }}</td><td>{{ asset.sn || '-' }}</td><td>{{ asset.supplier || '-' }}</td><td>{{ asset.location || '-' }}</td></tr><tr v-if="!pickerAssets.length"><td colspan="8"><el-empty description="没有符合条件的空闲资产" :image-size="64" /></td></tr></tbody>
        </table>
      </div>
      <template #footer><div class="disposal-asset-picker-footer"><span>已选择 {{ pickerAssetIds.length }} 项</span><div><el-button @click="assetPickerOpen = false">取消</el-button><el-button type="primary" @click="confirmAssetPicker">确认选择</el-button></div></div></template>
    </el-dialog>

    <el-drawer :model-value="Boolean(detailCurrent)" size="min(900px, 94vw)" class="disposal-detail-drawer" aria-label="处置单详情" append-to-body @close="detailId = ''">
      <template #header><div class="disposal-detail-title"><h2>处置单详情</h2></div></template>
      <template v-if="detailCurrent">
        <div class="disposal-detail-form">
          <div class="disposal-readonly-field"><span>处置单号</span><strong>{{ detailCurrent.id }}</strong></div>
          <div class="disposal-readonly-field"><span>处置状态</span><strong>{{ detailCurrent.status }}</strong></div>
          <div class="disposal-readonly-field"><span>处置类型</span><strong>{{ detailCurrent.disposalType }}</strong></div>
          <div class="disposal-readonly-field"><span>经办人</span><strong>{{ detailCurrent.operator || '-' }}</strong></div>
          <div class="disposal-readonly-field"><span>所属/承租公司</span><strong>{{ detailCurrent.company || '-' }}</strong></div>
          <div class="disposal-readonly-field"><span>创建日期</span><strong>{{ timestamp(detailCurrent.createdAt) }}</strong></div>
          <div class="disposal-readonly-field"><span>完成日期</span><strong>{{ timestamp(detailCurrent.completedAt) }}</strong></div>
          <div class="disposal-readonly-field"><span>处置金额</span><strong>{{ money(detailCurrent.amount) }}</strong></div>
          <div class="disposal-readonly-field"><span>处置费用</span><strong>{{ money(detailCurrent.fee) }}</strong></div>
          <div v-if="detailCurrent.disposalType === '退租'" class="disposal-readonly-field"><span>退租日期</span><strong>{{ detailCurrent.returnDate || '-' }}</strong></div>
          <div class="disposal-readonly-field disposal-detail-description"><span>处置说明</span><strong>{{ detailCurrent.description || '-' }}</strong></div>
        </div>
        <div class="disposal-section-tab disposal-detail-tab">资产详情</div>
        <div class="disposal-detail-assets-heading"><div><h3>资产明细</h3><span>共 {{ detailCurrent.assets.length }} 项</span></div><el-input v-if="can('asset:disposal:cancel') && cancellableLines.length" v-model="cancelReason" class="cancel-reason" clearable placeholder="取消原因（选填）" /></div>
        <div class="disposal-picker-table detail-table"><table><thead><tr><th v-if="can('asset:disposal:cancel')" class="check-cell"></th><th>处置状态</th><th>资产编码</th><th>资产名称</th><th>分类</th><th>品牌 / 型号</th><th>序列号</th><th>供应商</th><th>位置</th></tr></thead><tbody><tr v-for="line in detailCurrent.assets" :key="line.assetId"><td v-if="can('asset:disposal:cancel')" class="check-cell"><input v-if="line.status !== '已取消'" v-model="cancelAssetIds" type="checkbox" :value="line.assetId" :aria-label="`选择取消${line.assetId}`"></td><td><span class="line-status" :class="statusClass(line.status)">{{ line.status }}</span></td><td>{{ line.assetId }}</td><td>{{ line.name }}</td><td>{{ line.category }}</td><td>{{ [line.brand, line.model].filter(Boolean).join(' / ') || '-' }}</td><td>{{ line.sn || '-' }}</td><td>{{ line.supplier || '-' }}</td><td>{{ line.location || '-' }}</td></tr></tbody></table></div>
      </template>
      <template #footer><div class="disposal-drawer-footer"><el-button @click="detailId = ''">关闭</el-button><el-button v-if="detailCurrent && can('asset:disposal:cancel') && cancellableLines.length" type="danger" plain :icon="Close" :loading="submitting" @click="cancelSelected">{{ cancelAssetIds.length ? `取消所选（${cancelAssetIds.length}）` : '整单取消' }}</el-button><el-button v-if="detailCurrent && canComplete(detailCurrent) && can('asset:disposal:complete')" type="primary" :icon="CircleCheck" :loading="submitting" @click="completeOrder(detailCurrent)">完成处置</el-button></div></template>
    </el-drawer>
  </section>
</template>
