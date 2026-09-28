import { describe, expect, it } from 'vitest'
import { inkStrokePoints, mergeInkAnnotationId, simplifyPoints } from '../src/editor/ink'

describe('手書きの軌跡', () => {
  it('Ramer–Douglas–Peuckerで直線上の点を間引く', () => {
    const points: [number, number][] = [[0, 0], [1, 0.1], [2, -0.1], [3, 0]]
    expect(simplifyPoints(points, 0.5)).toEqual([[0, 0], [3, 0]])
    expect(simplifyPoints([[0, 0], [1, 2], [2, 0]], 0.5)).toHaveLength(3)
  })

  it('同じページ・種類で1.5秒以内に始めた線だけを結合する', () => {
    const previous = { id: 'new-1', pageIndex: 2, kind: 'ink' as const, endedAt: 1_000 }
    expect(mergeInkAnnotationId(previous, 2, 'ink', 2_500)).toBe('new-1')
    expect(mergeInkAnnotationId(previous, 2, 'ink', 2_501)).toBeNull()
    expect(mergeInkAnnotationId(previous, 1, 'ink', 2_000)).toBeNull()
    expect(mergeInkAnnotationId(previous, 2, 'highlight', 2_000)).toBeNull()
  })

  it('Ctrlでは始点と終点の2点、Ctrl+Shiftでは45度刻みの2点にする', () => {
    const curved: [number, number][] = [[0, 0], [5, 20], [30, 11]]
    expect(inkStrokePoints(curved, false, false)).toEqual(curved)
    expect(inkStrokePoints(curved, true, false)).toEqual([[0, 0], [30, 11]])
    const snapped = inkStrokePoints(curved, true, true)
    expect(snapped).toHaveLength(2)
    expect(snapped[1][1]).toBeCloseTo(0, 6)
    expect(Math.hypot(snapped[1][0], snapped[1][1])).toBeCloseTo(Math.hypot(30, 11), 6)
  })
})
