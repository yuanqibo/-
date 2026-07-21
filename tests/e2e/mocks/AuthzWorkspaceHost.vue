<script setup lang="ts">
import { onMounted } from 'vue'

const emit = defineEmits<{ loaded: [] }>()
onMounted(() => emit('loaded'))
</script>

<template>
  <main class="authz-workspace-host">
    <section class="target-workspace">
      <div class="workspace-step-strip">
        <div class="workspace-step-strip__item is-active">01 应用角色</div>
        <div class="workspace-step-strip__item">02 账号管理</div>
        <div class="workspace-step-strip__item">03 查权限原因</div>
      </div>
      <section class="workspace-account-management">
        <h2>应用角色</h2>
        <p>应用角色才会真正分给成员。</p>
        <table><tbody><tr><td>应用管理员</td><td>APP_ADMIN</td><td>分配给成员</td></tr></tbody></table>
      </section>
    </section>
  </main>
</template>
