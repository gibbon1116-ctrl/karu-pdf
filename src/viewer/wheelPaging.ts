import type { PageLayout } from './pageLayout'

type WheelPage = Pick<PageLayout, 'top' | 'height'>
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))

export function anchorPageIndex(pages: readonly WheelPage[], scrollTop: number, clientHeight: number): number {
  const center = scrollTop + clientHeight / 2
  let nearest = -1, distance = Infinity
  pages.forEach((page, index) => {
    const gap = Math.max(page.top - center, center - page.top - page.height, 0)
    if (gap < distance) { nearest = index; distance = gap }
  })
  return nearest
}

export function pageScrollRange(page: WheelPage, clientHeight: number, maxScrollTop: number): { lo: number; hi: number } {
  const bottom = page.top + page.height - clientHeight
  const max = Math.max(0, maxScrollTop)
  return { lo: clamp(Math.min(page.top, bottom), 0, max), hi: clamp(Math.max(page.top, bottom), 0, max) }
}

export function panRange(input: {
  pages: readonly { top: number; height: number; width: number }[]
  scrollLeft: number; scrollTop: number
  clientWidth: number; clientHeight: number
  contentWidth: number; maxScrollLeft: number; maxScrollTop: number
}): { left: { lo: number; hi: number }; top: { lo: number; hi: number } } {
  const { pages, scrollLeft, scrollTop, clientWidth, clientHeight, contentWidth } = input
  const maxLeft = Math.max(0, input.maxScrollLeft), maxTop = Math.max(0, input.maxScrollTop)
  const index = anchorPageIndex(pages, scrollTop, clientHeight)
  if (index < 0) return { left: { lo: 0, hi: maxLeft }, top: { lo: 0, hi: maxTop } }
  const top = pageScrollRange(pages[index], clientHeight, maxTop)
  const included = [pages[index]]
  const atBottom = scrollTop >= top.hi - 1.5, atTop = scrollTop <= top.lo + 1.5
  if (atBottom && index < pages.length - 1) {
    top.hi = pageScrollRange(pages[index + 1], clientHeight, maxTop).hi
    included.push(pages[index + 1])
  }
  if (atTop && index > 0) {
    top.lo = pageScrollRange(pages[index - 1], clientHeight, maxTop).lo
    included.push(pages[index - 1])
  }
  const left = { lo: Infinity, hi: -Infinity }
  for (const page of included) {
    const pageLeft = (contentWidth - page.width) / 2
    left.lo = Math.min(left.lo, pageLeft, pageLeft + page.width - clientWidth)
    left.hi = Math.max(left.hi, pageLeft, pageLeft + page.width - clientWidth)
  }
  left.lo = clamp(Math.min(left.lo, scrollLeft), 0, maxLeft)
  left.hi = clamp(Math.max(left.hi, scrollLeft), 0, maxLeft)
  top.lo = clamp(Math.min(top.lo, scrollTop), 0, maxTop)
  top.hi = clamp(Math.max(top.hi, scrollTop), 0, maxTop)
  return { left, top }
}

export function clampPan(value: number, range: { lo: number; hi: number }): number {
  return clamp(value, range.lo, range.hi)
}
