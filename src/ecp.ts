import { createEcpSdk } from '@acg/ecp-sdk'
import { createBundleFromGlob } from '@acg/ecp-auth-vue'
import type { App as VueApp } from 'vue'
import type { Router } from 'vue-router'

export type { AuthzSessionContext } from '@acg/ecp-sdk'

const authzBundle = createBundleFromGlob({
  ...import.meta.glob('../authz/*.{yaml,yml,json}', {
    eager: true,
    import: 'default',
    query: '?raw'
  }),
  ...import.meta.glob('/src/views/**/*.vue')
})

const readEnv = (key: string, fallback: string): string => {
  const value = import.meta.env[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export const ecp = createEcpSdk({
  appCode: readEnv('VITE_ECP_APP_CODE', 'WLY5YG'),
  baseUrl: readEnv('VITE_ECP_API_BASE_URL', '/api/v1'),
  modules: {
    auth: true
  },
  auth: {
    bundle: authzBundle,
    configSourceMode: readEnv('VITE_ECP_AUTH_CONFIG_SOURCE_MODE', 'local') as 'local' | 'remote-first' | 'remote',
    defaultSetup: {
      login: {
        loginPath: '/login',
        loginDefaultReturnTo: '/'
      },
      permission: {
        noPermissionPath: '/no-permission'
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

export const configureEcp = (app: VueApp, router: Router): Promise<void> => {
  ecpReadyPromise = ecp
    .setup({
      app,
      router,
      locale: 'zh-CN'
    })
    .then(() => undefined)
    .catch((error) => {
      console.error('[asset-portal] ECP setup failed', error)
      throw error
    })

  return ecpReadyPromise
}

export const waitForEcpReady = (): Promise<void> => ecpReadyPromise
