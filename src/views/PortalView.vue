<script setup lang="ts">
import { onMounted } from 'vue'
import JSZip from 'jszip'
import { ecp, waitForEcpReady, type AuthzSessionContext } from '../ecp'
import PortalShell from '../components/PortalShell.vue'
import '../styles/portal.css'

type PortalUser = {
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
}

declare global {
  interface Window {
    __ASSET_PORTAL_ECP_CONTEXT__?: {
      enabled: boolean
      session: AuthzSessionContext | null
      user: PortalUser
      getUser: () => PortalUser
      logout: () => Promise<void>
    }
    assetPortalApplyEcpSession?: () => boolean
    JSZip: typeof JSZip
  }
}

const buildDevelopmentUser = (session: AuthzSessionContext): PortalUser => {
  const profile = (session?.user || {}) as Record<string, unknown>
  const readString = (key: string): string => {
    const value = profile[key]
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  }
  const firstDepartment = Array.isArray(session?.user?.departments) ? session.user.departments[0] : null
  const tenant = (session?.tenant || {}) as Record<string, unknown>
  const tenantName = typeof tenant.name === 'string' ? tenant.name : ''
  const email = readString('email')
  const account = email || readString('account') || readString('username') || readString('accountId') || 'ecp.user'
  const company = readString('companyName') || tenantName || '默认公司'

  return {
    name: readString('displayName') || readString('name') || readString('nickname') || readString('realName') || account,
    account,
    email,
    phone: readString('phone') || readString('mobile'),
    department: readString('departmentName') || readString('department') || firstDepartment?.name || tenantName || 'ECP组织',
    company,
    roleCode: 'super_admin',
    roleName: '超级管理员',
    managerRoleCode: 'super_admin',
    managerRoleName: '超级管理员',
    scope: '系统初始化、管理员分配、全量资产与系统配置',
    loginType: 'ECP统一认证',
    identitySource: 'ECP',
    externalSubject: `ecp:${readString('accountId') || account}`,
    bindStatus: '已绑定',
    avatar: readString('avatar') || readString('avatarUrl')
  }
}

const loadPortalUser = async (session: AuthzSessionContext): Promise<PortalUser> => {
  const localDevelopmentHost = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)
  const token = localStorage.getItem('authzAppSessionToken')?.trim()
  if (!token) {
    if (localDevelopmentHost) return buildDevelopmentUser(session)
    throw new Error('ECP session token is missing')
  }
  const response = await fetch('/api/auth/ecp/me', { headers: { authorization: `Bearer ${token}` } })
  if (response.ok) {
    const payload = await response.json() as { user?: PortalUser }
    if (payload.user) return payload.user
  }
  if (localDevelopmentHost && [404, 503].includes(response.status)) return buildDevelopmentUser(session)
  throw new Error(`ECP identity validation failed (HTTP ${response.status})`)
}

onMounted(async () => {
  window.JSZip = JSZip
  await waitForEcpReady().catch((error) => {
    console.error('[asset-portal] ECP runtime is not ready', error)
    throw error
  })

  const session = await ecp.auth?.session.load().catch(() => null) ?? null
  if (!session) {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/'
    window.location.href = ecp.auth?.login.buildUrl(returnTo) || '/login'
    return
  }

  const user = await loadPortalUser(session).catch((error) => {
    console.error('[asset-portal] ECP identity validation failed', error)
    ecp.auth?.session.clear()
    window.location.href = ecp.auth?.login.buildUrl('/') || '/login'
    throw error
  })

  window.__ASSET_PORTAL_ECP_CONTEXT__ = {
    enabled: true,
    session,
    user,
    getUser: () => user,
    logout: async () => {
      ecp.auth?.session.clear()
      window.location.href = ecp.auth?.login.buildUrl('/') || '/login'
    }
  }

  await import('../portal/app')
  window.assetPortalApplyEcpSession?.()
  window.dispatchEvent(new CustomEvent('asset-portal-ecp-session'))
})
</script>

<template>
  <PortalShell />
</template>
