import { computed, onMounted, reactive, readonly } from 'vue'
import { fetchDashboardData } from '../api/dashboard.api'
import type { AssetRecord } from '../../assets/types/assets'
import type { ApprovalRecord } from '../../approvals/types/approval'
import type { DashboardMetric } from '../types/dashboard'

const state = reactive({ assets: [] as AssetRecord[], requests: [] as ApprovalRecord[], loading: false, errorMessage: '' })

const load = async (): Promise<void> => {
  state.loading = true
  state.errorMessage = ''
  try {
    const payload = await fetchDashboardData()
    state.assets = payload.assets
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
      { label: '在用资产', value: String(state.assets.filter((item) => item.status === '在用').length), note: '已分配给员工或部门', tone: 'green' },
      { label: '待处理单据', value: String(state.requests.filter((item) => !['已完成', '已拒绝', '已取消'].includes(item.status)).length), note: '等待审批或业务执行', tone: 'amber' },
      { label: '资产原值', value: `¥${totalValue.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`, note: '当前范围资产购置金额', tone: 'red' }
    ]
  })
  onMounted(() => void load())
  return { state: readonly(state), assets: computed(() => state.assets), requests: computed(() => state.requests), metrics, load }
}
