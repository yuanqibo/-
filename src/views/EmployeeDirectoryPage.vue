<script setup lang="ts">
import StandardPortalLayout from '../core/layout/StandardPortalLayout.vue'
import EmployeeDirectoryView from '../features/employees/components/EmployeeDirectoryView.vue'
import '../styles/portal.css'
</script>

<template>
  <StandardPortalLayout page-title="员工信息">
    <EmployeeDirectoryView />
  </StandardPortalLayout>
</template>
