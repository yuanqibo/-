<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { usePortalSession } from '../../../core/auth/portal-session'
import { useTerminalMode } from '../../../core/auth/terminal-mode'
import { useApprovals } from '../composables/useApprovals'
import { useAssets } from '../../assets/composables/useAssets'
import type { ApprovalDecision, ApprovalRecord } from '../types/approval'

const { state, rows, load, decide, create } = useApprovals()
const { assets, load: loadAssets } = useAssets()
const { user } = usePortalSession()
const { isEmployeeTerminal } = useTerminalMode()
const query = ref('')
const tab = ref('全部')
const detail = ref<ApprovalRecord | null>(null)
const decisionOpen = ref(false)
const requestOpen = ref(false)
const submitting = ref(false)
const decisionForm = reactive<{ decision: ApprovalDecision; reason: string }>({ decision: 'approve', reason: '' })
const requestForm = reactive({ type: '资产领用', assetIds: [] as string[], location: '', date: new Date().toISOString().slice(0, 10), expectedReturnDate: '', receiverSubject: '', reason: '' })
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
const canReview = computed(() => !isEmployeeTerminal.value && permissions.value.has('asset:request:review'))
const tabs = ['全部', '待处理', '已完成', '已拒绝']
const filtered = computed(() => rows.value.filter((item) => {
  const keyword = query.value.trim().toLowerCase()
  const tabMatch = tab.value === '全部' || (tab.value === '待处理' ? ['审批中', '待执行'].includes(item.status) : item.status === tab.value)
  return tabMatch && (!keyword || [item.id, item.type, item.applicant, item.asset, item.status].some((value) => String(value || '').toLowerCase().includes(keyword)))
}))
const statusType = (status: string): 'success' | 'warning' | 'danger' | 'info' => status === '已完成' ? 'success' : status === '审批中' || status === '待执行' ? 'warning' : status === '已拒绝' ? 'danger' : 'info'
const openDecision = (item: ApprovalRecord, decision: ApprovalDecision): void => { detail.value = item; decisionForm.decision = decision; decisionForm.reason = ''; decisionOpen.value = true }
const submitDecision = async (): Promise<void> => {
  if (!detail.value) return
  submitting.value = true
  try { await decide(detail.value.id, decisionForm.decision, decisionForm.reason, user.value?.name || ''); decisionOpen.value = false; detail.value = null; ElMessage.success('审批已处理') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '审批处理失败') }
  finally { submitting.value = false }
}
const requestAssets = computed(() => assets.value.filter((item) => {
  if (requestForm.type === '资产归还') return item.status === '借用中' && (!item.owner || item.owner === user.value?.name)
  if (requestForm.type === '资产退还' || requestForm.type === '资产交接') return ['在用', '领用中'].includes(item.status) && (!item.owner || item.owner === user.value?.name)
  return ['空闲', '闲置'].includes(item.status)
}))
const openRequest = (type = '资产领用'): void => {
  Object.assign(requestForm, { type, assetIds: [], location: '', date: new Date().toISOString().slice(0, 10), expectedReturnDate: '', receiverSubject: '', reason: '' })
  requestOpen.value = true
}
const submitRequest = async (): Promise<void> => {
  if (!requestForm.assetIds.length) { ElMessage.warning('请至少选择一项资产'); return }
  if (!requestForm.location.trim()) { ElMessage.warning('请填写资产位置'); return }
  if (requestForm.type === '资产借用' && !requestForm.expectedReturnDate) { ElMessage.warning('请选择预计归还日期'); return }
  const selectedAssets = assets.value.filter((item) => requestForm.assetIds.includes(item.id))
  const details: Record<string, unknown> = { assetIds: requestForm.assetIds, assetCount: requestForm.assetIds.length }
  const fieldPrefix = requestForm.type === '资产借用' ? 'borrow' : requestForm.type === '资产归还' || requestForm.type === '资产退还' ? 'return' : requestForm.type === '资产交接' ? 'handover' : 'receive'
  details[`${fieldPrefix}Location`] = requestForm.location
  details[`${fieldPrefix}Date`] = requestForm.date
  if (requestForm.expectedReturnDate) details.expectedReturnDate = requestForm.expectedReturnDate
  if (requestForm.receiverSubject) details.receiverSubject = requestForm.receiverSubject
  submitting.value = true
  try {
    await create({ type: requestForm.type, applicant: user.value?.name || '', asset: selectedAssets.map((item) => `${item.id} ${item.name}`).join('、'), reason: requestForm.reason, details })
    requestOpen.value = false
    ElMessage.success('资产申请已提交')
  } catch (error) { ElMessage.error(error instanceof Error ? error.message : '提交申请失败') }
  finally { submitting.value = false }
}
onMounted(() => { void load(); void loadAssets() })
</script>

