<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Bell, QuestionFilled } from '@element-plus/icons-vue'
import { ElNotification } from 'element-plus'
import { usePortalSession } from '../auth/portal-session'
import { useTerminalMode, type PortalTerminalMode } from '../auth/terminal-mode'
import type { PortalMenuItem } from '../auth/portal-context'
import ApprovalNotificationDialog from '../../features/approvals/components/ApprovalNotificationDialog.vue'
import { useApprovals } from '../../features/approvals/composables/useApprovals'
import type { ApprovalRecord } from '../../features/approvals/types/approval'
import PortalNavIcon from './PortalNavIcon.vue'
import { subnavScrollState } from './subnav-scroll-state'

type LayoutSection = 'auto' | 'assets' | 'system' | 'none'

const knownPendingApprovalIds = new Set<string>()
let approvalNotificationBaselineReady = false

const props = withDefaults(defineProps<{ pageTitle?: string; section?: LayoutSection }>(), {
  pageTitle: '',
  section: 'auto'
})

const route = useRoute()
const router = useRouter()
const { ready, loading, errorMessage, user, menuItems } = usePortalSession()
const { isEmployeeTerminal, canSwitchTerminal, setTerminalMode } = useTerminalMode()
const { rows: approvalRows, load: loadApprovals } = useApprovals()
const openAssetGroups = ref(new Set<string>())
const assetSubnav = ref<HTMLElement>()
const systemSubnav = ref<HTMLElement>()
const layoutActive = ref(true)
const approvalNotificationOpen = ref(false)
const routePreloads = new Map<string, Promise<void>>()
let approvalRefreshTimer: ReturnType<typeof setInterval> | null = null

const pendingStatuses = new Set(['审批中', '待审批', '待执行'])
const canReviewApprovals = computed(() => !isEmployeeTerminal.value
  && (user.value?.permissionCodes || []).includes('asset:request:review'))
const pendingApprovals = computed(() => approvalRows.value.filter((item) =>
  pendingStatuses.has(item.status) && !item.decisionSubmitted))
const approvalNotificationLabel = computed(() => pendingApprovals.value.length
  ? `审批消息，${pendingApprovals.value.length} 条待处理`
  : '审批消息，暂无待处理')

const resolvedSection = computed<Exclude<LayoutSection, 'auto'>>(() => {
  if (ready.value && isEmployeeTerminal.value && (props.section === 'assets' || route.path.startsWith('/assets'))) return 'none'
  if (props.section !== 'auto') return props.section
  if (route.path.startsWith('/assets')) return 'assets'
  if (route.path.startsWith('/system')) return 'system'
  return 'none'
})

const primaryMenuIds = ['home', 'assets', 'signatures', 'requests', 'settings']
const employeePortalPaths = new Set(['/', '/signatures', '/requests'])
const primaryMenus = computed(() => primaryMenuIds
  .map((id) => menuItems.value.find((item) => item.id === id))
  .filter((item): item is PortalMenuItem => Boolean(item))
  .filter((item) => isEmployeeTerminal.value
    ? ['home', 'signatures', 'requests'].includes(item.id)
    : item.id !== 'signatures'))
const systemMenus = computed(() => menuItems.value
  .filter((item) => item.parentId === 'settings')
  .sort((left, right) => left.order - right.order))
const assetMenus = computed(() => menuItems.value
  .filter((item) => item.parentId === 'assets')
  .sort((left, right) => left.order - right.order))
const assetRootMenu = computed(() => menuItems.value.find((item) => item.id === 'assets') || null)

const assetChildren = (parentId: string): PortalMenuItem[] => menuItems.value
  .filter((item) => item.parentId === parentId)
  .sort((left, right) => left.order - right.order)

const primaryActive = (item: PortalMenuItem): boolean => {
  if (item.id === 'assets') return route.path.startsWith('/assets')
  if (item.id === 'settings') {
    return route.path.startsWith('/system') || systemMenus.value.some((menu) => menu.path === route.path)
  }
  return route.path === item.path
}

const routePathForMenu = (item: PortalMenuItem): string => item.path

const preloadPath = (path: string): Promise<void> => {
  const existing = routePreloads.get(path)
  if (existing) return existing
  const loaders = router.resolve(path).matched.flatMap((record) => Object.values(record.components || {}))
    .filter((component): component is () => Promise<unknown> => typeof component === 'function')
  const preload = Promise.all(loaders.map((loader) => Promise.resolve(loader()))).then(() => undefined).catch(() => {
    routePreloads.delete(path)
  })
  routePreloads.set(path, preload)
  return preload
}
const preloadMenuRoute = (item: PortalMenuItem): void => { void preloadPath(routePathForMenu(item)) }
const primaryTarget = (item: PortalMenuItem): PortalMenuItem =>
  item.id === 'settings' ? systemMenus.value[0] || item : item
