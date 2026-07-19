<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDashboard } from '../composables/useDashboard'
import type { AssetRecord } from '../../assets/types/assets'

type DistributionMode = 'organization' | 'location'
type CategoryMetricMode = 'count' | 'amount'
type ChartRow = { key: string; label: string; title: string; count: number; amount: number }

const { state, assets, requests } = useDashboard()
const distributionMode = ref<DistributionMode>('organization')
const categoryMetricMode = ref<CategoryMetricMode>('count')

const totalValue = computed(() => assets.value.reduce((sum, item) => sum + Number(item.price || 0), 0))
const activeCount = computed(() => assets.value.filter((item) => item.status === '在用').length)
const pendingCount = computed(() => requests.value.filter((item) => item.status !== '已完成').length)

const statusRows = computed(() => {
  const receiveCount = assets.value.filter((item) => item.status === '在用').length
  const borrowCount = assets.value.filter((item) => item.status === '借用中').length
  const disposedCount = assets.value.filter((item) => ['报废', '已处置'].includes(item.status)).length
  const idleCount = Math.max(assets.value.length - receiveCount - borrowCount - disposedCount, 0)
  return [
    { key: 'receive', label: '领用', count: receiveCount, color: '#7c5cf6' },
    { key: 'idle', label: '空闲', count: idleCount, color: '#20a7dc' },
    { key: 'disposed', label: '已处置', count: disposedCount, color: '#f45f63' },
    { key: 'borrow', label: '借用', count: borrowCount, color: '#f59e0b' }
  ]
})

