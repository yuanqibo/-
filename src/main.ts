import { createApp } from 'vue'
import {
  ElAlert,
  ElAutocomplete,
  ElAvatar,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElConfigProvider,
  ElDatePicker,
  ElDescriptions,
  ElDescriptionsItem,
  ElDialog,
  ElDrawer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElEmpty,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElInputNumber,
  ElOption,
  ElPagination,
  ElPopover,
  ElProgress,
  ElResult,
  ElSelect,
  ElSkeleton,
  ElSwitch,
  ElTabPane,
  ElTable,
  ElTableColumn,
  ElTabs,
  ElTag,
  ElTimeline,
  ElTimelineItem,
  ElTooltip,
  ElTree
} from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/app.css'
import './styles/portal.css'
import App from './App.vue'
import { router } from './router'
import { configureEcp } from './ecp'

const app = createApp(App)

const elementComponents = [
  ElAlert, ElAutocomplete, ElAvatar, ElButton, ElCheckbox, ElCheckboxGroup, ElConfigProvider,
  ElDatePicker, ElDescriptions, ElDescriptionsItem, ElDialog, ElDrawer, ElDropdown, ElDropdownItem,
  ElDropdownMenu, ElEmpty, ElForm, ElFormItem, ElIcon, ElInput, ElInputNumber, ElOption, ElPagination,
  ElPopover, ElProgress, ElResult, ElSelect, ElSkeleton, ElSwitch, ElTabPane, ElTable, ElTableColumn,
  ElTabs, ElTag, ElTimeline, ElTimelineItem, ElTooltip, ElTree
]

const bootstrap = async (): Promise<void> => {
  elementComponents.forEach((component) => app.use(component))
  await configureEcp(app, router)
  app.use(router)
  await router.isReady()
  app.mount('#app')
}

void bootstrap().catch((error) => {
  console.error('[asset-portal] application bootstrap failed', error)
  const root = document.getElementById('app')
  if (!root) return
  root.replaceChildren()
  const message = document.createElement('div')
  message.setAttribute('role', 'alert')
  message.textContent = '系统启动失败，请稍后重试'
  Object.assign(message.style, {
    display: 'grid',
    minHeight: '100vh',
    placeItems: 'center',
    color: '#b42318',
    fontSize: '16px'
  })
  root.append(message)
})
