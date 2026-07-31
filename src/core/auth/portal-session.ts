import { readonly, reactive, toRefs } from 'vue'
import { useRouter, type Router } from 'vue-router'
import type { AuthzSessionContext, MenuTreeNode } from '@acg/ecp-sdk'
import { ecp, waitForEcpReady } from '../../ecp'
import type { PortalMenuItem, PortalUser } from './portal-context'
import { resolvePortalRoleCode } from './portal-role'
import { revokeEcpSession } from './ecp-session-logout'
import { applyTrustedPortalIdentity, loadTrustedPortalIdentity } from './trusted-identity'
import {
  ensureEmployeeSelfServiceMenu,
  primeEmployeeSelfServiceSession
} from './employee-self-service-access'

type PortalSessionState = {
  ready: boolean
  loading: boolean
  errorMessage: string
  session: AuthzSessionContext | null
  user: PortalUser | null
  menuItems: PortalMenuItem[]
}

const state = reactive<PortalSessionState>({
  ready: false,
  loading: false,
  errorMessage: '',
  session: null,
  user: null,
  menuItems: []
})

let initialization: Promise<void> | null = null
let sessionSubscription: (() => void) | null = null
let activeRouter: Router | null = null

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

const loadAccessiblePortalMenu = async (): Promise<PortalMenuItem[]> => {
  const tree = await ecp.auth?.menu.getAccessibleNavTree().catch((error) => {
    console.warn('[asset-portal] ECP accessible menu unavailable', error)
    return []
  }) ?? []
  const accessibleMenu = flattenMenuTree(tree)
    .filter(isMenuItemAllowed)
    .map(toPortalMenuItem)
    .filter((item): item is PortalMenuItem => Boolean(item))
    .sort((left, right) => left.order - right.order)
  return ensureEmployeeSelfServiceMenu(accessibleMenu)
}

const buildPortalUser = (session: AuthzSessionContext): PortalUser => {
  const permissionCodes = session.permissionCodes || []
  const roleCode = resolvePortalRoleCode(session.roles)
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

const normalizedPath = (value: string): string => value.replace(/\/$/, '') || '/'

const currentMenu = (): PortalMenuItem | null => {
  const path = normalizedPath(window.location.pathname)
  return state.menuItems.find((item) => normalizedPath(item.path) === path) || null
}

const redirectToLogin = (): void => {
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/'
  window.location.href = ecp.auth?.login.buildUrl(returnTo) || '/login'
}

const installPortalContext = (router: Router): void => {
  const user = state.user
  if (!user) return
  window.__ASSET_PORTAL_ECP_CONTEXT__ = {
    enabled: true,
    session: state.session,
    user,
    getUser: () => state.user || user,
    menuItems: state.menuItems,
    getMenuItems: () => state.menuItems,
    getCurrentMenu: currentMenu,
    navigate: async (menuId: string) => {
      const target = state.menuItems.find((item) => item.id === menuId)
      if (!target) throw new Error('当前账号没有该页面权限')
      await router.push(target.path)
    },
    logout: async () => {
      await revokeEcpSession(ecp.auth)
      window.location.href = ecp.auth?.login.buildUrl('/') || '/login'
    }
  }
}

const applySession = async (session: AuthzSessionContext, router: Router): Promise<void> => {
  const trustedIdentity = await loadTrustedPortalIdentity()
  const trustedSession = applyTrustedPortalIdentity(session, trustedIdentity)
  const augmentedSession = primeEmployeeSelfServiceSession(trustedSession)
  state.session = augmentedSession
  state.user = buildPortalUser(augmentedSession)
  state.menuItems = await loadAccessiblePortalMenu()
  installPortalContext(router)
}

export const ensurePortalSession = async (router: Router): Promise<void> => {
  activeRouter = router
  if (state.ready && state.session && state.user) {
    installPortalContext(router)
    return
  }
  if (initialization) return initialization

  initialization = (async () => {
    state.loading = true
    state.errorMessage = ''
    try {
      await waitForEcpReady()
      const session = await ecp.auth?.session.load().catch(() => null) ?? null
      if (!session) {
        redirectToLogin()
        return
      }
      await applySession(session, router)
      if (!sessionSubscription) {
        sessionSubscription = ecp.auth?.session.subscribe(async (nextSession) => {
          if (!nextSession) {
            redirectToLogin()
            return
          }
          await applySession(nextSession, activeRouter || router)
        }, false) ?? null
      }
      state.ready = true
    } catch (error) {
      state.errorMessage = error instanceof Error ? error.message : 'ECP 会话初始化失败'
      console.error('[asset-portal] ECP session initialization failed', error)
    } finally {
      state.loading = false
    }
  })()

  return initialization
}

export const usePortalSession = () => {
  const router = useRouter()
  void ensurePortalSession(router)
  return toRefs(readonly(state))
}
