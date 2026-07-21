<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { QuestionFilled } from '@element-plus/icons-vue'
import { usePortalSession } from '../auth/portal-session'
import { useTerminalMode, type PortalTerminalMode } from '../auth/terminal-mode'
import type { PortalMenuItem } from '../auth/portal-context'
import { MEMBER_AUTHORIZATION_PORTAL_PATH } from '../routing/standard-routes'
import PortalNavIcon from './PortalNavIcon.vue'
import { subnavScrollState } from './subnav-scroll-state'

type LayoutSection = 'auto' | 'assets' | 'system' | 'none'

const props = withDefaults(defineProps<{ pageTitle?: string; section?: LayoutSection }>(), {
  pageTitle: '',
  section: 'auto'
})

const route = useRoute()
const router = useRouter()
const { ready, loading, errorMessage, user, menuItems } = usePortalSession()
const { isEmployeeTerminal, canSwitchTerminal, setTerminalMode } = useTerminalMode()
const openAssetGroups = ref(new Set<string>())
const assetSubnav = ref<HTMLElement>()
const systemSubnav = ref<HTMLElement>()
const layoutActive = ref(true)
const routePreloads = new Map<string, Promise<void>>()
let idlePreloadScheduled = false

const resolvedSection = computed<Exclude<LayoutSection, 'auto'>>(() => {
  if (ready.value && isEmployeeTerminal.value && (props.section === 'assets' || route.path.startsWith('/assets'))) return 'none'
  if (props.section !== 'auto') return props.section
  if (route.path.startsWith('/assets')) return 'assets'
  if (route.path.startsWith('/system')) return 'system'
  return 'none'
})

const primaryMenuIds = ['home', 'assets', 'requests', 'settings']
const primaryMenus = computed(() => primaryMenuIds
  .map((id) => menuItems.value.find((item) => item.id === id))
  .filter((item): item is PortalMenuItem => Boolean(item))
  .filter((item) => !isEmployeeTerminal.value || ['home', 'assets', 'requests'].includes(item.id)))
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
  if (item.id === 'settings') return route.path.startsWith('/system')
  return route.path === item.path
}

const routePathForMenu = (item: PortalMenuItem): string =>
  item.id === 'authz.workspace' ? MEMBER_AUTHORIZATION_PORTAL_PATH : item.path

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
const scheduleRoutePreload = (): void => {
  if (idlePreloadScheduled) return
  idlePreloadScheduled = true
  const preload = () => menuItems.value.forEach(preloadMenuRoute)
  const idleWindow = window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number }
  if (idleWindow.requestIdleCallback) idleWindow.requestIdleCallback(preload, { timeout: 1200 })
  else window.setTimeout(preload, 180)
}

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
  navigate(item)
}

const logout = (): void => { void window.__ASSET_PORTAL_ECP_CONTEXT__?.logout() }
const handleAccountCommand = (command: string | number | object): void => {
  if (command === 'logout') logout()
  if (command === 'management' || command === 'employee') switchTerminal(command)
}
const switchTerminal = (mode: PortalTerminalMode): void => {
  if (!setTerminalMode(mode)) return
  if (mode === 'employee' && !['/', '/assets', '/requests'].includes(route.path)) void router.push('/')
}
const reload = (): void => window.location.reload()
const avatarText = computed(() => String(user.value?.name || user.value?.account || '用').trim().slice(0, 1))
const documentTitle = computed(() => route.meta.title as string || props.pageTitle || '资产云管家')
const syncActiveLayout = (): void => {
  document.body.classList.remove('auth-view', 'has-secondary-nav', 'self-service-view')
  document.body.classList.add('standard-vue-route')
  document.body.classList.toggle('employee-terminal-view', ready.value && isEmployeeTerminal.value)
  document.title = `资产云管家 - ${documentTitle.value}`
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
  if (sessionReady && employee && !['/', '/assets', '/requests'].includes(path)) void router.replace('/')
}, { immediate: true })

onMounted(() => {
  syncActiveLayout()
  scheduleRoutePreload()
})

onActivated(() => {
  layoutActive.value = true
  syncActiveLayout()
})
onDeactivated(() => {
  layoutActive.value = false
  document.body.classList.remove('standard-vue-route', 'employee-terminal-view')
})

watch(documentTitle, (title) => { if (layoutActive.value) document.title = `资产云管家 - ${title}` })
watch([ready, isEmployeeTerminal], ([sessionReady, employee]) => {
  if (layoutActive.value) document.body.classList.toggle('employee-terminal-view', sessionReady && employee)
})

onBeforeUnmount(() => { if (layoutActive.value) rememberSubnavScroll() })

onUnmounted(() => {
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
              @pointerenter="preloadMenuRoute(item)" @focus="preloadMenuRoute(item)" @click="navigatePrimary(item)">
              <span class="nav-icon"><PortalNavIcon :kind="item.id" /></span>
              <span class="nav-label">{{ item.id === 'requests' ? (isEmployeeTerminal ? '申请' : '审批') : item.title }}</span>
            </button>
          </div>
        </div></div>
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
  </div>
</template>
