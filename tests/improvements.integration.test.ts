import mupdf from 'mupdf'
import { describe, expect, it } from 'vitest'
import { applyAndSaveAtomically, applyEditsAtomically, pdfOperation } from '../src/core/editTransaction'
import { listAnnotations, type AnnotationEdit } from '../src/core/annotations'
import { prepareDocumentOutput } from '../src/core/output'
import { openDocument } from '../src/core/mupdfDoc'
import { saveDocument } from '../src/core/save'

function fixture() {
  const doc = new mupdf.PDFDocument(), font = new mupdf.Font('Helvetica')
  try {
    const ref = doc.addSimpleFont(font, 'Latin')
    doc.insertPage(-1, doc.addPage([0, 0, 300, 300], 0, { Font: { F1: ref } }, 'BT /F1 18 Tf 20 240 Td (SECRET) Tj 0 -120 Td (PUBLIC) Tj ET'))
    const info = doc.newDictionary(); info.put('Author', doc.newString('PRIVATE AUTHOR')); doc.getTrailer().put('Info', doc.addObject(info))
    const action = doc.newDictionary(); action.put('S', doc.newName('JavaScript')); action.put('JS', doc.newString('PRIVATE ACTION')); doc.getTrailer().get('Root').put('OpenAction', doc.addObject(action))
    const attachment = doc.addEmbeddedFile('private.txt', 'text/plain', 'PRIVATE ATTACHMENT', new Date(), new Date(), false)
    doc.insertEmbeddedFile('private.txt', attachment)
    const bytes = saveDocument(doc, 'full').bytes
    return bytes
  } finally { font.destroy(); doc.destroy() }
}
const rectangle: AnnotationEdit = { kind: 'createSquare', pageIndex: 0, rect: [15, 35, 100, 70], color: [1, 0, 0], borderWidth: 1 }

describe('業務利用の安全な編集・出力', () => {
  it('途中の注釈エラーは成功した注釈も巻き戻し、再試行で複製しない', () => {
    const opened = openDocument(fixture()), doc = opened.document.asPDF()!
    try {
      const invalid: AnnotationEdit = { ...rectangle, kind: 'updateSquare', objNum: 999999 }
      expect(() => applyEditsAtomically(doc, [rectangle, invalid], {})).toThrow('見つかりません')
      expect(listAnnotations(doc, 0)).toHaveLength(0)
      const output = applyAndSaveAtomically(doc, [rectangle], {}, 'incremental')
      output.opened.document.destroy()
      expect(output.applied.errors).toEqual([])
      expect(listAnnotations(doc, 0)).toHaveLength(1)
      const reopened = openDocument(output.saved.bytes)
      try { expect(listAnnotations(reopened.document.asPDF()!, 0)).toHaveLength(1) } finally { reopened.document.destroy() }
    } finally { doc.destroy() }
  })
  it('PDF操作の例外でページ変更も巻き戻す', () => {
    const doc = openDocument(fixture()).document.asPDF()!
    try {
      expect(() => pdfOperation(doc, () => { doc.deletePage(0); throw new Error('模擬失敗') })).toThrow('模擬失敗')
      expect(doc.countPages()).toBe(1)
    } finally { doc.destroy() }
  })
  it('通常の確定は保持し、共有用出力だけ文書情報・添付・アクションを除去する', () => {
    const original = fixture()
    const normal = prepareDocumentOutput(original, [], {}, true)
    const safe = prepareDocumentOutput(original, [], {}, true, { redactions: [] })
    for (const [bytes, expected] of [[normal.bytes, true], [safe.bytes, false]] as const) {
      const opened = openDocument(bytes), doc = opened.document.asPDF()!
      try {
        expect(!doc.getTrailer().get('Info').isNull()).toBe(expected)
        expect(!doc.getTrailer().get('Root', 'OpenAction').isNull()).toBe(expected)
        expect(Object.keys(doc.getEmbeddedFiles()).length).toBe(expected ? 1 : 0)
      } finally { doc.destroy() }
    }
  })
  it('墨消しの文字を検索・抽出できず、枠外の文字と元の文書を保持する', () => {
    const original = fixture()
    const safe = prepareDocumentOutput(original, [rectangle], {}, true, { redactions: [{ pageIndex: 0, rect: [15, 35, 100, 70] }] })
    const opened = openDocument(safe.bytes), page = opened.document.loadPage(0), text = page.toStructuredText('')
    try {
      expect(text.asText()).not.toContain('SECRET')
      expect(text.asText()).toContain('PUBLIC')
      expect(page.search('SECRET', {}).length).toBe(0)
      const pixmap = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false)
      try {
        const pixels = pixmap.getPixels(), offset = (50 * pixmap.getWidth() + 30) * pixmap.getNumberOfComponents()
        expect([...pixels.slice(offset, offset + 3)]).toEqual([0, 0, 0])
      } finally { pixmap.destroy() }
      expect(listAnnotations(opened.document.asPDF()!, 0)).toEqual([])
    } finally { text.destroy(); page.destroy(); opened.document.destroy() }
    const source = openDocument(original), sourcePage = source.document.loadPage(0), sourceText = sourcePage.toStructuredText('')
    try { expect(sourceText.asText()).toContain('SECRET') } finally { sourceText.destroy(); sourcePage.destroy(); source.document.destroy() }
  })
  it('反映エラーがあれば確定・共有用出力を作成しない', () => {
    expect(() => prepareDocumentOutput(fixture(), [{ ...rectangle, pageIndex: 999 }], {}, true, { redactions: [] })).toThrow()
  })
})
