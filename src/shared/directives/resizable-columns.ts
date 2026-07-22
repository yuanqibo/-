import type { Directive, DirectiveBinding } from 'vue'

type WidthMap = Record<string, number>
type ResizeState = {
  storageKey: string
  widths: WidthMap
  defaults: WidthMap
  frame?: number
  stopDragging?: () => void
}

const states = new WeakMap<HTMLTableElement, ResizeState>()
const MIN_COLUMN_WIDTH = 64
const MAX_COLUMN_WIDTH = 640

const clamp = (value: number): number => Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(value)))
const storageName = (key: string): string => `asset-table-column-widths:${key}`
const readWidths = (key: string): WidthMap => {
  try {
    const value = JSON.parse(localStorage.getItem(storageName(key)) || '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as WidthMap : {}
  } catch { return {} }
}
const saveWidths = (state: ResizeState): void => {
  try { localStorage.setItem(storageName(state.storageKey), JSON.stringify(state.widths)) }
  catch { /* Column resizing remains available when storage is unavailable. */ }
}
const headerLabel = (header: HTMLTableCellElement): string => Array.from(header.childNodes)
  .filter((node) => !(node instanceof HTMLElement && node.classList.contains('column-resize-handle')))
  .map((node) => node.textContent || '')
  .join('')
  .trim()
const columnId = (header: HTMLTableCellElement, index: number): string => `${index}:${header.dataset.columnKey || headerLabel(header) || 'column'}`
const directColgroup = (table: HTMLTableElement): HTMLTableColElement[] => {
  let group = Array.from(table.children).find((child): child is HTMLTableColElement => child.tagName === 'COLGROUP')
  if (!group) {
    group = document.createElement('colgroup')
    table.insertBefore(group, table.tHead || table.firstChild)
  }
  return Array.from(group.children).filter((child): child is HTMLTableColElement => child.tagName === 'COL')
}
const ensureColumns = (table: HTMLTableElement, count: number): HTMLTableColElement[] => {
  const columns = directColgroup(table)
  const group = columns[0]?.parentElement || Array.from(table.children).find((child) => child.tagName === 'COLGROUP')
  if (!group) return columns
  while (columns.length < count) {
    const column = document.createElement('col')
    group.append(column)
    columns.push(column)
  }
  while (columns.length > count) columns.pop()?.remove()
  return columns
}
const syncTableWidth = (table: HTMLTableElement, columns: HTMLTableColElement[]): void => {
  const total = columns.reduce((sum, column) => sum + (Number.parseFloat(column.style.width) || 0), 0)
  if (total > 0) table.style.width = `${Math.round(total)}px`
}
const setColumnWidth = (table: HTMLTableElement, state: ResizeState, index: number, id: string, width: number): void => {
  const columns = ensureColumns(table, table.tHead?.rows[0]?.cells.length || 0)
  const column = columns[index]
  if (!column) return
  const next = clamp(width)
  column.style.width = `${next}px`
  state.widths[id] = next
  syncTableWidth(table, columns)
}
const beginResize = (event: PointerEvent, table: HTMLTableElement, state: ResizeState, header: HTMLTableCellElement, index: number, id: string, handle: HTMLButtonElement): void => {
  event.preventDefault()
  event.stopPropagation()
  state.stopDragging?.()
  const startX = event.clientX
  const startWidth = header.getBoundingClientRect().width
  handle.classList.add('active')
  table.classList.add('is-column-resizing')
  document.body.classList.add('is-resizing-column')
  const move = (moveEvent: PointerEvent): void => setColumnWidth(table, state, index, id, startWidth + moveEvent.clientX - startX)
  const stop = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    window.removeEventListener('pointercancel', stop)
    handle.classList.remove('active')
    table.classList.remove('is-column-resizing')
    document.body.classList.remove('is-resizing-column')
    state.stopDragging = undefined
    saveWidths(state)
  }
  state.stopDragging = stop
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop, { once: true })
  window.addEventListener('pointercancel', stop, { once: true })
}
const attachHandle = (table: HTMLTableElement, state: ResizeState, header: HTMLTableCellElement, index: number, id: string): void => {
  if (header.querySelector(':scope > .column-resize-handle')) return
  const label = headerLabel(header) || `第 ${index + 1} 列`
  const handle = document.createElement('button')
  handle.type = 'button'
  handle.className = 'column-resize-handle'
  handle.setAttribute('aria-label', `调整${label}列宽`)
  handle.setAttribute('title', '拖动调整列宽，双击恢复')
  handle.addEventListener('pointerdown', (event) => beginResize(event, table, state, header, index, id, handle))
  handle.addEventListener('dblclick', (event) => {
    event.preventDefault()
    event.stopPropagation()
    setColumnWidth(table, state, index, id, state.defaults[id] || header.getBoundingClientRect().width)
    saveWidths(state)
  })
  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setColumnWidth(table, state, index, id, header.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 12 : -12))
    saveWidths(state)
  })
  header.append(handle)
}
const setup = (table: HTMLTableElement, state: ResizeState): void => {
  const headers = Array.from(table.tHead?.rows[0]?.cells || [])
  if (!headers.length) return
  table.classList.add('resizable-columns-table')
  const columns = ensureColumns(table, headers.length)
  headers.forEach((header, index) => {
    const id = columnId(header, index)
    const measured = header.getBoundingClientRect().width || Number.parseFloat(columns[index]?.style.width || '') || 120
    state.defaults[id] ||= clamp(measured)
    const width = state.widths[id] || state.defaults[id]
    if (columns[index]) columns[index].style.width = `${width}px`
    if (!header.querySelector('input[type="checkbox"]')) attachHandle(table, state, header, index, id)
  })
  syncTableWidth(table, columns)
}
const scheduleSetup = (table: HTMLTableElement, state: ResizeState): void => {
  if (state.frame) cancelAnimationFrame(state.frame)
  state.frame = requestAnimationFrame(() => {
    state.frame = undefined
    setup(table, state)
  })
}
const resolveKey = (binding: DirectiveBinding<string>): string => binding.value || 'default'

export const resizableColumns: Directive<HTMLTableElement, string> = {
  mounted(table, binding) {
    const storageKey = resolveKey(binding)
    const state: ResizeState = { storageKey, widths: readWidths(storageKey), defaults: {} }
    states.set(table, state)
    scheduleSetup(table, state)
  },
  updated(table, binding) {
    const state = states.get(table)
    if (!state) return
    const storageKey = resolveKey(binding)
    if (storageKey !== state.storageKey) {
      state.storageKey = storageKey
      state.widths = readWidths(storageKey)
    }
    scheduleSetup(table, state)
  },
  beforeUnmount(table) {
    const state = states.get(table)
    if (!state) return
    if (state.frame) cancelAnimationFrame(state.frame)
    state.stopDragging?.()
    document.body.classList.remove('is-resizing-column')
    states.delete(table)
  }
}
