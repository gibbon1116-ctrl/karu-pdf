import fs from 'node:fs/promises'
import mupdf, { type PDFDocument } from 'mupdf'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { applyEdits, listAnnotations, type AnnotationEdit, type Point } from '../src/core/annotations'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'
import { nextCountStyle, readCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { quantityLabel, type QuantityMark } from '../src/core/quantity'
import { applyPageLayout } from '../src/core/pageOps'
import { AnnotationStore } from '../src/editor/AnnotationStore'

let font: FontResource
beforeAll(async () => { font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf'))) })
afterAll(() => font.font.destroy())
const fixture: CountFixture = { id: 'cv', kind: 'length', method: 'polyline', defaults: { addM: 3 }, line: { width: 2, dash: 'dashed' }, name: 'ケーブル（CV）', code: 'CV', category: '電線・ケーブル', order: 0, style: { ...nextCountStyle([]), size: 12 } }
const points: Point[] = [[100, 220], [365.03937007874015, 220]]
const measure = { kind: 'perimeter' as const, unit: 'mm' as const, decimals: null, mmPerPoint: 25.4 / 72 * 100 }
function edit(addM?: number): AnnotationEdit {
  const quantity: QuantityMark = { version: 1, id: addM ? 'plus' : 'plan', itemId: 'cv', method: 'polyline', ...(addM ? { addM } : {}) }
  return { kind: 'createMeasure', pageIndex: 0, vertices: points, measure, quantity, quantityDash: 'dashed', text: quantityLabel(points, measure.mmPerPoint, quantity, 'CV', true), color: fixture.style.color, fontSize: 12, borderWidth: 2, opacity: .8 }
}
function blank() {
  const doc = new mupdf.PDFDocument()
  for (let i = 0; i < 2; i++) { const p = doc.addPage([0, 0, 595, 842], 0, {}, ''); try { doc.insertPage(-1, p) } finally { p.destroy() } }
  return doc
}
function reopen(doc: PDFDocument) {
  const buffer = doc.saveToBuffer('compress,garbage=4')
  try { return new mupdf.PDFDocument(buffer.asUint8Array()) } finally { buffer.destroy() }
}
it('round-trips measurement metadata, quantity labels, dashed appearances and catalog', () => {
  const doc = blank()
  try {
    expect(applyEdits(doc, [{ kind: 'setCountFixtures', pageIndex: 0, fixtures: [fixture] }, edit(), edit(3)], { BIZUDGothic: font }).errors).toEqual([])
    const saved = reopen(doc)
    try {
      expect(readCountFixtures(saved)).toEqual([fixture])
      const info = listAnnotations(saved, 0)
      expect(info.map(a => a.contents)).toEqual(['CV 9.35 m', 'CV 9.35+3.00=12.35 m'])
      for (const a of info) a.vertices!.forEach((p, i) => p.forEach((n, j) => expect(n).toBeCloseTo(points[i][j], 4)))
      expect(info.map(a => a.quantity?.addM)).toEqual([undefined, 3])
      expect(info.every(a => a.quantityDash === 'dashed' && a.measure?.kind === 'perimeter')).toBe(true)
      const page = saved.loadPage(0), annotations = page.getAnnotations()
      try {
        for (const a of annotations) {
          const object = a.getObject()
          try {
            for (const key of ['Measure', 'KaruMeasure', 'KaruQuantity']) { const v = object.get(key); try { expect(v.isNull()).toBe(false) } finally { v.destroy() } }
            const intent = object.get('IT'), ap = object.get('AP', 'N')
            try {
              expect(intent.asName()).toBe('PolyLineDimension')
              const stream = ap.readStream(); try { expect(stream.asString()).toMatch(/\[\s*[\d.]+[\d.\s]*\]\s+[\d.]+\s+d\b/) } finally { stream.destroy() }
            } finally { intent.destroy(); ap.destroy() }
            const display = a.toDisplayList(), text = display.toStructuredText('preserve-whitespace')
            try { let contents = ''; text.walk({ onChar: c => { contents += c } }); expect(contents).toBe(a.getContents()) } finally { text.destroy(); display.destroy() }
          } finally { object.destroy() }
        }
      } finally { annotations.forEach(a => a.destroy()); page.destroy() }
    } finally { saved.destroy() }
  } finally { doc.destroy() }
})
it('saves vertex/addition edits through the store and preserves quantities when pages reorder', async () => {
  const doc = blank(), store = new AnnotationStore()
  try {
    expect(applyEdits(doc, [{ kind: 'setCountFixtures', pageIndex: 0, fixtures: [fixture] }, edit(3)], { BIZUDGothic: font }).errors).toEqual([])
    await store.ensurePageLoaded(0, async () => listAnnotations(doc, 0))
    expect(store.countOverlayObjNums(0)).toEqual([])
    expect(store.fixturesReady).toBe(false)
    await store.ensureCountFixtures(async () => readCountFixtures(doc), async () => {})
    const a = store.getPageAnnotations(0)[0]
    expect(store.isDirty()).toBe(false)
    expect(store.quantityText(a)).toBe('CV 9.35+3.00=12.35 m')
    expect(store.countOverlayObjNums(0)).toEqual([a.objNum])
    store.updateMeasureVertices(a.id, [[100, 220], [172, 220]])
    store.updateQuantityAdd(a.id, 4)
    expect(applyEdits(doc, store.toEdits(), { BIZUDGothic: font }).errors).toEqual([])
    applyPageLayout('main', doc, [1, 0].map(pageIndex => ({ id: String(pageIndex), source: { kind: 'page' as const, docId: 'main', pageIndex }, rotation: 0 })), new Map())
    const saved = reopen(doc)
    try {
      expect(readCountFixtures(saved)).toEqual([fixture])
      expect(listAnnotations(saved, 0)).toEqual([])
      const [q] = listAnnotations(saved, 1)
      expect(q.contents).toBe('CV 2.54+4.00=6.54 m')
      expect(q.quantity).toMatchObject({ addM: 4, itemId: 'cv', id: 'plus' })
      expect(q.vertices).toEqual([[100, 220], [172, 220]])
    } finally { saved.destroy() }
  } finally { doc.destroy() }
})
it('falls back to ordinary measurement for malformed quantity metadata', () => {
  const doc = blank()
  try {
    applyEdits(doc, [edit()], { BIZUDGothic: font })
    const page = doc.loadPage(0), [a] = page.getAnnotations(), object = a.getObject(), raw = doc.newString('{')
    try { object.put('KaruQuantity', raw) } finally { raw.destroy(); object.destroy(); a.destroy(); page.destroy() }
    expect(listAnnotations(doc, 0)[0].quantity).toBeNull()
    expect(listAnnotations(doc, 0)[0].measure?.kind).toBe('perimeter')
  } finally { doc.destroy() }
})
