<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import SignaturePad from '../../../shared/components/SignaturePad.vue'
import { useAssets } from '../../assets/composables/useAssets'
import type { AssetOperationRecord } from '../../assets/types/assets'

type SignatureTab = '待签字' | '已签字' | '已打回'

const { state, operations, loadOperations, command } = useAssets()
const tab = ref<SignatureTab>('待签字')
const selectedId = ref('')
const detail = ref<AssetOperationRecord | null>(null)
const signOpen = ref(false)
const rejectOpen = ref(false)
const signatureImage = ref('')
const rejectionReason = ref('')
const submitting = ref(false)

const receiptTypes = new Set(['RECEIVE', 'BORROW', 'HANDOVER'])
const receiptRows = computed(() => operations.value.filter((item) => receiptTypes.has(item.type) && (
  item.status === '待签字' || item.status === '已打回' || item.status === '已终止'
  || Boolean(item.signedAt) || Boolean(item.signatureImage)
)))
const statusGroup = (item: AssetOperationRecord): SignatureTab => {
  if (item.status === '待签字') return '待签字'
  if (item.status === '已打回' || item.status === '已终止') return '已打回'
  return '已签字'
}
const statusLabel = (item: AssetOperationRecord): string => item.status === '已终止' ? '已终止' : statusGroup(item)
const rows = computed(() => receiptRows.value.filter((item) => statusGroup(item) === tab.value))
const selected = computed(() => receiptRows.value.find((item) => item.id === selectedId.value) || null)
const tabCount = (value: SignatureTab): number => receiptRows.value.filter((item) => statusGroup(item) === value).length
const typeLabel = (type: AssetOperationRecord['type']): string => {
  if (type === 'RECEIVE') return '资产领用'
  if (type === 'BORROW') return '资产借用'
  if (type === 'HANDOVER') return '资产交接'
  return type
}
const displayTime = (item: AssetOperationRecord): string => String(item.createdAt || item.date || '-').replace('T', ' ').slice(0, 19)
const choose = (item: AssetOperationRecord): void => { selectedId.value = item.id }
const requirePendingSelection = (): AssetOperationRecord | null => {
  if (!selected.value || selected.value.status !== '待签字' || !selected.value.canSign) {
    ElMessage.warning('请选择一条本人待签字的单据')
    return null
  }
  return selected.value
}
const openSign = (): void => {
  if (!requirePendingSelection()) return
  signatureImage.value = ''
  signOpen.value = true
}
const openReject = (): void => {
  if (!requirePendingSelection()) return
  rejectionReason.value = ''
  rejectOpen.value = true
}
const submitSign = async (): Promise<void> => {
  const item = requirePendingSelection()
  if (!item) return
  if (!signatureImage.value) { ElMessage.warning('请先完成签字'); return }
  submitting.value = true
  try {
    await command('receipt-sign', [item.assetId], { signatureImage: signatureImage.value, date: new Date().toISOString().slice(0, 10) })
    signOpen.value = false
    selectedId.value = ''
    tab.value = '已签字'
    ElMessage.success('签收完成')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '签收失败')
  } finally { submitting.value = false }
}
const submitReject = async (): Promise<void> => {
  const item = requirePendingSelection()
  if (!item) return
  if (!rejectionReason.value.trim()) { ElMessage.warning('请填写打回原因'); return }
  submitting.value = true
  try {
    await command('receipt-reject', [item.assetId], { reason: rejectionReason.value.trim(), date: new Date().toISOString().slice(0, 10) })
    rejectOpen.value = false
    selectedId.value = ''
    tab.value = '已打回'
    ElMessage.success('单据已打回')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '打回失败')
  } finally { submitting.value = false }
}

onMounted(() => { void loadOperations() })
</script>