const preloadPrimaryMenuRoute = (item: PortalMenuItem): void => preloadMenuRoute(primaryTarget(item))
const rememberSubnavScroll = (force = false): void => {
  if (subnavScrollState.navigationPending && !force) return
  if (assetSubnav.value) subnavScrollState.asset = assetSubnav.value.scrollTop
  if (systemSubnav.value) subnavScrollState.system = systemSubnav.value.scrollTop
}
const handleSubnavScroll = (): void => rememberSubnavScroll()

const restoreSubnavScroll = async (): Promise<void> => {
  await nextTick()
  if (assetSubnav.value) assetSubnav.value.scrollTop = subnavScrollState.asset
  if (systemSubnav.value) systemSubnav.value.scrollTop = subnavScrollState.system
}

const navigate = (item: PortalMenuItem): void => {
  const target = routePathForMenu(item)
  if (target === route.path) return
  rememberSubnavScroll(true)
  subnavScrollState.navigationPending = true
  void router.push(target).finally(async () => {
    await restoreSubnavScroll()
    subnavScrollState.navigationPending = false
  })
}

const navigatePrimary = (item: PortalMenuItem): void => {
  if (primaryActive(item)) return
  navigate(primaryTarget(item))
}

const openApprovalNotifications = (): void => {
  approvalNotificationOpen.value = true
  void loadApprovals()
}

const openApprovalRequest = (item: ApprovalRecord): void => {
  approvalNotificationOpen.value = false
  void router.push({ path: '/requests', query: { request: item.id } })
}

const refreshApprovalNotifications = async (): Promise<void> => {
  if (!layoutActive.value || !canReviewApprovals.value) return
  await loadApprovals()
  if (!approvalNotificationBaselineReady) {
    pendingApprovals.value.forEach((item) => knownPendingApprovalIds.add(item.id))
    approvalNotificationBaselineReady = true
  }
}

const stopApprovalRefresh = (): void => {
  if (!approvalRefreshTimer) return
  clearInterval(approvalRefreshTimer)
  approvalRefreshTimer = null
}

const startApprovalRefresh = (): void => {
  stopApprovalRefresh()
  if (!canReviewApprovals.value) return
  void refreshApprovalNotifications()
  approvalRefreshTimer = setInterval(() => { void refreshApprovalNotifications() }, 15_000)
}

const logout = (): void => { void window.__ASSET_PORTAL_ECP_CONTEXT__?.logout() }
const handleAccountCommand = (command: string | number | object): void => {
  if (command === 'logout') logout()
  if (command === 'management' || command === 'employee') switchTerminal(command)
}
const switchTerminal = (mode: PortalTerminalMode): void => {
  if (!setTerminalMode(mode)) return
  if (mode === 'employee' && !employeePortalPaths.has(route.path)) void router.push('/')
}
const reload = (): void => window.location.reload()
const avatarText = computed(() => String(user.value?.name || user.value?.account || '用').trim().slice(0, 1))
const syncActiveLayout = (): void => {
  document.body.classList.remove('auth-view', 'has-secondary-nav', 'self-service-view')
  document.body.classList.add('standard-vue-route')
  document.body.classList.toggle('employee-terminal-view', ready.value && isEmployeeTerminal.value)
  document.title = '资产管理平台'
  void restoreSubnavScroll()
}

const hasActiveAssetChild = (item: PortalMenuItem): boolean =>
  assetChildren(item.id).some((child) => route.path === child.path)

