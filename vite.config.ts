import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const buildRevision = String(process.env.ASSET_PORTAL_BUILD_REVISION || '').trim()
const chunkFileNames = buildRevision
  ? `build-assets/[name]-[hash]-${buildRevision}.js`
  : 'build-assets/[name]-[hash].js'

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: 'frontend-dist',
    assetsDir: 'build-assets',
    modulePreload: {
      resolveDependencies(_url, dependencies, context) {
        if (context.hostType !== 'html') return dependencies
        return dependencies.filter((dependency) =>
          !/(^|\/)(asset-workbook|pinyin|element)-[A-Za-z0-9_-]+\.js$/.test(dependency))
      }
    },
    rollupOptions: {
      output: {
        // Static assets are served with immutable caching. Add an explicit
        // release suffix when deploying a repaired vendor bundle so embedded
        // WebViews cannot reuse an earlier file with the same content hash.
        entryFileNames: chunkFileNames,
        chunkFileNames,
        manualChunks(id) {
          // Vite injects this helper into the entry module for dynamic imports.
          // It must stay separate from the ECP chunk or importing the helper
          // makes the browser fetch the whole SDK before Vue can mount.
          if (id.includes('vite/preload-helper')) return 'vite-preload'
          if (!id.includes('node_modules')) return undefined
          // The member-authorization workspace is a route-level feature. Keep
          // every workspace entry outside the ECP runtime chunk so opening the
          // portal does not download its editor, custom element, and dialogs.
          if (id.includes('/@acg/ecp-auth-vue/dist/workspace/')) return undefined
          // ECP packages have cross-package imports; keeping them together avoids
          // circular chunk initialization failures in production builds.
          if (['ecp-auth-vue', 'ecp-auth', 'ecp-core', 'ecp-ui', 'ecp-sdk'].some((dependency) => id.includes(`/@acg/${dependency}/`))) return 'ecp'
          if (id.includes('/element-plus/') || id.includes('/@element-plus/')) return 'element-plus'
          if (id.includes('/vue/') || id.includes('/vue-router/')) return 'vue-runtime'
          if (id.includes('/pinyin-pro/')) return 'pinyin'
          return 'vendor'
        }
      }
    },
    chunkSizeWarningLimit: 2000
  },
  optimizeDeps: {
    exclude: [
      '@acg/ecp-core',
      '@acg/ecp-auth',
      '@acg/ecp-auth-vue',
      '@acg/ecp-sdk',
      '@acg/ecp-ui'
    ]
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5387',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyRequest, request) => {
            const host = request.headers.host
            if (host) proxyRequest.setHeader('x-forwarded-host', host)
            proxyRequest.setHeader('x-forwarded-proto', 'http')
          })
        }
      },
      '^/auth(?:/|$)': {
        target: 'http://127.0.0.1:5387',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyRequest, request) => {
            const host = request.headers.host
            if (host) proxyRequest.setHeader('x-forwarded-host', host)
            proxyRequest.setHeader('x-forwarded-proto', 'http')
          })
        }
      }
    }
  }
})
