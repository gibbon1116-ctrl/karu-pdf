import { useEffect } from 'react'
import './windowDragging.css'

const windows = 'dialog, [role="dialog"], [role="alertdialog"]'
const handles = ':scope > header, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > form > header, :scope > form > h1, :scope > form > h2'
const controls = 'button, input, select, textarea, a, [role="button"], [contenteditable]:not([contenteditable="false"])'
type Offset = { x: number; y: number }

/** Delegated title dragging also covers dialogs mounted later and React portals.
 * No DOM scans, observers or pointermove listeners run during ordinary viewing.
 * The two windows with their own position memory keep their existing handlers.
 */
export function installWindowDragging(doc: Document): () => void {
  const view = doc.defaultView!
  const positions = new WeakMap<HTMLElement, Offset>()
  const moved = new Set<WeakRef<HTMLElement>>()
  let endDrag: (() => void) | undefined

  const headingFor = (element: HTMLElement) => element.querySelector<HTMLElement>(handles)
  const move = (element: HTMLElement, heading: HTMLElement, x: number, y: number) => {
    const previous = positions.get(element) ?? { x: 0, y: 0 }
    const rect = heading.getBoundingClientRect()
    const left = rect.left - previous.x, right = rect.right - previous.x
    const top = rect.top - previous.y
    const visibleWidth = Math.min(80, rect.width, view.innerWidth)
    const next = {
      x: Math.max(visibleWidth - right, Math.min(view.innerWidth - visibleWidth - left, x)),
      y: Math.max(-top, Math.min(view.innerHeight - Math.min(rect.height, view.innerHeight) - top, y)),
    }
    positions.set(element, next)
    element.style.translate = `${next.x}px ${next.y}px`
  }

  const start = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || !(event.target instanceof Element)) return
    const element = event.target.closest<HTMLElement>(windows)
    if (!element || element.matches('.fixture-editor-dialog, .symbol-candidate-review')) return
    const heading = headingFor(element)
    if (!heading?.contains(event.target) || event.target.closest(controls)) return
    for (const reference of moved) if (!reference.deref()?.isConnected) moved.delete(reference)
    endDrag?.()
    event.preventDefault()
    event.stopPropagation()
    const initial = positions.get(element) ?? { x: 0, y: 0 }
    if (!positions.has(element)) moved.add(new WeakRef(element))
    positions.set(element, initial)
    const x = event.clientX, y = event.clientY
    const update = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return
      next.preventDefault()
      next.stopPropagation()
      move(element, heading, initial.x + next.clientX - x, initial.y + next.clientY - y)
    }
    const stop = (next: PointerEvent) => {
      if (next.pointerId !== event.pointerId) return
      next.stopPropagation()
      endDrag?.()
    }
    const cancel = () => endDrag?.()
    endDrag = () => {
      heading.removeEventListener('pointermove', update)
      heading.removeEventListener('lostpointercapture', stop)
      doc.removeEventListener('pointerup', stop, true)
      doc.removeEventListener('pointercancel', stop, true)
      view.removeEventListener('blur', cancel)
      if (heading.hasPointerCapture(event.pointerId)) heading.releasePointerCapture(event.pointerId)
      doc.documentElement.removeAttribute('data-window-dragging')
      endDrag = undefined
    }
    heading.addEventListener('pointermove', update)
    heading.addEventListener('lostpointercapture', stop)
    doc.addEventListener('pointerup', stop, true)
    doc.addEventListener('pointercancel', stop, true)
    view.addEventListener('blur', cancel)
    heading.setPointerCapture(event.pointerId)
    doc.documentElement.setAttribute('data-window-dragging', '')
  }
  const resize = () => {
    for (const reference of moved) {
      const element = reference.deref()
      if (!element?.isConnected) { moved.delete(reference); continue }
      if (!element.getClientRects().length) continue
      const heading = headingFor(element), position = positions.get(element)
      if (heading && position) move(element, heading, position.x, position.y)
    }
  }
  const toggle = (event: Event) => {
    const element = event.target
    if (!(element instanceof HTMLElement) || !element.matches(windows) || !element.getClientRects().length) return
    const position = positions.get(element), heading = headingFor(element)
    if (position && heading) move(element, heading, position.x, position.y)
  }
  doc.addEventListener('pointerdown', start, true)
  doc.addEventListener('toggle', toggle, true)
  view.addEventListener('resize', resize)
  return () => {
    endDrag?.()
    doc.removeEventListener('pointerdown', start, true)
    doc.removeEventListener('toggle', toggle, true)
    view.removeEventListener('resize', resize)
  }
}

export function useDraggableWindows(): void {
  useEffect(() => installWindowDragging(document), [])
}
