import fs from 'node:fs/promises'
import mupdf, { type PDFDocument, type Quad, type Rect } from 'mupdf'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyEdits, listAnnotations, type AnnotationEdit } from '../src/core/annotations'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'
import { redactDocument, type RedactOptions } from '../src/core/redact'
import { openDocument } from '../src/core/mupdfDoc'
import { saveDocument } from '../src/core/save'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { DEFAULT_ANNOTATION_FILTER, matchesAnnotationFilter } from '../src/editor/annotationFilter'

const options: RedactOptions = { lineArt: 'covered', removeDocumentInfo: true }
const secret = 'PRIVATE_NAME_8237'
const area: Rect = [25, 60, 180, 90]
let font: FontResource
beforeAll(async () => { font = createFontResource(new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf'))) })
afterAll(() => font.font.destroy())

function fixture(extraContents = ''): PDFDocument {
  const doc = new mupdf.PDFDocument(), face = new mupdf.Font('Helvetica'), ref = doc.addSimpleFont(face)
  try {
    const page = doc.addPage([0, 0, 300, 300], 0, { Font: { F1: ref } },
      `BT /F1 12 Tf 30 220 Td (${secret}) Tj 0 -80 Td (PUBLIC_TEXT) Tj ET\n${extraContents}`)
    try { doc.insertPage(-1, page) } finally { page.destroy() }
  } finally { ref.destroy(); face.destroy() }
  return doc
}
function mark(doc: PDFDocument, rect = area, quads: Quad[] | null = null): number {
  const applied = applyEdits(doc, [{ kind: 'createRedact', pageIndex: 0, rect, quads }], {})
  expect(applied.errors).toEqual([])
  return applied.created[0]
}
function text(doc: PDFDocument, index = 0): string {
  const page = doc.loadPage(index), structured = page.toStructuredText({})
  try { return structured.asText() } finally { structured.destroy(); page.destroy() }
}
function output(doc: PDFDocument): Uint8Array {
  const buffer = doc.saveToBuffer('garbage=4,compress,compress-images,compress-fonts')
  try { return buffer.asUint8Array().slice() } finally { buffer.destroy() }
}
function quadsFor(doc: PDFDocument, prefix: string): Quad[] {
  const page = doc.loadPage(0), structured = page.toStructuredText({}), quads: Quad[] = []
  let index = 0
  try {
    structured.walk({ onChar: (char, _origin, _font, _size, quad) => {
      if (index < prefix.length) { expect(char).toBe(prefix[index++]); quads.push([...quad]) }
    } })
    return quads
  } finally { structured.destroy(); page.destroy() }
}

describe('true redaction on a disposable copy', () => {
  it('removes covered text, keeps outside text, and leaves the source copy unchanged', () => {
    const source = fixture()
    try {
      mark(source)
      const copy = new mupdf.PDFDocument(output(source))
      try {
        expect(redactDocument(copy, options)).toEqual({ areas: 1, pages: 1, removedLinks: 0 })
        expect(text(copy)).not.toContain(secret)
        expect(text(copy)).toContain('PUBLIC_TEXT')
        expect(listAnnotations(copy, 0)).toEqual([])
      } finally { copy.destroy() }
      expect(text(source)).toContain(secret)
      expect(listAnnotations(source, 0)[0].kind).toBe('redact')
    } finally { source.destroy() }
  })

  it('bakes FreeText first so covered annotation text is removed and outside FreeText remains', () => {
    const doc = fixture()
    try {
      const edits: AnnotationEdit[] = [
        { kind: 'createFreeText', pageIndex: 0, rect: [30, 65, 175, 88], text: 'PRIVATE_NOTE', fontSize: 12, color: [0, 0, 0], font: 'BIZUDGothic' },
        { kind: 'createFreeText', pageIndex: 0, rect: [30, 200, 180, 225], text: 'PUBLIC_NOTE', fontSize: 12, color: [0, 0, 0], font: 'BIZUDGothic' },
      ]
      expect(applyEdits(doc, edits, { BIZUDGothic: font }).errors).toEqual([])
      mark(doc)
      redactDocument(doc, options)
      expect(text(doc)).not.toContain('PRIVATE_NOTE')
      expect(text(doc)).toContain('PUBLIC_NOTE')
      expect(listAnnotations(doc, 0)).toEqual([])
    } finally { doc.destroy() }
  })

  it('uses each text quad and keeps text in gaps between quads', () => {
    const doc = fixture()
    try {
      const quads = quadsFor(doc, secret)
      // Deliberately omit the middle characters: the enclosing Rect must not erase them.
      mark(doc, area, [quads[0], quads[quads.length - 1]])
      redactDocument(doc, options)
      expect(text(doc)).toContain(secret.slice(1, -1))
      expect(text(doc)).not.toContain(secret)
      expect(text(doc)).toContain('PUBLIC_TEXT')
    } finally { doc.destroy() }
  })

  it.each([90, 270])('keeps page coordinates correct with rotation %s, CropBox and UserUnit', rotation => {
    const doc = fixture(), object = doc.findPage(0)
    try {
      object.put('Rotate', rotation)
      object.put('CropBox', [10, 20, 290, 280])
      object.put('UserUnit', 2)
    } finally { object.destroy() }
    try {
      const quads = quadsFor(doc, secret), xs = quads.flatMap(q => [q[0], q[2], q[4], q[6]]), ys = quads.flatMap(q => [q[1], q[3], q[5], q[7]])
      const rect: Rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
      mark(doc, rect, quads)
      const saved = new mupdf.PDFDocument(output(doc))
      try {
        const info = listAnnotations(saved, 0)[0]
        info.rect.forEach((value, i) => expect(value).toBeCloseTo(rect[i], 3))
        redactDocument(saved, options)
        expect(text(saved)).not.toContain(secret)
        expect(text(saved)).toContain('PUBLIC_TEXT')
      } finally { saved.destroy() }
    } finally { doc.destroy() }
  })

  it.each(['covered', 'touched'] as const)('lineArt=%s controls the part of a crossing line outside the range', lineArt => {
    const doc = fixture('0 0 0 RG 2 w 20 225 m 280 225 l S')
    try {
      mark(doc)
      redactDocument(doc, { ...options, lineArt })
      const page = doc.loadPage(0), pixels = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false)
      try {
        const outside = pixels.getPixels()[75 * pixels.getStride() + 240 * pixels.getNumberOfComponents()]
        if (lineArt === 'covered') expect(outside).toBeLessThan(32)
        else expect(outside).toBeGreaterThan(240)
      } finally { pixels.destroy(); page.destroy() }
    } finally { doc.destroy() }
  })

  it('removes every Redact before baking, including consecutive marks on multiple pages', () => {
    const doc = fixture()
    try {
      const ref = doc.addPage([0, 0, 300, 300], 0, {}, '')
      try { doc.insertPage(-1, ref) } finally { ref.destroy() }
      mark(doc)
      mark(doc, [200, 200, 220, 220])
      expect(applyEdits(doc, [{ kind: 'createRedact', pageIndex: 1, rect: area, quads: null }], {}).errors).toEqual([])
      expect(redactDocument(doc, options)).toMatchObject({ areas: 3, pages: 2 })
      expect(listAnnotations(doc, 0)).toEqual([])
      expect(listAnnotations(doc, 1)).toEqual([])
      expect(text(doc)).not.toContain(secret)
    } finally { doc.destroy() }
  })

  it('removes and counts intersecting links while keeping outside links', () => {
    const doc = fixture(), page = doc.loadPage(0)
    try {
      for (const [rect, uri] of [[area, 'https://example.com/private'], [[210, 200, 260, 230], 'https://example.com/public']] as const) {
        const link = page.createLink([...rect], uri)
        link.destroy()
      }
    } finally { page.destroy() }
    try {
      mark(doc)
      expect(redactDocument(doc, options).removedLinks).toBe(1)
      const reopened = new mupdf.PDFDocument(output(doc)), outputPage = reopened.loadPage(0)
      try {
        const links = outputPage.getLinks()
        try { expect(links.map(link => link.getURI())).toEqual(['https://example.com/public']) }
        finally { links.forEach(link => link.destroy()) }
      } finally { outputPage.destroy(); reopened.destroy() }
    } finally { doc.destroy() }
  })

  it.each([true, false])('removes Karu keys everywhere; removeDocumentInfo=%s controls Info and XMP', removeDocumentInfo => {
    const doc = fixture(), trailer = doc.getTrailer(), root = trailer.get('Root'), page = doc.findPage(0)
    try {
      root.put('KaruDrawingName', doc.newString('PRIVATE_ROOT'))
      root.put('KaruRoomSets', doc.newString('PRIVATE_ROOMS'))
      page.put('KaruPageName', doc.newString('PRIVATE_PAGE'))
      page.put('Unrelated', 123)
      const metadata = doc.addStream('<x:xmpmeta>PRIVATE_XMP</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' })
      try { root.put('Metadata', metadata) } finally { metadata.destroy() }
      const info = doc.newDictionary()
      try {
        for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) info.put(key, doc.newString('PRIVATE_INFO'))
        trailer.put('Info', info)
      } finally { info.destroy() }
      mark(doc)
      redactDocument(doc, { ...options, removeDocumentInfo })
      for (const [object, keys] of [[root, ['KaruDrawingName', 'KaruRoomSets']], [page, ['KaruPageName']]] as const) {
        for (const key of keys) { const value = object.get(key); try { expect(value.isNull()).toBe(true) } finally { value.destroy() } }
      }
      const infoAfter = trailer.get('Info'), xmp = root.get('Metadata'), unrelated = page.get('Unrelated')
      try {
        expect(xmp.isNull()).toBe(removeDocumentInfo)
        expect(unrelated.asNumber()).toBe(123)
        for (const key of ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer']) {
          const value = infoAfter.get(key)
          try { expect(value.isNull()).toBe(removeDocumentInfo); if (!removeDocumentInfo) expect(value.asString()).toBe('PRIVATE_INFO') }
          finally { value.destroy() }
        }
      } finally { unrelated.destroy(); xmp.destroy(); infoAfter.destroy() }
    } finally { page.destroy(); root.destroy(); trailer.destroy(); doc.destroy() }
  })

  it('rejects a document without redaction marks', () => {
    const doc = fixture()
    try { expect(() => redactDocument(doc, options)).toThrow('墨消しの範囲がありません。') }
    finally { doc.destroy() }
  })

  it('fails closed when verification finds even one remaining character', () => {
    const doc = fixture()
    mark(doc)
    const spy = vi.spyOn(mupdf.PDFPage.prototype, 'applyRedactions').mockImplementation(() => {})
    try {
      expect(() => redactDocument(doc, options)).toThrow('墨消しを確認できませんでした（1ページの範囲に文字が残っています）。')
    } finally { spy.mockRestore(); doc.destroy() }
  })

  it('full output contains no removed string in plain bytes, extracted text, or any decoded stream', () => {
    const doc = fixture()
    try {
      mark(doc)
      // Start from a saved source so old content really exists in the input bytes.
      const source = new mupdf.PDFDocument(output(doc))
      try {
        redactDocument(source, options)
        const bytes = output(source)
        expect(new TextDecoder('latin1').decode(bytes)).not.toContain(secret)
        const reopened = new mupdf.PDFDocument(bytes)
        try {
          for (let i = 0; i < reopened.countPages(); i++) expect(text(reopened, i)).not.toContain(secret)
          for (let i = 1; i < reopened.countObjects(); i++) {
            const object = reopened.newIndirect(i)
            try {
              if (!object.isStream()) continue
              const stream = object.readStream()
              try { expect(new TextDecoder('latin1').decode(stream.asUint8Array())).not.toContain(secret) }
              finally { stream.destroy() }
            } finally { object.destroy() }
          }
        } finally { reopened.destroy() }
      } finally { source.destroy() }
    } finally { doc.destroy() }
  })

  it('full redacted output still requires the original password', () => {
    const doc = fixture(), password = 'Ab1,=\\\"password'
    try {
      mark(doc)
      const encrypted = doc.saveToBuffer({ encrypt: 'aes-256', 'user-password': password, 'owner-password': password })
      const sourceBytes = encrypted.asUint8Array().slice()
      encrypted.destroy()
      const opened = openDocument(sourceBytes, true, password)
      try {
        // Same copy path used by the worker, including the incremental snapshot.
        const copy = openDocument(saveDocument(opened.document.asPDF()!, 'incremental').bytes, true, password)
        try {
          redactDocument(copy.document.asPDF()!, options)
          const result = new mupdf.PDFDocument(output(copy.document.asPDF()!))
          try {
            expect(result.needsPassword()).toBe(true)
            expect(result.authenticatePassword('wrong')).toBe(0)
            expect(result.authenticatePassword(password)).not.toBe(0)
            expect(text(result)).not.toContain(secret)
            expect(text(result)).toContain('PUBLIC_TEXT')
          } finally { result.destroy() }
        } finally { copy.document.destroy() }
      } finally { opened.document.destroy() }
    } finally { doc.destroy() }
  })

  it('createRedact/updateRedact round-trip Rect, QuadPoints and standard PDF dictionaries', () => {
    const doc = fixture()
    try {
      const objNum = mark(doc), quads = quadsFor(doc, secret)
      expect(applyEdits(doc, [{ kind: 'updateRedact', objNum, pageIndex: 0, rect: area, quads }], {}).errors).toEqual([])
      const saved = new mupdf.PDFDocument(output(doc))
      try {
        const info = listAnnotations(saved, 0)[0]
        expect(info).toMatchObject({ kind: 'redact', type: 'Redact', editable: true, rect: area })
        // MuPDF uses float32 page transforms when converting PDF's y-up coordinates.
        expect(info.quads).toHaveLength(quads.length)
        info.quads!.forEach((quad, i) => quad.forEach((value, j) => expect(value).toBeCloseTo(quads[i][j], 4)))
        const object = saved.newIndirect(info.objNum)
        try {
          for (const [key, expected] of [['C', [1, 0, 0]], ['IC', [0, 0, 0]]] as const) {
            const value = object.get(key)
            try { expect(value.asJS()).toEqual(expected) } finally { value.destroy() }
          }
          const author = object.get('T'), appearance = object.get('AP', 'N')
          try { expect(author.isNull()).toBe(true); expect(appearance.isStream()).toBe(true) }
          finally { author.destroy(); appearance.destroy() }
        } finally { object.destroy() }
        expect(applyEdits(saved, [{ kind: 'updateRedact', objNum: info.objNum, pageIndex: 0, rect: [20, 20, 90, 50], quads: null }], {}).errors).toEqual([])
        expect(listAnnotations(saved, 0)[0]).toMatchObject({ kind: 'redact', rect: [20, 20, 90, 50], quads: null })
      } finally { saved.destroy() }
    } finally { doc.destroy() }
  })

  it('imports external Redact marks; range marks move/resize/copy/undo while text marks stay anchored', async () => {
    const doc = fixture(), page = doc.loadPage(0)
    try {
      const annotation = page.createAnnotation('Redact')
      try { annotation.setRect(area); annotation.update() } finally { annotation.destroy() }
    } finally { page.destroy() }
    try {
      const store = new AnnotationStore()
      await store.ensurePageLoaded(0, async () => listAnnotations(doc, 0))
      const imported = store.getPageAnnotations(0)[0]
      expect(imported.kind).toBe('redact')
      expect(store.touchedObjNums(0)).toContain(imported.objNum)
      store.selectOnly(imported.id)
      expect(store.copySelected()).toHaveLength(1)
      store.move(imported.id, 5, 10)
      expect(store.toEdits()[0]).toMatchObject({ kind: 'updateRedact', rect: [30, 70, 185, 100], quads: null })
      store.resize(imported.id, [10, 10, 60, 60])
      store.undo()
      expect(store.get(imported.id)!.rect).toEqual([30, 70, 185, 100])
      store.redo()
      expect(store.get(imported.id)!.rect).toEqual([10, 10, 60, 60])
      const anchored = store.create({ kind: 'redact', pageIndex: 0, rect: area, quads: quadsFor(doc, secret) })
      store.move(anchored.id, 10, 10)
      store.resize(anchored.id, [0, 0, 10, 10])
      store.nudgeMany([anchored.id], 5, 0, 'redact-test')
      expect(store.get(anchored.id)!.rect).toEqual(area)
      expect(matchesAnnotationFilter(imported, { ...DEFAULT_ANNOTATION_FILTER, kind: 'shape' })).toBe(true)
      expect(matchesAnnotationFilter(anchored, { ...DEFAULT_ANNOTATION_FILTER, kind: 'markup' })).toBe(true)
      store.remove(anchored.id)
      store.undo()
      expect(store.get(anchored.id)).toBeDefined()
    } finally { doc.destroy() }
  })
})
