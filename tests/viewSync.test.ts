import { describe, expect, it } from 'vitest'
import { mapViewPosition, readViewPosition, ViewSyncDriver } from '../src/viewer/viewSync'
import { computePageLayout } from '../src/viewer/pageLayout'

const pages = Array.from({ length: 5 }, () => ({ width: 600, height: 1000 }))
describe('split view coordinates', () => {
  it('keeps the same page and page fractions, including horizontal pan', () => {
    const layout = computePageLayout(pages, 2)
    const source = readViewPosition(pages, 2, 190, layout.pages[2].top + 350, 700, 800)
    const target = mapViewPosition(source, pages, 700, 800)
    expect(target.pageIndex).toBe(2)
    expect(target.zoom).toBeCloseTo(2)
    expect(target.left).toBeCloseTo(190)
    expect(target.top).toBeCloseTo(layout.pages[2].top + 350)
    const restored = readViewPosition(pages, target.zoom, target.left, target.top, 700, 800)
    expect(restored.pageIndex).toBe(source.pageIndex)
    expect(restored.x).toBeCloseTo(source.x, 12)
    expect(restored.y).toBeCloseTo(source.y, 12)
    expect(restored.widthRatio).toBeCloseTo(source.widthRatio, 12)
  })
  it('matches the width ratio between A1 and A3, with different pane widths', () => {
    const a1 = Array.from({ length: 5 }, () => ({ width: 2384, height: 1684 }))
    const a3 = Array.from({ length: 5 }, () => ({ width: 1192, height: 842 }))
    const position = { pageIndex: 2, x: .5, y: .4, widthRatio: 2 }
    const big = mapViewPosition(position, a1, 800, 500)
    const small = mapViewPosition(position, a3, 600, 500)
    expect(small.zoom / big.zoom).toBeCloseTo(2 * 568 / 768)
    const restored = readViewPosition(a3, small.zoom, small.left, small.top, 600, 500)
    expect(restored.pageIndex).toBe(2)
    expect(restored.widthRatio).toBeCloseTo(2)
    expect(restored.y).toBeCloseTo(.4)
  })
  it('clamps to the shorter document and the actual scroll range', () => {
    const target = mapViewPosition({ pageIndex: 8, x: .5, y: 1, widthRatio: 2 }, pages.slice(0, 2), 700, 800)
    expect(target.pageIndex).toBe(1)
    expect(target.top).toBe(computePageLayout(pages.slice(0, 2), target.zoom).totalHeight - 800)
    expect(mapViewPosition({ pageIndex: 8, x: .5, y: 1, widthRatio: 2 }, [], 700, 800)).toEqual({ zoom: 1, left: 0, top: 0, pageIndex: 0 })
  })
  it('does not let target notifications reverse the driving side', () => {
    const driver = new ViewSyncDriver()
    driver.drive('right')
    expect(driver.accepts('right')).toBe(true)
    for (let i = 0; i < 10; i++) expect(driver.accepts('left')).toBe(false)
    driver.drive('left')
    expect(driver.accepts('right')).toBe(false)
    expect(driver.accepts('left')).toBe(true)
  })
})
