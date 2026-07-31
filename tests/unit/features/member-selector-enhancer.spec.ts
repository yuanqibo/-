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

  it('runs the SDK search automatically after pinyin input without a physical Enter key', async () => {
    vi.useFakeTimers()
    const host = selectorHost()
    const input = host.querySelector('input')!
    const searches: string[] = []
    input.addEventListener('keyup', (event) => {
      if (event.key === 'Enter') searches.push(input.value)
    })
    const cleanup = enhanceMemberSelector(host)

    input.value = 'zhou zhou'
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
    await vi.advanceTimersByTimeAsync(179)
    expect(searches).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(searches).toEqual(['zhou zhou'])

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
})
