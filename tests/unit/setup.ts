import { afterEach, vi } from 'vitest'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub)

const readBlob = <T extends string | ArrayBuffer>(blob: Blob, method: 'readAsText' | 'readAsArrayBuffer'): Promise<T> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result as T)
  reader.onerror = () => reject(reader.error)
  reader[method](blob)
})

if (!File.prototype.text) {
  Object.defineProperty(File.prototype, 'text', {
    configurable: true,
    value(this: File): Promise<string> { return readBlob<string>(this, 'readAsText') }
  })
}

if (!File.prototype.arrayBuffer) {
  Object.defineProperty(File.prototype, 'arrayBuffer', {
    configurable: true,
    value(this: File): Promise<ArrayBuffer> { return readBlob<ArrayBuffer>(this, 'readAsArrayBuffer') }
  })
}

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })
})

afterEach(() => {
  document.body.replaceChildren()
  window.__ASSET_PORTAL_ECP_CONTEXT__ = undefined
})
