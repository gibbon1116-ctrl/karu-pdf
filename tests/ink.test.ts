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

  it('Ctrlでは始点と終点の2点、Shift単独でも45度刻みの2点にする', () => {
    const curved: [number, number][] = [[0, 0], [5, 20], [30, 11]]
    expect(inkStrokePoints(curved, false, false)).toEqual(curved)
    expect(inkStrokePoints(curved, true, false)).toEqual([[0, 0], [30, 11]])
    const snapped = inkStrokePoints(curved, true, true)
    expect(snapped).toHaveLength(2)
    expect(snapped[1][1]).toBeCloseTo(0, 6)
    expect(Math.hypot(snapped[1][0], snapped[1][1])).toBeCloseTo(Math.hypot(30, 11), 6)
    expect(inkStrokePoints(curved, false, true)).toEqual(snapped)
  })

  it.each([
    [[10, 20], [70, 25], 0],
    [[10, 20], [15, 80], Math.PI / 2],
    [[10, 20], [70, 55], Math.PI / 4],
    [[10, 20], [-50, -15], -3 * Math.PI / 4],
  ] as const)('Shiftで水平・垂直・45度にそろえ、長さと始点を保つ: %j → %j', (start, end, angle) => {
    const points: [number, number][] = [[...start], [22, 90], [...end]]
    const snapped = inkStrokePoints(points, false, true)
    expect(snapped).toHaveLength(2)
    expect(snapped[0]).toEqual(start)
    const dx = snapped[1][0] - start[0], dy = snapped[1][1] - start[1]
    expect(Math.atan2(dy, dx)).toBeCloseTo(angle, 8)
    expect(Math.hypot(dx, dy)).toBeCloseTo(Math.hypot(end[0] - start[0], end[1] - start[1]), 8)
    expect(inkStrokePoints(points, true, true)).toEqual(snapped)
    expect(inkStrokePoints(points, true, false)).toEqual([start, end])
    expect(inkStrokePoints(points, false, false)).toEqual(points)
  })

  it('空・1点・始点に戻る軌跡でも元の配列を変えない', () => {
    expect(inkStrokePoints([], false, true)).toEqual([])
    const points: [number, number][] = [[10, 20]]
    const copied = inkStrokePoints(points, false, true)
    expect(copied).toEqual(points)
    expect(copied[0]).not.toBe(points[0])
    expect(inkStrokePoints([[10, 20], [20, 50], [10, 20]], false, true)).toEqual([[10, 20], [10, 20]])
  })
})
