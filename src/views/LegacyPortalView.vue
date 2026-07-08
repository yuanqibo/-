<script setup lang="ts">
import { onMounted } from 'vue'
import { ecp, type AuthzSessionContext } from '../ecp'

type LegacyUser = {
  name: string
  account: string
  email: string
  phone: string
  department: string
  roleCode: string
  roleName: string
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
      user: LegacyUser
      getUser: () => LegacyUser
      logout: () => Promise<void>
    }
    assetPortalApplyEcpSession?: () => boolean
  }
}

const roleLabels: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '普通管理员',
  employee: '普通员工'
}

const normalizeRoleCode = (session: AuthzSessionContext | null): string => {
  const roleCodes = (session?.roles || [])
    .map((role) => role.code || role.name || '')
    .filter(Boolean)
    .map((code) => code.toUpperCase())

  if (roleCodes.includes('APP_ADMIN')) return 'super_admin'
  if (roleCodes.includes('OPERATOR')) return 'admin'
  return 'employee'
}

const buildLegacyUser = (session: AuthzSessionContext | null): LegacyUser => {
  const profile = (session?.user || {}) as Record<string, unknown>
  const readString = (key: string): string => {
    const value = profile[key]
    return typeof value === 'string' && value.trim() ? value.trim() : ''
  }
  const firstDepartment = Array.isArray(session?.user?.departments) ? session.user.departments[0] : null
  const tenant = (session?.tenant || {}) as Record<string, unknown>
  const tenantName = typeof tenant.name === 'string' ? tenant.name : ''
  const account = readString('account') || readString('username') || readString('email') || readString('accountId') || 'ecp.user'
  const roleCode = normalizeRoleCode(session)
  const roleName = roleLabels[roleCode] || '普通员工'

  return {
    name: readString('displayName') || readString('name') || readString('nickname') || account,
    account,
    email: readString('email'),
    phone: readString('phone') || readString('mobile'),
    department: readString('departmentName') || readString('department') || firstDepartment?.name || tenantName || 'ECP组织',
    roleCode,
    roleName,
    scope: roleCode === 'employee' ? '本人资产、个人申请和审批状态' : '资产与系统管理',
    loginType: 'ECP统一认证',
    identitySource: 'ECP',
    externalSubject: `ecp:${readString('accountId') || account}`,
    bindStatus: '已绑定',
    avatar: readString('avatar') || readString('avatarUrl')
  }
}

const ensureLink = (id: string, href: string): void => {
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

const ensureScript = (id: string, src: string): Promise<void> => {
  const existing = document.getElementById(id) as HTMLScriptElement | null
  if (existing) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.id = id
    script.src = src
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.body.appendChild(script)
  })
}

onMounted(async () => {
  const session = await ecp.auth?.session.load().catch(() => null) ?? null
  if (!session) {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/'
    window.location.href = ecp.auth?.login.buildUrl(returnTo) || '/login'
    return
  }

  const user = buildLegacyUser(session)

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

  ensureLink('asset-portal-legacy-style', '/legacy/styles.css?v=ecp-vite')
  await ensureScript('asset-portal-jszip', '/legacy/assets/jszip.min.js?v=ecp-vite')
  await ensureScript('asset-portal-legacy-app', '/legacy/app.js?v=ecp-vite')
  window.assetPortalApplyEcpSession?.()
  window.dispatchEvent(new CustomEvent('asset-portal-ecp-session'))
})
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">AM</div>
        <div>
          <div class="brand-name">资产云管家</div>
          <div class="brand-subtitle">ITAM Portal</div>
        </div>
      </div>
      <nav id="nav" class="nav"></nav>
      <div id="sidebarTools" class="sidebar-tools"></div>
    </aside>

    <aside id="secondarySidebar" class="secondary-sidebar" aria-hidden="true"></aside>

    <main class="workspace">
      <header class="topbar">
        <div class="topbar-actions">
          <button class="icon-button" title="消息中心" aria-label="消息中心">◔</button>
          <button class="icon-button" title="系统设置" aria-label="系统设置">⚙</button>
          <div class="avatar">验</div>
        </div>
      </header>

      <section id="page" class="page"></section>
    </main>
  </div>

  <div id="drawerBackdrop" class="drawer-backdrop"></div>
  <aside id="drawer" class="drawer" aria-hidden="true">
    <div class="drawer-header">
      <div>
        <div id="drawerEyebrow" class="eyebrow">资产详情</div>
        <h2 id="drawerTitle">-</h2>
      </div>
      <button id="drawerClose" class="icon-button" title="关闭" aria-label="关闭">×</button>
    </div>
    <div id="drawerBody" class="drawer-body"></div>
  </aside>

  <div id="modalBackdrop" class="modal-backdrop"></div>
  <section id="modal" class="modal" aria-hidden="true">
    <div class="modal-header">
      <h2 id="modalTitle">新建申请</h2>
      <button id="modalClose" class="icon-button" title="关闭" aria-label="关闭">×</button>
    </div>
    <div id="modalBody"></div>
  </section>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>
</template>
