import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
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
