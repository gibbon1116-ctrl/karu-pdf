import mupdf, { type PDFDocument, type PDFPage } from 'mupdf'
import { describe, expect, it } from 'vitest'
import { createMeasureDictionary, readDocumentScaleMetadata, readDocumentScaleRegions, readMeasureSettings, readPageScale, readScaleRegions, ratioScale, writePageScale, writeScaleRegions, type ScaleRegion } from '../src/core/measure'
const size = { width: 500, height: 500 }, scale = ratioScale(100, 'PDF', size)
const regions: ScaleRegion[] = [
  { id: 'a', label: 'A部詳細', rect: [250, 250, 450, 450], scale: ratioScale(20, 'PDF', size) },
  { id: 'b', rect: [280, 280, 350, 350], scale: ratioScale(10, 'PDF', size) },
]
function blank(rotation: Parameters<PDFDocument['addPage']>[1] = 0) {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 500], rotation, {}, '')
  try { doc.insertPage(-1, ref) } finally { ref.destroy() }
  return doc
}
function foreign(doc: PDFDocument, page: PDFPage) {
  const obj = page.getObject(), array = doc.newArray(), vp = doc.newDictionary(), name = doc.newString('Other app'), box = doc.newArray(), measure = createMeasureDictionary(doc, { ...ratioScale(500, 'PDF', size), kind: 'distance' })
  try { for (const n of [0, 0, 500, 500]) box.push(n); vp.put('Type', 'Viewport'); vp.put('Name', name); vp.put('BBox', box); vp.put('Measure', measure); array.push(vp); obj.put('VP', array) }
  finally { measure.destroy(); box.destroy(); name.destroy(); vp.destroy(); array.destroy(); obj.destroy() }
}
describe('scale region PDF viewports', () => {
  it('round trips two regions and keeps page/foreign viewports regardless of write order', () => {
    const doc = blank(), page = doc.loadPage(0)
    let saved: PDFDocument | undefined
    try {
      foreign(doc, page); writePageScale(doc, page, scale); writeScaleRegions(doc, page, regions)
      expect(readScaleRegions(page)).toEqual(regions); expect(readPageScale(page)).toEqual(scale)
      const obj = page.getObject(), vp = obj.get('VP')
      try {
        expect(vp.length).toBe(4)
        const other = vp.get(0), name = other.get('Name')
        try { expect(name.asString()).toBe('Other app') } finally { name.destroy(); other.destroy() }
        // The old reader scans from the end for KaruScale or Measure. Both are absent on each region.
        for (let i = 2; i < vp.length; i++) {
          const r = vp.get(i), measure = r.get('Measure'), oldCustom = r.get('KaruScale'), custom = r.get('KaruScaleRegion')
          try { expect(measure.isNull()).toBe(true); expect(oldCustom.isNull()).toBe(true); expect(custom.isString()).toBe(true); expect(readMeasureSettings(r, 'distance')).toBeNull() }
          finally { custom.destroy(); oldCustom.destroy(); measure.destroy(); r.destroy() }
        }
      } finally { vp.destroy(); obj.destroy() }
      writePageScale(doc, page, ratioScale(200, 'PDF', size))
      expect(readScaleRegions(page)).toEqual(regions)
      writeScaleRegions(doc, page, regions)
      expect(readPageScale(page)?.denominator).toBe(200)
      const buffer = doc.saveToBuffer('compress,garbage=4')
      try { saved = new mupdf.PDFDocument(buffer.asUint8Array()) } finally { buffer.destroy() }
      const reopened = saved.loadPage(0)
      try { expect(readScaleRegions(reopened)).toEqual(regions); expect(readPageScale(reopened)?.denominator).toBe(200) } finally { reopened.destroy() }
      expect(readDocumentScaleRegions(saved)).toEqual([[0, regions]])
      expect(readDocumentScaleMetadata(saved)).toEqual({ pageScales: [ratioScale(200, 'PDF', size)], pageScaleRegions: [[0, regions]] })
      writeScaleRegions(doc, page, []); expect(readScaleRegions(page)).toEqual([]); expect(readPageScale(page)?.denominator).toBe(200)
      writeScaleRegions(doc, page, regions); writePageScale(doc, page, null); expect(readScaleRegions(page)).toEqual(regions)
      const remaining = page.getObject(), array = remaining.get('VP')
      try { expect(array.length).toBe(3) } finally { array.destroy(); remaining.destroy() }
    } finally { saved?.destroy(); page.destroy(); doc.destroy() }
  })
  it.each([0, 90, 180, 270] as const)('transforms bounding boxes on rotation %i with CropBox/UserUnit', rotation => {
    const doc = blank(rotation), page = doc.loadPage(0)
    try {
      const object = page.getObject(), crop = doc.newArray()
      try { for (const n of [10, 20, 480, 490]) crop.push(n); object.put('CropBox', crop); object.put('UserUnit', 2) } finally { crop.destroy(); object.destroy() }
      // Reload after changing geometry, so MuPDF rebuilds the display transform.
      const changed = doc.loadPage(0)
      try { writeScaleRegions(doc, changed, regions); expect(readScaleRegions(changed)).toEqual(regions) } finally { changed.destroy() }
    } finally { page.destroy(); doc.destroy() }
  })
  it('ignores malformed/outside/duplicate regions and returns only pages with regions', () => {
    const doc = blank(), page = doc.loadPage(0)
    try {
      expect(readDocumentScaleRegions(doc)).toEqual([])
      writeScaleRegions(doc, page, [regions[0]])
      const obj = page.getObject(), array = obj.get('VP'), good = array.get(0)
      try {
        array.push(good)
        for (const [raw, bbox] of [['{', [0, 0, 20, 20]], [JSON.stringify({ id: 'bad', scale }), [0, 0, 5, 5]], [JSON.stringify({ id: 'outside', scale }), [0, 0, 600, 600]], [JSON.stringify({ id: 'name', scale, label: 'x'.repeat(41) }), [0, 0, 20, 20]], [JSON.stringify({ id: 'scale', scale: {} }), [0, 0, 20, 20]]] as const) {
          const vp = doc.newDictionary(), json = doc.newString(raw), box = doc.newArray()
          try { for (const n of bbox) box.push(n); vp.put('BBox', box); vp.put('KaruScaleRegion', json); array.push(vp) } finally { box.destroy(); json.destroy(); vp.destroy() }
        }
        // Mutating a page-owned array is visible to the next reader.
        obj.put('VP', array)
      } finally { good.destroy(); array.destroy(); obj.destroy() }
      expect(readScaleRegions(page)).toEqual([regions[0]])
      expect(() => writeScaleRegions(doc, page, [{ ...regions[0], rect: [0, 0, 501, 500] }])).toThrow()
      expect(() => writeScaleRegions(doc, page, Array.from({ length: 21 }, (_, i) => ({ ...regions[0], id: String(i) })))).toThrow()
      expect(readScaleRegions(page)).toEqual([regions[0]])
    } finally { page.destroy(); doc.destroy() }
  })
})
