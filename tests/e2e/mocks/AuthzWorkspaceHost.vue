<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const emit = defineEmits<{ loaded: [] }>()
const activeView = ref<'roles' | 'accounts'>('roles')
const assignmentOpen = ref(false)
const roleDetailOpen = ref(false)
const accountPermissionOpen = ref(false)
const memberQuery = ref('')
const memberSearchCount = ref(0)
onMounted(() => {
  document.documentElement.style.setProperty('--ecp-primary-500', '#3370ff')
  emit('loaded')
})
onBeforeUnmount(() => document.documentElement.style.removeProperty('--ecp-primary-500'))
</script>

<template>
  <main class="authz-workspace-host">
    <section class="target-workspace">
      <div class="workspace-step-strip">
        <button class="workspace-step-strip__item" :class="{ 'is-active': activeView === 'roles' }" type="button" @click="activeView = 'roles'">01 应用角色 4 个角色</button>
        <button class="workspace-step-strip__item" :class="{ 'is-active': activeView === 'accounts' }" type="button" @click="activeView = 'accounts'">02 账号管理 3 条授权</button>
        <div class="workspace-step-strip__item">03 查权限原因</div>
      </div>
      <section v-if="activeView === 'roles'" class="workspace-account-management">
        <h2>应用角色</h2>
        <p>应用角色才会真正分给成员。</p>
        <table><tbody><tr><td>应用管理员</td><td>APP_ADMIN</td><td><button type="button" @click="roleDetailOpen = true">详情</button><button type="button" @click="assignmentOpen = true">分配给成员</button></td></tr></tbody></table>
      </section>
      <section v-else class="workspace-account-management">
        <h2>账号管理</h2>
        <button type="button" @click="accountPermissionOpen = true">添加权限</button>
      </section>
    </section>
    <Teleport to="body">
      <div v-show="assignmentOpen" class="el-overlay">
        <div class="el-overlay-dialog is-align-center" style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%">
          <section class="target-workspace-assignment-dialog el-dialog" style="width: min(1000px, 92vw)" role="dialog" aria-label="分配 应用管理员 角色">
            <h2>分配 应用管理员 角色</h2>
            <div class="ecp-entity-selector__toolbar">
              <input v-model="memberQuery" aria-label="搜索授权对象" @keyup.enter="memberSearchCount += 1">
              <span data-member-search-count>检索次数 {{ memberSearchCount }}</span>
            </div>
            <button type="button" @click="assignmentOpen = false">取消</button>
          </section>
        </div>
      </div>
    </Teleport>
    <Teleport to="body">
      <div v-show="roleDetailOpen" class="el-overlay is-drawer">
        <section class="role-editor-wizard-drawer el-drawer rtl" style="width: var(--authz-role-editor-drawer-width); height: 100%" role="dialog" aria-label="编辑应用角色">
          <h2>编辑应用角色</h2>
          <button type="button" aria-label="关闭角色详情" @click="roleDetailOpen = false">关闭</button>
        </section>
      </div>
    </Teleport>
    <Teleport to="body">
      <div v-show="accountPermissionOpen" class="el-overlay is-drawer">
        <section class="target-workspace-subject-assignment-drawer el-drawer rtl" style="width: var(--authz-editor-drawer-width); height: 100%" role="dialog" aria-label="新增权限配置">
          <h2>新增权限配置</h2>
          <button type="button" aria-label="关闭账号授权" @click="accountPermissionOpen = false">关闭</button>
        </section>
      </div>
    </Teleport>
  </main>
</template>
