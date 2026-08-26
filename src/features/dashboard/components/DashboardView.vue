<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { PictureFilled } from '@element-plus/icons-vue'
import { usePortalSession } from '../../../core/auth/portal-session'
import { useTerminalMode } from '../../../core/auth/terminal-mode'
import { useDashboard } from '../composables/useDashboard'
import { displayAssetCode, isClaimedAssetStatus, type AssetRecord } from '../../assets/types/assets'
import AssetRequestDialog from '../../approvals/components/AssetRequestDialog.vue'
import EmployeeAssetDetailDrawer from './EmployeeAssetDetailDrawer.vue'

type DistributionMode = 'organization' | 'location'
type CategoryMetricMode = 'count' | 'amount'
type ChartRow = { key: string; label: string; title: string; count: number; amount: number }
type DashboardTooltip = {
  visible: boolean
  compact: boolean
  left: number
  top: number
  title: string
  metric: string
  value: string
  color: string
}

const { state, assets, disposedCount, requests, load } = useDashboard()
const { user } = usePortalSession()
const { isEmployeeTerminal } = useTerminalMode()
const distributionMode = ref<DistributionMode>('organization')
const categoryMetricMode = ref<CategoryMetricMode>('count')
const statusScope = ref('')
const requestOpen = ref(false)
const requestType = ref('资产退还')
const requestAssetId = ref('')
const employeeAssetDetail = ref<AssetRecord | null>(null)
const dashboardTooltip = reactive<DashboardTooltip>({
  visible: false,
  compact: false,
  left: 0,
  top: 0,
  title: '',
  metric: '数量',
  value: '0',
  color: '#1fa4e5'
})

const positionDashboardTooltip = (event: MouseEvent): void => {
  const tooltipWidth = 220
  const tooltipHeight = 72
  dashboardTooltip.left = event.clientX + tooltipWidth + 24 > window.innerWidth
    ? Math.max(12, event.clientX - tooltipWidth - 12)
    : event.clientX + 12
  dashboardTooltip.top = event.clientY + tooltipHeight + 24 > window.innerHeight
    ? Math.max(12, event.clientY - tooltipHeight - 12)
    : event.clientY + 12
}
const showDashboardTooltip = (
  event: MouseEvent,
  title: string,
  metric: string,
  value: string,
  color = '#1fa4e5',
  compact = false
): void => {
  dashboardTooltip.title = title
  dashboardTooltip.metric = metric
  dashboardTooltip.value = value
  dashboardTooltip.color = color
  dashboardTooltip.compact = compact
  dashboardTooltip.visible = true
  positionDashboardTooltip(event)
}
const hideDashboardTooltip = (): void => { dashboardTooltip.visible = false }

const totalValue = computed(() => assets.value.reduce((sum, item) => sum + Number(item.price || 0), 0))
const activeCount = computed(() => assets.value.filter((item) => isClaimedAssetStatus(item.status)).length)
const pendingCount = computed(() => requests.value.filter((item) => ['审批中', '待审批', '待执行'].includes(item.status)).length)
const employeeAssets = computed(() => {
  const assigned = assets.value.filter((item) => ['领用', '领用中', '借用', '借用中'].includes(item.status))
  return assigned.filter((item) => item.owner === user.value?.name || item.ownerSubject === user.value?.externalSubject)
})
const failedAssetImages = ref(new Set<string>())
const hasAssetImage = (item: AssetRecord): boolean => Boolean(item.image) && !failedAssetImages.value.has(item.id)
const markAssetImageFailed = (item: AssetRecord): void => {
  failedAssetImages.value = new Set([...failedAssetImages.value, item.id])
}
const assetAssignmentLabel = (item: AssetRecord): string => ['借用', '借用中'].includes(item.status) ? '借用' : '领用'
const assetAssignmentDateLabel = (item: AssetRecord): string => ['借用', '借用中'].includes(item.status) ? '借用日期' : '领用日期'
const approvedRequestForAsset = (item: AssetRecord) => requests.value.find((request) =>
  ['已同意', '已完成'].includes(String(request.status || ''))
  && Array.isArray(request.assetIds)
  && request.assetIds.some((assetId) => String(assetId) === item.id)
)
const assetAssignmentDate = (item: AssetRecord): string => ['借用', '借用中'].includes(item.status)
  ? String(item.borrowDate || approvedRequestForAsset(item)?.borrowDate || item.receiveDate || '-')
  : String(item.receiveDate || approvedRequestForAsset(item)?.receiveDate || item.borrowDate || '-')
