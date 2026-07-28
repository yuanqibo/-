import { createEcpSdk } from '@acg/ecp-sdk'
import { initAuthzSdk } from '@acg/ecp-auth'
import { createBundleFromGlob } from '@acg/ecp-auth-vue'
import type { App as VueApp } from 'vue'
import type { Router } from 'vue-router'
import type { DoctorReport, EcpAuthConfigSourceMode } from '@acg/ecp-sdk'
import { formatPermissionDisplayName } from './authz/permission-display'
import {
  primeEmployeeSelfServiceSession,
  withEmployeeSelfServiceSnapshot
} from './core/auth/employee-self-service-access'

export type { AuthzSessionContext } from '@acg/ecp-sdk'

const authzBundle = createBundleFromGlob({
  ...import.meta.glob('../authz/*.{yaml,yml,json}', {
    eager: true,
    import: 'default',
    query: '?raw'
  }),
  ...import.meta.glob('/src/views/**/*.vue')
})

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
      permission: {
        noPermissionPath: '/no-permission',
        loadPermissionSnapshot: async ({ appCode }) => {
          const snapshot = await initAuthzSdk(appCode).loadPermissionSnapshot()
          return snapshot ? withEmployeeSelfServiceSnapshot(snapshot) : null
        }
      },
      menu: {
        parentRouteName: 'app-shell',
        sync: true
      },
      workspace: {
        parentRouteName: 'app-shell',
        mountPath: '/workspace',
        noPermissionPath: '/no-permission',
        styleScopeMode: 'strict'
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
let localDoctorReport: DoctorReport | null = null
let workspacePreloadPromise: Promise<void> | null = null

export const preloadMemberAuthorizationWorkspace = (): Promise<void> => {
  if (!workspacePreloadPromise) {
    workspacePreloadPromise = Promise.all([
      import('@acg/ecp-auth-vue/workspace/loader').then((module) => module.registerAuthzWorkspaceElement()),
      import('@acg/ecp-auth-vue/workspace/style.strict.css')
    ]).then(() => undefined).catch((error) => {
      workspacePreloadPromise = null
      console.warn('[asset-portal] member authorization preload failed', error)
    })
  }
  return workspacePreloadPromise
}

export const configureEcp = (app: VueApp, router: Router): Promise<void> => {
  ecpReadyPromise = ecp.setup({
      app,
      router,
      locale: 'zh-CN'
    })
    .then(async () => {
      const session = await ecp.auth?.session.load()
      if (session) primeEmployeeSelfServiceSession(session)
      localDoctorReport = await ecp.auth?.doctor.run({ bundleAppCodeMismatchLevel: 'fail' }) ?? null
      if (!localDoctorReport?.ok) {
        const failures = localDoctorReport?.checks
          .filter((check) => check.status === 'FAIL')
          .map((check) => `${check.code}: ${check.message}`)
          .join('; ')
        throw new Error(`ECP local doctor failed${failures ? `: ${failures}` : ''}`)
      }
      void preloadMemberAuthorizationWorkspace()
    })
    .catch((error) => {
      console.error('[asset-portal] ECP setup failed', error)
      throw error
    })

  return ecpReadyPromise
}

export const waitForEcpReady = (): Promise<void> => ecpReadyPromise
export const getLocalDoctorReport = (): DoctorReport | null => localDoctorReport
