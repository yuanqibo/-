<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'
import { useAssets } from '../composables/useAssets'
import type { BusinessRecord } from '../types/assets'

const { state, business, load } = useAssets()
const query = ref('')
const detail = ref<BusinessRecord | null>(null)
const rows = computed(() => (business.value.stocktakes || []).filter((item) => {
  const keyword = query.value.trim().toLowerCase()
  return !keyword || [item.id, item.name, item.scope, item.owner].some((value) => String(value || '').toLowerCase().includes(keyword))
}))
onMounted(() => void load())
</script>

<template>
  <section class="standard-business-view">
    <header class="standard-page-header"><div><h1>资产盘点</h1><p>查看盘点任务、完成进度与差异处理情况。</p></div><el-button :icon="Refresh" @click="load(true)">刷新</el-button></header>
    <div class="standard-toolbar"><el-input v-model="query" clearable :prefix-icon="Search" placeholder="搜索任务编号、名称或负责人" /></div>
    <div class="standard-table-shell"><el-table v-loading="state.loading" :data="rows" height="100%" row-key="id">
      <el-table-column prop="id" label="任务编号" min-width="140" /><el-table-column prop="name" label="盘点任务" min-width="180" />
      <el-table-column prop="scope" label="盘点范围" min-width="180" /><el-table-column prop="owner" label="负责人" width="120" />
      <el-table-column label="进度" min-width="180"><template #default="scope"><el-progress :percentage="scope.row.total ? Math.round((scope.row.checked || 0) * 100 / scope.row.total) : 0" /></template></el-table-column>
      <el-table-column prop="diff" label="差异数量" width="100" /><el-table-column prop="date" label="计划日期" width="130" />
      <el-table-column label="操作" width="90"><template #default="scope"><el-button link type="primary" @click="detail = scope.row">详情</el-button></template></el-table-column>
    </el-table></div>
    <el-empty v-if="!state.loading && !rows.length" description="暂无盘点任务" />
    <el-drawer :model-value="Boolean(detail)" size="min(620px, 92vw)" append-to-body @close="detail = null">
      <template #header><div><span class="standard-drawer-eyebrow">盘点明细</span><h2>{{ detail?.name }}</h2></div></template>
      <el-descriptions v-if="detail" :column="1" border><el-descriptions-item label="任务编号">{{ detail.id }}</el-descriptions-item><el-descriptions-item label="盘点范围">{{ detail.scope }}</el-descriptions-item><el-descriptions-item label="负责人">{{ detail.owner }}</el-descriptions-item><el-descriptions-item label="应盘数量">{{ detail.total || 0 }}</el-descriptions-item><el-descriptions-item label="已盘数量">{{ detail.checked || 0 }}</el-descriptions-item><el-descriptions-item label="差异数量">{{ detail.diff || 0 }}</el-descriptions-item></el-descriptions>
    </el-drawer>
  </section>
</template>