<template>
  <section class="employee-signature-page standard-business-view">
    <header class="standard-page-header"><div><h1>签字</h1><p>核对待签收单据，签字确认或说明原因后打回。</p></div></header>
    <div class="employee-signature-tabs" role="tablist">
      <button v-for="item in (['待签字', '已签字', '已打回'] as SignatureTab[])" :key="item" type="button"
        :class="{ active: tab === item }" @click="tab = item; selectedId = ''">{{ item }} ({{ tabCount(item) }})</button>
    </div>
    <div v-if="tab === '待签字'" class="employee-signature-actions">
      <el-button type="primary" :disabled="!selected" @click="openSign">签字</el-button>
      <el-button :disabled="!selected" @click="openReject">打回</el-button>
    </div>
    <div v-loading="state.loading" class="employee-signature-table-wrap">
      <table class="employee-signature-table">
        <thead><tr><th class="signature-select-cell"></th><th>单据编号</th><th>签字类型</th><th>数量</th><th>备注说明</th><th>操作人</th><th>发起时间</th><th>签收状态</th></tr></thead>
        <tbody>
          <tr v-for="item in rows" :key="item.id" :class="{ selected: selectedId === item.id }" @click="choose(item)">
            <td class="signature-select-cell"><input type="radio" name="signature-order" :checked="selectedId === item.id" :aria-label="`选择单据 ${item.id}`" @change="choose(item)" /></td>
            <td><button class="link" type="button" @click.stop="detail = item">{{ item.id }}</button></td>
            <td>{{ typeLabel(item.type) }}</td><td>1</td><td>{{ item.note || '-' }}</td><td>{{ item.operator || '-' }}</td><td>{{ displayTime(item) }}</td><td><span class="signature-status" :class="statusLabel(item)">{{ statusLabel(item) }}</span></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="8" class="employee-signature-empty-cell">当前没有{{ tab }}单据</td></tr>
        </tbody>
      </table>
    </div>

    <el-dialog v-model="signOpen" title="签收同意" width="min(760px, 94vw)" append-to-body destroy-on-close>
      <p v-if="selected?.noticeContent" class="signature-notice">{{ selected.noticeContent }}</p>
      <div class="signature-dialog-label">请签字确认收货</div>
      <SignaturePad v-model="signatureImage" :height="300" />
      <template #footer><el-button @click="signOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitSign">确定</el-button></template>
    </el-dialog>
    <el-dialog v-model="rejectOpen" title="打回签收单" width="min(560px, 92vw)" append-to-body destroy-on-close>
      <el-form label-position="top"><el-form-item label="打回原因" required><el-input v-model="rejectionReason" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="请说明设备问题或非本人领用等原因" /></el-form-item></el-form>
      <template #footer><el-button @click="rejectOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitReject">确定</el-button></template>
    </el-dialog>
    <el-drawer :model-value="Boolean(detail)" title="签收单详情" size="min(620px, 92vw)" append-to-body @close="detail = null">
      <div v-if="detail" class="signature-detail-grid">
        <div><span>单据编号</span><strong>{{ detail.id }}</strong></div><div><span>签字类型</span><strong>{{ typeLabel(detail.type) }}</strong></div>
        <div><span>资产编码</span><strong>{{ detail.assetId }}</strong></div><div><span>资产名称</span><strong>{{ detail.assetName || '-' }}</strong></div>
        <div><span>资产分类</span><strong>{{ detail.assetCategory || '-' }}</strong></div><div><span>品牌/型号</span><strong>{{ [detail.assetBrand, detail.assetModel].filter(Boolean).join(' ') || '-' }}</strong></div>
        <div><span>设备序列号</span><strong>{{ detail.assetSn || '-' }}</strong></div><div><span>接收位置</span><strong>{{ detail.location || '-' }}</strong></div>
        <div><span>发起人</span><strong>{{ detail.operator || '-' }}</strong></div><div><span>签收状态</span><strong>{{ statusLabel(detail) }}</strong></div>
        <div v-if="detail.rejectionReason" class="wide"><span>打回原因</span><strong>{{ detail.rejectionReason }}</strong></div>
        <div v-if="detail.noticeContent" class="wide"><span>签收须知</span><strong>{{ detail.noticeContent }}</strong></div>
        <div v-if="detail.signatureImage" class="wide"><span>签字图片</span><img :src="String(detail.signatureImage)" alt="员工签字图片" /></div>
      </div>
    </el-drawer>
  </section>
</template>
