<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ensurePortalSession } from '../core/auth/portal-session'

const router = useRouter()
const loading = ref(true)
const errorMessage = ref('')

onMounted(async () => {
  try {
    await ensurePortalSession(router)
    const context = window.__ASSET_PORTAL_ECP_CONTEXT__
    const target = context?.getMenuItems().find((item) => item.parentId === 'settings')
    if (!target || target.path === router.currentRoute.value.path) {
      throw new Error('当前账号没有可访问的系统页面')
    }
    await router.replace(target.path)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '系统页面加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="standard-route-state" :aria-busy="loading">
    <el-result v-if="errorMessage" icon="error" title="系统页面加载失败" :sub-title="errorMessage" />
    <el-skeleton v-else :rows="8" animated />
  </div>
</template>
