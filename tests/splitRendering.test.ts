import mupdf from 'mupdf'
import { describe, expect, it, vi } from 'vitest'
import { makeSplitPdf } from '../e2e/splitFixtures'
import { DocumentSession } from '../src/app/documentModel'
import { prepareSplitDisplays } from '../src/app/splitRendering'
import type { PdfWorkerPool } from '../src/client/PdfWorkerPool'
import { saveDocument } from '../src/core/save'

function session(docId: string) {
  return new DocumentSession({ docId, name: `${docId}.pdf`, byteLength: 1, handle: null,
    pageSizes: Array.from({ length: 5 }, () => ({ width: 600, height: 1000 })) })
}

function checkPdf(bytes: Uint8Array, count: number, annotations = 1) {
  const doc = new mupdf.PDFDocument(bytes)
  try {
    expect(doc.countPages()).toBe(count)
    for (let i = 0; i < count; i++) {
      const page = doc.loadPage(i)
      try {
        expect(page.getBounds()).toEqual([0, 0, 600, 1000])
        const text = page.toStructuredText('')
        try { expect(text.asText()).toContain(`RED page ${i + 1}`) } finally { text.destroy() }
        const raster = page.toPixmap(mupdf.Matrix.scale(.1, .1), mupdf.ColorSpace.DeviceRGB, false, true)
        try {
          const pixels = raster.getPixels()
          expect([...pixels.slice((20 * 60 + 12) * 3, (20 * 60 + 12) * 3 + 3)]).toEqual([255, 0, 0])
        } finally { raster.destroy() }
        if (i === 0) {
          const marks = page.getAnnotations()
          try { expect(marks).toHaveLength(annotations) } finally { marks.forEach(mark => mark.destroy()) }
        }
      } finally { page.destroy() }
    }
  } finally { doc.destroy() }
}

describe('split PDF loading', () => {
  it('the generated fixture has valid pages, text and raster before any application reload', () => {
    checkPdf(Uint8Array.from(makeSplitPdf(5)), 5)
  })

  it('rebases both edited panes before display eviction/export, preserves later saves and does not repeat snapshots', async () => {
    const left = session('left'), right = session('right')
    const documents = new Map([left, right].map(s => [s.docId, new mupdf.PDFDocument(Uint8Array.from(makeSplitPdf(5)))]))
    const messages: string[] = []
    mupdf.setLog(message => messages.push(message))
    const pool = {
      applyAndSave: vi.fn(async (id: string, edits: unknown[], mode: 'full') => {
        expect(edits).toEqual([])
        expect(mode).toBe('full')
        const doc = documents.get(id)!
        const result = saveDocument(doc, mode)
        // Match the existing worker's full-save replaceDocument() path.
        documents.set(id, new mupdf.PDFDocument(result.bytes.slice()))
        doc.destroy()
        return { ...result, errors: [] }
      }),
      openSourceDisplays: vi.fn(async (_id: string, file: Blob) => {
        checkPdf(new Uint8Array(await file.arrayBuffer()), 5, 2)
      }),
      activate: vi.fn(async (id: string) => {
        // Force the export path even if the display worker already holds it.
        checkPdf(saveDocument(documents.get(id)!, 'incremental').bytes, 5, 2)
      }),
    }
    try {
      for (const s of [left, right]) {
        const page = documents.get(s.docId)!.loadPage(0)
        const mark = page.createAnnotation('Square')
        try { mark.setRect([20, 20, 40, 40]); mark.update() } finally { mark.destroy(); page.destroy() }
        checkPdf(saveDocument(documents.get(s.docId)!, 'incremental').bytes, 5, 2)
        s.recordSavedRendering([], [])
      }
      await prepareSplitDisplays(pool as unknown as PdfWorkerPool, left, right, () => false)
      await prepareSplitDisplays(pool as unknown as PdfWorkerPool, left, right, () => false)
      expect(pool.applyAndSave).toHaveBeenCalledTimes(2)
      for (const s of [left, right]) checkPdf(saveDocument(documents.get(s.docId)!, 'incremental').bytes, 5, 2)
      expect(messages).toEqual([])
    } finally { documents.forEach(doc => doc.destroy()); mupdf.setLog(null) }
  })

  it('serializes overlapping selections and skips cancelled preparation', async () => {
    const left = session('left'), right = session('right'), third = session('third')
    const calls: string[] = []
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const pool = { activate: vi.fn(async (id: string) => { calls.push(id); if (calls.length === 1) await blocked }) }
    const first = prepareSplitDisplays(pool as unknown as PdfWorkerPool, left, right, () => false)
    const cancelled = prepareSplitDisplays(pool as unknown as PdfWorkerPool, left, third, () => true)
    const next = prepareSplitDisplays(pool as unknown as PdfWorkerPool, left, third, () => false)
    await vi.waitFor(() => expect(calls).toEqual(['right']))
    release()
    await Promise.all([first, cancelled, next])
    expect(calls).toEqual(['right', 'left', 'third', 'left'])
  })
})
