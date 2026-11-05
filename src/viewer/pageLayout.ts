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

export function currentPageIndex(pages: readonly PageLayout[], scrollTop: number, clientHeight: number): number {
  let current = pages[0]
  for (const candidate of pages) {
    if (candidate.top > scrollTop + clientHeight / 3) break
    current = candidate
  }
  return current?.index ?? 0
}

export function fitPageView(
  pageSizes: readonly PageSize[],
  index: number,
  clientWidth: number,
  clientHeight: number,
  minZoom = .25,
): { zoom: number; left: number; top: number } | null {
  const size = pageSizes[index]
  if (!size) return null
  const zoom = Math.max(minZoom, Math.min(8,
    (clientWidth - 16) / (size.width * CSS_PX_PER_PT),
    (clientHeight - 16) / (size.height * CSS_PX_PER_PT)))
  const layout = computePageLayout(pageSizes, zoom)
  const page = layout.pages[index]
  const contentWidth = Math.max(layout.maxWidth, clientWidth)
  return {
    zoom,
    left: Math.max(0, Math.min(contentWidth - clientWidth, (contentWidth - clientWidth) / 2)),
    top: Math.max(0, Math.min(layout.totalHeight - clientHeight, page.top + (page.height - clientHeight) / 2)),
  }
}
