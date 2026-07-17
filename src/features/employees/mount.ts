import { createVNode, render } from 'vue'
import EmployeeDirectoryView from './components/EmployeeDirectoryView.vue'

const HOST_SELECTOR = '[data-vue-feature="employee-directory"]'
let activeHost: Element | null = null

// Transitional bridge while the remaining legacy portal pages are migrated to Vue routes.
export const syncEmployeeDirectoryFeature = (): void => {
  const nextHost = document.querySelector(HOST_SELECTOR)
  if (activeHost && activeHost !== nextHost) render(null, activeHost)
  if (!nextHost) {
    activeHost = null
    return
  }
  if (activeHost === nextHost) return
  render(createVNode(EmployeeDirectoryView), nextHost)
  activeHost = nextHost
}
