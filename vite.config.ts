import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

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
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // The ECP workspace web component is a prebundled, lazy-only artifact.
          // Keep it outside the eager SDK chunk so normal portal routes never download it.
          if (id.includes('/@acg/ecp-auth-vue/dist/workspace/element.js')) return undefined
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
