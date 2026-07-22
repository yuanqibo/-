<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Download, Refresh, RefreshLeft, Search, Switch as SwitchIcon, TakeawayBox, User } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import { usePortalSession } from '../../../core/auth/portal-session'
import { useTerminalMode } from '../../../core/auth/terminal-mode'
import { useAssets } from '../../assets/composables/useAssets'
import { useApprovals } from '../composables/useApprovals'
import type { ApprovalDecision, ApprovalRecord } from '../types/approval'
import AssetRequestDialog from './AssetRequestDialog.vue'

const { state, rows, load, decide } = useApprovals()
const { store, load: loadAssets } = useAssets()
const { user } = usePortalSession()
const { isEmployeeTerminal } = useTerminalMode()
const route = useRoute()
const query = ref('')
const tab = ref('全部')
const detail = ref<ApprovalRecord | null>(null)
const decisionOpen = ref(false)
const requestOpen = ref(false)
const submitting = ref(false)
const requestType = ref('资产领用')
const requestAssetId = ref('')
const decisionForm = reactive<{ decision: ApprovalDecision; reason: string }>({ decision: 'approve', reason: '' })
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
const canReview = computed(() => !isEmployeeTerminal.value && permissions.value.has('asset:request:review'))
const managerTabs = ['全部', '待处理', '已完成', '已拒绝']
const employeeTabs = ['全部', '待审批', '已同意', '已驳回']
const tabs = computed(() => canReview.value ? managerTabs : employeeTabs)
const pendingStatuses = new Set(['审批中', '待审批', '待执行'])
const approvedStatuses = new Set(['已完成', '已同意'])
const rejectedStatuses = new Set(['已拒绝', '已驳回'])
const employeeRequestActionDefinitions = [
  { label: '资产领用', type: '资产领用', tone: 'blue', settingKey: 'receiveAsset', icon: TakeawayBox },
  { label: '资产借用', type: '资产借用', tone: 'sky', settingKey: 'borrowAsset', icon: SwitchIcon },
  { label: '资产归还', type: '资产归还', tone: 'orange', settingKey: 'giveBackAsset', icon: Download },
  { label: '自助退还', type: '资产退还', tone: 'violet', settingKey: 'returnAsset', icon: RefreshLeft },
  { label: '自助交接', type: '资产交接', tone: 'green', settingKey: 'handoverAsset', icon: User }
]
const selfServiceSettings = computed(() => store.value.assetPortalSelfServiceSettingsV9 || {})
const employeeRequestActions = computed(() => employeeRequestActionDefinitions.filter((action) => {
  const setting = selfServiceSettings.value[action.settingKey]
  return Boolean(setting && typeof setting === 'object' && (setting as { enabled?: boolean }).enabled === true)
}))
const matchesTab = (item: ApprovalRecord, selected: string): boolean => {
  if (selected === '全部') return true
  if (selected === '待处理' || selected === '待审批') return pendingStatuses.has(item.status)
  if (selected === '已完成' || selected === '已同意') return approvedStatuses.has(item.status)
  if (selected === '已拒绝' || selected === '已驳回') return rejectedStatuses.has(item.status)
  return item.status === selected
}
const displayStatus = (status: string): string => {
  if (!canReview.value && pendingStatuses.has(status)) return '待审批'
  if (!canReview.value && approvedStatuses.has(status)) return '已同意'
  if (!canReview.value && rejectedStatuses.has(status)) return '已驳回'
  return status
}
const displayRequestType = (item: ApprovalRecord): string => {
  if (canReview.value) return item.type
  if (item.type === '资产退还') return '自助退还'
  if (item.type === '资产领用' && Boolean(item.selfServiceRequest)) return '自助领用'
  if (item.type === '资产借用' && Boolean(item.selfServiceRequest)) return '自助借用'
  if (item.type === '资产归还' && Boolean(item.selfServiceRequest)) return '自助归还'
  return item.type
}
const tabCount = (selected: string): number => selected === '全部' ? rows.value.length : rows.value.filter((item) => matchesTab(item, selected)).length
const filtered = computed(() => rows.value.filter((item) => {
  const keyword = query.value.trim().toLowerCase()
  return matchesTab(item, tab.value) && (!keyword || [item.id, item.type, item.applicant, item.asset, item.status].some((value) => String(value || '').toLowerCase().includes(keyword)))
}))
const statusType = (status: string): 'success' | 'warning' | 'danger' | 'info' => approvedStatuses.has(status) ? 'success' : pendingStatuses.has(status) ? 'warning' : rejectedStatuses.has(status) ? 'danger' : 'info'
const isDecisionSyncing = (item: ApprovalRecord): boolean => Boolean(item.decisionSubmitted) && pendingStatuses.has(item.status)
const approvalDetailFields = (item: ApprovalRecord): Array<[string, unknown]> => [
  ['申请类型', displayRequestType(item)],
  ...(item.approvalNo ? [['审批编号', item.approvalNo] as [string, unknown]] : []),
  ['申请人', item.applicant],
  ['申请物品', item.asset],
  ['审批系统', item.system],
  ['当前节点', item.currentNode],
  ['资产数量', item.assetCount || '-'],
  ['申请原因', item.reason || '-'],
  ['申请日期', item.date],
  ...(item.receiveType ? [['领用类型', item.receiveType] as [string, unknown]] : []),
  ...(item.receiveLocation ? [['领用后位置', item.receiveLocation] as [string, unknown]] : []),
  ...(item.receiveDate ? [['领用日期', item.receiveDate] as [string, unknown]] : []),
  ...(item.returnLocation ? [[item.type === '资产归还' ? '归还后位置' : '退库后位置', item.returnLocation] as [string, unknown]] : []),
  ...(item.returnDate ? [[item.type === '资产归还' ? '归还日期' : '退库日期', item.returnDate] as [string, unknown]] : []),
  ...(item.receiverName ? [['接收人', item.receiverName] as [string, unknown]] : []),
  ...(item.receiverCompany ? [['接收公司', item.receiverCompany] as [string, unknown]] : []),
  ...(item.receiverDepartment ? [['接收部门', item.receiverDepartment] as [string, unknown]] : []),
  ...(item.handoverLocation ? [['接收位置', item.handoverLocation] as [string, unknown]] : []),
  ...(item.handoverDate ? [['交接日期', item.handoverDate] as [string, unknown]] : []),
  ...(item.borrowLocation ? [['借用后位置', item.borrowLocation] as [string, unknown]] : []),
  ...(item.borrowDate ? [['借用日期', item.borrowDate] as [string, unknown]] : []),
  ...(item.expectedReturnDate ? [['预计归还日期', item.expectedReturnDate] as [string, unknown]] : [])
]
const openDecision = (item: ApprovalRecord, decision: ApprovalDecision): void => { detail.value = item; decisionForm.decision = decision; decisionForm.reason = ''; decisionOpen.value = true }
const submitDecision = async (): Promise<void> => {
  if (!detail.value) return
  submitting.value = true
  try { await decide(detail.value.id, decisionForm.decision, decisionForm.reason, user.value?.name || ''); decisionOpen.value = false; detail.value = null; ElMessage.success('审批已处理') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '审批处理失败') }
  finally { submitting.value = false }
}
const openRequest = (type = '资产领用'): void => {
  requestType.value = type
  requestAssetId.value = ''
  requestOpen.value = true
}
const onRequestSubmitted = (): void => {
  tab.value = '全部'
}
const openRequestFromRoute = (): void => {
  if (route.path !== '/requests' || !isEmployeeTerminal.value) return
  const action = typeof route.query.action === 'string' ? route.query.action : ''
  const type = action === 'return' ? '资产退还' : action === 'borrow-return' ? '资产归还' : action === 'handover' ? '资产交接' : ''
  if (!type) return
  requestType.value = type
  requestAssetId.value = typeof route.query.asset === 'string' ? route.query.asset : ''
  requestOpen.value = true
}
const focusManagerRequestFromRoute = (): void => {
  if (route.path !== '/requests' || !canReview.value) return
  const requestId = typeof route.query.request === 'string' ? route.query.request.trim() : ''
  if (!requestId) return
  tab.value = '全部'
  query.value = requestId
}
onMounted(() => {
  void load()
  if (isEmployeeTerminal.value) void loadAssets(true)
  openRequestFromRoute()
  focusManagerRequestFromRoute()
})
onActivated(() => {
  openRequestFromRoute()
  focusManagerRequestFromRoute()
  if (isEmployeeTerminal.value) void loadAssets(true)
})
watch(() => route.fullPath, () => {
  openRequestFromRoute()
  focusManagerRequestFromRoute()
})
watch(canReview, () => { tab.value = '全部' })
</script>

