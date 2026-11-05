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

export interface WheelTargetInput {
  pages: readonly WheelPage[]
  scrollTop: number
  clientHeight: number
  maxScrollTop: number
  target: number
  delta: number
  gestureStart: boolean
  anchorIndex: number
}

export function wheelTarget(input: WheelTargetInput): { target: number; anchorIndex: number } {
  const { pages, scrollTop, clientHeight, maxScrollTop, delta, gestureStart } = input
  let anchorIndex = gestureStart ? anchorPageIndex(pages, scrollTop, clientHeight) : input.anchorIndex
  if (!pages.length) return { target: 0, anchorIndex: -1 }
  anchorIndex = clamp(anchorIndex, 0, pages.length - 1)
  const { lo, hi } = pageScrollRange(pages[anchorIndex], clientHeight, maxScrollTop)
  if (gestureStart && delta > 0 && scrollTop >= hi - 1.5 && anchorIndex < pages.length - 1) {
    anchorIndex++
    return { target: clamp(pages[anchorIndex].top, 0, Math.max(0, maxScrollTop)), anchorIndex }
  }
  if (gestureStart && delta < 0 && scrollTop <= lo + 1.5 && anchorIndex > 0) {
    anchorIndex--
    const page = pages[anchorIndex]
    return { target: clamp(Math.max(page.top, page.top + page.height - clientHeight), 0, Math.max(0, maxScrollTop)), anchorIndex }
  }
  return { target: clamp((gestureStart ? scrollTop : input.target) + delta, lo, hi), anchorIndex }
}
