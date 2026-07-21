<script setup lang="ts">
import { CACHEABLE_PORTAL_PAGE_NAMES } from '../core/routing/standard-routes'
</script>

<template>
  <RouterView v-slot="{ Component }">
    <KeepAlive :include="CACHEABLE_PORTAL_PAGE_NAMES" :max="24">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
</template>
