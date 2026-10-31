import type { PageSize } from '../core/mupdfDoc'

export const CSS_PX_PER_PT = 96 / 72
export const PAGE_GAP = 12

export interface PageLayout {
  index: number
  top: number
  width: number
  height: number
}

export interface LayoutResult {
  pages: PageLayout[]
  totalHeight: number
  maxWidth: number
}

export function computePageLayout(
  pageSizes: readonly PageSize[],
  zoom: number,
  gap = PAGE_GAP,
): LayoutResult {
  let top = 0
  let maxWidth = 0
  const pages = pageSizes.map((size, index) => {
    const width = size.width * CSS_PX_PER_PT * zoom
    const height = size.height * CSS_PX_PER_PT * zoom
    const page = { index, top, width, height }
    top += height + gap
    maxWidth = Math.max(maxWidth, width)
    return page
  })
  return {
    pages,
    totalHeight: pageSizes.length === 0 ? 0 : top - gap,
    maxWidth,
  }
}

export function pagesInRange(
  pages: readonly PageLayout[],
  start: number,
  end: number,
): PageLayout[] {
  return pages.filter((page) => page.top + page.height >= start && page.top <= end)
}
