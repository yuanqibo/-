import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: './ecp', replacement: new URL('./tests/e2e/mocks/ecp.ts', import.meta.url).pathname },
      { find: '../../ecp', replacement: new URL('./tests/e2e/mocks/ecp.ts', import.meta.url).pathname },
      { find: '@acg/ecp-auth-vue/workspace/vue', replacement: new URL('./tests/e2e/mocks/AuthzWorkspaceHost.vue', import.meta.url).pathname }
    ]
  },
  server: {
    host: '127.0.0.1',
    port: 4174,
    strictPort: true
  }
})
