<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { Download, Monitor, Refresh, RefreshLeft, Search, Switch as SwitchIcon, TakeawayBox, User } from '@element-plus/icons-vue'
import { useRoute } from 'vue-router'
import { usePortalSession } from '../../../core/auth/portal-session'
import { useTerminalMode } from '../../../core/auth/terminal-mode'
import { useAssets } from '../../assets/composables/useAssets'
import { displayAssetCode, type AssetRecord } from '../../assets/types/assets'
import { useApprovals } from '../composables/useApprovals'
import type { ApprovalDecision, ApprovalRecord } from '../types/approval'
import AssetRequestDialog from './AssetRequestDialog.vue'

const { state, rows, load, decide } = useApprovals()
const { assets, store, loadAssets, loadStore } = useAssets()
const { user } = usePortalSession()
const { isEmployeeTerminal } = useTerminalMode()
const route = useRoute()
const query = ref('')
const tab = ref('全部')
const employeeRequestPage = ref(1)
const employeeRequestPageSize = ref(10)
const employeeAdvancedOpen = ref(false)
const detail = ref<ApprovalRecord | null>(null)
const decisionOpen = ref(false)
const requestOpen = ref(false)
const submitting = ref(false)
const requestType = ref('资产领用')
const requestAssetId = ref('')
const decisionForm = reactive<{ decision: ApprovalDecision; reason: string }>({ decision: 'approve', reason: '' })
const employeeAdvancedDraft = reactive({ type: '', startDate: '', endDate: '' })
const employeeAdvancedApplied = reactive({ type: '', startDate: '', endDate: '' })
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
  { label: '自助交接', type: '资产交接', tone: 'green', settingKey: 'handoverAsset', icon: User },
  { label: '办公设备申领', type: '办公设备申领', tone: 'teal', settingKey: 'deviceRequest', icon: Monitor }
]
const selfServiceSettings = computed(() => store.value.assetPortalSelfServiceSettingsV9 || {})
const employeeRequestActions = computed(() => employeeRequestActionDefinitions.filter((action) => {
  const setting = selfServiceSettings.value[action.settingKey]
  return Boolean(setting && typeof setting === 'object' && (setting as { enabled?: boolean }).enabled === true)
}))
const employeeRequestTypeOptions = computed(() => Array.from(new Set([
  ...employeeRequestActions.value.map((action) => action.label),
  ...rows.value.map((item) => displayRequestType(item))
].filter(Boolean))))
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
const deviceItems = (item: ApprovalRecord): Array<Record<string, unknown>> => Array.isArray(item.deviceItems)
  ? item.deviceItems.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object')
  : []
