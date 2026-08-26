<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CircleCheck, Close, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { usePortalSession } from '../../../core/auth/portal-session'
import { useAssets } from '../../assets/composables/useAssets'
import { useDisposals } from '../composables/useDisposals'
import type { DisposalRecord } from '../types/disposal'
import AssetDisposalCreateDrawer from './AssetDisposalCreateDrawer.vue'
import { matchesPinyinSearch } from '../../../shared/search/pinyin-search'

const route = useRoute()
const router = useRouter()
const { user } = usePortalSession()
const { load: loadAssets } = useAssets()
const { items, loading, errorMessage, load, complete, cancel } = useDisposals()
const query = ref('')
const createOpen = ref(false)
const createPresetAssetIds = ref<string[]>([])
const detailId = ref('')
const submitting = ref(false)
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
const filteredRows = computed(() => {
  return items.value.filter((item) => matchesPinyinSearch(
    [item.id, item.status, item.disposalType, item.company, item.operator, item.description], query.value))
})
const detailCurrent = computed(() => items.value.find((item) => item.id === detailId.value) || null)
const cancellableLines = computed(() => detailCurrent.value?.assets.filter((line) => line.status !== '已取消') || [])

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
  createPresetAssetIds.value = [...presetIds]
  createOpen.value = true
}
const handleCreated = (created: DisposalRecord): void => { detailId.value = created.id }

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
        <div class="disposal-table-content" :style="{ width: `${disposalTableWidth}px`, minWidth: `${disposalTableWidth}px` }">
          <table class="disposal-table">
            <colgroup><col v-for="column in disposalColumns" :key="column.key" :style="{ width: `${column.width}px` }"></colgroup>
            <thead><tr><th v-for="column in disposalColumns" :key="column.key" :class="{ 'disposal-actions-header': column.key === 'actions' }"><span>{{ column.label }}</span><button class="disposal-column-resizer" type="button" role="separator" :aria-label="`调整${column.label}列宽`" aria-orientation="vertical" :aria-valuemin="column.minWidth" :aria-valuenow="column.width" @pointerdown.stop.prevent="startColumnResize($event, column)" @keydown="resizeColumnByKeyboard($event, column)" @dblclick.stop="column.width = column.defaultWidth"></button></th></tr></thead>
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
            </tbody>
          </table>
          <div v-if="!filteredRows.length" class="disposal-table-empty"><el-empty description="暂无符合条件的处置单" :image-size="64" /></div>
        </div>
      </div>
      <div class="disposal-table-footer">共 {{ filteredRows.length }} 条处置单</div>
    </div>

    <AssetDisposalCreateDrawer v-model="createOpen" :preset-asset-ids="createPresetAssetIds" @created="handleCreated" />

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
        <div class="disposal-picker-table detail-table"><table><thead><tr><th v-if="can('asset:disposal:cancel')" class="check-cell"></th><th>处置状态</th><th>资产编码</th><th>资产名称</th><th>分类</th><th>品牌 / 型号</th><th>序列号</th><th>供应商</th><th>位置</th></tr></thead><tbody><tr v-for="line in detailCurrent.assets" :key="line.assetId"><td v-if="can('asset:disposal:cancel')" class="check-cell"><input v-if="line.status !== '已取消'" v-model="cancelAssetIds" type="checkbox" :value="line.assetId" :aria-label="`选择取消${line.assetId}`"></td><td><span class="line-status" :class="statusClass(line.status)">{{ line.status }}</span></td><td><span class="asset-code-text">{{ line.assetId }}</span></td><td>{{ line.name }}</td><td>{{ line.category }}</td><td>{{ [line.brand, line.model].filter(Boolean).join(' / ') || '-' }}</td><td>{{ line.sn || '-' }}</td><td>{{ line.supplier || '-' }}</td><td>{{ line.location || '-' }}</td></tr></tbody></table></div>
      </template>
      <template #footer><div class="disposal-drawer-footer"><el-button @click="detailId = ''">关闭</el-button><el-button v-if="detailCurrent && can('asset:disposal:cancel') && cancellableLines.length" type="danger" plain :icon="Close" :loading="submitting" @click="cancelSelected">{{ cancelAssetIds.length ? `取消所选（${cancelAssetIds.length}）` : '整单取消' }}</el-button><el-button v-if="detailCurrent && canComplete(detailCurrent) && can('asset:disposal:complete')" type="primary" :icon="CircleCheck" :loading="submitting" @click="completeOrder(detailCurrent)">完成处置</el-button></div></template>
    </el-drawer>
  </section>
</template>
