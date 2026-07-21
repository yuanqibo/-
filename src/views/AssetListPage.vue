<script setup lang="ts">
import StandardPortalLayout from '../core/layout/StandardPortalLayout.vue'
import AssetDirectoryView from '../features/assets/components/AssetDirectoryView.vue'
</script>

<template>
  <StandardPortalLayout page-title="资产列表" section="assets">
    <AssetDirectoryView mode="list" />
  </StandardPortalLayout>
</template>
