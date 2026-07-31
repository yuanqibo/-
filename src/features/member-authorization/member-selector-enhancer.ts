const MEMBER_PATH = '.target-workspace-assignment-dialog .ecp-entity-selector__path-line'

const matchingElement = (event: Event, selector: string, host: HTMLElement): HTMLElement | null => {
  const target = event.target
  if (!target || typeof target !== 'object' || !('nodeType' in target) || target.nodeType !== 1) return null
  const element = (target as Element).closest<HTMLElement>(selector)
  return element && host.contains(element) ? element : null
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
  let tooltip: HTMLElement | null = null
  let tooltipTarget: HTMLElement | null = null

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

  const onMouseover = (event: MouseEvent): void => {
    const target = matchingElement(event, MEMBER_PATH, host)
    if (target && target !== tooltipTarget) showTooltip(target)
  }
  const onMouseout = (event: MouseEvent): void => {
    if (!tooltipTarget) return
    const related = event.relatedTarget
    if (related && typeof related === 'object' && 'nodeType' in related
      && tooltipTarget.contains(related as Node)) return
    if (matchingElement(event, MEMBER_PATH, host) === tooltipTarget) hideTooltip()
  }

  host.addEventListener('mouseover', onMouseover as EventListener)
  host.addEventListener('mouseout', onMouseout as EventListener)
  host.addEventListener('scroll', hideTooltip, true)

  return () => {
    hideTooltip()
    host.removeEventListener('mouseover', onMouseover as EventListener)
    host.removeEventListener('mouseout', onMouseout as EventListener)
    host.removeEventListener('scroll', hideTooltip, true)
  }
}
