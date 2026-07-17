<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Box, HomeFilled, QuestionFilled, Setting, Tickets } from '@element-plus/icons-vue'
import { usePortalSession } from '../auth/portal-session'
import type { PortalMenuItem } from '../auth/portal-context'
import { MEMBER_AUTHORIZATION_PORTAL_PATH } from '../routing/standard-routes'

const props = withDefaults(defineProps<{ pageTitle?: string }>(), {
  pageTitle: '系统'
})

const route = useRoute()
const router = useRouter()
const { ready, loading, errorMessage, user, menuItems } = usePortalSession()

const primaryMenuIds = ['home', 'assets', 'requests', 'settings']
const primaryMenus = computed(() => primaryMenuIds
  .map((id) => menuItems.value.find((item) => item.id === id))
  .filter((item): item is PortalMenuItem => Boolean(item)))
const systemMenus = computed(() => menuItems.value
  .filter((item) => item.parentId === 'settings')
  .sort((left, right) => left.order - right.order))

const iconByMenuId = {
  home: HomeFilled,
  assets: Box,
  requests: Tickets,
  settings: Setting
} as const

const primaryActive = (item: PortalMenuItem): boolean => {
  if (item.id === 'assets') return route.path.startsWith('/assets')
  if (item.id === 'settings') return route.path.startsWith('/system')
  return route.path === item.path
}

const routePathForMenu = (item: PortalMenuItem): string =>
  item.id === 'authz.workspace' ? MEMBER_AUTHORIZATION_PORTAL_PATH : item.path

const navigate = (item: PortalMenuItem): void => {
  void router.push(routePathForMenu(item))
}

const menuIcon = (id: string) => iconByMenuId[id as keyof typeof iconByMenuId] || Setting

const logout = (): void => {
  void window.__ASSET_PORTAL_ECP_CONTEXT__?.logout()
}

const handleAccountCommand = (command: string | number | object): void => {
  if (command === 'logout') logout()
}

const reload = (): void => window.location.reload()

const avatarText = computed(() => String(user.value?.name || user.value?.account || '用').trim().slice(0, 1))

onMounted(() => {
  document.body.classList.remove('auth-view', 'has-secondary-nav', 'self-service-view')
  document.body.classList.add('standard-vue-route')
  document.title = `资产云管家 - ${props.pageTitle}`
})

onUnmounted(() => {
  document.body.classList.remove('standard-vue-route')
})
</script>

<template>
  <div v-if="errorMessage" class="standard-route-state">
    <el-result icon="error" title="页面加载失败" :sub-title="errorMessage">
      <template #extra>
        <el-button type="primary" @click="reload">重新加载</el-button>
      </template>
    </el-result>
  </div>
  <div v-else-if="loading || !ready" class="standard-route-state" aria-busy="true">
    <el-skeleton :rows="8" animated />
  </div>
  <div v-else class="app-shell standard-portal-shell">
    <aside class="sidebar">
      <div class="sidebar-account-host">
        <el-dropdown trigger="click" @command="handleAccountCommand">
          <button class="standard-account-entry" type="button" :title="user?.name || '账号管理'">
            <el-avatar :size="42" :src="user?.avatar">{{ avatarText }}</el-avatar>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item disabled>{{ user?.name }} · {{ user?.roleName }}</el-dropdown-item>
              <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <nav class="nav" aria-label="主导航">
        <div class="nav-content">
          <div class="nav-section">
            <div v-for="item in primaryMenus" :key="item.id" class="nav-group" :class="{ 'has-children': item.id === 'assets' }">
              <button
                class="nav-item"
                :class="{ active: primaryActive(item) }"
                type="button"
                :title="item.id === 'requests' ? '审批' : item.title"
                :aria-current="primaryActive(item) ? 'page' : undefined"
                @click="navigate(item)"
              >
                <span class="nav-icon">
                  <el-icon :size="32"><component :is="menuIcon(item.id)" /></el-icon>
                </span>
                <span class="nav-label">{{ item.id === 'requests' ? '审批' : item.title }}</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div class="sidebar-tools">
        <el-tooltip content="系统使用说明" placement="right">
          <button class="sidebar-tool" type="button" aria-label="系统使用说明">
            <span class="sidebar-tool-icon"><el-icon><QuestionFilled /></el-icon></span>
          </button>
        </el-tooltip>
      </div>
    </aside>

    <main class="workspace">
      <section class="page">
        <section class="system-page">
          <aside class="system-menu-shell">
            <div class="asset-subnav system-menu">
              <div class="asset-subnav-heading">
                <span class="asset-subnav-accent" aria-hidden="true"></span>
                <h2>系统</h2>
              </div>
              <div class="asset-subnav-rule" aria-hidden="true"></div>
              <div class="asset-subnav-list">
                <button
                  v-for="item in systemMenus"
                  :key="item.id"
                  class="asset-subnav-item"
                  :class="{ active: route.path === routePathForMenu(item) }"
                  type="button"
                  :aria-current="route.path === routePathForMenu(item) ? 'page' : undefined"
                  @click="navigate(item)"
                >
                  <span class="asset-subnav-dot" aria-hidden="true"></span>
                  <span class="asset-subnav-label">{{ item.id === 'authz.workspace' ? '成员授权' : item.title }}</span>
                </button>
              </div>
            </div>
          </aside>
          <div class="system-content standard-system-content">
            <slot />
          </div>
        </section>
      </section>
    </main>
  </div>
</template>
