<script setup lang="ts">
import StandardPortalLayout from '../core/layout/StandardPortalLayout.vue'
import ApprovalListView from '../features/approvals/components/ApprovalListView.vue'
</script>

<template>
  <StandardPortalLayout page-title="审批" section="none">
    <ApprovalListView />
  </StandardPortalLayout>
</template>
