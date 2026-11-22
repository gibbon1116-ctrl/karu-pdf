import { describe, expect, it } from 'vitest'
import {
  carryOverTransform, convertCarryOverScale, fillCarryOverByOrder, hasCarryOverPageContents,
  matchCarryOverPages, normalizeDrawingKey, planCarryOverPages, transformCarryOverPoint,
  type CarryOverMatch, type CarryOverPageInfo, type CarryOverSourcePage,
} from '../src/core/carryOver'
import { calibratedScale, PT_MM, ratioScale, validScale } from '../src/core/measure'

const page = (pageIndex: number, name?: string, number?: string): CarryOverPageInfo =>
  ({ pageIndex, name, number, width: 600, height: 800 })

describe('旧版と新版のページ対応', () => {
  it('名称が1件なら番号より優先する', () => {
    expect(matchCarryOverPages([page(0, '平面図', 'A-1')], [
      page(0, '立面図', 'A-1'), page(1, '平面図', 'A-2'),
    ])).toEqual([{ oldPage: 0, newPage: 1, reason: 'name' }])
  })

  it('同名候補を番号で1件に絞り、対応の根拠は名称とする', () => {
    expect(matchCarryOverPages([page(5, '平面図', 'A-1')], [
      page(0, '平面図', 'A-2'), page(1, '平面図', 'A-1'), page(2, '断面図', 'A-1'),
    ])).toEqual([{ oldPage: 5, newPage: 1, reason: 'name' }])
  })

  it('名称がない、一致しない、または候補が複数のときは番号で探す', () => {
    expect(matchCarryOverPages([
      page(0, undefined, 'A-6'), page(1, '旧名称', 'A-7'), page(2, '平面図', 'A-8'),
    ], [
      page(0, '平面図', 'A-6'), page(1, '平面図', 'A-7'), page(2, '詳細図', 'A-8'),
    ])).toEqual([
      { oldPage: 0, newPage: 0, reason: 'number' },
      { oldPage: 1, newPage: 1, reason: 'number' },
      { oldPage: 2, newPage: 2, reason: 'number' },
    ])
  })

  it('候補がないか、番号でも1件に決まらなければ未対応にする', () => {
    expect(matchCarryOverPages([page(2), page(3, '平面図', 'A-1'), page(4, '異なる図面', 'A-2')], [
      page(0, '平面図', 'A-1'), page(1, '平面図', 'A-1'),
    ])).toEqual([2, 3, 4].map(oldPage => ({ oldPage, newPage: null, reason: null })))
  })

  it('同じ新版ページへの競合は旧版ページ番号で解決し、入力順を保つ', () => {
    expect(matchCarryOverPages([page(8, '立面図', 'A-2'), page(1, '旧名称', 'A-1')], [
      page(0, '立面図', 'A-1'), page(1, '詳細図', 'A-2'),
    ])).toEqual([
      { oldPage: 8, newPage: null, reason: null },
      { oldPage: 1, newPage: 0, reason: 'number' },
    ])
  })

  it('全角・空白・改行・大文字を正規化する', () => {
    expect(normalizeDrawingKey('　Ａ\tＢ \r\n－ｃ　')).toBe('ab-c')
    expect(normalizeDrawingKey('　 \r\n')).toBeUndefined()
    expect(normalizeDrawingKey(undefined)).toBeUndefined()
    expect(matchCarryOverPages([page(0, '１Ｆ\n平 面　図'), page(1, undefined, ' Ａ－０２　')], [
      page(0, '1f平面図'), page(1, undefined, 'a-02'),
    ])).toEqual([{ oldPage: 0, newPage: 0, reason: 'name' }, { oldPage: 1, newPage: 1, reason: 'number' }])
  })

  it('ページ順は存在する未使用の同じ番号だけを補う', () => {
    const matches: CarryOverMatch[] = [
      { oldPage: 0, newPage: 1, reason: 'manual' },
      { oldPage: 1, newPage: null, reason: null },
      { oldPage: 2, newPage: null, reason: null },
      { oldPage: 3, newPage: null, reason: null },
    ]
    const input = structuredClone(matches)
    expect(fillCarryOverByOrder(matches, 3)).toEqual([
      input[0], input[1], { oldPage: 2, newPage: 2, reason: 'order' }, input[3],
    ])
    expect(matches).toEqual(input)
  })
})