<template>
  <section class="approvals-view">
    <template v-if="canReview">
      <section class="hero"><h1>审批管理</h1><p>处理资产及业务申请，审批结果由服务端记录。</p><div class="quick-actions"><button class="btn primary" type="button" @click="openRequest()">新建申请</button><button class="btn" type="button" @click="load">刷新</button></div></section>
      <section class="panel"><div class="toolbar"><input v-model="query" class="local-search" type="search" placeholder="搜索申请编号、类型、申请人或资产"><select v-model="tab"><option v-for="item in tabs" :key="item">{{ item }}</option></select></div><div v-loading="state.loading" class="table-wrap"><table><thead><tr><th>单据编号</th><th>类型</th><th>申请人</th><th>关联物品</th><th>原因</th><th>状态</th><th>当前节点</th><th>操作</th></tr></thead><tbody><tr v-for="item in filtered" :key="item.id"><td>{{ item.id }}</td><td>{{ item.type }}</td><td>{{ item.applicant }}</td><td>{{ item.asset }}</td><td>{{ item.reason || '-' }}</td><td><span class="tag" :class="statusType(item.status) === 'success' ? 'green' : statusType(item.status) === 'danger' ? 'red' : 'amber'">{{ item.status }}</span></td><td>{{ item.currentNode || '-' }}</td><td><template v-if="['审批中', '待执行'].includes(item.status)"><button class="btn primary" type="button" @click="openDecision(item, 'approve')">批准</button> <button class="btn" type="button" @click="openDecision(item, 'reject')">拒绝</button></template><button v-else class="btn" type="button" @click="detail = item">查看</button></td></tr><tr v-if="!filtered.length" class="empty-row"><td colspan="8">暂无审批单据。</td></tr></tbody></table></div></section>
    </template>
    <template v-else>
      <section class="employee-request-page"><section class="employee-request-head"><h1 class="employee-request-title">员工申请</h1><div class="employee-request-actions-grid"><button v-for="action in [['资产领用','blue'],['资产借用','sky'],['资产归还','orange'],['资产退还','violet'],['资产交接','green']]" :key="action[0]" class="employee-request-action" type="button" @click="openRequest(action[0])"><span class="employee-request-action-icon" :class="action[1]">资</span><span class="employee-request-action-label">{{ action[0] }}</span></button></div></section><section class="employee-request-history"><div class="employee-request-list-head"><div class="employee-request-tabs" role="tablist"><button v-for="item in tabs" :key="item" :class="{ active: tab === item }" type="button" @click="tab = item">{{ item }} ({{ item === '全部' ? rows.length : rows.filter(row => item === '待处理' ? ['审批中','待执行'].includes(row.status) : row.status === item).length }})</button></div><button class="employee-request-advanced" type="button">高级搜索</button></div><div class="employee-request-card-list"><article v-for="item in filtered" :key="item.id" class="employee-request-card"><div class="employee-request-card-main"><div class="employee-request-card-title"><span class="employee-request-status-pill" :class="statusType(item.status)">{{ item.status }}</span><strong>{{ item.type }}</strong></div><div class="employee-request-card-fields"><div><span>单据编号</span><strong>{{ item.id }}</strong></div><div><span>发起时间</span><strong>{{ item.date || '-' }}</strong></div><div><span>审批时间</span><strong>{{ ['审批中','待执行'].includes(item.status) ? '-' : item.date || '-' }}</strong></div><div><span>资产数量</span><strong>{{ item.assetCount || (item.asset ? 1 : '-') }}</strong></div></div></div><button class="btn employee-request-detail" type="button" @click="detail = item">查看详情</button></article><div v-if="!filtered.length" class="employee-request-empty">当前分类下还没有可展示的申请。</div></div></section></section>
    </template>
    <el-alert v-if="state.errorMessage" type="error" :title="state.errorMessage" show-icon :closable="false" />

    <el-drawer :model-value="Boolean(detail) && !decisionOpen" size="min(560px, 94vw)" append-to-body @close="detail = null"><template #header><div><span class="eyebrow">审批轨迹</span><h2>{{ detail?.id }}</h2></div></template><template v-if="detail"><div class="detail-grid"><div v-for="field in [['申请类型', detail.type], ...(detail.approvalNo ? [['审批编号', detail.approvalNo]] : []), ['申请人', detail.applicant], ['申请物品', detail.asset], ['审批系统', detail.system], ['当前节点', detail.currentNode], ['资产数量', detail.assetCount || '-'], ['申请原因', detail.reason || '-'], ['申请日期', detail.date], ...(detail.borrowLocation ? [['借用后位置', detail.borrowLocation]] : []), ...(detail.expectedReturnDate ? [['预计归还日期', detail.expectedReturnDate]] : [])]" :key="String(field[0])" class="detail-item"><span class="detail-label">{{ field[0] }}</span><strong class="detail-value">{{ field[1] }}</strong></div><div class="detail-item"><span class="detail-label">状态</span><strong class="detail-value"><span class="tag" :class="statusType(detail.status) === 'success' ? 'green' : statusType(detail.status) === 'danger' ? 'red' : 'amber'">{{ detail.status }}</span></strong></div></div><h3>审批状态</h3><div class="approval-flow"><div class="approval-step"><span class="step-dot done"></span><div><strong>资产系统创建单据</strong><div class="timeline-desc">生成业务单据并记录申请内容。</div></div></div><div class="approval-step"><span class="step-dot current"></span><div><strong>{{ detail.currentNode || detail.status }}</strong><div class="timeline-desc">Java 后端校验权限、资产归属和状态后执行。</div></div></div><div class="approval-step"><span class="step-dot"></span><div><strong>资产动作归档</strong><div class="timeline-desc">审批通过后写入资产台账和操作记录。</div></div></div></div></template></el-drawer>
    <el-dialog v-model="decisionOpen" :title="decisionForm.decision === 'approve' ? '通过审批' : '拒绝审批'" width="min(520px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="处理意见"><el-input v-model="decisionForm.reason" type="textarea" :rows="4" maxlength="500" show-word-limit /></el-form-item></el-form><template #footer><el-button @click="decisionOpen = false">取消</el-button><el-button :type="decisionForm.decision === 'approve' ? 'primary' : 'danger'" :loading="submitting" @click="submitDecision">确认</el-button></template></el-dialog>
    <el-dialog v-model="requestOpen" :title="requestForm.type" width="min(820px, 94vw)" append-to-body><el-form label-position="top" class="standard-form-grid"><el-form-item label="选择资产" class="standard-form-span" required><el-select v-model="requestForm.assetIds" multiple filterable collapse-tags placeholder="搜索并选择资产" style="width: 100%"><el-option v-for="item in requestAssets" :key="item.id" :label="`${item.id} · ${item.name}`" :value="item.id" /></el-select></el-form-item><el-form-item label="资产位置" required><el-input v-model="requestForm.location" /></el-form-item><el-form-item label="申请日期"><el-date-picker v-model="requestForm.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item><el-form-item v-if="requestForm.type === '资产借用'" label="预计归还日期" required><el-date-picker v-model="requestForm.expectedReturnDate" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item><el-form-item v-if="requestForm.type === '资产交接'" label="接收人标识" required><el-input v-model="requestForm.receiverSubject" /></el-form-item><el-form-item label="申请原因" class="standard-form-span"><el-input v-model="requestForm.reason" type="textarea" :rows="3" /></el-form-item></el-form><template #footer><el-button @click="requestOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitRequest">提交申请</el-button></template></el-dialog>
  </section>
</template>
