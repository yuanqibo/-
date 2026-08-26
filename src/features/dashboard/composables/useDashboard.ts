import { computed, onMounted, reactive, readonly } from 'vue'
import { fetchDashboardData } from '../api/dashboard.api'
import { isClaimedAssetStatus, type AssetRecord } from '../../assets/types/assets'
import type { ApprovalRecord } from '../../approvals/types/approval'
import type { DashboardMetric } from '../types/dashboard'

const state = reactive({ assets: [] as AssetRecord[], disposedCount: 0, requests: [] as ApprovalRecord[], loading: false, errorMessage: '' })

const load = async (): Promise<void> => {
  state.loading = true
  state.errorMessage = ''
  try {
    const payload = await fetchDashboardData()
    state.assets = payload.assets
    state.disposedCount = payload.disposedCount
    state.requests = payload.requests as ApprovalRecord[]
  } catch (error) {
    state.errorMessage = error instanceof Error ? error.message : '首页数据加载失败'
  } finally {
    state.loading = false
  }
}

export const useDashboard = () => {
  const metrics = computed<DashboardMetric[]>(() => {
    const totalValue = state.assets.reduce((sum, item) => sum + Number(item.price || 0), 0)
    return [
      { label: '资产总数', value: String(state.assets.length), note: '当前账号范围内全部资产', tone: 'blue' },
      { label: '领用资产', value: String(state.assets.filter((item) => isClaimedAssetStatus(item.status)).length), note: '已分配给员工或部门', tone: 'green' },
      { label: '待处理单据', value: String(state.requests.filter((item) => ['审批中', '待审批', '待执行'].includes(item.status)).length), note: '等待审批或业务执行', tone: 'amber' },
      { label: '资产原值', value: `¥${totalValue.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`, note: '当前范围资产购置金额', tone: 'red' }
    ]
  })
  onMounted(() => void load())
  return {
    state: readonly(state),
    assets: computed(() => state.assets),
    disposedCount: computed(() => state.disposedCount),
    requests: computed(() => state.requests),
    metrics,
    load
  }
}
