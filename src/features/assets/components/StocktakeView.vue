<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
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
  <section class="stocktake-view">
    <section class="hero"><h1>资产盘点</h1><p>支持普通管理员扫码盘点、员工自助盘点、照片水印和盘盈盘亏处理。</p><div v-if="can('asset:stocktake:create')" class="quick-actions"><button class="btn primary" type="button" @click="openCreate">新建盘点</button></div></section>
    <section class="panel"><div class="toolbar"><input v-model="query" class="local-search" type="search" placeholder="盘点任务名称"><select><option>状态</option></select><input type="search" placeholder="负责人"><button class="btn" type="button" @click="load(true)">查询</button></div><div v-loading="state.loading" class="table-wrap"><table><thead><tr><th>任务编号</th><th>盘点任务</th><th>范围</th><th>负责人</th><th>进度</th><th>差异</th><th>计划日期</th><th>操作</th></tr></thead><tbody><tr v-for="item in rows" :key="item.id"><td>{{ item.id }}</td><td>{{ item.name }}</td><td>{{ item.scope }}</td><td>{{ item.owner }}</td><td><span class="tag blue">{{ item.progress || '盘点中' }}</span><div class="panel-subtitle">{{ item.checked || 0 }}/{{ item.total || 0 }} · {{ item.total ? Math.round(Number(item.checked || 0) * 100 / Number(item.total)) : 0 }}%</div></td><td>{{ item.diff || 0 }}</td><td>{{ item.date || '-' }}</td><td><button class="btn" type="button" @click="detail = item">查看明细</button> <button v-if="can('asset:stocktake:update')" class="btn" type="button" @click="openUpdate(item)">登记进度</button></td></tr><tr v-if="!rows.length" class="empty-row"><td colspan="8">当前账号没有可查看的盘点任务。</td></tr></tbody></table></div></section>
    <el-empty v-if="!state.loading && !rows.length" description="暂无盘点任务" />
    <el-drawer :model-value="Boolean(detail)" size="min(620px, 92vw)" append-to-body @close="detail = null">
      <template #header><div><span class="eyebrow">盘点明细</span><h2>{{ detail?.name }}</h2></div></template>
      <template v-if="detail"><div class="detail-grid"><div v-for="field in [['任务编号', detail.id], ['盘点范围', detail.scope], ['负责人', detail.owner], ['应盘数量', detail.total || 0], ['已盘数量', detail.checked || 0], ['差异数量', detail.diff || 0], ['计划日期', detail.date || '-']]" :key="String(field[0])" class="detail-item"><span class="detail-label">{{ field[0] }}</span><strong class="detail-value">{{ field[1] }}</strong></div><div class="detail-item"><span class="detail-label">状态</span><strong class="detail-value"><span class="tag blue">{{ detail.progress || '未开始' }}</span></strong></div></div><h3>差异处理</h3><div class="timeline"><div class="timeline-item"><div class="timeline-date">盘亏</div><div><div class="timeline-title">{{ detail.diff || 0 }} 项差异待核查</div><div class="timeline-desc">建议发起资产核查或报废流程。</div></div></div><div class="timeline-item"><div class="timeline-date">照片</div><div><div class="timeline-title">盘点照片待审核</div><div class="timeline-desc">移动端上传照片带时间和位置水印。</div></div></div></div></template>
      <template #footer><el-button v-if="detail && can('asset:stocktake:update')" type="primary" @click="openUpdate(detail)">更新盘点进度</el-button></template>
    </el-drawer>

    <el-dialog v-model="createOpen" title="新建盘点任务" width="min(620px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="盘点任务名称" required><el-input v-model="createForm.name" /></el-form-item><el-form-item label="盘点范围" required><el-input v-model="createForm.scope" /></el-form-item><el-form-item label="负责人" required><el-input v-model="createForm.owner" /></el-form-item><el-form-item label="应盘数量" required><el-input-number v-model="createForm.total" :min="1" :max="5000" /></el-form-item><el-form-item label="计划日期"><el-date-picker v-model="createForm.date" value-format="YYYY-MM-DD" style="width: 100%" /></el-form-item></el-form><template #footer><el-button @click="createOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitCreate">创建</el-button></template></el-dialog>
    <el-dialog v-model="updateOpen" title="更新盘点进度" width="min(520px, 94vw)" append-to-body><el-form label-position="top"><el-form-item label="已盘数量"><el-input-number v-model="updateForm.checked" :min="0" :max="updateForm.total" /></el-form-item><el-form-item label="差异数量"><el-input-number v-model="updateForm.diff" :min="0" :max="updateForm.checked" /></el-form-item></el-form><template #footer><el-button @click="updateOpen = false">取消</el-button><el-button type="primary" :loading="submitting" @click="submitUpdate">保存</el-button></template></el-dialog>
  </section>
</template>
