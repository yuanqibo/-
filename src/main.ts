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
  ElLoading,
  ElOption,
  ElPagination,
  ElPopover,
  ElProgress,
  ElRadio,
  ElRadioButton,
  ElRadioGroup,
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
import { resizableColumns } from './shared/directives/resizable-columns'

const app = createApp(App)
app.directive('resizable-columns', resizableColumns)

// Keep every select menu below its trigger so opening it never covers the parent field.
const selectProps = (ElSelect as unknown as { props: Record<string, { default?: unknown }> }).props
selectProps.placement.default = 'bottom-start'
selectProps.fallbackPlacements.default = []
selectProps.fitInputWidth.default = true
selectProps.offset.default = 6
selectProps.showArrow.default = false
selectProps.popperClass.default = 'portal-downward-select-popper'
selectProps.popperOptions.default = () => ({
  modifiers: [
    { name: 'flip', enabled: false },
    { name: 'preventOverflow', options: { mainAxis: true, altAxis: false, tether: false } }
  ]
})

const fitSelectMenuToViewport = (select: Element, combobox: Element): void => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const listboxId = combobox.getAttribute('aria-controls')
    const popper = listboxId ? document.getElementById(listboxId)?.closest<HTMLElement>('.el-popper') : null
    if (!popper) return
    const selectRect = select.getBoundingClientRect()
    const availableHeight = select.classList.contains('asset-page-size-select')
      ? selectRect.top - 18
      : window.innerHeight - selectRect.bottom - 18
    popper.style.setProperty('--portal-select-max-height', `${Math.min(240, Math.max(48, availableHeight))}px`)
  }))
}

const closeExpandedSelectOnSecondClick = (event: MouseEvent): void => {
  const target = event.target instanceof Element ? event.target : null
  if (target?.closest('.el-select__clear')) return
  const select = target?.closest('.el-select')
  const combobox = select?.querySelector<HTMLElement>('[role="combobox"]')
  if (!select || !combobox) return
  if (combobox.getAttribute('aria-expanded') !== 'true') {
    fitSelectMenuToViewport(select, combobox)
    return
  }
  event.preventDefault()
  event.stopImmediatePropagation()
  combobox.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true
  }))
}

const elementComponents = [
  ElAlert, ElAutocomplete, ElAvatar, ElButton, ElCheckbox, ElCheckboxGroup, ElConfigProvider,
  ElDatePicker, ElDescriptions, ElDescriptionsItem, ElDialog, ElDrawer, ElDropdown, ElDropdownItem,
  ElDropdownMenu, ElEmpty, ElForm, ElFormItem, ElIcon, ElInput, ElInputNumber, ElOption, ElPagination,
  ElPopover, ElProgress, ElRadio, ElRadioButton, ElRadioGroup, ElResult, ElSelect, ElSkeleton, ElSwitch, ElTabPane, ElTable, ElTableColumn,
  ElTabs, ElTag, ElTimeline, ElTimelineItem, ElTooltip, ElTree
]

const bootstrap = async (): Promise<void> => {
  document.addEventListener('click', closeExpandedSelectOnSecondClick, true)
  elementComponents.forEach((component) => app.use(component))
  app.use(ElLoading)
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
