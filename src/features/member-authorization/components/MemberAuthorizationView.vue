<script setup lang="ts">
import { ref } from 'vue'
import AuthzWorkspaceHost from '@acg/ecp-auth-vue/workspace/vue'

const loaded = ref(false)
const errorMessage = ref('')

const handleLoaded = (): void => {
  loaded.value = true
  errorMessage.value = ''
}

const handleError = (error: unknown): void => {
  loaded.value = false
  errorMessage.value = error instanceof Error ? error.message : '成员授权工作台加载失败'
}
</script>

<template>
  <section class="member-authorization-view" aria-labelledby="member-authorization-title">
    <header class="member-authorization-header">
      <div>
        <h2 id="member-authorization-title" class="panel-title">成员授权</h2>
        <div class="panel-subtitle">管理应用角色、账号授权和权限模型。</div>
      </div>
    </header>
    <el-alert v-if="errorMessage" :title="errorMessage" type="error" show-icon :closable="false" />
    <div class="member-authorization-workspace-shell" :aria-busy="!loaded">
      <div v-if="!loaded && !errorMessage" class="member-authorization-loading">正在加载成员授权...</div>
      <AuthzWorkspaceHost
        class="member-authorization-workspace"
        style-scope-mode="strict"
        :auto-redirect-on-unauthorized="true"
        @loaded="handleLoaded"
        @error="handleError"
      />
    </div>
  </section>
</template>