<template>
  <section class="approvals-view">
    <template v-if="canReview">
      <section class="approval-workspace">
        <nav class="approval-workspace-tabs" aria-label="审批状态筛选">
          <button
            v-for="item in tabs"
            :key="item"
            class="approval-workspace-tab"
            :class="{ active: tab === item }"
            :aria-current="tab === item ? 'page' : undefined"
            type="button"
            @click="tab = item"
          >
            {{ item }}
          </button>
        </nav>
        <div class="approval-workspace-toolbar">
          <div class="approval-toolbar-actions">
            <button class="btn" type="button" @click="load">
              <el-icon><Refresh /></el-icon>
              刷新
            </button>
          </div>
          <label class="approval-search">
            <input v-model="query" type="search" aria-label="搜索审批单据" placeholder="搜索申请编号、类型、申请人或资产">
            <span class="approval-search-icon" aria-hidden="true"><el-icon><Search /></el-icon></span>
          </label>
        </div>
        <div v-loading="state.loading" class="table-wrap approval-table-wrap">
          <table>
            <thead><tr><th>单据编号</th><th>类型</th><th>申请人</th><th>关联物品</th><th>原因</th><th>状态</th><th>当前节点</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="item in filtered" :key="item.id"><td>{{ item.id }}</td><td>{{ item.type }}</td><td>{{ item.applicant }}</td><td>{{ item.asset }}</td><td>{{ item.reason || '-' }}</td><td><span class="tag" :class="statusType(item.status) === 'success' ? 'green' : statusType(item.status) === 'danger' ? 'red' : 'amber'">{{ item.status }}</span></td><td>{{ item.currentNode || '-' }}</td><td><span v-if="isDecisionSyncing(item)" class="tag">同步中</span><template v-else-if="pendingStatuses.has(item.status)"><button class="btn primary" type="button" @click="openDecision(item, 'approve')">批准</button> <button class="btn" type="button" @click="openDecision(item, 'reject')">拒绝</button></template><button v-else class="btn" type="button" @click="detail = item">查看</button></td></tr>
              <tr v-if="!filtered.length" class="empty-row"><td colspan="8">暂无审批单据。</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
    <template v-else>
      <section class="employee-request-page"><section class="employee-request-head"><h1 class="employee-request-title">员工申请</h1><div v-if="employeeRequestActions.length" class="employee-request-actions-grid"><button v-for="action in employeeRequestActions" :key="action.type" class="employee-request-action" type="button" @click="openRequest(action.type)"><span class="employee-request-action-icon" :class="action.tone" aria-hidden="true"><component :is="action.icon" /></span><span class="employee-request-action-label">{{ action.label }}</span></button></div><div v-else class="employee-request-actions-empty">当前未开放自助申请</div></section><section class="employee-request-history"><div class="employee-request-list-head"><div class="employee-request-tabs" role="tablist"><button v-for="item in tabs" :key="item" :class="{ active: tab === item }" type="button" @click="tab = item">{{ item }} ({{ tabCount(item) }})</button></div><button class="employee-request-advanced" type="button">高级搜索</button></div><div class="employee-request-card-list"><article v-for="item in filtered" :key="item.id" class="employee-request-card"><div class="employee-request-card-main"><div class="employee-request-card-title"><span class="employee-request-status-pill" :class="statusType(item.status)">{{ displayStatus(item.status) }}</span><strong>{{ displayRequestType(item) }}</strong></div><div class="employee-request-card-fields"><div><span>单据编号</span><strong>{{ item.id }}</strong></div><div><span>发起时间</span><strong>{{ item.date || '-' }}</strong></div><div><span>审批时间</span><strong>{{ pendingStatuses.has(item.status) ? '-' : String(item.approvalDate || item.date || '-') }}</strong></div><div><span>资产数量</span><strong>{{ item.assetCount || (item.asset ? 1 : '-') }}</strong></div></div></div><button class="btn employee-request-detail" type="button" @click="detail = item">查看详情</button></article><div v-if="!filtered.length" class="employee-request-empty">当前分类下还没有可展示的申请。</div></div></section></section>
    </template>
    <el-alert v-if="state.errorMessage" type="error" :title="state.errorMessage" show-icon :closable="false" />

    <el-drawer :model-value="Boolean(detail) && !decisionOpen" size="min(560px, 94vw)" append-to-body @close="detail = null"><template #header><div><span class="eyebrow">审批轨迹</span><h2>{{ detail?.id }}</h2></div></template><template v-if="detail"><div class="detail-grid"><div v-for="field in approvalDetailFields(detail)" :key="String(field[0])" class="detail-item"><span class="detail-label">{{ field[0] }}</span><strong class="detail-value">{{ field[1] }}</strong></div><div class="detail-item"><span class="detail-label">状态</span><strong class="detail-value"><span class="tag" :class="statusType(detail.status) === 'success' ? 'green' : statusType(detail.status) === 'danger' ? 'red' : 'amber'">{{ displayStatus(detail.status) }}</span></strong></div></div><h3>审批状态</h3><div class="approval-flow"><div class="approval-step"><span class="step-dot done"></span><div><strong>资产系统创建单据</strong><div class="timeline-desc">生成业务单据并记录申请内容。</div></div></div><div class="approval-step"><span class="step-dot current"></span><div><strong>{{ detail.currentNode || displayStatus(detail.status) }}</strong><div class="timeline-desc">Java 后端校验权限、资产归属和状态后执行。</div></div></div><div class="approval-step"><span class="step-dot"></span><div><strong>资产动作归档</strong><div class="timeline-desc">审批通过后写入资产台账和操作记录。</div></div></div></div></template></el-drawer>
    <el-dialog v-model="decisionOpen" :title="decisionForm.decision === 'approve' ? '通过审批' : '拒绝审批'" width="min(520px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="处理意见"><el-input v-model="decisionForm.reason" type="textarea" :rows="4" maxlength="500" show-word-limit /></el-form-item></el-form><template #footer><el-button @click="decisionOpen = false">取消</el-button><el-button :type="decisionForm.decision === 'approve' ? 'primary' : 'danger'" :loading="submitting" @click="submitDecision">确认</el-button></template></el-dialog>
    <AssetRequestDialog v-model="requestOpen" :type="requestType" :preselected-asset-id="requestAssetId" @submitted="onRequestSubmitted" />
  </section>
</template>
