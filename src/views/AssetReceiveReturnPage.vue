<script setup lang="ts">
import StandardPortalLayout from '../core/layout/StandardPortalLayout.vue'
import AssetDirectoryView from '../features/assets/components/AssetDirectoryView.vue'
</script>

<template>
  <StandardPortalLayout page-title="领用退库" section="assets">
    <AssetDirectoryView mode="receive-return" />
  </StandardPortalLayout>
</template>
