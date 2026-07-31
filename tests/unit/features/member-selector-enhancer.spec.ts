import { afterEach, describe, expect, it, vi } from 'vitest'
import { enhanceMemberSelector } from '../../../src/features/member-authorization/member-selector-enhancer'

const selectorHost = () => {
  const host = document.createElement('div')
  host.innerHTML = `
    <section class="target-workspace-assignment-dialog">
      <div class="ecp-entity-selector__toolbar"><input /></div>
      <div class="ecp-entity-selector__path-line">杭州艾柯塞斯品牌管理有限公司/数字化信息中心/运维技术部</div>
    </section>
  `
  document.body.appendChild(host)
  return host
}

describe('member selector enhancer', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('lets a physical Enter trigger exactly one SDK search without changing pinyin', () => {
    const host = selectorHost()
    const input = host.querySelector('input')!
    const searches: string[] = []
    input.addEventListener('keyup', (event) => {
      if (event.key === 'Enter') searches.push(input.value)
    })
    const cleanup = enhanceMemberSelector(host)

    input.value = 'zhou'
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }))
    expect(searches).toEqual(['zhou'])
    expect(input.value).toBe('zhou')

    cleanup()
  })

  it('does not synthesize searches or restore deleted text after Backspace', () => {
    const host = selectorHost()
    const input = host.querySelector<HTMLInputElement>('input')!
    const searches: string[] = []
    input.addEventListener('keyup', (event) => {
      if (event.key === 'Enter') searches.push(input.value)
    })
    const cleanup = enhanceMemberSelector(host)

    input.value = 'zhou'
    input.value = 'zho'
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Backspace', code: 'Backspace' }))

    expect(searches).toEqual([])
    expect(input.value).toBe('zho')
    cleanup()
  })

  it('does not mutate or search during an IME composition update', () => {
    const host = selectorHost()
    const input = host.querySelector<HTMLInputElement>('input')!
    let searchCount = 0
    input.addEventListener('keyup', (event) => {
      if (event.key === 'Enter') searchCount += 1
    })
    const cleanup = enhanceMemberSelector(host)

    input.value = 'zhou'
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: 'zhou' }))

    expect(input.value).toBe('zhou')
    expect(searchCount).toBe(0)
    cleanup()
  })

  it('shows and removes the complete organization path tooltip on hover', () => {
    const host = selectorHost()
    const path = host.querySelector<HTMLElement>('.ecp-entity-selector__path-line')!
    const cleanup = enhanceMemberSelector(host)

    path.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    const tooltip = host.querySelector('.authz-member-path-tooltip')
    expect(tooltip?.textContent).toBe('杭州艾柯塞斯品牌管理有限公司/数字化信息中心/运维技术部')
    expect(tooltip?.getAttribute('role')).toBe('tooltip')

    path.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    expect(host.querySelector('.authz-member-path-tooltip')).toBeNull()
    cleanup()
  })

  it('keeps native keyboard behavior after the SDK overlay is adopted from an iframe document', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const frameDocument = frame.contentDocument!
    const host = frameDocument.createElement('div')
    host.innerHTML = `
      <section class="target-workspace-assignment-dialog">
        <div class="ecp-entity-selector__toolbar"><input /></div>
      </section>
    `
    frameDocument.body.appendChild(host)
    document.body.appendChild(host)
    const input = host.querySelector<HTMLInputElement>('input')!
    let searchCount = 0
    input.addEventListener('keyup', (event) => {
      if (event.key === 'Enter') searchCount += 1
    })
    const cleanup = enhanceMemberSelector(host)

    expect(input instanceof HTMLInputElement).toBe(false)
    input.value = 'zhou'
    const FrameKeyboardEvent = (input.ownerDocument.defaultView as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent
    input.dispatchEvent(new FrameKeyboardEvent('keyup', { bubbles: true, key: 'Enter', code: 'Enter' }))

    expect(searchCount).toBe(1)
    expect(input.value).toBe('zhou')
    cleanup()
  })
})
