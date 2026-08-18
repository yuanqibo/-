<script setup lang="ts">
import { ref } from 'vue'
import { CACHEABLE_PORTAL_PAGE_NAMES } from './core/routing/standard-routes'
import { router } from './router'

const routerReady = ref(false)
void router.isReady().then(() => { routerReady.value = true })

const reload = (): void => window.location.reload()
</script>

<template>
  <RouterView v-slot="{ Component }">
    <KeepAlive :include="CACHEABLE_PORTAL_PAGE_NAMES" :max="24">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
  <main v-if="!routerReady" class="portal-bootstrap" aria-busy="true" aria-live="polite">
    <div class="portal-bootstrap__indicator" aria-hidden="true" />
    <p>正在连接资产管理平台</p>
    <button type="button" @click="reload">重新加载</button>
  </main>
</template>

<style>
.portal-bootstrap {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 16px;
  padding: 24px;
  color: #344054;
  background: #f7f9fc;
  font-size: 15px;
}

.portal-bootstrap__indicator {
  width: 28px;
  height: 28px;
  border: 3px solid #cbd5e1;
  border-top-color: #1677ff;
  border-radius: 50%;
  animation: portal-bootstrap-spin 0.8s linear infinite;
}

.portal-bootstrap p { margin: 0; }

.portal-bootstrap button {
  min-width: 96px;
  min-height: 34px;
  border: 1px solid #b7c4d4;
  border-radius: 4px;
  color: #175cd3;
  background: #fff;
  cursor: pointer;
}

@keyframes portal-bootstrap-spin { to { transform: rotate(360deg); } }
</style>
