import type { AuthzSessionContext } from '@acg/ecp-sdk'

export type PortalUser = {
  name: string
  account: string
  email: string
  phone: string
  department: string
  company: string
  roleCode: string
  roleName: string
  managerRoleCode: string
  managerRoleName: string
  scope: string
  loginType: string
  identitySource: string
  externalSubject: string
  bindStatus: string
  avatar?: string
  permissionCodes: string[]
}

export type PortalMenuItem = {
  id: string
  parentId: string
  title: string
  path: string
  pageKey: string
  order: number
}

export type PortalEcpContext = {
  enabled: boolean
  session: AuthzSessionContext | null
  user: PortalUser
  getUser: () => PortalUser
  menuItems: PortalMenuItem[]
  getMenuItems: () => PortalMenuItem[]
  getCurrentMenu: () => PortalMenuItem | null
  navigate: (menuId: string) => Promise<void>
  logout: () => Promise<void>
}

declare global {
  interface Window {
    __ASSET_PORTAL_ECP_CONTEXT__?: PortalEcpContext
    assetPortalApplyEcpSession?: () => boolean
  }
}

export const getPortalContext = (): PortalEcpContext | null =>
  window.__ASSET_PORTAL_ECP_CONTEXT__ ?? null

export const getPortalSessionToken = (): string =>
  String(getPortalContext()?.session?.sessionToken ?? '').trim()
