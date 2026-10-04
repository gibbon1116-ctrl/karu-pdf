import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import mupdf, { type PDFAnnotation, type PDFDocument } from 'mupdf'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyEdits, listAnnotations, type AnnotationEdit, type Rect } from '../src/core/annotations'
import { readCountFixtures, type CountFixture } from '../src/core/countFixtures'
import { applyAndSaveAtomically, applyEditsAtomically, pdfChunkedOperation } from '../src/core/editTransaction'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'
import * as documentOpening from '../src/core/mupdfDoc'
import * as documentSaving from '../src/core/save'
import { AnnotationStore } from '../src/editor/AnnotationStore'

let font: FontResource
beforeAll(async () => {
  font = createFontResource(new Uint8Array(await fs.readFile(path.resolve('public/fonts/BIZUDGothic-Regular.ttf'))))
})
afterAll(() => { font.font.destroy() })

function fixture(): CountFixture {
  return { id: 'dl', name: 'ダウンライト', code: 'DL', category: '照明器具', order: 0,
    style: { shape: 'star', fill: 'solid', color: [1, 0, 0], size: 10, opacity: 1, showCode: true } }
}

function legacyMark(index: number, pageCount: number): Extract<AnnotationEdit, { kind: 'createSymbol' }> {
  const x = 12 + index % 50 * 11, y = 12 + Math.floor(index / 50) * 15
  return { kind: 'createSymbol', pageIndex: index % pageCount, rect: [x, y, x + 10, y + 10],
    symbol: 'circle', color: [0, 0, 1], count: { version: 1, id: `legacy-${index}`, group: '照明器具' } }
}

function legacyDocument(count: number, pageCount = 1, withCatalog = false): PDFDocument {
  const source = new mupdf.PDFDocument()
  try {
    for (let i = 0; i < pageCount; i++) {
      const ref = source.addPage([0, 0, 640, 840], 0, {}, '')
      try { source.insertPage(-1, ref) } finally { ref.destroy() }
    }
    const edits: AnnotationEdit[] = Array.from({ length: count }, (_, i) => legacyMark(i, pageCount))
    if (withCatalog) edits.push({ kind: 'setCountFixtures', pageIndex: 0, fixtures: [fixture()] })
    expect(applyEdits(source, edits, {}).errors).toEqual([])
    const buffer = source.saveToBuffer('compress')
    try { return new mupdf.PDFDocument(new Uint8Array(buffer.asUint8Array())) } finally { buffer.destroy() }
  } finally { source.destroy() }
}

function snapshot(doc: PDFDocument) {
  const pages = Array.from({ length: doc.countPages() }, (_, pageIndex) => {
    const pageObject = doc.findPage(pageIndex), annots = pageObject.get('Annots'), resolvedAnnots = annots.resolve()
    const page = doc.loadPage(pageIndex), annotations = page.getAnnotations()
    try {
      return { annots: resolvedAnnots.asJS(), annotations: annotations.map(annotation => {
        const object = annotation.getObject(), dictionary = object.resolve(), appearance = object.get('AP', 'N')
        try {
          let contents: string | null = null
          if (appearance.isStream()) {
            const stream = appearance.readStream()
            try { contents = stream.asString() } finally { stream.destroy() }
          }
          // The complete dictionary includes Rect, KaruCount, KaruCountRect and AP.
          return { objNum: object.asIndirect(), dictionary: dictionary.asJS(), appearance: contents }
        } finally { appearance.destroy(); dictionary.destroy(); object.destroy() }
      }) }
    } finally {
      for (const annotation of annotations) annotation.destroy()
      page.destroy(); resolvedAnnots.destroy(); annots.destroy(); pageObject.destroy()
    }
  })
  const trailer = doc.getTrailer(), root = trailer.get('Root'), catalog = root.get('KaruCountFixtures')
  try { return { pages, catalog: catalog.asJS(), fixtures: readCountFixtures(doc) } }
  finally { catalog.destroy(); root.destroy(); trailer.destroy() }
}

function batchEdits(doc: PDFDocument): AnnotationEdit[] {
  const pageCount = doc.countPages()
  const marks = Array.from({ length: pageCount }, (_, pageIndex) => listAnnotations(doc, pageIndex))
  const updates = marks.map(pageMarks => pageMarks.slice(1))
  return Array.from({ length: 300 }, (_, i): AnnotationEdit => {
    if (i === 0) return { kind: 'setCountFixtures', pageIndex: 0, fixtures: [{ ...fixture(), name: '変更した器具' }] }
    if (i === 1) return { kind: 'delete', pageIndex: 0, objNum: marks[0][0].objNum }
    if (i === 2) return { ...legacyMark(300, pageCount), pageIndex: 1,
      count: { version: 2, id: 'created', fixtureId: fixture().id } }
    const pageIndex = i % pageCount
    const mark = updates[pageIndex][(Math.floor(i / pageCount) - 1) % updates[pageIndex].length]
    const rect: Rect = [mark.rect[0] + 2, mark.rect[1] + 3, mark.rect[2] + 2, mark.rect[3] + 3]
    return { kind: 'updateSymbol', pageIndex, objNum: mark.objNum, rect, symbol: 'circle', color: [1, 0, 0],
      count: { version: 2, id: `changed-${i}`, fixtureId: fixture().id } }
  })
}