const assetCustodian = (item: AssetRecord): string => {
  const custodian = String(item.custodian || '').trim()
  return custodian && custodian !== '-' ? custodian : String(approvedRequestForAsset(item)?.decisionOperator || '-')
}
const assetModelLabel = (item: AssetRecord): string => [item.brand, item.model].filter(Boolean).join(' ') || '-'
const openEmployeeRequest = (action: 'return' | 'handover', item: AssetRecord): void => {
  employeeAssetDetail.value = null
  requestType.value = action === 'handover' ? '资产交接' : ['借用', '借用中'].includes(item.status) ? '资产归还' : '资产退还'
  requestAssetId.value = item.id
  requestOpen.value = true
}

const statusRows = computed(() => {
  const definitions = [
    { status: '领用', key: 'receive', label: '领用', color: '#7c5cf6' },
    { status: '交接审批中', key: 'handover-approval', label: '交接审批中', color: '#a21caf' },
    { status: '交接待签字', key: 'handover-signature', label: '交接待签字', color: '#b91c1c' },
    { status: '退库审批中', key: 'return-approval', label: '退库审批中', color: '#b45309' },
    { status: '空闲', key: 'idle', label: '空闲', color: '#20a7dc' },
    { status: '借用', key: 'borrow', label: '借用', color: '#f59e0b' },
    { status: '维修中', key: 'repair', label: '维修中', color: '#e1a235' },
    { status: '调拨中', key: 'transfer', label: '调拨中', color: '#2e9f99' },
    { status: '流程中', key: 'workflow', label: '流程中', color: '#6f7d8c' },
    { status: '状态待确认', key: 'unconfirmed', label: '状态待确认', color: '#a66a3f' },
    { status: '处置中', key: 'disposing', label: '处置中', color: '#df7b45' },
    { status: '已处置', key: 'disposed', label: '已处置', color: '#f45f63' },
    { status: '已报废', key: 'scrapped', label: '已报废', color: '#8d99ae' }
  ]
  const knownStatuses = new Set(definitions.map((item) => item.status))
  const extraDefinitions = Array.from(new Set(assets.value.map((item) => item.status).filter((status) => !knownStatuses.has(status))))
    .map((status, index) => ({ status, key: `other-${index}`, label: status || '未标注', color: '#6f7d8c' }))
  return [...definitions, ...extraDefinitions].map((definition) => ({
    ...definition,
    count: definition.status === '已处置'
      ? disposedCount.value
      : assets.value.filter((item) => item.status === definition.status).length
  })).filter((item) => item.count > 0)
})

const statusTotal = computed(() => statusRows.value.reduce((sum, row) => sum + row.count, 0))

const statusSegments = computed(() => {
  const circumference = 213.6
  let offset = 0
  return statusRows.value.map((row) => {
    const dash = statusTotal.value ? row.count / statusTotal.value * circumference : 0
    const segment = { ...row, dash, offset: -offset, percent: statusTotal.value ? Math.round(row.count / statusTotal.value * 100) : 0 }
    offset += dash
    return segment
  })
})

const groupAssets = (rows: AssetRecord[], keyFor: (item: AssetRecord) => string): ChartRow[] => {
  const grouped = new Map<string, ChartRow>()
  rows.forEach((item) => {
    const key = keyFor(item) || '未设置'
    const current = grouped.get(key) || { key, label: key, title: key, count: 0, amount: 0 }
    current.count += 1
    current.amount += Number(item.price || 0)
    grouped.set(key, current)
  })
  return Array.from(grouped.values()).sort((left, right) => right.count - left.count).slice(0, 8)
}

