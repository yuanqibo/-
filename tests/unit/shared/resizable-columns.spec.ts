import type { DirectiveBinding, ObjectDirective } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resizableColumns } from '../../../src/shared/directives/resizable-columns'

type DirectiveHook = (table: HTMLTableElement, binding: DirectiveBinding<string>) => void

const callHook = (name: 'mounted' | 'beforeUnmount', table: HTMLTableElement, key: string): void => {
  const hook = (resizableColumns as ObjectDirective<HTMLTableElement, string>)[name]
  if (typeof hook === 'function') (hook as DirectiveHook)(table, { value: key } as DirectiveBinding<string>)
}

const createTable = (key: string): HTMLTableElement => {
  const table = document.createElement('table')
  table.style.minWidth = '900px'
  table.innerHTML = '<colgroup><col style="width: 120px"><col style="width: 100px"></colgroup><thead><tr><th>资产状态</th><th>资产编码</th></tr></thead><tbody><tr><td>空闲</td><td>A-001</td></tr></tbody>'
  document.body.append(table)
  vi.spyOn(table.tHead!.rows[0].cells[0], 'getBoundingClientRect').mockReturnValue({ width: 120 } as DOMRect)
  callHook('mounted', table, key)
  return table
}

const createSelectionTable = (): HTMLTableElement => {
  const table = document.createElement('table')
  table.innerHTML = '<thead><tr><th><input type="checkbox" aria-label="全选"></th><th>入库状态</th></tr></thead><tbody><tr><td><input type="checkbox"></td><td>已完成</td></tr></tbody>'
  document.body.append(table)
  callHook('mounted', table, 'assets:inbound')
  return table
}

const dragFirstColumn = (table: HTMLTableElement, distance: number): void => {
  const handle = table.querySelector<HTMLButtonElement>('.column-resize-handle')!
  handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }))
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 100 + distance }))
  window.dispatchEvent(new MouseEvent('pointerup'))
}

describe('resizableColumns asset mode', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
  const originalLocalStorage = globalThis.localStorage
  let storedValues: Map<string, string>

  beforeEach(() => {
    storedValues = new Map()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        clear: () => storedValues.clear(),
        getItem: (key: string) => storedValues.get(key) ?? null,
        key: (index: number) => [...storedValues.keys()][index] ?? null,
        removeItem: (key: string) => storedValues.delete(key),
        setItem: (key: string, value: string) => storedValues.set(key, String(value)),
        get length() { return storedValues.size }
      } satisfies Storage
    })
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback): number => { callback(0); return 1 }
    })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: vi.fn() })
  })

  afterEach(() => {
    Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: originalRequestAnimationFrame })
    Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: originalCancelAnimationFrame })
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage })
  })

  it('matches disposal resizing for asset tables', () => {
    const table = createTable('assets:test')
    const handle = table.querySelector<HTMLButtonElement>('.column-resize-handle')!
    const firstColumn = table.querySelector<HTMLTableColElement>('col')!

    expect(table.classList.contains('asset-disposal-resize-table')).toBe(true)
    expect(handle.getAttribute('role')).toBe('separator')
    expect(handle.getAttribute('aria-orientation')).toBe('vertical')
    expect(handle.getAttribute('aria-valuemin')).toBe('48')
    expect(table.style.minWidth).toBe('220px')

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(firstColumn.style.width).toBe('48px')
    expect(handle.getAttribute('aria-valuenow')).toBe('48')
    expect(table.style.minWidth).toBe('148px')

    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    expect(firstColumn.style.width).toBe('120px')

    dragFirstColumn(table, 800)
    expect(firstColumn.style.width).toBe('920px')
    expect(table.style.minWidth).toBe('1020px')
    expect(localStorage.getItem('asset-table-column-widths:assets:test')).toContain('920')

    callHook('beforeUnmount', table, 'assets:test')
  })

  it('leaves non-asset table limits and layout unchanged', () => {
    const table = createTable('approvals:test')
    const firstColumn = table.querySelector<HTMLTableColElement>('col')!

    expect(table.classList.contains('asset-disposal-resize-table')).toBe(false)
    dragFirstColumn(table, 800)
    expect(firstColumn.style.width).toBe('640px')
    expect(table.style.minWidth).toBe('900px')

    callHook('beforeUnmount', table, 'approvals:test')
  })

  it('keeps the asset selection column tight around its checkbox', () => {
    const table = createSelectionTable()
    const columns = table.querySelectorAll<HTMLTableColElement>('col')

    expect(columns[0].style.width).toBe('36px')
    expect(table.querySelectorAll('.column-resize-handle')).toHaveLength(1)
    expect(table.querySelector<HTMLButtonElement>('.column-resize-handle')?.getAttribute('aria-label')).toBe('调整入库状态列宽')

    callHook('beforeUnmount', table, 'assets:inbound')
  })
})
