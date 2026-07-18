<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Box, CircleCheck, Clock, Refresh, Tickets } from '@element-plus/icons-vue'
import { usePortalSession } from '../../../core/auth/portal-session'
import { useDashboard } from '../composables/useDashboard'

const router = useRouter()
const { user } = usePortalSession()
const { state, assets, requests, metrics, load } = useDashboard()
const recentAssets = computed(() => assets.value.slice(0, 6))
const recentRequests = computed(() => requests.value.slice(0, 6))
</script>

<template>
  <section class="standard-business-view dashboard-view">
    <header class="standard-page-header"><div><h1>你好，{{ user?.name }}</h1><p>这里汇总当前权限范围内的资产与审批动态。</p></div><el-button :icon="Refresh" @click="load">刷新</el-button></header>
    <div class="standard-metric-grid"><article v-for="(item, index) in metrics" :key="item.label" class="standard-metric" :class="`tone-${item.tone}`"><el-icon :size="24"><Box v-if="index === 0" /><CircleCheck v-else-if="index === 1" /><Clock v-else-if="index === 2" /><Tickets v-else /></el-icon><span>{{ item.label }}</span><strong>{{ item.value }}</strong><small>{{ item.note }}</small></article></div>
    <div class="standard-dashboard-grid">
      <section class="standard-dashboard-panel"><div class="standard-section-title"><div><h2>最近资产</h2><p>最新登记和变更的资产。</p></div><el-button link type="primary" @click="router.push('/assets')">查看全部</el-button></div><el-table v-loading="state.loading" :data="recentAssets"><el-table-column prop="name" label="资产名称" min-width="150" /><el-table-column prop="id" label="资产编码" min-width="120" /><el-table-column prop="status" label="状态" width="90" /><el-table-column prop="owner" label="使用人" min-width="100" /></el-table></section>
      <section class="standard-dashboard-panel"><div class="standard-section-title"><div><h2>最近审批</h2><p>当前范围内的申请和处理状态。</p></div><el-button link type="primary" @click="router.push('/requests')">查看全部</el-button></div><el-table v-loading="state.loading" :data="recentRequests"><el-table-column prop="type" label="申请类型" min-width="120" /><el-table-column prop="applicant" label="申请人" width="100" /><el-table-column prop="status" label="状态" width="100" /><el-table-column prop="date" label="申请日期" width="120" /></el-table></section>
    </div>
  </section>
</template>