const distributionRows = computed<ChartRow[]>(() => {
  const rows = distributionMode.value === 'location'
    ? groupAssets(assets.value, (item) => String(item.location || '未设置位置').split(' / ')[0])
    : groupAssets(assets.value, (item) => String(item.ownerCompany || item.company || '默认公司'))
  return rows.length ? rows : [{ key: 'empty', label: distributionMode.value === 'location' ? '暂无位置' : '默认公司', title: distributionMode.value === 'location' ? '暂无位置' : '默认公司', count: 0, amount: 0 }]
})

const categoryRowsFor = (rows: AssetRecord[]): ChartRow[] => {
  const result = groupAssets(rows, (item) => String(item.category || item.type || '其他'))
  return result.length ? result : [{ key: 'empty', label: '暂无分类', title: '暂无分类', count: 0, amount: 0 }]
}
const activeAssetRows = computed(() => categoryRowsFor(assets.value.filter((item) => isClaimedAssetStatus(item.status))))
const categoryRows = computed(() => categoryRowsFor(assets.value))

const chartScale = (maximum: number): { max: number; ticks: number[] } => {
  const max = Math.max(1, Math.ceil(maximum || 0))
  const rawStep = Math.max(1, max / 5)
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const step = Math.max(1, (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude)
  const scaledMax = Math.ceil(max / step) * step
  return { max: scaledMax, ticks: Array.from({ length: Math.floor(scaledMax / step) + 1 }, (_, index) => scaledMax - index * step) }
}
const distributionScale = computed(() => chartScale(Math.max(...distributionRows.value.map((item) => item.count), 0)))
const activeScale = computed(() => chartScale(Math.max(...activeAssetRows.value.map((item) => item.count), 0)))
const categoryScale = computed(() => chartScale(Math.max(...categoryRows.value.map((item) => categoryMetricMode.value === 'amount' ? item.amount : item.count), 0)))
const columns = (rows: ChartRow[]): string => `repeat(${rows.length}, minmax(0, 1fr))`
const barHeight = (value: number, max: number): string => `${max ? Math.max(value / max * 100, value ? 6 : 0).toFixed(2) : 0}%`
const metricLabel = (value: number, mode: CategoryMetricMode = 'count'): string => mode === 'amount' && value >= 10000 ? `${Math.round(value / 10000).toLocaleString('zh-CN')}万` : Math.round(value).toLocaleString('zh-CN')
const exactMetricLabel = (value: number, mode: CategoryMetricMode = 'count'): string => mode === 'amount'
  ? `¥${Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
  : Math.round(value).toLocaleString('zh-CN')
</script>

<template>
  <el-alert v-if="state.errorMessage" :title="state.errorMessage" type="error" show-icon :closable="false" />
  <template v-if="isEmployeeTerminal">
    <section class="hero employee-home-hero"><h1>你好，{{ user?.name }}</h1></section>
    <section v-loading="state.loading" class="device-overview-section">
      <div class="device-overview-heading">
        <div><h2 class="panel-title">我的设备概览</h2><div class="panel-subtitle">查看当前领用或借用的设备信息。</div></div>
        <span v-if="employeeAssets.length" class="device-overview-count">共 {{ employeeAssets.length }} 台</span>
      </div>
      <div v-if="employeeAssets.length" class="device-card-grid">
        <article v-for="item in employeeAssets" :key="item.id" class="device-card">
          <div class="device-card-content">
            <div class="device-card-image">
              <img v-if="hasAssetImage(item)" :src="item.image" :alt="item.name" @error="markAssetImageFailed(item)">
              <div v-else class="device-card-image-empty"><el-icon><PictureFilled /></el-icon><span>暂无图片</span></div>
            </div>
            <div class="device-card-details">
              <div class="device-card-title-row">
                <h3 :title="item.name">{{ item.name }}</h3>
                <span class="device-card-status" :class="{ borrowed: ['借用', '借用中'].includes(item.status) }">{{ assetAssignmentLabel(item) }}</span>
              </div>
              <dl class="device-card-fields">
                <div><dt>资产编码</dt><dd><button class="device-card-code" type="button" :title="`查看资产 ${displayAssetCode(item)} 详情`" :aria-label="`查看资产 ${displayAssetCode(item)} 详情`" @click="employeeAssetDetail = item">{{ displayAssetCode(item) }}</button></dd></div>
                <div><dt>品牌/型号</dt><dd :title="assetModelLabel(item)">{{ assetModelLabel(item) }}</dd></div>
                <div><dt>管理员</dt><dd :title="assetCustodian(item)">{{ assetCustodian(item) }}</dd></div>
                <div><dt>{{ assetAssignmentDateLabel(item) }}</dt><dd :title="assetAssignmentDate(item)">{{ assetAssignmentDate(item) }}</dd></div>
              </dl>
            </div>
          </div>
          <div class="device-card-actions">
            <button type="button" @click="openEmployeeRequest('return', item)">退还</button>
            <button type="button" @click="openEmployeeRequest('handover', item)">交接</button>
          </div>
        </article>
      </div>
      <div v-else class="device-overview-empty"><el-icon><PictureFilled /></el-icon><strong>暂无设备</strong><span>当前还没有分配到你的设备。</span></div>
    </section>
  </template>
  <template v-else>
  <section v-loading="state.loading" class="grid stats-grid">
    <article class="stat-card" data-watermark="ZC"><div class="stat-top"><span>资产总数</span><span class="tag blue">当前范围</span></div><div class="stat-value">{{ assets.length }}</div><div class="stat-note">账号范围内全部资产</div></article>
    <article class="stat-card" data-watermark="ZY"><div class="stat-top"><span>领用资产</span><span class="tag green">领用</span></div><div class="stat-value">{{ activeCount }}</div><div class="stat-note">已分配给员工或部门</div></article>
    <article class="stat-card" data-watermark="OA"><div class="stat-top"><span>待处理单据</span><span v-if="pendingCount > 0" class="tag amber">审批中</span></div><div class="stat-value">{{ pendingCount }}</div><div class="stat-note">资产动作等待审批或执行</div></article>
    <article class="stat-card" data-watermark="¥"><div class="stat-top"><span>资产原值</span><span class="tag blue">当前范围</span></div><div class="stat-value">¥{{ totalValue.toLocaleString('zh-CN') }}</div><div class="stat-note">后续可接折旧与成本中心</div></article>
  </section>

  <section class="grid content-grid session-only">
    <article class="panel dashboard-panel">
      <div class="panel-header"><div><h2 class="panel-title">仪表盘</h2><div class="panel-subtitle">查看当前账号范围内的核心资产数量。</div></div></div>
      <div class="dashboard-charts">
        <article class="dashboard-chart-card dashboard-status-card">
          <div class="dashboard-card-head"><h3>资产状态占比</h3><div class="dashboard-card-filters"><el-select v-model="statusScope" aria-label="资产状态范围" placeholder="全部"><el-option label="全部" value="" /></el-select><el-select model-value="" aria-label="所属或承租公司" placeholder="所属/承租公司" disabled><el-option label="所属/承租公司" value="" /></el-select></div></div>
          <div class="donut-layout">
            <div class="dashboard-donut">
              <svg class="donut-svg" viewBox="0 0 100 100" aria-hidden="true"><circle class="donut-ring donut-ring-base" cx="50" cy="50" r="34" /><circle v-for="segment in statusSegments.filter((item) => item.count > 0)" :key="segment.key" class="donut-ring donut-ring-segment" :class="`donut-ring-${segment.key}`" cx="50" cy="50" r="34" :style="{ '--segment-color': segment.color, '--segment-dash': segment.dash, '--segment-offset': segment.offset }" @mouseenter="showDashboardTooltip($event, segment.label, '', `${segment.count}(${segment.percent}%)`, segment.color, true)" @mousemove="positionDashboardTooltip" @mouseleave="hideDashboardTooltip" /></svg>
              <div><span>全部</span><strong>{{ statusTotal }}</strong></div>
            </div>
            <div class="chart-legend"><div v-for="segment in statusSegments" :key="segment.key"><i class="legend-dot" :style="{ '--legend-color': segment.color }"></i><span>{{ segment.label }}</span><strong>{{ segment.count }}</strong><em>{{ segment.percent }}%</em></div></div>
          </div>
        </article>

        <article class="dashboard-chart-card asset-distribution-card">
          <div class="dashboard-card-head"><h3>资产分布情况</h3></div>
          <div class="asset-distribution-chart">
            <div class="asset-distribution-body" :style="{ '--tick-intervals': Math.max(distributionScale.ticks.length - 1, 1) }"><div class="asset-distribution-axis" aria-hidden="true"><span v-for="tick in distributionScale.ticks" :key="tick">{{ tick.toLocaleString('zh-CN') }}</span></div><div class="asset-distribution-plot" :style="{ '--distribution-columns': columns(distributionRows), '--tick-intervals': Math.max(distributionScale.ticks.length - 1, 1) }"><div class="asset-distribution-plot-inner"><div class="asset-distribution-grid" aria-hidden="true"><span v-for="index in Math.max(distributionScale.ticks.length - 1, 1)" :key="index"></span></div><div class="asset-distribution-bars"><div v-for="item in distributionRows" :key="item.key" class="asset-distribution-bar" :style="{ '--bar-height': barHeight(item.count, distributionScale.max) }"><strong v-if="item.count">{{ item.count.toLocaleString('zh-CN') }}</strong><span @mouseenter="showDashboardTooltip($event, item.title, '资产分布情况', exactMetricLabel(item.count))" @mousemove="positionDashboardTooltip" @mouseleave="hideDashboardTooltip"></span></div></div><div class="asset-distribution-labels"><span v-for="item in distributionRows" :key="item.key" :title="item.title">{{ item.label }}</span></div></div></div></div>
            <div class="asset-distribution-tabs"><button :class="{ active: distributionMode === 'organization' }" type="button" :aria-pressed="distributionMode === 'organization'" @click="distributionMode = 'organization'">组织架构</button><button :class="{ active: distributionMode === 'location' }" type="button" :aria-pressed="distributionMode === 'location'" @click="distributionMode = 'location'">所在位置</button></div>
          </div>
        </article>

        <article class="dashboard-chart-card active-asset-stat-card">
          <div class="dashboard-card-head"><h3>领用资产统计</h3></div>
          <div class="asset-distribution-chart active-asset-stat-chart"><div class="asset-distribution-body" :style="{ '--tick-intervals': Math.max(activeScale.ticks.length - 1, 1) }"><div class="asset-distribution-axis" aria-hidden="true"><span v-for="tick in activeScale.ticks" :key="tick">{{ tick.toLocaleString('zh-CN') }}</span></div><div class="asset-distribution-plot" :style="{ '--distribution-columns': columns(activeAssetRows), '--tick-intervals': Math.max(activeScale.ticks.length - 1, 1) }"><div class="asset-distribution-plot-inner"><div class="asset-distribution-grid" aria-hidden="true"><span v-for="index in Math.max(activeScale.ticks.length - 1, 1)" :key="index"></span></div><div class="asset-distribution-bars"><div v-for="item in activeAssetRows" :key="item.key" class="asset-distribution-bar" :style="{ '--bar-height': barHeight(item.count, activeScale.max) }"><strong v-if="item.count">{{ item.count.toLocaleString('zh-CN') }}</strong><span @mouseenter="showDashboardTooltip($event, item.title, '领用资产统计', exactMetricLabel(item.count))" @mousemove="positionDashboardTooltip" @mouseleave="hideDashboardTooltip"></span></div></div><div class="asset-distribution-labels"><span v-for="item in activeAssetRows" :key="item.key" :title="item.title">{{ item.label }}</span></div></div></div></div></div>
        </article>

        <article class="dashboard-chart-card asset-category-stat-card">
          <div class="dashboard-card-head"><h3>资产分类统计</h3></div>
          <div class="asset-distribution-chart asset-category-stat-chart"><div class="asset-distribution-body" :style="{ '--tick-intervals': Math.max(categoryScale.ticks.length - 1, 1) }"><div class="asset-distribution-axis" aria-hidden="true"><span v-for="tick in categoryScale.ticks" :key="tick">{{ metricLabel(tick, categoryMetricMode) }}</span></div><div class="asset-distribution-plot" :style="{ '--distribution-columns': columns(categoryRows), '--tick-intervals': Math.max(categoryScale.ticks.length - 1, 1) }"><div class="asset-distribution-plot-inner"><div class="asset-distribution-grid" aria-hidden="true"><span v-for="index in Math.max(categoryScale.ticks.length - 1, 1)" :key="index"></span></div><div class="asset-distribution-bars"><div v-for="item in categoryRows" :key="item.key" class="asset-distribution-bar" :style="{ '--bar-height': barHeight(categoryMetricMode === 'amount' ? item.amount : item.count, categoryScale.max) }"><strong v-if="item.count || item.amount">{{ metricLabel(categoryMetricMode === 'amount' ? item.amount : item.count, categoryMetricMode) }}</strong><span @mouseenter="showDashboardTooltip($event, item.title, '资产分类统计', exactMetricLabel(categoryMetricMode === 'amount' ? item.amount : item.count, categoryMetricMode))" @mousemove="positionDashboardTooltip" @mouseleave="hideDashboardTooltip"></span></div></div><div class="asset-distribution-labels"><span v-for="item in categoryRows" :key="item.key" :title="item.title">{{ item.label }}</span></div></div></div></div><div class="asset-distribution-tabs asset-category-stat-tabs"><button :class="{ active: categoryMetricMode === 'count' }" type="button" :aria-pressed="categoryMetricMode === 'count'" @click="categoryMetricMode = 'count'">数量</button><button :class="{ active: categoryMetricMode === 'amount' }" type="button" :aria-pressed="categoryMetricMode === 'amount'" @click="categoryMetricMode = 'amount'">金额</button></div></div>
        </article>
      </div>
    </article>
  </section>
  <Teleport to="body">
    <div
      v-show="dashboardTooltip.visible"
      class="dashboard-bar-tooltip show"
      :class="{ compact: dashboardTooltip.compact }"
      data-testid="dashboard-chart-tooltip"
      :style="{ left: `${dashboardTooltip.left}px`, top: `${dashboardTooltip.top}px` }"
      role="status"
    >
      <span v-if="dashboardTooltip.compact" class="dashboard-bar-tooltip-compact-text">{{ dashboardTooltip.title }}：{{ dashboardTooltip.value }}</span>
      <template v-else>
        <strong>{{ dashboardTooltip.title }}</strong>
        <div class="dashboard-bar-tooltip-detail">
          <i :style="{ background: dashboardTooltip.color }"></i>
          <span>{{ dashboardTooltip.metric }}：{{ dashboardTooltip.value }}</span>
        </div>
      </template>
    </div>
  </Teleport>
  </template>
  <EmployeeAssetDetailDrawer
    :asset="employeeAssetDetail"
    :assignment-date="employeeAssetDetail ? assetAssignmentDate(employeeAssetDetail) : '-'"
    :assignment-date-label="employeeAssetDetail ? assetAssignmentDateLabel(employeeAssetDetail) : '领用日期'"
    :assignment-label="employeeAssetDetail ? assetAssignmentLabel(employeeAssetDetail) : '领用'"
    :custodian="employeeAssetDetail ? assetCustodian(employeeAssetDetail) : '-'"
    @close="employeeAssetDetail = null"
    @request="openEmployeeRequest"
  />
  <AssetRequestDialog v-model="requestOpen" :type="requestType" :preselected-asset-id="requestAssetId" @submitted="load" />
</template>
