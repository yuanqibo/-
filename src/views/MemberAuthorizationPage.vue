<script setup lang="ts">
import StandardPortalLayout from '../core/layout/StandardPortalLayout.vue'
import MemberAuthorizationView from '../features/member-authorization/components/MemberAuthorizationView.vue'

defineOptions({ name: 'MemberAuthorizationPage' })
</script>

<template>
  <StandardPortalLayout page-title="成员授权" section="system">
    <MemberAuthorizationView />
  </StandardPortalLayout>
</template>
