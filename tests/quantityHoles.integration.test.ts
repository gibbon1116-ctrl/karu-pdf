import fs from 'node:fs/promises'
import mupdf, { type PDFDocument } from 'mupdf'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { applyEdits, listAnnotations, type AnnotationEdit, type Point } from '../src/core/annotations'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'
import { nextCountStyle, readCountFixtures, fixtureOpeningSize, type CountFixture } from '../src/core/countFixtures'
import { measureText } from '../src/core/measure'
import { quantityLabel, quantityValue, type QuantityMark } from '../src/core/quantity'

// SPEC-S16: holes, openings and fitting sizes survive saving, and the PDF appearance hatches the holes.
let font: FontResource
beforeAll(async () => { font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf'))) })
afterAll(() => font.font.destroy())

const floor: CountFixture = { id: 'floor', kind: 'area', method: 'polygon', name: '床仕上げ', code: 'F', category: '仕上げ', order: 0, style: nextCountStyle([]) }
const wall: CountFixture = { id: 'wall', kind: 'area', method: 'lengthHeight', name: '壁仕上げ', code: 'W', category: '仕上げ', order: 1, style: nextCountStyle([]) }
const door: CountFixture = { id: 'aw1', name: 'アルミ窓', code: 'AW-1', category: '建具', order: 2, style: nextCountStyle([]), opening: { widthM: 1.8, heightM: 1.2 } }
const fixtures = [floor, wall, door]
// 1 pt = 1 mm at 1:100 in mmPerPoint terms below: 100 mm per pt -> 0.1 m per pt.
const measureArea = { kind: 'area' as const, unit: 'mm' as const, decimals: null, mmPerPoint: 100 }
const measureLine = { kind: 'perimeter' as const, unit: 'mm' as const, decimals: null, mmPerPoint: 100 }
const outer: Point[] = [[100, 100], [200, 100], [200, 200], [100, 200]]
const hole: Point[] = [[120, 120], [140, 120], [140, 140], [120, 140]]
const wallLine: Point[] = [[100, 300], [220, 300]]

function blank() {
  const doc = new mupdf.PDFDocument()
  const p = doc.addPage([0, 0, 595, 842], 0, {}, '')
  try { doc.insertPage(-1, p) } finally { p.destroy() }
  return doc
}
function reopen(doc: PDFDocument) {
  const buffer = doc.saveToBuffer('compress,garbage=4')
  try { return new mupdf.PDFDocument(buffer.asUint8Array()) } finally { buffer.destroy() }
}

it('round-trips holes, openings, fitting sizes and measure holes with net values and hatched appearances', () => {
  const openingSize = fixtureOpeningSize(fixtures)
  const floorMark: QuantityMark = { version: 1, id: 'q1', itemId: 'floor', method: 'polygon', holes: [hole] }
  const wallMark: QuantityMark = { version: 1, id: 'q2', itemId: 'wall', method: 'lengthHeight', heightM: 2.5, openings: [{ itemId: 'aw1', widthM: 1.8, heightM: 1.2, count: 2 }, { widthM: .9, heightM: 2, count: 1 }] }
  const floorText = quantityLabel(outer, 100, floorMark, 'F', true, undefined, openingSize)
  const wallText = quantityLabel(wallLine, 100, wallMark, 'W', true, undefined, openingSize)
  const measureSettings = { ...measureArea, holes: [hole] }
  const measured = measureText(outer, measureSettings)
  // 10 m x 10 m = 100 m², hole 2 m x 2 m = 4 m²; wall 12 m x 2.5 m = 30 m², openings 1.8*1.2*2 + 0.9*2 = 6.12 m².
  expect(quantityValue(outer, 100, floorMark, openingSize)).toBeCloseTo(96, 6)
  expect(quantityValue(wallLine, 100, wallMark, openingSize)).toBeCloseTo(23.88, 6)
  expect(floorText).toContain('100.00−4.00=96.00 m²')
  expect(wallText).toContain('12.00×H2.50−開口6.12=23.88 m²')
  expect(measured).toContain('−4')

  const edits: AnnotationEdit[] = [
    { kind: 'setCountFixtures', pageIndex: 0, fixtures },
    { kind: 'createMeasure', pageIndex: 0, vertices: outer, measure: measureArea, quantity: floorMark, text: floorText, color: [1, 0, 0], fontSize: 10, borderWidth: 1.5, opacity: 1 },
    { kind: 'createMeasure', pageIndex: 0, vertices: wallLine, measure: measureLine, quantity: wallMark, text: wallText, color: [0, 0, 1], fontSize: 10, borderWidth: 1.5, opacity: 1 },
    { kind: 'createMeasure', pageIndex: 0, vertices: outer.map(([x, y]) => [x + 250, y] as Point), measure: { ...measureArea, holes: [hole.map(([x, y]) => [x + 250, y] as Point)] }, text: measured, color: [0, .5, 0], fontSize: 10, borderWidth: 1, opacity: 1 },
  ]
  const doc = blank()
  try {
    expect(applyEdits(doc, edits, { BIZUDGothic: font }).errors).toEqual([])
    const saved = reopen(doc)
    try {
      expect(readCountFixtures(saved).find(f => f.id === 'aw1')?.opening).toEqual({ widthM: 1.8, heightM: 1.2 })
      const info = listAnnotations(saved, 0)
      const floorInfo = info.find(a => a.quantity?.itemId === 'floor')!, wallInfo = info.find(a => a.quantity?.itemId === 'wall')!
      const measureInfo = info.find(a => !a.quantity)!
      expect(floorInfo.quantity?.holes).toHaveLength(1)
      floorInfo.quantity!.holes![0].forEach((p, i) => p.forEach((n, j) => expect(n).toBeCloseTo(hole[i][j], 4)))
      expect(wallInfo.quantity?.openings).toEqual(wallMark.openings)
      expect(measureInfo.measure?.holes).toHaveLength(1)
      expect(floorInfo.contents).toBe(floorText)
      expect(wallInfo.contents).toBe(wallText)
      // The appearance of each annotation with holes draws dashed hole outlines.
      const page = saved.loadPage(0), annotations = page.getAnnotations()
      try {
        let withHoles = 0
        for (const a of annotations) {
          const object = a.getObject(), ap = object.get('AP', 'N')
          try {
            const custom = object.get('KaruQuantity'), measureJson = object.get('KaruMeasure')
            const hasHoles = (custom.isString() && custom.asString().includes('"holes"')) || (measureJson.isString() && measureJson.asString().includes('"holes"'))
            custom.destroy(); measureJson.destroy()
            if (!hasHoles) continue
            withHoles++
            const stream = ap.readStream()
            // The hole is clipped (W n) and hatched with several short strokes.
            try { const text = stream.asString(); expect(text.match(/W n/g)?.length ?? 0).toBeGreaterThanOrEqual(2); expect(text.match(/ m\s+[-\d.]+ [-\d.]+ l/g)?.length ?? 0).toBeGreaterThanOrEqual(4) } finally { stream.destroy() }
          } finally { ap.destroy(); object.destroy() }
        }
        expect(withHoles).toBe(2)
      } finally { annotations.forEach(a => a.destroy()); page.destroy() }
    } finally { saved.destroy() }
  } finally { doc.destroy() }
})
