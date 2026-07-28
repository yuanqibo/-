<script setup lang="ts">
import { onMounted, ref } from 'vue'

const emit = defineEmits<{ loaded: [] }>()
const assignmentOpen = ref(false)
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
        <table><tbody><tr><td>应用管理员</td><td>APP_ADMIN</td><td><button type="button" @click="assignmentOpen = true">分配给成员</button></td></tr></tbody></table>
      </section>
    </section>
    <div v-if="assignmentOpen" class="el-overlay">
      <section class="target-workspace-assignment-dialog" role="dialog" aria-label="分配 应用管理员 角色">
        <h2>分配 应用管理员 角色</h2>
        <button type="button" @click="assignmentOpen = false">取消</button>
      </section>
    </div>
  </main>
</template>
