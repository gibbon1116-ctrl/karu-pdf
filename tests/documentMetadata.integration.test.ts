import mupdf from 'mupdf'
import { describe, expect, it, vi } from 'vitest'
import { readDocumentMetadata } from '../src/core/documentMetadata'
import { readDocumentDrawingInfos, writeDrawingInfo } from '../src/core/drawingInfo'
import { createMeasureDictionary, ratioScale, readDocumentScaleMetadata, writePageScale, writeScaleRegions } from '../src/core/measure'
import { openDocument } from '../src/core/mupdfDoc'
import { readDocumentRoomMetadata, writePageRoomSet, writeRoomRegions, writeRoomSets } from '../src/core/rooms'

function fixture() {
  const doc = new mupdf.PDFDocument()
  try {
    for (const rotation of [0, 90, 180, 270] as const) {
      const ref = doc.addPage([0, 0, 500, 600], rotation, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const room = { id: 'office', name: '事務室', points: [[10, 10], [100, 10], [100, 100], [10, 100]] as [number, number][] }
    writeRoomSets(doc, [{ id: 'floor', name: '1階', regions: [room] }])
    for (let i = 0; i < 4; i++) {
      const page = doc.loadPage(i)
      try {
        const annotation = page.createAnnotation('Square')
        try { annotation.setRect([10, 10, 20, 20]); annotation.update() } finally { annotation.destroy() }
        if (i === 0) {
          writeDrawingInfo(doc, page, { number: 'E-101', name: '電灯設備', numberManual: true })
          writePageScale(doc, page, ratioScale(100, 'PDF', { width: 500, height: 600 }))
          writeRoomRegions(doc, page, [room])
          writePageRoomSet(doc, page, 'floor', 20, 30)
        } else if (i === 1) {
          const obj = page.getObject()
          try { obj.put('CropBox', [10, 20, 480, 590]); obj.put('UserUnit', 2) } finally { obj.destroy() }
          const changed = doc.loadPage(i)
          try {
            writeScaleRegions(doc, changed, [{ id: 'detail', rect: [100, 100, 200, 200], scale: ratioScale(20, 'PDF', { width: 500, height: 600 }) }])
            // A standard viewport from another application must still restore.
            const obj = changed.getObject(), vp = doc.newDictionary(), array = obj.get('VP')
            const measure = createMeasureDictionary(doc, { ...ratioScale(200, 'PDF', { width: 500, height: 600 }), kind: 'distance' })
            try { vp.put('Type', 'Viewport'); vp.put('BBox', [10, 20, 100, 200]); vp.put('Measure', measure); array.push(vp) }
            finally { measure.destroy(); array.destroy(); vp.destroy(); obj.destroy() }
          } finally { changed.destroy() }
        } else if (i === 2) {
          const obj = page.getObject(), invalid = doc.newString('{invalid')
          try { obj.put('KaruDrawing', invalid); obj.put('KaruRooms', invalid) } finally { invalid.destroy(); obj.destroy() }
          writePageRoomSet(doc, page, 'missing')
        }
      } finally { page.destroy() }
    }
    const saved = doc.saveToBuffer('compress')
    try { return new Uint8Array(saved.asUint8Array()) } finally { saved.destroy() }
  } finally { doc.destroy() }
}

describe('opening metadata', () => {
  it('restores the same dimensions and saved metadata in one page pass', () => {
    const bytes = fixture()
    const old = openDocument(bytes), next = openDocument(bytes, false)
    try {
      const expected = {
        pageSizes: old.pageSizes,
        pageDrawingInfos: readDocumentDrawingInfos(old.document.asPDF()!),
        ...readDocumentScaleMetadata(old.document.asPDF()!),
        ...readDocumentRoomMetadata(old.document.asPDF()!),
      }
      const doc = next.document.asPDF()!, load = vi.spyOn(doc, 'loadPage')
      const { sizesMs, ...actual } = readDocumentMetadata(doc)
      expect(actual).toEqual(expected)
      expect(actual.pageScales[1]?.source).toBe('standard')
      expect(actual.pageScaleRegions).toHaveLength(1)
      expect(actual.pageRoomSets).toEqual([[0, { id: 'floor', dx: 20, dy: 30 }]])
      expect(load).toHaveBeenCalledTimes(3)
      expect(sizesMs).toBeGreaterThanOrEqual(0)
    } finally { old.document.destroy(); next.document.destroy() }
  })

  it.each([
    { media: [0, 0, 595.276, 841.89], crop: null, unit: 1 },
    { media: [-200, -100, 500, 600], crop: [-10.25, 20.5, 480.125, 590], unit: 2 },
    { media: [10.1, 20.2, 500.3, 600.4], crop: [-50, -50, 700, 800], unit: 1.5 },
    { media: [-200.125, -100.5, 500.875, 600.25], crop: null, unit: .25 },
  ])('matches native bounds for inherited boxes, rotations and UserUnit: %j', geometry => {
    for (const rotation of [-450, -90, 0, 90, 180, 270, 450] as const) {
      const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 600], 0, {}, '')
      try {
        doc.insertPage(-1, ref)
        const obj = doc.findPage(0), parent = obj.get('Parent')
        try {
          obj.delete('MediaBox'); obj.delete('Rotate')
          parent.put('MediaBox', geometry.media); parent.put('Rotate', rotation)
          if (geometry.crop) parent.put('CropBox', geometry.crop)
          obj.put('UserUnit', geometry.unit)
        } finally { parent.destroy(); obj.destroy() }
        const page = doc.loadPage(0)
        let bounds: number[]
        try { bounds = page.getBounds() } finally { page.destroy() }
        const load = vi.spyOn(doc, 'loadPage')
        expect(readDocumentMetadata(doc).pageSizes).toEqual([{ width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] }])
        expect(load).not.toHaveBeenCalled()
      } finally { ref.destroy(); doc.destroy() }
    }
  })

  it.each(['rotation', 'large-rotation', 'empty-crop', 'small-media', 'invalid-unit'])('uses native geometry for %s', kind => {
    const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 500, 600], 0, {}, '')
    try {
      doc.insertPage(-1, ref)
      const obj = doc.findPage(0)
      try {
        if (kind === 'rotation') obj.put('Rotate', 45)
        if (kind === 'large-rotation') obj.put('Rotate', 3600000000)
        if (kind === 'empty-crop') obj.put('CropBox', [700, 700, 800, 800])
        if (kind === 'small-media') obj.put('MediaBox', [0, 0, .5, .5])
        if (kind === 'invalid-unit') obj.put('UserUnit', 0)
      } finally { obj.destroy() }
      const page = doc.loadPage(0)
      let bounds: number[]
      try { bounds = page.getBounds() } finally { page.destroy() }
      const load = vi.spyOn(doc, 'loadPage')
      expect(readDocumentMetadata(doc).pageSizes).toEqual([{ width: bounds[2] - bounds[0], height: bounds[3] - bounds[1] }])
      expect(load).toHaveBeenCalledTimes(1)
    } finally { ref.destroy(); doc.destroy() }
  })

  it('matches float32 bounds across decimal origins and non-integer UserUnit', () => {
    const doc = new mupdf.PDFDocument()
    try {
      const expected = []
      for (let i = 0; i < 100; i++) {
        const x = (i - 50) * 12.34567, y = (50 - i) * 3.14159
        const ref = doc.addPage([x, y, x + 595.276, y + 841.89], (i % 4 * 90) as 0 | 90 | 180 | 270, {}, '')
        try { doc.insertPage(-1, ref) } finally { ref.destroy() }
        const obj = doc.findPage(i)
        try { obj.put('CropBox', [x + 10.123, y + 20.234, x + 500.456, y + 700.567]); obj.put('UserUnit', .12345 + i / 13) } finally { obj.destroy() }
        const page = doc.loadPage(i)
        try {
          const [x0, y0, x1, y1] = page.getBounds()
          expected.push({ width: x1 - x0, height: y1 - y0 })
        } finally { page.destroy() }
      }
      const load = vi.spyOn(doc, 'loadPage')
      expect(readDocumentMetadata(doc).pageSizes).toEqual(expected)
      expect(load).not.toHaveBeenCalled()
    } finally { doc.destroy() }
  })
})