function withInvalid250th(edits: AnnotationEdit[]): AnnotationEdit[] {
  return edits.map((edit, i) => i === 249 && edit.kind === 'updateSymbol' ? { ...edit, objNum: 999999 } : edit)
}

function expectRetrySaved(doc: PDFDocument, edits: AnnotationEdit[]): void {
  const result = applyAndSaveAtomically(doc, edits, { BIZUDGothic: font }, 'incremental')
  try {
    expect(result.applied.errors).toEqual([])
    expect(snapshot(result.opened.document.asPDF()!)).toEqual(snapshot(doc))
  } finally { result.opened.document.destroy() }
}

describe('chunked atomic annotation operations', () => {
  it('saves migration of 2,000 legacy counts and one fixture style within ten seconds, sharing AP resources across chunks', async () => {
    const doc = legacyDocument(2000)
    try {
      const store = new AnnotationStore()
      await store.ensureCountFixtures(async () => readCountFixtures(doc), async () => store.ensurePageLoaded(0, async () => listAnnotations(doc, 0)))
      expect(store.getCountFixtures()).toHaveLength(1)
      const changed: CountFixture = { ...store.getCountFixtures()[0], code: 'DL', style: fixture().style }
      store.setCountFixtures([changed])
      const edits = store.toEdits()
      expect(edits.filter(edit => edit.kind === 'updateSymbol')).toHaveLength(2000)
      expect(edits.filter(edit => edit.kind === 'setCountFixtures')).toHaveLength(1)
      const begin = vi.spyOn(doc, 'beginOperation'), update = vi.spyOn(mupdf.PDFAnnotation.prototype, 'update')
      try {
        const start = performance.now()
        const result = applyAndSaveAtomically(doc, edits, { BIZUDGothic: font }, 'incremental')
        const elapsed = performance.now() - start
        try {
          expect(elapsed).toBeLessThanOrEqual(10_000)
          expect(result.applied.errors).toEqual([])
          expect(result.saved.mode).toBe('incremental')
          // One checkpoint per edit and per installed appearance, plus the initial operation.
          expect(begin).toHaveBeenCalledTimes(1 + Math.floor((edits.length + 2000) / 50))
          expect(begin.mock.calls.every(([name]) => name === 'かるPDF 編集')).toBe(true)
          expect(update).not.toHaveBeenCalled()
          const reopened: PDFDocument = result.opened.document.asPDF()!
          expect(readCountFixtures(reopened)).toEqual([changed])
          const marks = listAnnotations(reopened, 0)
          expect(marks).toHaveLength(2000)
          expect(marks.every(mark => mark.count?.version === 2 && mark.count.fixtureId === changed.id)).toBe(true)
          expect(new Set(marks.map(mark => mark.count!.id)).size).toBe(2000)
          const page = reopened.loadPage(0), annotations = page.getAnnotations(), resources = new Set<number>()
          try {
            for (const annotation of annotations) {
              const object = annotation.getObject(), appearance = object.get('AP', 'N')
              const resource = appearance.get('Resources'), stream = appearance.readStream()
              try {
                expect(appearance.isStream()).toBe(true)
                const contents = stream.asString()
                expect(contents.match(/(?:^|\s)l(?=\s|$)/g)).toHaveLength(18)
                expect(contents).toMatch(/(?:^|\s)f(?=\s|$)/)
                expect(contents).toMatch(/(?:^|\s)S(?=\s|$)/)
                expect(contents).toContain('BT')
                resources.add(resource.asIndirect())
              } finally { stream.destroy(); resource.destroy(); appearance.destroy(); object.destroy() }
            }
            expect(resources.size).toBe(1)
            expect([...resources][0]).toBeGreaterThan(0)
          } finally { for (const annotation of annotations) annotation.destroy(); page.destroy() }
        } finally { result.opened.document.destroy() }
      } finally { update.mockRestore(); begin.mockRestore() }
    } finally { doc.destroy() }
  }, 30_000)

  it.each(['applyEditsAtomically', 'applyAndSaveAtomically'] as const)('%s rolls back 300 edits when edit 250 fails and then saves a correct retry', operation => {
    const doc = legacyDocument(300, 3, true)
    try {
      const before = snapshot(doc), edits = batchEdits(doc), invalid = withInvalid250th(edits)
      const undo = vi.spyOn(doc, 'undo')
      try {
        expect(() => {
          if (operation === 'applyEditsAtomically') applyEditsAtomically(doc, invalid, { BIZUDGothic: font })
          else applyAndSaveAtomically(doc, invalid, { BIZUDGothic: font }, 'incremental')
        }).toThrow('999999')
        expect(undo).toHaveBeenCalledTimes(6)
      } finally { undo.mockRestore() }
      expect(snapshot(doc)).toEqual(before)
      expectRetrySaved(doc, edits)
      expect(snapshot(doc)).not.toEqual(before)
    } finally { doc.destroy() }
  }, 30_000)

  it('keeps every change from a preceding successful call after a separate call fails', () => {
    const doc = legacyDocument(300, 3, true)
    try {
      const original = snapshot(doc)
      expect(applyEditsAtomically(doc, batchEdits(doc), { BIZUDGothic: font }).errors).toEqual([])
      const committed = snapshot(doc)
      expect(committed).not.toEqual(original)
      const edits = batchEdits(doc)
      expect(() => applyEditsAtomically(doc, withInvalid250th(edits), { BIZUDGothic: font })).toThrow('999999')
      expect(snapshot(doc)).toEqual(committed)
      expectRetrySaved(doc, edits)
    } finally { doc.destroy() }
  }, 30_000)

  it('does not undo the preceding call when completed chunks contain no changes', () => {
    const doc = legacyDocument(1)
    try {
      applyEditsAtomically(doc, [{ kind: 'setCountFixtures', pageIndex: 0, fixtures: [fixture()] }], {})
      const committed = snapshot(doc), failure = new Error('空の区切りの後で失敗')
      expect(() => pdfChunkedOperation(doc, checkpoint => {
        for (let i = 0; i < 100; i++) checkpoint()
        throw failure
      })).toThrow(failure)
      expect(snapshot(doc)).toEqual(committed)
    } finally { doc.destroy() }
  })

  it.each(['save', 'reopen'] as const)('rolls back all chunks when %s fails inside the last operation and then saves a retry', stage => {
    const doc = legacyDocument(300, 3, true)
    try {
      const before = snapshot(doc), edits = batchEdits(doc), failure = new Error(`${stage} failed`)
      const begin = vi.spyOn(doc, 'beginOperation'), end = vi.spyOn(doc, 'endOperation')
      const fail = () => {
        expect(begin.mock.calls.length).toBeGreaterThan(1)
        expect(begin.mock.calls.length).toBe(end.mock.calls.length + 1)
        throw failure
      }
      const fault = stage === 'save'
        ? vi.spyOn(documentSaving, 'saveDocument').mockImplementationOnce(fail)
        : vi.spyOn(documentOpening, 'openDocument').mockImplementationOnce(fail)
      try {
        expect(() => applyAndSaveAtomically(doc, edits, { BIZUDGothic: font }, 'incremental')).toThrow(failure)
        expect(fault).toHaveBeenCalledTimes(1)
      } finally { fault.mockRestore(); end.mockRestore(); begin.mockRestore() }
      expect(snapshot(doc)).toEqual(before)
      expectRetrySaved(doc, edits)
    } finally { doc.destroy() }
  }, 30_000)

  it('rolls back edits and already installed AP chunks if a later appearance fails', () => {
    const doc = legacyDocument(300, 3, true)
    try {
      const before = snapshot(doc), countFixture = fixture()
      const edits: AnnotationEdit[] = Array.from({ length: doc.countPages() }, (_, pageIndex) =>
        listAnnotations(doc, pageIndex).map((mark): AnnotationEdit => ({ kind: 'updateSymbol', pageIndex, objNum: mark.objNum,
          rect: mark.rect, symbol: 'circle', color: [1, 0, 0], count: { version: 2, id: mark.count!.id, fixtureId: countFixture.id }, countFixture }))).flat()
      const original = mupdf.PDFAnnotation.prototype.setAppearance
      let calls = 0
      const appearance = vi.spyOn(mupdf.PDFAnnotation.prototype, 'setAppearance').mockImplementation(function (this: PDFAnnotation, ...args) {
        if (++calls === 60) throw new Error('模擬外観失敗')
        return original.apply(this, args)
      })
      try {
        expect(() => applyAndSaveAtomically(doc, edits, { BIZUDGothic: font }, 'incremental')).toThrow('模擬外観失敗')
        expect(calls).toBe(60)
      } finally { appearance.mockRestore() }
      expect(snapshot(doc)).toEqual(before)
      expectRetrySaved(doc, edits)
    } finally { doc.destroy() }
  }, 30_000)

  it('calls the optional checkpoint after successful and failed edits, including early continues', () => {
    const doc = legacyDocument(1)
    try {
      const checkpoint = vi.fn(), mark = legacyMark(1, 1)
      const result = applyEdits(doc, [
        { kind: 'setCountFixtures', pageIndex: 0, fixtures: [fixture()] },
        { ...mark, kind: 'updateSymbol', objNum: 999999 }, mark,
      ], {}, { checkpoint })
      expect(result.errors).toHaveLength(1)
      expect(result.created).toHaveLength(1)
      expect(checkpoint).toHaveBeenCalledTimes(3)
    } finally { doc.destroy() }
  })
})
