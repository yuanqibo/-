<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import JSZip from 'jszip'
import { ecp, waitForEcpReady, type AuthzSessionContext } from '../ecp'
import type { MenuTreeNode } from '@acg/ecp-sdk'
import PortalShell from '../components/PortalShell.vue'
import type { PortalMenuItem, PortalUser } from '../core/auth/portal-context'
import '../styles/portal.css'

declare global {
  interface Window {
    assetPortalApplyEcpSession?: () => boolean
    JSZip: typeof JSZip
  }
}

const route = useRoute()
const router = useRouter()

const flattenMenuTree = (items: MenuTreeNode[]): MenuTreeNode[] => items.flatMap((item) => [
  item,
  ...flattenMenuTree(item.children || [])
])

const toPortalMenuItem = (item: Partial<MenuTreeNode>): PortalMenuItem | null => {
  const id = String(item.id || '').trim()
  const path = String(item.path || '').trim()
  if (!id || !path) return null
  return {
    id,
    parentId: String(item.parentId || '').trim(),
    title: String(item.title || id).trim(),
    path,
    pageKey: String(item.pageKey || '').trim(),
    order: Number(item.order) || 0
  }
}

const isMenuItemAllowed = (item: Partial<MenuTreeNode>): boolean => {
  const permissions = Array.isArray(item.permissionCodes) ? item.permissionCodes : []
  const features = Array.isArray(item.featureCodes) ? item.featureCodes : []
  if (!permissions.length && !features.length) return true
  const input = { permissions, features }
  return item.permissionMode === 'ANY'
    ? Boolean(ecp.auth?.permission.any(input))
    : Boolean(ecp.auth?.permission.all(input))
}

let portalMenuItems: PortalMenuItem[] = []

const loadAccessiblePortalMenu = async (): Promise<PortalMenuItem[]> => {
  const tree = await ecp.auth?.menu.getAccessibleNavTree().catch((error) => {
    console.warn('[asset-portal] ECP accessible menu unavailable', error)
    return []
  }) ?? []
  return flattenMenuTree(tree)
    .filter(isMenuItemAllowed)
    .map(toPortalMenuItem)
    .filter((item): item is PortalMenuItem => Boolean(item))
    .sort((left, right) => left.order - right.order)
}

const currentMenu = (): PortalMenuItem | null => {
  const path = route.path.replace(/\/$/, '') || '/'
  return portalMenuItems.find((item) => (item.path.replace(/\/$/, '') || '/') === path) || null
}

const notifyPortalRoute = (): void => {
  const item = currentMenu()
  if (!item) return
  window.dispatchEvent(new CustomEvent('asset-portal-route', { detail: item }))
}

const buildPortalUser = (session: AuthzSessionContext): PortalUser => {
  const roleCodes = new Set((session.roles || []).map((role) => role.code.toUpperCase()))
  const permissionCodes = session.permissionCodes || []
  const roleCode = roleCodes.has('APP_ADMIN')
    ? 'super_admin'
    : roleCodes.has('OPERATOR')
      ? 'admin'
      : roleCodes.has('APP_AUDITOR')
        ? 'auditor'
      : 'employee'
  const roleName = roleCode === 'super_admin'
    ? '应用管理员'
    : roleCode === 'admin'
      ? '资产运营'
      : roleCode === 'auditor'
        ? '审计员'
        : '普通员工'
  const department = session.user.departments?.[0]?.name || session.user.companyName || 'ECP组织'
  return {
    name: session.user.name || session.user.accountId,
    account: session.user.accountId,
    email: session.user.email || '',
    phone: session.user.phone || '',
    department,
    company: session.user.companyName || session.user.accountSetName || '默认公司',
    roleCode,
    roleName,
    managerRoleCode: roleCode === 'super_admin' || roleCode === 'admin' ? roleCode : '',
    managerRoleName: roleCode === 'super_admin' || roleCode === 'admin' ? roleName : '',
    scope: '按 ECP 权限与数据范围访问',
    loginType: 'ECP统一认证',
    identitySource: 'ECP',
    externalSubject: `ecp:${session.user.accountId}`,
    bindStatus: '已绑定',
    avatar: session.user.avatar || '',
    permissionCodes
  }
}

let unsubscribeSession: (() => void) | null = null

const redirectToLogin = (): void => {
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/'
  window.location.href = ecp.auth?.login.buildUrl(returnTo) || '/login'
}

onMounted(async () => {
  window.JSZip = JSZip
  await waitForEcpReady().catch((error) => {
    console.error('[asset-portal] ECP runtime is not ready', error)
    throw error
  })

  const session = await ecp.auth?.session.load().catch(() => null) ?? null
  if (!session) {
    redirectToLogin()
    return
  }

  let currentSession = session
  let currentUser = buildPortalUser(session)
  portalMenuItems = await loadAccessiblePortalMenu()

  window.__ASSET_PORTAL_ECP_CONTEXT__ = {
    enabled: true,
    session: currentSession,
    user: currentUser,
    getUser: () => currentUser,
    menuItems: portalMenuItems,
    getMenuItems: () => portalMenuItems,
    getCurrentMenu: currentMenu,
    navigate: async (menuId: string) => {
      const target = portalMenuItems.find((item) => item.id === menuId)
      if (!target) throw new Error('当前账号没有该页面权限')
      await router.push(target.path)
    },
    logout: async () => {
      ecp.auth?.session.clear()
      window.location.href = ecp.auth?.login.buildUrl('/') || '/login'
    }
  }

  await import('../portal/app')
  window.assetPortalApplyEcpSession?.()
  window.dispatchEvent(new CustomEvent('asset-portal-ecp-session'))
  notifyPortalRoute()

  unsubscribeSession = ecp.auth?.session.subscribe(async (nextSession) => {
    if (!nextSession) {
      redirectToLogin()
      return
    }
    currentSession = nextSession
    currentUser = buildPortalUser(nextSession)
    portalMenuItems = await loadAccessiblePortalMenu()
    const context = window.__ASSET_PORTAL_ECP_CONTEXT__
    if (context) {
      context.session = currentSession
      context.user = currentUser
      context.menuItems = portalMenuItems
    }
    window.assetPortalApplyEcpSession?.()
    window.dispatchEvent(new CustomEvent('asset-portal-ecp-session'))
  }, false) ?? null
})

const stopRouteWatch = watch(() => route.path, () => notifyPortalRoute())

onUnmounted(() => {
  stopRouteWatch()
  unsubscribeSession?.()
  unsubscribeSession = null
})
</script>

<template>
  <PortalShell />
</template>
