import mupdf from 'mupdf'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { extractTextLines } from '../src/core/textExtract'
import { makeTextExtractFixture, DRAWING_TEXTS, VERTICAL_DRAWING_TEXTS } from './textExtractFixtures'

let bytes: Uint8Array
beforeAll(async () => { bytes = await makeTextExtractFixture() })

function pageText(document: InstanceType<typeof mupdf.PDFDocument>, pageIndex: number) {
  const page = document.loadPage(pageIndex)
  let text: ReturnType<typeof page.toStructuredText> | undefined
  const object = page.getObject(), rotation = object.getInheritable('Rotate')
  try {
    text = page.toStructuredText('preserve-whitespace')
    return extractTextLines(text, page.getBounds(), rotation.asNumber())
  } finally { text?.destroy(); rotation.destroy(); object.destroy(); page.destroy() }
}

describe('図面文字の行解析', () => {
  it('walkが文字ごとに保持するFont参照を直ちに解放し、再抽出してもページの文字を保つ', () => {
    const document = new mupdf.PDFDocument(bytes), page = document.loadPage(0), text = page.toStructuredText('preserve-whitespace')
    const release = vi.spyOn(mupdf.Font.prototype, 'destroy')
    try {
      const first = extractTextLines(text, page.getBounds(), 0)
      expect(release).toHaveBeenCalledTimes(first.lines[0].text.length)
      expect(extractTextLines(text, page.getBounds(), 0)).toEqual(first)
      expect(release).toHaveBeenCalledTimes(first.lines[0].text.length * 2)
    } finally { release.mockRestore(); text.destroy(); page.destroy(); document.destroy() }
  })
  it('ToUnicodeの補助平面文字をBMPの別文字へ切り詰めない', () => {
    const document = new mupdf.PDFDocument()
    const cmap = document.addStream('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Test def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 2 beginbfchar <41> <D842DFB7> <42> <91CE> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end', {})
    const object = document.addPage([0, 0, 400, 300], 0, { Font: { F1: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', ToUnicode: cmap } } }, 'BT /F1 12 Tf 40 180 Td (AB) Tj ET')
    document.insertPage(-1, object); object.destroy(); cmap.destroy()
    try {
      const result = pageText(document, 0)
      expect(result.lines[0].text).toBe('𠮷野')
      expect(result.uncertainCharacters).toBe(false)
      expect(result.lines[0].rect[2]).toBeGreaterThan(result.lines[0].rect[0])
    } finally { document.destroy() }
  })
  it('Identity-Vの日本語を、横書きへの誤変換なしに書字方向と表示方向を分けて返す', async () => {
    const document = new mupdf.PDFDocument(await makeTextExtractFixture({ vertical: true }))
    try {
      const first = pageText(document, 0), rotated = pageText(document, 3)
      expect(first.lines.map(line => line.text).join('')).toContain(VERTICAL_DRAWING_TEXTS[0])
      expect(first.lines[0].writingMode).toBe(1)
      expect(first.lines[0].direction).toEqual([0, 1])
      expect(rotated.lines[0].writingMode).toBe(1)
      expect(rotated.lines[0].direction).toEqual([-1, 0])
    } finally { document.destroy() }
  })
  it('日本語・CropBox・UserUnit・回転を表示ページ座標で抽出し、保存した原本を変えない', () => {
    const document = new mupdf.PDFDocument(bytes)
    try {
      const first = pageText(document, 0)
      expect(first.lines.map(line => line.text).join('')).toContain(DRAWING_TEXTS[0])
      expect(first.bounds).toEqual([0, 0, 600, 400])
      expect(first.lines[0].rect[0]).toBeCloseTo(60, 2)
      expect(first.lines[0].direction).toEqual([1, 0])
      expect(first.rotation).toBe(0)
      const rotated = pageText(document, 3)
      expect(rotated.lines.map(line => line.text).join('')).toContain(DRAWING_TEXTS[3])
      expect(rotated.bounds).toEqual([0, 0, 400, 600])
      expect(rotated.rotation).toBe(90)
      expect(rotated.lines[0].direction[0]).toBeCloseTo(0)
      expect(Math.abs(rotated.lines[0].direction[1])).toBeCloseTo(1)
      expect(document.hasUnsavedChanges()).toBe(false)
    } finally { document.destroy() }
  })

  it('文字のないページは空の行として返す', () => {
    const document = new mupdf.PDFDocument(bytes)
    try {
      const result = pageText(document, 2)
      expect(result.lines).toEqual([])
      expect(result.truncated).toBe(false)
    } finally { document.destroy() }
  })

  it.each([180, 270] as const)('%s度でも文字列を保ち、表示座標の向きを返す', angle => {
    const source = new mupdf.PDFDocument(bytes)
    const object = source.findPage(0)
    object.put('Rotate', angle); object.destroy()
    const saved = source.saveToBuffer('compress')
    const document = new mupdf.PDFDocument(saved.asUint8Array())
    try {
      const text = pageText(document, 0)
      expect(text.rotation).toBe(angle)
      expect(text.lines[0].text).toContain(DRAWING_TEXTS[0])
      expect(text.bounds).toEqual(angle === 180 ? [0, 0, 600, 400] : [0, 0, 400, 600])
      expect(text.lines[0].direction[0]).toBeCloseTo(angle === 180 ? -1 : 0)
      expect(text.lines[0].direction[1]).toBeCloseTo(angle === 270 ? -1 : 0)
    } finally { document.destroy(); saved.destroy(); source.destroy() }
  })

  it('長いページの出力上限を通知し、途中の文字列と元の行bboxを組み合わせない', () => {
    const document = new mupdf.PDFDocument(bytes), page = document.loadPage(0)
    const text = page.toStructuredText('preserve-whitespace')
    try {
      const limited = extractTextLines(text, page.getBounds(), 0, { characters: 5 })
      expect(limited.truncated).toBe(true)
      expect(limited.lines).toEqual([])
    } finally { text.destroy(); page.destroy(); document.destroy() }
  })

  it('コピーを許可しないPDFの権限を行解析後も保持する', () => {
    const source = new mupdf.PDFDocument(bytes)
    const saved = source.saveToBuffer('encrypt=aes-128,owner-password=owner-secret,user-password=reader-secret,permissions=0')
    const document = new mupdf.PDFDocument(saved.asUint8Array())
    try {
      expect(document.authenticatePassword('reader-secret')).toBeGreaterThan(0)
      expect(document.hasPermission('copy')).toBe(false)
      const result = pageText(document, 0)
      expect(result.lines[0].text).toContain(DRAWING_TEXTS[0])
      expect(document.hasPermission('copy')).toBe(false)
      expect(document.hasUnsavedChanges()).toBe(false)
    } finally { document.destroy(); saved.destroy(); source.destroy() }
  })
})