const tabCount = (selected: string): number => selected === '全部' ? rows.value.length : rows.value.filter((item) => matchesTab(item, selected)).length
const filtered = computed(() => rows.value.filter((item) => {
  const keyword = query.value.trim().toLowerCase()
  const requestDate = String(item.date || '').slice(0, 10)
  const requestType = displayRequestType(item)
  const matchesAdvancedType = !employeeAdvancedApplied.type || requestType === employeeAdvancedApplied.type
  const matchesStartDate = !employeeAdvancedApplied.startDate || requestDate >= employeeAdvancedApplied.startDate
  const matchesEndDate = !employeeAdvancedApplied.endDate || requestDate <= employeeAdvancedApplied.endDate
  return matchesTab(item, tab.value)
    && matchesAdvancedType
    && matchesStartDate
    && matchesEndDate
    && (!keyword || [item.id, item.type, item.applicant, item.asset, item.status].some((value) => String(value || '').toLowerCase().includes(keyword)))
}))
const employeeRequestPageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / employeeRequestPageSize.value)))
const pagedEmployeeRequests = computed(() => {
  const start = (employeeRequestPage.value - 1) * employeeRequestPageSize.value
  return filtered.value.slice(start, start + employeeRequestPageSize.value)
})
const statusType = (status: string): 'success' | 'warning' | 'danger' | 'info' => approvedStatuses.has(status) ? 'success' : pendingStatuses.has(status) ? 'warning' : rejectedStatuses.has(status) ? 'danger' : 'info'
const isDecisionSyncing = (item: ApprovalRecord): boolean => Boolean(item.decisionSubmitted) && pendingStatuses.has(item.status)
type ApprovalAssetRow = Partial<AssetRecord> & { id: string; name: string }
const requestFieldConfig: Record<string, { dateLabel: string; dateKey: string; locationLabel: string; locationKey: string }> = {
  资产领用: { dateLabel: '领用日期', dateKey: 'receiveDate', locationLabel: '领用后位置', locationKey: 'receiveLocation' },
  资产借用: { dateLabel: '借用日期', dateKey: 'borrowDate', locationLabel: '借用后位置', locationKey: 'borrowLocation' },
  资产归还: { dateLabel: '归还日期', dateKey: 'returnDate', locationLabel: '归还后位置', locationKey: 'returnLocation' },
  资产退还: { dateLabel: '退库日期', dateKey: 'returnDate', locationLabel: '退库后位置', locationKey: 'returnLocation' },
  资产交接: { dateLabel: '交接日期', dateKey: 'handoverDate', locationLabel: '接收位置', locationKey: 'handoverLocation' }
}
const textValue = (value: unknown): string => String(value ?? '').trim() || '-'
const requestAssetIds = (item: ApprovalRecord): string[] => {
  const explicit = Array.isArray(item.assetIds) ? item.assetIds.map(String).filter(Boolean) : []
  if (explicit.length) return explicit
  const description = String(item.asset || '')
  return assets.value.filter((asset) => description.includes(displayAssetCode(asset)) || description.includes(asset.id) || description === asset.name).map((asset) => asset.id)
}
const approvalAssets = (item: ApprovalRecord): ApprovalAssetRow[] => {
  const byId = new Map(assets.value.map((asset) => [asset.id, asset]))
  const descriptions = String(item.asset || '').split('、').map((value) => value.trim())
  return requestAssetIds(item).map((id) => byId.get(id) || {
    id,
    name: descriptions.find((value) => value.startsWith(id))?.slice(id.length).trim() || '-'
  })
}
const detailAssets = computed(() => detail.value ? approvalAssets(detail.value) : [])
const approvalCompany = (item: ApprovalRecord): string => {
  const firstAsset = approvalAssets(item)[0]
  return textValue(item.company || item.applicantCompany || firstAsset?.ownerCompany || firstAsset?.company)
}
const approvalSummaryFields = (item: ApprovalRecord): Array<[string, unknown]> => {
  const config = requestFieldConfig[item.type]
  return [
    ['申请单号', item.id],
    ['申请状态', displayStatus(item.status)],
    ['申请类型', displayRequestType(item)],
    ['申请人', item.applicant],
    ['所属公司', approvalCompany(item)],
    ['所在部门', item.department || '-'],
    [config?.dateLabel || '申请时间', config ? item[config.dateKey] || item.date : item.date],
    [config?.locationLabel || '申请位置', config ? item[config.locationKey] : '-'],
    ['经办人', item.operator || item.decisionOperator || '-'],
    ['说明', item.reason || '-']
  ]
}
const approvalProcessFields = (item: ApprovalRecord): Array<[string, unknown]> => [
  ['审批编号', item.approvalNo || '-'],
  ['审批系统', item.system || '-'],
  ['当前节点', item.currentNode || '-'],
  ['处理人', item.decisionOperator || '-'],
  ['处理时间', item.approvalDate || item.decisionAt || item.approvalSyncedAt || '-'],
  ['处理意见', item.decisionReason || '-']
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
const openEmployeeAdvanced = (): void => {
  Object.assign(employeeAdvancedDraft, employeeAdvancedApplied)
  employeeAdvancedOpen.value = !employeeAdvancedOpen.value
}
const clearEmployeeAdvanced = (): void => {
  Object.assign(employeeAdvancedDraft, { type: '', startDate: '', endDate: '' })
  Object.assign(employeeAdvancedApplied, { type: '', startDate: '', endDate: '' })
  employeeRequestPage.value = 1
}
const applyEmployeeAdvanced = (): void => {
  if (employeeAdvancedDraft.startDate && employeeAdvancedDraft.endDate && employeeAdvancedDraft.startDate > employeeAdvancedDraft.endDate) {
    ElMessage.warning('开始时间不能晚于结束时间')
    return
  }
  Object.assign(employeeAdvancedApplied, employeeAdvancedDraft)
  employeeRequestPage.value = 1
  employeeAdvancedOpen.value = false
}
const onRequestSubmitted = (): void => {
  tab.value = '全部'
  employeeRequestPage.value = 1
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
  void Promise.all([load(), loadAssets(), loadStore()])
  openRequestFromRoute()
  focusManagerRequestFromRoute()
})
onActivated(() => {
  void load()
  openRequestFromRoute()
  focusManagerRequestFromRoute()
  void Promise.all([loadAssets(), loadStore()])
})
watch(() => route.fullPath, () => {
  openRequestFromRoute()
  focusManagerRequestFromRoute()
})
watch([tab, query, employeeRequestPageSize], () => { employeeRequestPage.value = 1 })
watch(filtered, () => {
  employeeRequestPage.value = Math.min(employeeRequestPage.value, employeeRequestPageCount.value)
})
watch(canReview, () => {
  tab.value = '全部'
  employeeRequestPage.value = 1
})
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
          <table v-resizable-columns="'approvals:manager'" class="approval-manager-table">
            <thead><tr><th data-column-key="requestId">申请单号</th><th data-column-key="type">申请类型</th><th data-column-key="applicant">申请人</th><th data-column-key="company">所属公司</th><th data-column-key="department">所在部门</th><th data-column-key="date">申请时间</th><th data-column-key="reason">说明</th><th data-column-key="status">状态</th><th data-column-key="currentNode">当前节点</th><th data-column-key="actions">操作</th></tr></thead>
            <tbody>
              <tr v-for="item in filtered" :key="item.id"><td class="approval-request-number-cell"><button class="approval-request-number-link" type="button" :title="item.id" @click="detail = item">{{ item.id }}</button></td><td>{{ displayRequestType(item) }}</td><td>{{ item.applicant }}</td><td :title="approvalCompany(item)">{{ approvalCompany(item) }}</td><td>{{ item.department || '-' }}</td><td>{{ item.date || '-' }}</td><td :title="item.reason || '-'">{{ item.reason || '-' }}</td><td><span class="tag" :class="statusType(item.status) === 'success' ? 'green' : statusType(item.status) === 'danger' ? 'red' : 'amber'">{{ item.status }}</span></td><td>{{ item.currentNode || '-' }}</td><td class="approval-actions-cell"><div class="approval-row-actions"><span v-if="isDecisionSyncing(item)" class="tag">同步中</span><template v-else-if="pendingStatuses.has(item.status)"><button class="link" type="button" @click="openDecision(item, 'approve')">同意</button><span class="action-separator">|</span><button class="link" type="button" @click="openDecision(item, 'reject')">驳回</button></template><span v-else>-</span></div></td></tr>
              <tr v-if="!filtered.length" class="empty-row"><td colspan="10">暂无审批单据。</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
    <template v-else>
      <section class="employee-request-page">
        <section class="employee-request-head">
          <h1 class="employee-request-title">员工申请</h1>
          <div v-if="employeeRequestActions.length" class="employee-request-actions-grid">
            <button v-for="action in employeeRequestActions" :key="action.type" class="employee-request-action" type="button" @click="openRequest(action.type)">
              <span class="employee-request-action-icon" :class="action.tone" aria-hidden="true"><component :is="action.icon" /></span>
              <span class="employee-request-action-label">{{ action.label }}</span>
            </button>
          </div>
          <div v-else class="employee-request-actions-empty">当前未开放自助申请</div>
        </section>
        <section class="employee-request-history">
          <div class="employee-request-list-head">
            <div class="employee-request-tabs" role="tablist">
              <button v-for="item in tabs" :key="item" :class="{ active: tab === item }" type="button" @click="tab = item">{{ item }} ({{ tabCount(item) }})</button>
            </div>
            <button class="employee-request-advanced" type="button" :aria-expanded="employeeAdvancedOpen" @click="openEmployeeAdvanced">高级搜索</button>
            <el-config-provider v-if="employeeAdvancedOpen" :locale="zhCn">
              <div class="employee-request-advanced-panel" role="dialog" aria-label="高级搜索" @click.stop>
                <div class="employee-request-advanced-panel-actions"><button class="btn primary" type="button" @click="applyEmployeeAdvanced">查询</button><button class="btn" type="button" @click="clearEmployeeAdvanced">重置</button></div>
                <div class="employee-request-advanced-fields">
                  <label><span>申请类型：</span><el-select v-model="employeeAdvancedDraft.type" clearable placeholder="请选择" aria-label="申请类型"><el-option v-for="option in employeeRequestTypeOptions" :key="option" :label="option" :value="option" /></el-select></label>
                  <label><span>开始时间：</span><el-date-picker v-model="employeeAdvancedDraft.startDate" type="date" value-format="YYYY-MM-DD" placeholder="请选择" aria-label="开始时间" /></label>
                  <label><span>结束时间：</span><el-date-picker v-model="employeeAdvancedDraft.endDate" type="date" value-format="YYYY-MM-DD" placeholder="请选择" aria-label="结束时间" /></label>
                </div>
              </div>
            </el-config-provider>
          </div>
          <div class="employee-request-card-list">
            <article v-for="item in pagedEmployeeRequests" :key="item.id" class="employee-request-card">
              <div class="employee-request-card-main">
                <div class="employee-request-card-title">
                  <span class="employee-request-status-pill" :class="statusType(item.status)">{{ displayStatus(item.status) }}</span>
                  <strong>{{ displayRequestType(item) }}</strong>
                </div>
                <div class="employee-request-card-fields">
                  <div><span>单据编号</span><strong>{{ item.id }}</strong></div>
                  <div><span>发起时间</span><strong>{{ item.date || '-' }}</strong></div>
                  <div><span>审批时间</span><strong>{{ pendingStatuses.has(item.status) ? '-' : String(item.approvalDate || item.date || '-') }}</strong></div>
                  <div><span>资产数量</span><strong>{{ item.assetCount || (item.asset ? 1 : '-') }}</strong></div>
                </div>
              </div>
              <button class="btn employee-request-detail" type="button" @click="detail = item">查看详情</button>
            </article>
            <div v-if="!filtered.length" class="employee-request-empty">当前分类下还没有可展示的申请。</div>
          </div>
          <el-config-provider :locale="zhCn">
            <div v-if="filtered.length" class="employee-request-pagination">
              <el-pagination
                v-model:current-page="employeeRequestPage"
                class="employee-request-pagination-controls"
                :pager-count="5"
                :total="filtered.length"
                :page-size="employeeRequestPageSize"
                layout="total, prev, pager, next"
              />
              <el-select
                v-model="employeeRequestPageSize"
                class="employee-request-page-size-select asset-page-size-select"
                aria-label="员工申请每页条数"
                placement="top-start"
                :fallback-placements="['top-start']"
                popper-class="portal-upward-select-popper"
              >
                <el-option label="10 条/页" :value="10" />
                <el-option label="20 条/页" :value="20" />
                <el-option label="50 条/页" :value="50" />
                <el-option label="100 条/页" :value="100" />
              </el-select>
            </div>
          </el-config-provider>
        </section>
      </section>
    </template>
    <el-alert v-if="state.errorMessage" type="error" :title="state.errorMessage" show-icon :closable="false" />

    <el-drawer :model-value="Boolean(detail) && !decisionOpen" class="approval-detail-drawer" :title="detail ? displayRequestType(detail) : '审批详情'" direction="rtl" size="min(1120px, 96vw)" append-to-body destroy-on-close @close="detail = null">
      <template v-if="detail">
        <section v-if="detail.type === '办公设备申领'" class="approval-detail-section">
          <div class="approval-detail-section-head"><h3>设备需求</h3><span>共 {{ deviceItems(detail).length }} 项</span></div>
          <div class="approval-device-items"><article v-for="(item, index) in deviceItems(detail)" :key="index"><strong>{{ textValue(item.name) }}</strong><span>{{ textValue(item.specification) }}</span><em>数量 {{ Number(item.quantity || 1) }}</em></article></div>
        </section>
        <section v-else class="approval-detail-section">
          <h3>申请信息</h3>
          <div class="approval-detail-fields"><div v-for="field in approvalSummaryFields(detail)" :key="String(field[0])" class="approval-detail-field" :class="{ wide: field[0] === '说明' }"><span>{{ field[0] }}</span><strong>{{ textValue(field[1]) }}</strong></div></div>
        </section>
        <section class="approval-detail-section">
          <div class="approval-detail-section-head"><h3>申请明细</h3><span>共 {{ detailAssets.length || detail.assetCount || 0 }} 项</span></div>
          <div class="approval-detail-assets-wrap"><table v-resizable-columns="`approvals:detail:${detail.type}`" class="approval-detail-assets-table"><thead><tr><th>图片</th><th>资产编码</th><th>资产分类</th><th>资产名称</th><th>品牌</th><th>型号</th><th>设备序列号</th><th>所属/承租公司</th><th>所在位置</th><th>资产状态</th></tr></thead><tbody><tr v-for="asset in detailAssets" :key="asset.id"><td><img v-if="asset.image" :src="String(asset.image)" :alt="asset.name"><span v-else>-</span></td><td>{{ displayAssetCode(asset) }}</td><td>{{ asset.category || '-' }}</td><td>{{ asset.name || '-' }}</td><td>{{ asset.brand || '-' }}</td><td>{{ asset.model || '-' }}</td><td>{{ asset.sn || '-' }}</td><td>{{ asset.ownerCompany || asset.company || '-' }}</td><td>{{ asset.location || '-' }}</td><td>{{ asset.status || '-' }}</td></tr><tr v-if="!detailAssets.length" class="empty-row"><td colspan="10">该申请未关联可读取的资产明细。</td></tr></tbody></table></div>
        </section>
        <section class="approval-detail-section">
          <h3>审批信息</h3>
          <div class="approval-detail-fields approval-process-fields"><div v-for="field in approvalProcessFields(detail)" :key="String(field[0])" class="approval-detail-field"><span>{{ field[0] }}</span><strong>{{ textValue(field[1]) }}</strong></div></div>
        </section>
      </template>
      <template #footer><div class="approval-detail-footer"><el-button @click="detail = null">关闭</el-button><template v-if="detail && pendingStatuses.has(detail.status) && !isDecisionSyncing(detail)"><el-button type="primary" @click="openDecision(detail, 'approve')">同意</el-button><el-button type="danger" plain @click="openDecision(detail, 'reject')">驳回</el-button></template></div></template>
    </el-drawer>
    <el-dialog v-model="decisionOpen" :title="decisionForm.decision === 'approve' ? '通过审批' : '拒绝审批'" width="min(520px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="处理意见"><el-input v-model="decisionForm.reason" type="textarea" :rows="4" maxlength="500" show-word-limit /></el-form-item></el-form><template #footer><el-button @click="decisionOpen = false">取消</el-button><el-button :type="decisionForm.decision === 'approve' ? 'primary' : 'danger'" :loading="submitting" @click="submitDecision">确认</el-button></template></el-dialog>
    <AssetRequestDialog v-model="requestOpen" :type="requestType" :preselected-asset-id="requestAssetId" @submitted="onRequestSubmitted" />
  </section>
</template>
