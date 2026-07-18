<script setup lang="ts">
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import StandardPortalLayout from '../core/layout/StandardPortalLayout.vue'
import OrganizationDirectoryView from '../features/organization/components/OrganizationDirectoryView.vue'
</script>

<template>
  <el-config-provider :locale="zhCn">
    <StandardPortalLayout page-title="组织架构">
      <OrganizationDirectoryView />
    </StandardPortalLayout>
  </el-config-provider>
</template>
