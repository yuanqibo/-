<script setup lang="ts">
import StandardPortalLayout from '../core/layout/StandardPortalLayout.vue'
import AssetDirectoryView from '../features/assets/components/AssetDirectoryView.vue'
</script>

<template>
  <StandardPortalLayout page-title="资产交接" section="assets">
    <AssetDirectoryView mode="handover" />
  </StandardPortalLayout>
</template>
