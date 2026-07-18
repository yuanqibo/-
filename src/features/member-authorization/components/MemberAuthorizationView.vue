<script setup lang="ts">
import { useMemberAuthorizationBridge } from '../composables/useMemberAuthorizationBridge'

const { frame, state, workspaceUrl, frameLoaded } = useMemberAuthorizationBridge()
</script>

<template>
  <section class="standard-business-view member-authorization-view">
    <header class="standard-page-header"><div><h1>成员授权</h1><p>使用 ECP 工作台管理应用角色、账号授权和权限范围。</p></div></header>
    <el-alert v-if="state.errorMessage" :title="state.errorMessage" type="warning" show-icon :closable="false" />
    <div class="account-management-frame-anchor"><div class="account-management-frame-shell" :class="{ 'is-workspace-drawer-open': state.overlayOpen }"><div v-if="!state.loaded" class="account-management-frame-loading">正在加载 ECP 成员授权工作台...</div><iframe ref="frame" class="account-management-frame" :src="workspaceUrl" title="ECP 成员授权工作台" @load="frameLoaded"></iframe></div></div>
  </section>
</template>
