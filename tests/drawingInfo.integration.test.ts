import mupdf, { type PDFDocument } from 'mupdf'
import { beforeAll, describe, expect, it } from 'vitest'
import { detectDrawingInfo, readDrawingInfo, readDocumentDrawingInfos, reconcileDrawingInfos, writeDrawingInfo } from '../src/core/drawingInfo'
import { extractTextLines } from '../src/core/textExtract'
import { applyPageLayout, extractPages, splitPages, type PageLayoutCard } from '../src/core/pageOps'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import { applyEdits } from '../src/core/annotations'
import { makeDrawingInfoPdf } from './drawingInfoFixtures'

let bytes: Uint8Array
beforeAll(async () => { bytes = await makeDrawingInfoPdf() })
function detect(doc: PDFDocument) {
  return reconcileDrawingInfos(Array.from({ length: doc.countPages() }, (_, i) => {
    const page = doc.loadPage(i), text = page.toStructuredText('preserve-whitespace')
    try { return detectDrawingInfo(extractTextLines(text, page.getBounds(), 0).lines, page.getBounds(), 0, true) }
    finally { text.destroy(); page.destroy() }
  }))
}
function populate(doc: PDFDocument) {
  detect(doc).forEach((info, i) => { const page = doc.loadPage(i); try { writeDrawingInfo(doc, page, { number: info.number, name: info.name, scanned: true, nameManual: i === 1 }) } finally { page.destroy() } })
}
const card = (docId: string, pageIndex: number): PageLayoutCard => ({ id: `${docId}-${pageIndex}`, source: { kind: 'page', docId, pageIndex }, rotation: 0 })
describe('図面情報のPDF保存とページ対応', () => {
  it('3ページの文字を読み、版と手動印を保存して復元する', () => {
    const doc = new mupdf.PDFDocument(bytes)
    try {
      expect(detect(doc).map(p => [p.number, p.name])).toEqual([['E-101', '1階 電灯設備平面図'], ['E-102', '2階 電灯設備平面図'], ['E-103', '3階 電灯設備平面図']])
      populate(doc)
      const buffer = doc.saveToBuffer('compress'), saved = new mupdf.PDFDocument(buffer.asUint8Array())
      try { expect(readDocumentDrawingInfos(saved).map(i => i?.number)).toEqual(['E-101', 'E-102', 'E-103']); expect(readDocumentDrawingInfos(saved)[1]?.nameManual).toBe(true) }
      finally { saved.destroy(); buffer.destroy() }
    } finally { doc.destroy() }
  })
  it('並べ替え・削除・白紙・他PDF追加・抽出・分割でも対応する', () => {
    const doc = new mupdf.PDFDocument(bytes), source = new mupdf.PDFDocument(bytes)
    try {
      populate(doc); populate(source)
      const cards: PageLayoutCard[] = [card('self', 2), card('other', 1), card('self', 0), { id: 'blank', source: { kind: 'blank', width: 500, height: 500 }, rotation: 0 }]
      applyPageLayout('self', doc, cards, new Map([['other', source]]))
      expect(readDocumentDrawingInfos(doc).map(i => i?.number)).toEqual(['E-103', 'E-102', 'E-101', undefined])
      const outputs = [extractPages('self', doc, [card('self', 1)], new Map()), ...splitPages('self', doc, [[card('self', 0)], [card('self', 2)]], new Map())]
      outputs.forEach((data, i) => { const output = new mupdf.PDFDocument(data); try { expect(readDocumentDrawingInfos(output)[0]?.number).toBe(['E-102', 'E-103', 'E-101'][i]); if (!i) expect(readDocumentDrawingInfos(output)[0]?.nameManual).toBe(true) } finally { output.destroy() } })
    } finally { doc.destroy(); source.destroy() }
  })
  it('手動欄を守り、編集経路で書き込み、Undoする', () => {
    const doc = new mupdf.PDFDocument(bytes), store = new AnnotationStore()
    try {
      store.loadDrawingInfos([null, null, null]); detect(doc).forEach((info, i) => store.applyAutomaticDrawingInfo(i, info))
      store.setDrawingInfo([1], { ...store.getDrawingInfo(1), name: '手動の名称', nameManual: true })
      detect(doc).forEach((info, i) => store.applyAutomaticDrawingInfo(i, info))
      expect(store.getDrawingInfo(1)?.name).toBe('手動の名称')
      const result = applyEdits(doc, store.toEdits(), {}); expect(result.errors).toEqual([]); store.markApplied(result)
      expect(readDocumentDrawingInfos(doc)[1]?.name).toBe('手動の名称'); expect(store.isDirty()).toBe(false)
      store.undo(); expect(store.getDrawingInfo(1)?.name).toBe('2階 電灯設備平面図'); expect(store.isDirty()).toBe(true)
    } finally { doc.destroy() }
  })
  it('破損・未知版・80文字超過・2KB超過は無いものとして扱う', () => {
    const doc = new mupdf.PDFDocument(bytes), page = doc.loadPage(0), obj = page.getObject()
    try {
      for (const json of ['{', '{"version":2,"number":"E-101"}', JSON.stringify({ version: 1, name: 'a'.repeat(81) }), JSON.stringify({ version: 1, other: 'a'.repeat(2048) }), '{"version":1,"scanned":"true"}']) {
        const value = doc.newString(json); try { obj.put('KaruDrawing', value) } finally { value.destroy() }
        expect(readDrawingInfo(page)).toBeNull()
      }
      expect(() => writeDrawingInfo(doc, page, { name: 'a'.repeat(81) })).toThrow()
    } finally { obj.destroy(); page.destroy(); doc.destroy() }
  })
})
