import { createEcpSdk } from '@acg/ecp-sdk'
import { initAuthzSdk } from '@acg/ecp-auth'
import { createBundleFromGlob, validateAuthzBundle } from '@acg/ecp-auth-vue'
import type { Component } from 'vue'
import type { Router, RouteRecordRaw } from 'vue-router'
import type { AuthzPermissionSnapshot, EcpAuthConfigSourceMode } from '@acg/ecp-sdk'
import { formatPermissionDisplayName } from './authz/permission-display'
import { withEmployeeSelfServiceSnapshot } from './core/auth/employee-self-service-access'

export type { AuthzSessionContext } from '@acg/ecp-sdk'

const portalPageFiles = import.meta.glob('/src/views/**/*.vue')

const authzBundle = createBundleFromGlob({
  ...import.meta.glob('../authz/*.{yaml,yml,json}', {
    eager: true,
    import: 'default',
    query: '?raw'
  }),
  ...portalPageFiles
})

export const localAuthzValidationReport = validateAuthzBundle(authzBundle)

const toPortalPageImporter = (file: string): (() => Promise<Component>) | null => {
  const normalized = file.startsWith('/') ? file : `/${file}`
  const importer = portalPageFiles[normalized] || portalPageFiles[normalized.replace(/^\//, '')]
  return typeof importer === 'function' ? importer as () => Promise<Component> : null
}

export const installPortalRoutes = (router: Router): void => {
  authzBundle.menu?.menus?.forEach((item) => {
    const path = String(item.path || '').trim()
    const name = String(item.pageKey || '').trim()
    const file = String(item.file || '').trim()
    if (!path || !name || !file || router.hasRoute(name)) return

    const component = toPortalPageImporter(file)
    if (!component) return

    const record: RouteRecordRaw = {
      path,
      name,
      component,
      meta: {
        title: item.title,
        permissionMode: item.permissionMode,
        permissionCodes: item.permissionCodes,
        featureCodes: item.featureCodes
      }
    }
    router.addRoute('app-shell', record)
  })
}

type PermissionBearingContext = {
  permissionCodes: string[]
  featureCodes?: string[]
  roleCodes?: string[]
  roles?: Array<{ code?: string; type?: string }>
}

const localAppAdminRole = authzBundle.roles?.roles?.find((role) =>
  String(role.code || '').trim().toUpperCase() === 'APP_ADMIN'
)
const localAppAdminPermissions = localAppAdminRole?.permissions || []
const localAppAdminFeatures = localAppAdminRole?.features || []

const mergeCodes = (left: string[] | undefined, right: string[] | undefined): string[] =>
  Array.from(new Set([...(left || []), ...(right || [])].map((code) => String(code || '').trim()).filter(Boolean)))

const hasAppAdminIdentity = (context: PermissionBearingContext): boolean => {
  const roleValues = [
    ...(context.roleCodes || []),
    ...(context.roles || []).flatMap((role) => [role.code, role.type])
  ].map((value) => String(value || '').trim().toUpperCase())
  if (roleValues.includes('APP_ADMIN')) return true

  const permissions = new Set(context.permissionCodes || [])
  return permissions.has('authz:application:edit') && permissions.has('authz:app_role:assign')
}

export const withLocalAppAdminGrants = <T extends PermissionBearingContext>(context: T): T => {
  if (!hasAppAdminIdentity(context)) return context
  return {
    ...context,
    permissionCodes: mergeCodes(context.permissionCodes, localAppAdminPermissions),
    featureCodes: mergeCodes(context.featureCodes, localAppAdminFeatures)
  }
}

export const loadPortalPermissionSnapshot = async (appCode: string) => {
  // Reuse the SDK's persisted session/snapshot on repeated embedded-app opens.
  // A forced reload here serializes two ECP requests before Vue can render.
  const snapshot = await initAuthzSdk(appCode).loadPermissionSnapshot(false)
  return snapshot
    ? withLocalAppAdminGrants(withEmployeeSelfServiceSnapshot(snapshot) as AuthzPermissionSnapshot)
    : null
}

authzBundle.catalog?.resources?.forEach((resource) => {
  resource.permissions?.forEach((catalogPermission) => {
    const permission = catalogPermission as typeof catalogPermission & { name?: string }
    permission.name = formatPermissionDisplayName(permission.code, resource.name)
  })
})

const readEnv = (key: string, fallback: string): string => {
  const value = import.meta.env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

const resolveConfigSourceMode = (): EcpAuthConfigSourceMode => {
  const value = readEnv('VITE_ECP_AUTH_CONFIG_SOURCE_MODE', 'local').toLowerCase()
  return value === 'local' || value === 'remote-first' || value === 'remote' ? value : 'local'
}

export const ecp = createEcpSdk({
  appCode: readEnv('VITE_ECP_APP_CODE', 'WLY5YG'),
  baseUrl: readEnv('VITE_ECP_API_BASE_URL', '/api/v1'),
  modules: {
    auth: true
  },
  auth: {
    bundle: authzBundle,
    configSourceMode: resolveConfigSourceMode(),
    defaultSetup: {
      login: {
        loginPath: '/login',
        loginDefaultReturnTo: '/'
      },
      // Do not install the SDK permission guard during bootstrap. It preloads the
      // ECP session before Vue mounts, which can leave embedded WebViews blank
      // indefinitely when the host delays the session bridge. Portal-session
      // initializes the same session after the UI is mounted; server APIs still
      // enforce authorization for every business request.
      permission: false,
      // Portal routes are registered locally as lazy Vue Router components.
      // The SDK's menu sync eagerly imports every page before first paint.
      menu: false,
      workspace: {
        parentRouteName: 'system-workspace-shell',
        mountPath: '/workspace',
        noPermissionPath: '/no-permission',
        styleScopeMode: 'strict',
        routeMeta: {
          title: '成员授权',
          portalMenuId: 'authz.workspace'
        }
      },
      quickstart: {
        layoutRouteName: 'app-shell',
        loginPath: '/login',
        noPermissionPath: '/no-permission',
        workspaceMountPath: '/workspace',
        remoteMenuSync: true,
        replayInitialEntry: true
      }
    }
  }
})

let ecpReadyPromise: Promise<void> = Promise.resolve()

const runEcpDoctor = async (): Promise<void> => {
  const localDoctorReport = await ecp.auth?.doctor.run({ bundleAppCodeMismatchLevel: 'fail' }) ?? null
  if (localDoctorReport?.ok) return

  const failures = localDoctorReport?.checks
    .filter((check) => check.status === 'FAIL')
    .map((check) => `${check.code}: ${check.message}`)
    .join('; ')
  throw new Error(`ECP local doctor failed${failures ? `: ${failures}` : ''}`)
}

const scheduleEcpDoctor = (): void => {
  const start = (): void => {
    void runEcpDoctor().catch((error) => {
      console.error('[asset-portal] ECP doctor failed', error)
    })
  }
  const requestIdle = window.requestIdleCallback
  if (typeof requestIdle === 'function') {
    requestIdle(start, { timeout: 5_000 })
    return
  }
  globalThis.setTimeout(start, 1_500)
}

export const configureEcp = (router: Router): Promise<void> => {
  if (!localAuthzValidationReport.ok) {
    const failures = localAuthzValidationReport.errors
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join('; ')
    return Promise.reject(new Error(`ECP local bundle validation failed${failures ? `: ${failures}` : ''}`))
  }
  ecpReadyPromise = ecp.setup({
      router,
      locale: 'zh-CN'
    })
    .then(() => {
      scheduleEcpDoctor()
    })
    .catch((error) => {
      console.error('[asset-portal] ECP setup failed', error)
      throw error
    })

  return ecpReadyPromise
}

export const waitForEcpReady = (): Promise<void> => ecpReadyPromise