const statusSegments = computed(() => {
  const circumference = 213.6
  let offset = 0
  return statusRows.value.map((row) => {
    const dash = assets.value.length ? row.count / assets.value.length * circumference : 0
    const segment = { ...row, dash, offset: -offset, percent: assets.value.length ? Math.round(row.count / assets.value.length * 100) : 0 }
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
const activeAssetRows = computed(() => categoryRowsFor(assets.value.filter((item) => item.status === '在用')))
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
</script>

<template>
  <el-alert v-if="state.errorMessage" :title="state.errorMessage" type="error" show-icon :closable="false" />
  <section v-loading="state.loading" class="grid stats-grid">
    <article class="stat-card" data-watermark="ZC"><div class="stat-top"><span>资产总数</span><span class="tag blue">当前范围</span></div><div class="stat-value">{{ assets.length }}</div><div class="stat-note">账号范围内全部资产</div></article>
    <article class="stat-card" data-watermark="ZY"><div class="stat-top"><span>在用资产</span><span class="tag green">在用</span></div><div class="stat-value">{{ activeCount }}</div><div class="stat-note">已分配给员工或部门</div></article>
    <article class="stat-card" data-watermark="OA"><div class="stat-top"><span>待处理单据</span><span class="tag amber">审批中</span></div><div class="stat-value">{{ pendingCount }}</div><div class="stat-note">资产动作等待审批或执行</div></article>
    <article class="stat-card" data-watermark="¥"><div class="stat-top"><span>资产原值</span><span class="tag blue">当前范围</span></div><div class="stat-value">¥{{ totalValue.toLocaleString('zh-CN') }}</div><div class="stat-note">后续可接折旧与成本中心</div></article>
  </section>

  <section class="grid content-grid session-only">
    <article class="panel dashboard-panel">
      <div class="panel-header"><div><h2 class="panel-title">仪表盘</h2><div class="panel-subtitle">查看当前账号范围内的核心资产数量。</div></div></div>
      <div class="dashboard-charts">
        <article class="dashboard-chart-card dashboard-status-card">
          <div class="dashboard-card-head"><h3>资产状态占比</h3><div class="dashboard-card-filters"><select aria-label="资产状态范围"><option>全部</option></select><select aria-label="所属或承租公司" disabled><option>所属/承租公司</option></select></div></div>
          <div class="donut-layout">
            <div class="dashboard-donut">
              <svg class="donut-svg" viewBox="0 0 100 100" aria-hidden="true"><circle class="donut-ring donut-ring-base" cx="50" cy="50" r="34" /><circle v-for="segment in statusSegments.filter((item) => item.count > 0)" :key="segment.key" class="donut-ring donut-ring-segment" :class="`donut-ring-${segment.key}`" cx="50" cy="50" r="34" :style="{ '--segment-color': segment.color, '--segment-dash': segment.dash, '--segment-offset': segment.offset }" /></svg>
              <div><span>全部</span><strong>{{ assets.length }}</strong></div>
            </div>
            <div class="chart-legend"><div v-for="segment in statusSegments" :key="segment.key"><i class="legend-dot" :style="{ '--legend-color': segment.color }"></i><span>{{ segment.label }}</span><strong>{{ segment.count }}</strong><em>{{ segment.percent }}%</em></div></div>
          </div>
        </article>

        <article class="dashboard-chart-card asset-distribution-card">
          <div class="dashboard-card-head"><h3>资产分布情况</h3></div>
          <div class="asset-distribution-chart">
            <div class="asset-distribution-body" :style="{ '--tick-intervals': Math.max(distributionScale.ticks.length - 1, 1) }"><div class="asset-distribution-axis" aria-hidden="true"><span v-for="tick in distributionScale.ticks" :key="tick">{{ tick.toLocaleString('zh-CN') }}</span></div><div class="asset-distribution-plot" :style="{ '--distribution-columns': columns(distributionRows), '--tick-intervals': Math.max(distributionScale.ticks.length - 1, 1) }"><div class="asset-distribution-plot-inner"><div class="asset-distribution-grid" aria-hidden="true"><span v-for="index in Math.max(distributionScale.ticks.length - 1, 1)" :key="index"></span></div><div class="asset-distribution-bars"><div v-for="item in distributionRows" :key="item.key" class="asset-distribution-bar" :title="`${item.title}，资产分布情况：${item.count}`"><strong v-if="item.count">{{ item.count.toLocaleString('zh-CN') }}</strong><span :style="{ '--bar-height': barHeight(item.count, distributionScale.max) }"></span></div></div><div class="asset-distribution-labels"><span v-for="item in distributionRows" :key="item.key" :title="item.title">{{ item.label }}</span></div></div></div></div>
            <div class="asset-distribution-tabs"><button :class="{ active: distributionMode === 'organization' }" type="button" :aria-pressed="distributionMode === 'organization'" @click="distributionMode = 'organization'">组织架构</button><button :class="{ active: distributionMode === 'location' }" type="button" :aria-pressed="distributionMode === 'location'" @click="distributionMode = 'location'">所在位置</button></div>
          </div>
        </article>

        <article class="dashboard-chart-card active-asset-stat-card">
          <div class="dashboard-card-head"><h3>在用资产统计</h3></div>
          <div class="asset-distribution-chart active-asset-stat-chart"><div class="asset-distribution-body" :style="{ '--tick-intervals': Math.max(activeScale.ticks.length - 1, 1) }"><div class="asset-distribution-axis" aria-hidden="true"><span v-for="tick in activeScale.ticks" :key="tick">{{ tick.toLocaleString('zh-CN') }}</span></div><div class="asset-distribution-plot" :style="{ '--distribution-columns': columns(activeAssetRows), '--tick-intervals': Math.max(activeScale.ticks.length - 1, 1) }"><div class="asset-distribution-plot-inner"><div class="asset-distribution-grid" aria-hidden="true"><span v-for="index in Math.max(activeScale.ticks.length - 1, 1)" :key="index"></span></div><div class="asset-distribution-bars"><div v-for="item in activeAssetRows" :key="item.key" class="asset-distribution-bar" :title="`${item.title}，在用资产统计：${item.count}`"><strong v-if="item.count">{{ item.count.toLocaleString('zh-CN') }}</strong><span :style="{ '--bar-height': barHeight(item.count, activeScale.max) }"></span></div></div><div class="asset-distribution-labels"><span v-for="item in activeAssetRows" :key="item.key" :title="item.title">{{ item.label }}</span></div></div></div></div></div>
        </article>

        <article class="dashboard-chart-card asset-category-stat-card">
          <div class="dashboard-card-head"><h3>资产分类统计</h3></div>
          <div class="asset-distribution-chart asset-category-stat-chart"><div class="asset-distribution-body" :style="{ '--tick-intervals': Math.max(categoryScale.ticks.length - 1, 1) }"><div class="asset-distribution-axis" aria-hidden="true"><span v-for="tick in categoryScale.ticks" :key="tick">{{ metricLabel(tick, categoryMetricMode) }}</span></div><div class="asset-distribution-plot" :style="{ '--distribution-columns': columns(categoryRows), '--tick-intervals': Math.max(categoryScale.ticks.length - 1, 1) }"><div class="asset-distribution-plot-inner"><div class="asset-distribution-grid" aria-hidden="true"><span v-for="index in Math.max(categoryScale.ticks.length - 1, 1)" :key="index"></span></div><div class="asset-distribution-bars"><div v-for="item in categoryRows" :key="item.key" class="asset-distribution-bar" :title="`${item.title}，资产分类统计：${metricLabel(categoryMetricMode === 'amount' ? item.amount : item.count, categoryMetricMode)}`"><strong v-if="item.count || item.amount">{{ metricLabel(categoryMetricMode === 'amount' ? item.amount : item.count, categoryMetricMode) }}</strong><span :style="{ '--bar-height': barHeight(categoryMetricMode === 'amount' ? item.amount : item.count, categoryScale.max) }"></span></div></div><div class="asset-distribution-labels"><span v-for="item in categoryRows" :key="item.key" :title="item.title">{{ item.label }}</span></div></div></div></div><div class="asset-distribution-tabs asset-category-stat-tabs"><button :class="{ active: categoryMetricMode === 'count' }" type="button" :aria-pressed="categoryMetricMode === 'count'" @click="categoryMetricMode = 'count'">数量</button><button :class="{ active: categoryMetricMode === 'amount' }" type="button" :aria-pressed="categoryMetricMode === 'amount'" @click="categoryMetricMode = 'amount'">金额</button></div></div>
        </article>
      </div>
    </article>
  </section>
</template>
