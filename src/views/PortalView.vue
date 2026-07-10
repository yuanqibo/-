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

const loadPortalUser = async (): Promise<PortalUser> => {
  const token = localStorage.getItem('authzAppSessionToken')?.trim()
  if (!token) throw new Error('ECP session token is missing')
  const response = await fetch('/api/auth/ecp/me', { headers: { authorization: `Bearer ${token}` } })
  if (response.ok) {
    const payload = await response.json() as { user?: PortalUser }
    if (payload.user) return payload.user
  }
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

  const user = await loadPortalUser().catch((error) => {
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