describe('ページ座標と縮尺の換算', () => {
  const a1 = { width: 594 / PT_MM, height: 841 / PT_MM }
  const a3 = { width: 297 / PT_MM, height: 420 / PT_MM }

  it('同じ大きさは厳密に1、A1からA3は左上を基準に約0.5倍にする', () => {
    expect(carryOverTransform(a1, a1)).toEqual({ factor: 1 })
    const transform = carryOverTransform(a1, a3)
    expect(transform).toEqual({ factor: .5 })
    expect(transformCarryOverPoint([120, 54], transform)).toEqual([60, 27])
  })

  it('縦横比が1%を超える場合は拡大縮小せず警告する', () => {
    const old = { width: 100, height: 100 }
    expect(carryOverTransform(old, { width: 101, height: 100 })).toEqual({ factor: 1.01 })
    expect(carryOverTransform(old, { width: 102, height: 100 })).toEqual({ factor: 1, warning: 'aspect' })
    expect(carryOverTransform(a1, { width: a3.height, height: a3.width })).toEqual({ factor: 1, warning: 'aspect' })
  })

  it('倍率1では縮尺の内容を保ち、校正値も独立して複製する', () => {
    const scale = calibratedScale([[0, 0], [50, 0]], 2000, 'm', 2)
    const result = convertCarryOverScale(scale, 1, a3)
    expect(result).toEqual(scale)
    expect(result).not.toBe(scale)
    expect(result.calibration).not.toBe(scale.calibration)
    expect(validScale(result)).toBe(true)
  })

  it('用紙指定の縮尺は新版の寸法で ratioScale を使う', () => {
    const scale = ratioScale(50, 'A1', a1, 'm', 3)
    const slightlyNarrower = { ...a3, width: a3.width * .998 }
    const { factor } = carryOverTransform(a1, slightlyNarrower)
    const result = convertCarryOverScale(scale, factor, slightlyNarrower)
    expect(result).toEqual(ratioScale(50, 'A1', slightlyNarrower, 'm', 3))
    expect(result.mmPerPoint).not.toBeCloseTo(scale.mmPerPoint / factor, 5)
    expect(validScale(result)).toBe(true)
  })

  it('PDF用紙の分母と校正点間の長さを換算する', () => {
    const ratio = ratioScale(50, 'PDF', a1, 'mm', 1)
    const result = convertCarryOverScale(ratio, .5, a3)
    expect(result).toEqual({ ...ratio, mmPerPoint: ratio.mmPerPoint * 2, denominator: (ratio.mmPerPoint * 2) / PT_MM })
    expect(result.denominator).toBeCloseTo(100)
    const calibrated = calibratedScale([[0, 0], [50, 0]], 2000)
    const calibratedResult = convertCarryOverScale(calibrated, .5, a3)
    expect(calibratedResult.calibration).toEqual({ pointsLength: 25, actualMm: 2000 })
    expect(calibratedResult.mmPerPoint).toBe(80)
    expect(calibratedResult.denominator).toBe(80 / PT_MM)
    expect(validScale(calibratedResult)).toBe(true)
  })

  it('選んだ種類のあるページを対象にし、対応済みのページの計画を作る', () => {
    const source: CarryOverSourcePage<string> = { ...page(0), pickups: ['pickup'], roomRegions: [] }
    const empty: CarryOverSourcePage<string> = { ...page(1), pickups: [], roomRegions: [] }
    const include = { fixtures: true, pickups: true, rooms: false, scales: false }
    expect(hasCarryOverPageContents(source, include)).toBe(true)
    expect(hasCarryOverPageContents(source, { ...include, pickups: false })).toBe(false)
    expect(hasCarryOverPageContents(empty, include)).toBe(false)
    const plan = planCarryOverPages(new Map([[0, source], [1, empty]]), [
      { ...page(2), width: 300, height: 400 },
    ], [
      { oldPage: 0, newPage: 2, reason: 'name' }, { oldPage: 1, newPage: null, reason: null },
    ])
    expect(plan).toEqual([{ oldPage: 0, newPage: 2, factor: .5, pickups: ['pickup'], roomRegions: [] }])
  })
})