const toggleAssetGroup = (id: string): void => {
  const next = new Set(openAssetGroups.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  openAssetGroups.value = next
}

watch([() => route.path, assetMenus], () => {
  const parent = assetMenus.value.find((item) => hasActiveAssetChild(item))
  if (parent) openAssetGroups.value = new Set([...openAssetGroups.value, parent.id])
}, { immediate: true })

watch([() => route.path, openAssetGroups], () => { void restoreSubnavScroll() }, { flush: 'post' })

watch([ready, isEmployeeTerminal, () => route.path], ([sessionReady, employee, path]) => {
  if (sessionReady && employee && !employeePortalPaths.has(path)) void router.replace('/')
}, { immediate: true })

watch(
  [() => pendingApprovals.value.map((item) => item.id).join('|'), canReviewApprovals],
  () => {
    if (!approvalNotificationBaselineReady || !layoutActive.value || !canReviewApprovals.value) return
    const newItems = pendingApprovals.value.filter((item) => !knownPendingApprovalIds.has(item.id))
    if (!newItems.length) return
    newItems.forEach((item) => knownPendingApprovalIds.add(item.id))
    ElNotification({
      title: '新增审批待办',
      message: newItems.length === 1
        ? `${newItems[0].applicant}提交了${newItems[0].type}申请`
        : `新增 ${newItems.length} 条审批申请，请及时处理`,
      type: 'info',
      position: 'bottom-left',
      duration: 5_000,
      onClick: () => { approvalNotificationOpen.value = true }
    })
  }
)

watch(canReviewApprovals, () => {
  if (layoutActive.value) startApprovalRefresh()
  if (!canReviewApprovals.value) approvalNotificationOpen.value = false
})

onMounted(() => {
  syncActiveLayout()
  startApprovalRefresh()
})

onActivated(() => {
  layoutActive.value = true
  syncActiveLayout()
  startApprovalRefresh()
})
onDeactivated(() => {
  layoutActive.value = false
  stopApprovalRefresh()
  document.body.classList.remove('standard-vue-route', 'employee-terminal-view')
})

watch([ready, isEmployeeTerminal], ([sessionReady, employee]) => {
  if (layoutActive.value) document.body.classList.toggle('employee-terminal-view', sessionReady && employee)
})

onBeforeUnmount(() => { if (layoutActive.value) rememberSubnavScroll() })

onUnmounted(() => {
  stopApprovalRefresh()
  if (!layoutActive.value) return
  document.body.classList.remove('standard-vue-route')
  document.body.classList.remove('employee-terminal-view')
})
</script>

<template>
  <div v-if="errorMessage" class="standard-route-state">
    <el-result icon="error" title="页面加载失败" :sub-title="errorMessage">
      <template #extra><el-button type="primary" @click="reload">重新加载</el-button></template>
    </el-result>
  </div>
  <div v-else-if="loading || !ready" class="standard-route-state" aria-busy="true">
    <el-skeleton :rows="8" animated />
  </div>
  <div v-else class="app-shell standard-portal-shell" :class="`standard-section-${resolvedSection}`">
    <aside class="sidebar">
      <div class="sidebar-account-host">
        <el-dropdown trigger="click" @command="handleAccountCommand">
          <button class="standard-account-entry" type="button" :title="user?.name || '账号管理'" :aria-label="user?.name || '账号管理'">
            <el-avatar :size="42" :src="user?.avatar">{{ avatarText }}</el-avatar>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item disabled>{{ user?.name }} · {{ user?.roleName }}</el-dropdown-item>
              <el-dropdown-item v-if="canSwitchTerminal" :command="isEmployeeTerminal ? 'management' : 'employee'">{{ isEmployeeTerminal ? '切换管理端' : '切换员工端' }}</el-dropdown-item>
              <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <nav class="nav" aria-label="主导航">
        <div class="nav-content"><div class="nav-section">
          <div v-for="item in primaryMenus" :key="item.id" class="nav-group" :class="{ 'has-children': item.id === 'assets' }">
            <button class="nav-item" :class="{ active: primaryActive(item) }" type="button"
              :title="item.id === 'requests' ? (isEmployeeTerminal ? '申请' : '审批') : item.title"
              :aria-current="primaryActive(item) ? 'page' : undefined" :disabled="primaryActive(item)"
              @pointerenter="preloadPrimaryMenuRoute(item)" @focus="preloadPrimaryMenuRoute(item)" @click="navigatePrimary(item)">
              <span class="nav-icon"><PortalNavIcon :kind="item.id" /></span>
              <span class="nav-label">{{ item.id === 'requests' ? (isEmployeeTerminal ? '申请' : '审批') : item.title }}</span>
            </button>
          </div>
        </div></div>
      </nav>

      <div class="sidebar-tools">
        <el-tooltip v-if="canReviewApprovals" content="审批消息" placement="right">
          <button
            class="sidebar-tool sidebar-notification-tool"
            type="button"
            :aria-label="approvalNotificationLabel"
            @click="openApprovalNotifications"
          >
            <span class="sidebar-tool-icon"><el-icon><Bell /></el-icon></span>
            <span v-if="pendingApprovals.length" class="sidebar-notification-badge" aria-hidden="true">
              {{ pendingApprovals.length > 99 ? '99+' : pendingApprovals.length }}
            </span>
          </button>
        </el-tooltip>
        <el-tooltip content="系统使用说明" placement="right">
          <button class="sidebar-tool" type="button" aria-label="系统使用说明">
            <span class="sidebar-tool-icon"><el-icon><QuestionFilled /></el-icon></span>
          </button>
        </el-tooltip>
      </div>
    </aside>

    <main class="workspace">
      <section class="page">
        <section v-if="resolvedSection === 'system'" class="system-page">
          <aside class="system-menu-shell">
            <div ref="systemSubnav" class="asset-subnav system-menu" @scroll="handleSubnavScroll">
              <div class="asset-subnav-heading"><span class="asset-subnav-accent" aria-hidden="true"></span><h2>系统</h2></div>
              <div class="asset-subnav-rule" aria-hidden="true"></div>
              <div class="asset-subnav-list">
                <button v-for="item in systemMenus" :key="item.id" class="asset-subnav-item"
                  :class="{ active: route.path === routePathForMenu(item) }" type="button"
                  :aria-current="route.path === routePathForMenu(item) ? 'page' : undefined" @pointerenter="preloadMenuRoute(item)" @focus="preloadMenuRoute(item)" @click="navigate(item)">
                  <span class="asset-subnav-dot" aria-hidden="true"></span>
                  <span class="asset-subnav-label">{{ item.id === 'authz.workspace' ? '成员授权' : item.title }}</span>
                </button>
              </div>
            </div>
          </aside>
          <div class="system-content standard-system-content"><slot /></div>
        </section>

        <section v-else-if="resolvedSection === 'assets'" class="system-page standard-assets-page">
          <aside class="system-menu-shell">
            <div ref="assetSubnav" class="asset-subnav" @scroll="handleSubnavScroll">
              <div class="asset-subnav-heading"><span class="asset-subnav-accent" aria-hidden="true"></span><h2>资产</h2></div>
              <div class="asset-subnav-rule" aria-hidden="true"></div>
              <div class="asset-subnav-list">
                <button v-if="assetRootMenu" class="asset-subnav-item" :class="{ active: route.path === assetRootMenu.path }" type="button" @pointerenter="preloadMenuRoute(assetRootMenu)" @focus="preloadMenuRoute(assetRootMenu)" @click="navigate(assetRootMenu)">
                  <span class="asset-subnav-dot" aria-hidden="true"></span><span class="asset-subnav-label">资产列表</span>
                </button>
                <template v-for="item in assetMenus" :key="item.id">
                  <div v-if="assetChildren(item.id).length" class="asset-subnav-group" :class="{ open: openAssetGroups.has(item.id) }">
                    <button class="asset-subnav-item asset-subnav-parent" :class="{ active: route.path === item.path || hasActiveAssetChild(item) }"
                      type="button" :aria-expanded="openAssetGroups.has(item.id)" @pointerenter="preloadMenuRoute(item)" @focus="preloadMenuRoute(item)" @click="toggleAssetGroup(item.id)">
                      <span class="asset-subnav-dot" aria-hidden="true"></span><span class="asset-subnav-label">{{ item.title }}</span>
                      <span class="asset-subnav-caret" aria-hidden="true"></span>
                    </button>
                    <div class="asset-subnav-children" :aria-hidden="!openAssetGroups.has(item.id)" :inert="!openAssetGroups.has(item.id)">
                      <div class="asset-subnav-children-inner">
                        <button v-for="child in assetChildren(item.id)" :key="child.id" class="asset-subnav-child"
                          :class="{ active: route.path === child.path }" type="button" @pointerenter="preloadMenuRoute(child)" @focus="preloadMenuRoute(child)" @click="navigate(child)">{{ child.title }}</button>
                      </div>
                    </div>
                  </div>
                  <button v-else class="asset-subnav-item" :class="{ active: route.path === item.path }" type="button" @pointerenter="preloadMenuRoute(item)" @focus="preloadMenuRoute(item)" @click="navigate(item)">
                    <span class="asset-subnav-dot" aria-hidden="true"></span><span class="asset-subnav-label">{{ item.title }}</span>
                  </button>
                </template>
              </div>
            </div>
          </aside>
          <div class="system-content standard-system-content"><slot /></div>
        </section>

        <template v-else><slot /></template>
      </section>
    </main>

    <ApprovalNotificationDialog
      v-if="canReviewApprovals"
      v-model="approvalNotificationOpen"
      :items="pendingApprovals"
      @select="openApprovalRequest"
    />
  </div>
</template>
