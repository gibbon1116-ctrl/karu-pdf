import type { PageSize } from '../core/mupdfDoc'
import { computePageLayout, CSS_PX_PER_PT } from './pageLayout'

/** Position at the viewport's horizontal centre and upper third, in page fractions. */
export interface ViewPosition {
  pageIndex: number
  x: number
  y: number
  widthRatio: number
  /** A driving pane's scroll phase, used before the target's native scroll event. */
  scrolling?: boolean
}

export function readViewPosition(sizes: readonly PageSize[], zoom: number, left: number, top: number, width: number, height: number): ViewPosition {
  const layout = computePageLayout(sizes, zoom)
  const anchorY = top + height / 3
  const page = [...layout.pages].reverse().find(p => p.top <= anchorY) ?? layout.pages[0]
  if (!page) return { pageIndex: 0, x: .5, y: 0, widthRatio: 1 }
  const pageLeft = (Math.max(layout.maxWidth, width) - page.width) / 2
  return {
    pageIndex: page.index,
    x: (left + width / 2 - pageLeft) / page.width,
    y: Math.max(0, Math.min(1, (anchorY - page.top) / page.height)),
    widthRatio: page.width / Math.max(1, width - 32),
  }
}

export function mapViewPosition(position: ViewPosition, sizes: readonly PageSize[], width: number, height: number) {
  const pageIndex = Math.max(0, Math.min(sizes.length - 1, position.pageIndex))
  const size = sizes[pageIndex]
  if (!size) return { zoom: 1, left: 0, top: 0, pageIndex: 0 }
  const zoom = Math.max(.25, Math.min(8, position.widthRatio * Math.max(1, width - 32) / (size.width * CSS_PX_PER_PT)))
  const layout = computePageLayout(sizes, zoom)
  const page = layout.pages[pageIndex]
  return {
    pageIndex, zoom,
    left: Math.max(0, (Math.max(layout.maxWidth, width) - page.width) / 2 + position.x * page.width - width / 2),
    top: Math.max(0, Math.min(layout.totalHeight - height, page.top + position.y * page.height - height / 3)),
  }
}

/** Only the driving pane can submit updates; application echoes cannot take ownership. */
export class ViewSyncDriver {
  private source: 'left' | 'right' = 'left'
  drive(source: 'left' | 'right') { this.source = source }
  accepts(source: 'left' | 'right') { return this.source === source }
}
