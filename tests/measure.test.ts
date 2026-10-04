import { describe, expect, it } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { createAnnotationCsv } from '../src/app/annotationCsv'
import { calibratedScale, constrainMeasurePoint, measureBounds, measureText, pointInsidePolygon, polygonArea, polygonLabelPoint, polylineLength, ratioScale, scaleLabel, type MeasureSettings } from '../src/core/measure'
import type { Point } from '../src/core/annotations'

const size = { width: 420 * 72 / 25.4, height: 297 * 72 / 25.4 }
const scale = ratioScale(100, 'PDF', size)
const settings: MeasureSettings = { ...scale, kind: 'distance' }
const points: Point[] = [[100, 200], [172, 200]]
describe('実寸と表示の計算', () => {
  it('72ptを1/100で2,540 mmと表示する', () => expect(measureText(points, settings)).toBe('2,540 mm'))
  it('原図A1とPDF A3では、ちょうど2倍に補正する', () => {
    const corrected = ratioScale(100, 'A1', size)
    expect(corrected.mmPerPoint / scale.mmPerPoint).toBeCloseTo(2, 10)
    expect(measureText(points, { ...corrected, kind: 'distance' })).toBe('5,080 mm')
    // 原図A3をA1に拡大したPDFでは、ちょうど半分
    const enlarged = ratioScale(100, 'A3', { width: 841 * 72 / 25.4, height: 594 * 72 / 25.4 })
    expect(measureText(points, { ...enlarged, kind: 'distance' })).toBe('1,270 mm')
    // A1 の図面を A4 に縮めたPDF（√2 の3乗）
    const a4 = ratioScale(100, 'A1', { width: 210 * 72 / 25.4, height: 297 * 72 / 25.4 })
    expect(a4.mmPerPoint / scale.mmPerPoint).toBeCloseTo(Math.SQRT2 ** 3, 10)
  })
  it('A判でない用紙では、長い辺の比で補正する', () => {
    const custom = ratioScale(100, 'A1', { width: 500 * 72 / 25.4, height: 300 * 72 / 25.4 })
    expect(custom.mmPerPoint / scale.mmPerPoint).toBeCloseTo(841 / 500, 10)
  })
  it('2点と実際の寸法から係数と相当縮尺を求める', () => {
    const s = calibratedScale(points, 3600)
    expect(s.mmPerPoint).toBe(50)
    expect(s.denominator).toBeCloseTo(141.73228346)
    expect(scaleLabel(s)).toBe('約 1/141.73')
  })
  it('連続した長さを合計する', () => {
    expect(polylineLength([[0, 0], [3, 4], [6, 8]])).toBe(10)
    expect(measureText([[0, 0], [72, 0], [72, 72]], { ...settings, kind: 'perimeter' })).toBe('合計 5,080 mm')
  })
  it('正方形をm²に換算しmm設定でも小数2桁で表示する', () => expect(measureText([[0, 0], [72, 0], [72, 72], [0, 72]], { ...settings, kind: 'area' })).toBe('6.45 m²'))
  it.each([
    { p: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], area: 7 },
    { p: [[0, 0], [6, 0], [6, 6], [4, 6], [4, 1], [2, 1], [2, 6], [0, 6]], area: 26 },
  ])('凹多角形の面積と内側のラベル位置 $area', ({ p, area }) => {
    const polygon = p as Point[]
    expect(polygonArea(polygon)).toBe(area)
    expect(polygonArea([...polygon].reverse())).toBe(area)
    expect(pointInsidePolygon(polygonLabelPoint(polygon), polygon)).toBe(true)
  })
  it('単位と指定小数と桁区切りを反映する', () => {
    expect(measureText(points, { ...settings, unit: 'm' })).toBe('2.54 m')
    expect(measureText(points, { ...settings, decimals: 2 })).toBe('2,540.00 mm')
    expect(measureText([[0, 0], [72000, 0]], { ...settings, unit: 'm' })).toBe('2,540.00 m')
  })
  it.each([[10, 1, 5 * Math.PI / 180], [1, 10, 85 * Math.PI / 180], [9, 10, 50 * Math.PI / 180], [-9, -10, -130 * Math.PI / 180]])('Shiftの角度 %s,%s', (x, y, angle) => {
    const p = constrainMeasurePoint([0, 0], [x, y], true)
    expect(Math.atan2(p[1], p[0])).toBeCloseTo(angle)
    expect(Math.hypot(...p)).toBeCloseTo(Math.hypot(x, y))
  })
  it('不正な分母や長さを受け付けない', () => {
    for (const n of [0, -1, Infinity, NaN]) expect(() => ratioScale(n, 'PDF', size)).toThrow()
    expect(() => calibratedScale([[1, 1], [1, 1]], 100)).toThrow()
  })
})

describe('縮尺と計測の履歴', () => {
  it('ページ縮尺の保存・Undo・Redoを扱い、既存値は明示時だけ再計算する', () => {
    const store = new AnnotationStore()
    store.loadScales([null, null])
    store.setScale([0, 1], scale, false)
    const a = store.create({ pageIndex: 0, kind: 'distance', vertices: points, measure: settings, text: '2,540 mm', rect: measureBounds(points, 'distance', '2,540 mm', 10.5) })
    const next = ratioScale(200, 'PDF', size)
    store.setScale([0], next, false)
    expect(store.get(a.id)?.text).toBe('2,540 mm')
    store.setScale([0], next, true)
    expect(store.get(a.id)?.text).toBe('5,080 mm')
    store.undo(); expect(store.get(a.id)?.text).toBe('2,540 mm')
    store.undo(); expect(store.getScale(0)?.denominator).toBe(100)
    store.redo(); expect(store.getScale(0)?.denominator).toBe(200)
    const edits = store.toEdits()
    expect(edits.filter(e => e.kind === 'setPageScale')).toHaveLength(2)
    store.markApplied({ created: [50] }); expect(store.isDirty()).toBe(false)
    store.undo(); expect(store.toEdits()).toEqual([{ kind: 'setPageScale', pageIndex: 0, scale }])
  })
  it('頂点の編集、コピー、移動、保存後のUndoで実測値と縮尺を保持する', () => {
    const store = new AnnotationStore()
    const a = store.create({ pageIndex: 0, kind: 'distance', vertices: points, measure: settings, text: '2,540 mm', rect: measureBounds(points, 'distance', '2,540 mm', 10.5) })
    store.updateMeasureVertices(a.id, [[100, 200], [244, 200]])
    expect(store.get(a.id)?.text).toBe('5,080 mm')
    store.undo(); expect(store.get(a.id)?.text).toBe('2,540 mm')
    const [copy] = store.pasteAnnotations([store.get(a.id)!], 1, size, 10)
    store.move(copy, 20, 30)
    expect(store.get(copy)?.vertices).toEqual([[130, 240], [202, 240]])
    expect(store.get(copy)?.text).toBe('2,540 mm')
    expect(store.get(copy)?.measure).toEqual(settings)
    const csv = createAnnotationCsv([store.get(copy)!])
    expect(csv).toContain('縮尺'); expect(csv).toContain('距離,,2,,"2,540 mm"'); expect(csv).toContain('約 1/100')
  })
})
