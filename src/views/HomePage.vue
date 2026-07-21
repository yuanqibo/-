<script setup lang="ts">
import StandardPortalLayout from '../core/layout/StandardPortalLayout.vue'
import DashboardView from '../features/dashboard/components/DashboardView.vue'
</script>

<template>
  <StandardPortalLayout page-title="首页" section="none">
    <DashboardView />
  </StandardPortalLayout>
</template>
