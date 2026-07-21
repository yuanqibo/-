<script setup lang="ts">
import StandardPortalLayout from '../core/layout/StandardPortalLayout.vue'
import SelfServiceView from '../features/system-settings/components/SelfServiceView.vue'
</script>

<template>
  <StandardPortalLayout page-title="员工自助" section="system">
    <SelfServiceView />
  </StandardPortalLayout>
</template>
