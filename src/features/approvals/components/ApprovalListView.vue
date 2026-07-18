<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Search } from '@element-plus/icons-vue'
import { usePortalSession } from '../../../core/auth/portal-session'
import { useApprovals } from '../composables/useApprovals'
import type { ApprovalDecision, ApprovalRecord } from '../types/approval'

const { state, rows, load, decide } = useApprovals()
const { user } = usePortalSession()
const query = ref('')
const tab = ref('全部')
const detail = ref<ApprovalRecord | null>(null)
const decisionOpen = ref(false)
const submitting = ref(false)
const decisionForm = reactive<{ decision: ApprovalDecision; reason: string }>({ decision: 'approve', reason: '' })
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
const canReview = computed(() => permissions.value.has('asset:request:review'))
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
onMounted(() => void load())
</script>

<template>
  <section class="standard-business-view approvals-view">
    <header class="standard-page-header"><div><h1>审批</h1><p>查看资产业务申请、审批节点与处理结果。</p></div><el-button :icon="Refresh" @click="load">刷新</el-button></header>
    <el-tabs v-model="tab" class="standard-tabs"><el-tab-pane v-for="item in tabs" :key="item" :label="item" :name="item" /></el-tabs>
    <div class="standard-toolbar"><el-input v-model="query" :prefix-icon="Search" clearable placeholder="搜索申请编号、类型、申请人或资产" /></div>
    <div class="standard-table-shell"><el-table v-loading="state.loading" :data="filtered" height="100%" row-key="id">
      <el-table-column prop="id" label="申请编号" min-width="150" /><el-table-column prop="type" label="申请类型" min-width="120" /><el-table-column prop="applicant" label="申请人" min-width="100" /><el-table-column prop="asset" label="申请物品" min-width="220" show-overflow-tooltip /><el-table-column prop="currentNode" label="当前节点" min-width="140" /><el-table-column label="状态" width="100"><template #default="scope"><el-tag :type="statusType(scope.row.status)">{{ scope.row.status }}</el-tag></template></el-table-column><el-table-column prop="date" label="申请日期" width="120" />
      <el-table-column label="操作" width="190" fixed="right"><template #default="scope"><el-button link type="primary" @click="detail = scope.row">详情</el-button><template v-if="canReview && ['审批中', '待执行'].includes(scope.row.status)"><el-button link type="primary" @click="openDecision(scope.row, 'approve')">通过</el-button><el-button link type="danger" @click="openDecision(scope.row, 'reject')">拒绝</el-button></template></template></el-table-column>
    </el-table></div>
    <el-alert v-if="state.errorMessage" type="error" :title="state.errorMessage" show-icon :closable="false" />

    <el-drawer :model-value="Boolean(detail) && !decisionOpen" size="min(660px, 92vw)" append-to-body @close="detail = null"><template #header><div><span class="standard-drawer-eyebrow">审批详情</span><h2>{{ detail?.id }}</h2></div></template><template v-if="detail"><el-descriptions :column="1" border><el-descriptions-item label="申请类型">{{ detail.type }}</el-descriptions-item><el-descriptions-item label="申请人">{{ detail.applicant }}</el-descriptions-item><el-descriptions-item label="申请物品">{{ detail.asset }}</el-descriptions-item><el-descriptions-item label="申请原因">{{ detail.reason || '-' }}</el-descriptions-item><el-descriptions-item label="当前节点">{{ detail.currentNode }}</el-descriptions-item><el-descriptions-item label="状态"><el-tag :type="statusType(detail.status)">{{ detail.status }}</el-tag></el-descriptions-item></el-descriptions><section class="standard-detail-section"><h3>审批轨迹</h3><el-timeline><el-timeline-item :timestamp="detail.date" type="primary">资产系统创建单据</el-timeline-item><el-timeline-item :type="['已完成', '已拒绝'].includes(detail.status) ? 'success' : 'warning'">{{ detail.currentNode || detail.status }}</el-timeline-item><el-timeline-item>资产动作归档</el-timeline-item></el-timeline></section></template></el-drawer>
    <el-dialog v-model="decisionOpen" :title="decisionForm.decision === 'approve' ? '通过审批' : '拒绝审批'" width="min(520px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="处理意见"><el-input v-model="decisionForm.reason" type="textarea" :rows="4" maxlength="500" show-word-limit /></el-form-item></el-form><template #footer><el-button @click="decisionOpen = false">取消</el-button><el-button :type="decisionForm.decision === 'approve' ? 'primary' : 'danger'" :loading="submitting" @click="submitDecision">确认</el-button></template></el-dialog>
  </section>
</template>
