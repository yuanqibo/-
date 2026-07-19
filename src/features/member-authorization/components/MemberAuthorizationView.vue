<script setup lang="ts">
import { useMemberAuthorizationWorkspace } from '../composables/useMemberAuthorizationWorkspace'

const { state, bindFrame, frameLoaded } = useMemberAuthorizationWorkspace()
</script>

<template>
  <div class="system-content member-authorization-view">
    <section class="panel account-management-panel">
    <div class="panel-header"><div><h2 class="panel-title">成员授权</h2><div class="panel-subtitle">使用 ECP SDK 工作台管理应用角色、账号授权和权限模型，保持在资产系统内操作。</div></div></div>
    <el-alert v-if="state.errorMessage" :title="state.errorMessage" type="warning" show-icon :closable="false" />
    <div class="account-management-frame-anchor"><div class="account-management-frame-shell" :class="{ 'is-workspace-docked': state.docked, 'is-workspace-drawer-open': state.overlayOpen }"><div v-if="!state.loaded" class="account-management-frame-loading">正在加载 ECP 成员授权工作台...</div><iframe :ref="bindFrame" class="account-management-frame" src="about:blank" title="ECP 成员授权工作台" loading="eager" @load="frameLoaded"></iframe></div></div>
    </section>
  </div>
</template>
