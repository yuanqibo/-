const ASSIGNMENT_SEARCH_INPUT = '.target-workspace-assignment-dialog .ecp-entity-selector__toolbar input'
const MEMBER_PATH = '.target-workspace-assignment-dialog .ecp-entity-selector__path-line'
const SEARCH_DEBOUNCE_MS = 180

const matchingElement = (event: Event, selector: string, host: HTMLElement): HTMLElement | null => {
  const target = event.target
  if (!(target instanceof host.ownerDocument.defaultView!.Element)) return null
  const element = target.closest<HTMLElement>(selector)
  return element && host.contains(element) ? element : null
}

const dispatchSearch = (input: HTMLInputElement): void => {
  const KeyboardEventConstructor = input.ownerDocument.defaultView?.KeyboardEvent
  if (!KeyboardEventConstructor) return
  input.dispatchEvent(new KeyboardEventConstructor('keyup', {
    bubbles: true,
    cancelable: true,
    key: 'Enter',
    code: 'Enter'
  }))
}

const positionTooltip = (tooltip: HTMLElement, target: HTMLElement): void => {
  const viewport = target.ownerDocument.defaultView
  if (!viewport) return
  const targetRect = target.getBoundingClientRect()
  const spacing = 8
  const center = targetRect.left + targetRect.width / 2
  tooltip.classList.remove('is-bottom')
  tooltip.style.left = `${center}px`
  tooltip.style.top = `${targetRect.top - spacing}px`
  tooltip.style.visibility = 'hidden'

  const tooltipRect = tooltip.getBoundingClientRect()
  const halfWidth = tooltipRect.width / 2
  const left = Math.min(
    Math.max(center, spacing + halfWidth),
    Math.max(spacing + halfWidth, viewport.innerWidth - spacing - halfWidth)
  )
  tooltip.style.left = `${left}px`
  if (targetRect.top < tooltipRect.height + spacing * 2) {
    tooltip.classList.add('is-bottom')
    tooltip.style.top = `${targetRect.bottom + spacing}px`
  }
  tooltip.style.visibility = 'visible'
}

export const enhanceMemberSelector = (host: HTMLElement): (() => void) => {
  const searchTimers = new Map<HTMLInputElement, number>()
  let tooltip: HTMLElement | null = null
  let tooltipTarget: HTMLElement | null = null

  const clearSearchTimer = (input: HTMLInputElement): void => {
    const timer = searchTimers.get(input)
    if (timer !== undefined) host.ownerDocument.defaultView?.clearTimeout(timer)
    searchTimers.delete(input)
  }

  const scheduleSearch = (input: HTMLInputElement): void => {
    clearSearchTimer(input)
    const timer = host.ownerDocument.defaultView?.setTimeout(() => {
      searchTimers.delete(input)
      if (input.isConnected) dispatchSearch(input)
    }, SEARCH_DEBOUNCE_MS)
    if (timer !== undefined) searchTimers.set(input, timer)
  }

  const hideTooltip = (): void => {
    tooltip?.remove()
    tooltip = null
    tooltipTarget = null
  }

  const showTooltip = (target: HTMLElement): void => {
    const text = target.textContent?.trim() || ''
    if (!text) return
    hideTooltip()
    tooltipTarget = target
    tooltip = host.ownerDocument.createElement('div')
    tooltip.className = 'authz-member-path-tooltip'
    tooltip.setAttribute('role', 'tooltip')
    tooltip.textContent = text
    host.appendChild(tooltip)
    positionTooltip(tooltip, target)
  }

  const onInput = (event: Event): void => {
    const element = matchingElement(event, ASSIGNMENT_SEARCH_INPUT, host)
    if (element instanceof host.ownerDocument.defaultView!.HTMLInputElement) scheduleSearch(element)
  }
  const onKeyup = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return
    const element = matchingElement(event, ASSIGNMENT_SEARCH_INPUT, host)
    if (element instanceof host.ownerDocument.defaultView!.HTMLInputElement) clearSearchTimer(element)
  }
  const onMouseover = (event: MouseEvent): void => {
    const target = matchingElement(event, MEMBER_PATH, host)
    if (target && target !== tooltipTarget) showTooltip(target)
  }
  const onMouseout = (event: MouseEvent): void => {
    if (!tooltipTarget) return
    const related = event.relatedTarget
    if (related instanceof host.ownerDocument.defaultView!.Node && tooltipTarget.contains(related)) return
    if (matchingElement(event, MEMBER_PATH, host) === tooltipTarget) hideTooltip()
  }

  host.addEventListener('input', onInput)
  host.addEventListener('keyup', onKeyup as EventListener)
  host.addEventListener('mouseover', onMouseover as EventListener)
  host.addEventListener('mouseout', onMouseout as EventListener)
  host.addEventListener('scroll', hideTooltip, true)

  return () => {
    searchTimers.forEach((timer) => host.ownerDocument.defaultView?.clearTimeout(timer))
    searchTimers.clear()
    hideTooltip()
    host.removeEventListener('input', onInput)
    host.removeEventListener('keyup', onKeyup as EventListener)
    host.removeEventListener('mouseover', onMouseover as EventListener)
    host.removeEventListener('mouseout', onMouseout as EventListener)
    host.removeEventListener('scroll', hideTooltip, true)
  }
}
