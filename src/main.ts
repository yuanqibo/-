import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/app.css'
import App from './App.vue'
import { router } from './router'
import { ecp } from './ecp'

const app = createApp(App)

app.use(ElementPlus)

await ecp.setup({
  app,
  router,
  locale: 'zh-CN'
})

app.use(router)
app.mount('#app')
