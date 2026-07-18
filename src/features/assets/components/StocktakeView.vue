<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Refresh, Search } from '@element-plus/icons-vue'
import { usePortalSession } from '../../../core/auth/portal-session'
import { useAssets } from '../composables/useAssets'
import type { BusinessRecord } from '../types/assets'

const { state, assets, business, load, createStocktake, updateStocktake } = useAssets()
const { user } = usePortalSession()
const query = ref('')
const detail = ref<BusinessRecord | null>(null)
const createOpen = ref(false)
const updateOpen = ref(false)
const submitting = ref(false)
const permissions = computed(() => new Set(user.value?.permissionCodes || []))
const can = (code: string): boolean => permissions.value.has(code)
const rows = computed(() => (business.value.stocktakes || []).filter((item) => {
  const keyword = query.value.trim().toLowerCase()
  return !keyword || [item.id, item.name, item.scope, item.owner].some((value) => String(value || '').toLowerCase().includes(keyword))
}))
const createForm = reactive({ name: '', scope: '全部资产', owner: '', total: 1, date: new Date().toISOString().slice(0, 10) })
const updateForm = reactive({ id: '', checked: 0, diff: 0, total: 0 })
const openCreate = (): void => { Object.assign(createForm, { name: '', scope: '全部资产', owner: user.value?.name || '', total: Math.max(assets.value.length, 1), date: new Date().toISOString().slice(0, 10) }); createOpen.value = true }
const submitCreate = async (): Promise<void> => {
  if (!createForm.name.trim() || !createForm.scope.trim() || !createForm.owner.trim()) { ElMessage.warning('请完整填写盘点任务信息'); return }
  submitting.value = true
  try { await createStocktake({ ...createForm }); createOpen.value = false; ElMessage.success('盘点任务已创建') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '创建盘点任务失败') }
  finally { submitting.value = false }
}
const openUpdate = (item: BusinessRecord): void => { Object.assign(updateForm, { id: item.id, checked: Number(item.checked || 0), diff: Number(item.diff || 0), total: Number(item.total || 0) }); updateOpen.value = true }
const submitUpdate = async (): Promise<void> => {
  if (updateForm.diff > updateForm.checked) { ElMessage.warning('差异数量不能大于已盘数量'); return }
  submitting.value = true
  try { await updateStocktake(updateForm.id, { checked: updateForm.checked, diff: updateForm.diff }); updateOpen.value = false; detail.value = null; ElMessage.success('盘点进度已更新') }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '更新盘点任务失败') }
  finally { submitting.value = false }
}
onMounted(() => void load())
</script>

<template>
  <section class="standard-business-view">
    <header class="standard-page-header"><div><h1>资产盘点</h1><p>查看盘点任务、完成进度与差异处理情况。</p></div><div class="standard-header-actions"><el-button :icon="Refresh" @click="load(true)">刷新</el-button><el-button v-if="can('asset:stocktake:create')" type="primary" :icon="Plus" @click="openCreate">新建盘点</el-button></div></header>
    <div class="standard-toolbar"><el-input v-model="query" clearable :prefix-icon="Search" placeholder="搜索任务编号、名称或负责人" /></div>
    <div class="standard-table-shell"><el-table v-loading="state.loading" :data="rows" height="100%" row-key="id">
      <el-table-column prop="id" label="任务编号" min-width="140" /><el-table-column prop="name" label="盘点任务" min-width="180" />
      <el-table-column prop="scope" label="盘点范围" min-width="180" /><el-table-column prop="owner" label="负责人" width="120" />
      <el-table-column label="进度" min-width="180"><template #default="scope"><el-progress :percentage="scope.row.total ? Math.round((scope.row.checked || 0) * 100 / scope.row.total) : 0" /></template></el-table-column>
      <el-table-column prop="diff" label="差异数量" width="100" /><el-table-column prop="date" label="计划日期" width="130" />
      <el-table-column label="操作" width="150"><template #default="scope"><el-button link type="primary" @click="detail = scope.row">详情</el-button><el-button v-if="can('asset:stocktake:update')" link type="primary" @click="openUpdate(scope.row)">更新进度</el-button></template></el-table-column>
    </el-table></div>
    <el-empty v-if="!state.loading && !rows.length" description="暂无盘点任务" />
    <el-drawer :model-value="Boolean(detail)" size="min(620px, 92vw)" append-to-body @close="detail = null">
      <template #header><div><span class="standard-drawer-eyebrow">盘点明细</span><h2>{{ detail?.name }}</h2></div></template>
      <el-descriptions v-if="detail" :column="1" border><el-descriptions-item label="任务编号">{{ detail.id }}</el-descriptions-item><el-descriptions-item label="盘点范围">{{ detail.scope }}</el-descriptions-item><el-descriptions-item label="负责人">{{ detail.owner }}</el-descriptions-item><el-descriptions-item label="盘点状态">{{ detail.progress || '未开始' }}</el-descriptions-item><el-descriptions-item label="应盘数量">{{ detail.total || 0 }}</el-descriptions-item><el-descriptions-item label="已盘数量">{{ detail.checked || 0 }}</el-descriptions-item><el-descriptions-item label="差异数量">{{ detail.diff || 0 }}</el-descriptions-item></el-descriptions>
      <template #footer><el-button v-if="detail && can('asset:stocktake:update')" type="primary" @click="openUpdate(detail)">更新盘点进度</el-button></template>
    </el-drawer>

    <el-dialog v-model="createOpen" title="新建盘点任务" width="min(620px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="盘点任务名称" required><el-input v-model="createForm.name" /></el-form-item><el-form-item label="盘点范围" required><el-input v-model="createForm.scope" /></el-form-item><el-form-item label="负责人" required><el-input v-model="createForm.owner" /></el-form-item><el-form-item label="应盘数量" required><el-input-number v-model="createForm.total" :min="1" :max="5000" /></el-form-item><el-form-item label="计划日期"><el-date-picker v-model="createForm.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item></el-form><template #footer><el-button @click="createOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitCreate">创建</el-button></template></el-dialog>
    <el-dialog v-model="updateOpen" title="更新盘点进度" width="min(520px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="已盘数量"><el-input-number v-model="updateForm.checked" :min="0" :max="updateForm.total" /></el-form-item><el-form-item label="差异数量"><el-input-number v-model="updateForm.diff" :min="0" :max="updateForm.checked" /></el-form-item></el-form><template #footer><el-button @click="updateOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitUpdate">保存</el-button></template></el-dialog>
  </section>
</template>
