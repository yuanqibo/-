import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/app.css'
import App from './App.vue'
import { router } from './router'
import { configureEcp } from './ecp'

const app = createApp(App)

app.use(ElementPlus)
app.use(router)
void configureEcp(app, router)
app.mount('#app')
