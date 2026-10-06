import { describe, expect, it } from 'vitest'
import { buildSnapIndex, findSnap, MAX_SNAP_VERTICES } from '../src/core/snap'
import type { Point } from '../src/core/annotations'

const bounds: [number, number, number, number] = [0, 0, 600, 600]
const index = buildSnapIndex([[100, 200], [172, 200], [103, 204], [16, 16]], bounds)

describe('existing vertex snap', () => {
  it('格子の境界をまたぐ頂点を8px相当の距離内だけ探す', () => {
    expect(findSnap([102, 203], 4, index)).toEqual({ point: [103, 204], kind: 'vertex' })
    expect(findSnap([107, 207], 4, index)).toBeNull()
    expect(findSnap([14, 14], 3, index)?.point).toEqual([16, 16])
    expect(findSnap([16, 16], 0, index)?.point).toEqual([16, 16])
    expect(findSnap([-20, -20], 2, index)).toBeNull()
    expect(findSnap([100, 200], 4, null)).toBeNull()
  })
  it('複数候補では最も近い頂点を採用し、元の精度を保つ', () => {
    const i = buildSnapIndex([[100.123456789, 200], [101, 200]], bounds)
    expect(findSnap([100.2, 200], 1, i)?.point).toEqual([100.123456789, 200])
    expect(findSnap([99, 200], 1, index)?.point).toEqual([100, 200])
  })
  it('Shift の拘束線から外れる頂点を除く', () => {
    const axis = { start: [100, 200] as Point, direction: [1, 0] as Point }
    expect(findSnap([170, 200], 4, index, axis)?.point).toEqual([172, 200])
    expect(findSnap([103, 200], 2, index, axis)).toBeNull()
    const diagonal = buildSnapIndex([[150, 250], [151, 250]], bounds)
    expect(findSnap([151, 251], 3, diagonal, { start: [100, 200], direction: [Math.SQRT1_2, Math.SQRT1_2] })?.point).toEqual([150, 250])
  })
  it('ページ外の頂点とゼロ幅のページも正しく距離判定する', () => {
    const i = buildSnapIndex([[-3, 10], [610, 10]], bounds)
    expect(findSnap([-2, 10], 2, i)?.point).toEqual([-3, 10])
    expect(findSnap([609, 10], 2, i)?.point).toEqual([610, 10])
    expect(findSnap([0, 0], 0, buildSnapIndex([[0, 0]], [0, 0, 0, 0]))?.point).toEqual([0, 0])
  })
  it('不正な入力・索引の上限を拒否する', () => {
    expect(() => buildSnapIndex([[NaN, 0]], bounds)).toThrow()
    expect(() => buildSnapIndex([], bounds, 0)).toThrow()
    expect(() => buildSnapIndex([], [0, 0, 1e9, 1e9])).toThrow()
    expect(() => buildSnapIndex(Array.from({ length: MAX_SNAP_VERTICES + 1 }, () => [1, 1] as Point), bounds)).toThrow()
    expect(findSnap([100, 200], -1, index)).toBeNull()
    expect(findSnap([NaN, 200], 1, index)).toBeNull()
  })
  it('過密な格子は探索を打ち切り、メモリを上限内に保つ', () => {
    const i = buildSnapIndex(Array.from({ length: MAX_SNAP_VERTICES }, () => [100, 200] as Point), bounds)
    expect(findSnap([101, 201], 8, i)).toBeNull()
    expect(i.bytes).toBeLessThan(50 * 1024 * 1024)
  })
})
