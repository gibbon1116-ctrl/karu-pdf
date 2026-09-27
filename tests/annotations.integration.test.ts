import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf, { type PDFAnnotation, type PDFDocument, type PDFObject, type PDFPage } from 'mupdf'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyEdits, listAnnotations, type AnnotationEdit, type Rect } from '../src/core/annotations'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'
import { saveDocument, type SaveMode } from '../src/core/save'
import { ensureSamplePdf } from './fixtures'

const realPath = path.resolve('test-data/real/公共建築工事標準仕様書_建築_R7.pdf')
const fontPath = path.resolve('public/fonts/BIZUDGothic-Regular.ttf')
const resultPath = path.resolve('test-results/annot-roundtrip.pdf')
const firstText = '日本語の書き込みテスト①（半角ABC 123）'
const firstRect: Rect = [72, 320, 272, 362]
const rotatedRect: Rect = [100, 100, 300, 145]

let fontResource: FontResource
let sampleBytes: Uint8Array

beforeAll(async () => {
  sampleBytes = new Uint8Array(await fs.readFile(await ensureSamplePdf()))
  fontResource = createFontResource(new Uint8Array(await fs.readFile(fontPath)))
  await fs.mkdir(path.dirname(resultPath), { recursive: true })
})

afterAll(() => {
  fontResource.font.destroy()
})

function openPdf(bytes: Uint8Array): PDFDocument {
  return new mupdf.PDFDocument(bytes)
}

function applyAndSave(bytes: Uint8Array, edits: AnnotationEdit[], mode: SaveMode = 'full') {
  const document = openPdf(bytes)
  try {
    const applied = applyEdits(document, edits, fontResource)
    expect(applied.errors).toEqual([])
    return { ...applied, ...saveDocument(document, mode) }
  } finally {
    document.destroy()
  }
}

function findAnnotation(page: PDFPage, objNum: number): PDFAnnotation {
  for (const annotation of page.getAnnotations()) {
    const object = annotation.getObject()
    let matches = false
    try { matches = object.asIndirect() === objNum } finally { object.destroy() }
    if (matches) return annotation
    annotation.destroy()
  }
  throw new Error(`注釈 ${objNum} が見つかりません。`)
}

function arrayValue(object: PDFObject, key: string): number[] {
  const value = object.get(key)
  try {
    return value.asJS() as number[]
  } finally {
    value.destroy()
  }
}

function inspectFreeText(document: PDFDocument, pageIndex: number, objNum: number) {
  const page = document.loadPage(pageIndex)
  const annotation = findAnnotation(page, objNum)
  const object = annotation.getObject()
  // readStream() は間接参照のオブジェクト番号を必要とするため、resolve() しない。
  const normalAppearance = object.get('AP', 'N')
  const fonts = normalAppearance.get('Resources', 'Font')
  let baseFont = ''
  let embeddedFontBytes = 0
  let hasToUnicode = false
  try {
    fonts.forEach((fontObject) => {
      if (baseFont !== '') {
        fontObject.destroy()
        return
      }
      const font = fontObject.resolve()
      const name = font.get('BaseFont')
      const descendant = font.get('DescendantFonts', 0).resolve()
      const descriptor = descendant.get('FontDescriptor').resolve()
      let fontFile = descriptor.get('FontFile2')
      if (fontFile.isNull()) {
        fontFile.destroy()
        fontFile = descriptor.get('FontFile3')
      }
      const toUnicode = font.get('ToUnicode')
      try {
        baseFont = name.isName() ? name.asName() : String(name.valueOf())
        hasToUnicode = toUnicode.isStream()
        if (fontFile.isStream()) {
          const stream = fontFile.readStream()
          try { embeddedFontBytes = stream.length } finally { stream.destroy() }
        }
      } finally {
        toUnicode.destroy()
        fontFile.destroy()
        descriptor.destroy()
        descendant.destroy()
        name.destroy()
        font.destroy()
        fontObject.destroy()
      }
    })
    const author = object.get('T')
    const richContents = object.get('RC')
    let hasAuthor: boolean
    let hasRichContents: boolean
    try {
      hasAuthor = !author.isNull()
      hasRichContents = !richContents.isNull()
    } finally {
      author.destroy()
      richContents.destroy()
    }
    const appearanceStream = normalAppearance.readStream()
    let appearanceBytes: Uint8Array
    try { appearanceBytes = new Uint8Array(appearanceStream.asUint8Array()) } finally { appearanceStream.destroy() }
    return {
      baseFont,
      embeddedFontBytes,
      hasToUnicode,
      hasAuthor,
      hasRichContents,
      bbox: arrayValue(normalAppearance, 'BBox'),
      matrix: arrayValue(normalAppearance, 'Matrix'),
      appearanceBytes,
      page,
      annotation,
      object,
      normalAppearance,
      fonts,
    }
  } catch (error) {
    fonts.destroy()
    normalAppearance.destroy()
    object.destroy()
    annotation.destroy()
    page.destroy()
    throw error
  }
}

function closeInspection(inspection: ReturnType<typeof inspectFreeText>): void {
  inspection.fonts.destroy()
  inspection.normalAppearance.destroy()
  inspection.object.destroy()
  inspection.annotation.destroy()
  inspection.page.destroy()
}

function annotationText(annotation: PDFAnnotation): string {
  const displayList = annotation.toDisplayList()
  const structuredText = displayList.toStructuredText('preserve-spans')
  try {
    return structuredText.asText()
  } finally {
    structuredText.destroy()
    displayList.destroy()
  }
}

function countRedPixels(page: PDFPage, rect: Rect, scale = 2): number {
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
  try {
    const pixels = pixmap.getPixels()
    const width = pixmap.getWidth()
    const x0 = Math.max(0, Math.floor(rect[0] * scale))
    const y0 = Math.max(0, Math.floor(rect[1] * scale))
    const x1 = Math.min(width, Math.ceil(rect[2] * scale))
    const y1 = Math.min(pixmap.getHeight(), Math.ceil(rect[3] * scale))
    let count = 0
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const offset = (y * width + x) * 3
        if (pixels[offset] > 160 && pixels[offset + 1] < 140 && pixels[offset + 2] < 140) count += 1
      }
    }
    return count
  } finally {
    pixmap.destroy()
  }
}

function expectRect(actual: Rect, expected: Rect): void {
  for (let index = 0; index < 4; index += 1) expect(actual[index]).toBeCloseTo(expected[index], 2)
}

function makeFirstAnnotation(bytes = sampleBytes) {
  return applyAndSave(bytes, [{
    kind: 'createFreeText',
    pageIndex: 0,
    rect: firstRect,
    text: firstText,
    fontSize: 10.5,
    color: [1, 0, 0],
    font: 'BIZUDGothic',
  }])
}

function renderPage(document: PDFDocument, pageIndex: number): Uint8Array {
  const page = document.loadPage(pageIndex)
  const pixmap = page.toPixmap(mupdf.Matrix.scale(0.5, 0.5), mupdf.ColorSpace.DeviceRGB, false, true)
  try {
    return new Uint8Array(pixmap.getPixels())
  } finally {
    pixmap.destroy()
    page.destroy()
  }
}

describe('annotation integration', () => {
  it('日本語 FreeText をサブセットフォントと自前の外観で往復保存する', () => {
    const saved = makeFirstAnnotation()
    expect(saved.created).toHaveLength(1)
    const document = openPdf(saved.bytes)
    try {
      const [info] = listAnnotations(document, 0).filter((item) => item.objNum === saved.created[0])
      expect(info.contents).toBe(firstText)
      expectRect(info.rect, firstRect)
      expect(info.fontSize).toBeCloseTo(10.5, 2)
      expect(info.textColor).toEqual([1, 0, 0])
      expect(info.madeByKaru).toBe(true)

      const inspection = inspectFreeText(document, 0, saved.created[0])
      let originalAppearance: Uint8Array
      try {
        expect(inspection.baseFont).toMatch(/^[A-Z]{6}\+BIZUDGothic/)
        expect(inspection.embeddedFontBytes).toBeGreaterThan(0)
        expect(inspection.embeddedFontBytes).toBeLessThan(300 * 1024)
        expect(inspection.hasToUnicode).toBe(true)
        expect(inspection.hasAuthor).toBe(false)
        expect(inspection.hasRichContents).toBe(false)
        expect(inspection.bbox).toEqual([0, 0, 200, 42])
        expect(inspection.matrix).toEqual([1, 0, 0, 1, 0, 0])
        expect(annotationText(inspection.annotation).replace(/\s/g, ''))
          .toContain(firstText.replace(/\s/g, ''))
        expect(countRedPixels(inspection.page, firstRect)).toBeGreaterThan(100)
        originalAppearance = inspection.appearanceBytes
        console.info(`ANNOT_METRIC subset_font_bytes=${inspection.embeddedFontBytes}`)
      } finally {
        closeInspection(inspection)
      }

      const resaved = saveDocument(document, 'full')
      const reopened = openPdf(resaved.bytes)
      try {
        const afterSave = inspectFreeText(reopened, 0, saved.created[0])
        try {
          expect(afterSave.appearanceBytes).toEqual(originalAppearance!)
        } finally {
          closeInspection(afterSave)
        }
      } finally {
        reopened.destroy()
      }
    } finally {
      document.destroy()
    }
  })

  it('FreeText の本文と外観を更新して再保存する', () => {
    const first = makeFirstAnnotation()
    const updatedText = '書き換えました。\n二行目'
    const updated = applyAndSave(first.bytes, [{
      kind: 'updateFreeText',
      objNum: first.created[0],
      pageIndex: 0,
      rect: firstRect,
      text: updatedText,
      fontSize: 10.5,
      color: [1, 0, 0],
      font: 'BIZUDGothic',
    }], 'incremental')
    const document = openPdf(updated.bytes)
    try {
      const info = listAnnotations(document, 0).find((item) => item.objNum === first.created[0])
      expect(info?.contents).toBe(updatedText)
      const page = document.loadPage(0)
      const annotation = findAnnotation(page, first.created[0])
      try { expect(annotationText(annotation)).toContain('書き換えました。\n二行目') } finally {
        annotation.destroy()
        page.destroy()
      }
    } finally {
      document.destroy()
    }
  })

  it('既存の Helvetica FreeText を BIZ UDゴシックへ置き換える', () => {
    const initial = openPdf(sampleBytes)
    let existing: number
    try {
      existing = listAnnotations(initial, 0).find((item) => item.contents === 'Existing note')!.objNum
    } finally {
      initial.destroy()
    }
    const saved = applyAndSave(sampleBytes, [{
      kind: 'updateFreeText',
      objNum: existing,
      pageIndex: 0,
      rect: [72, 72, 272, 118],
      text: '既存の注釈を書き換えました',
      fontSize: 10.5,
      color: [1, 0, 0],
      font: 'BIZUDGothic',
    }])
    const document = openPdf(saved.bytes)
    try {
      const info = listAnnotations(document, 0).find((item) => item.objNum === existing)
      expect(info?.madeByKaru).toBe(true)
      const inspection = inspectFreeText(document, 0, existing)
      try {
        expect(inspection.baseFont).toContain('+BIZUDGothic')
        expect(annotationText(inspection.annotation)).toContain('既存の注釈を書き換えました')
      } finally {
        closeInspection(inspection)
      }
    } finally {
      document.destroy()
    }
  })

  it('回転済みページ座標の Rect 内に外観を描き、確認用 PDF を出力する', async () => {
    const first = makeFirstAnnotation()
    const rotated = applyAndSave(first.bytes, [{
      kind: 'createFreeText',
      pageIndex: 4,
      rect: rotatedRect,
      text: '回転ページの日本語',
      fontSize: 10.5,
      color: [1, 0, 0],
      font: 'BIZUDGothic',
    }])
    const document = openPdf(rotated.bytes)
    try {
      const info = listAnnotations(document, 4).find((item) => item.objNum === rotated.created[0])!
      expectRect(info.rect, rotatedRect)
      const inspection = inspectFreeText(document, 4, rotated.created[0])
      try {
        expect(inspection.page.getBounds()).toEqual([0, 0, 842, 595])
        expect(inspection.bbox).toEqual([100, 100, 145, 300])
        expect(annotationText(inspection.annotation)).toContain('回転ページの日本語')
        expect(countRedPixels(inspection.page, rotatedRect)).toBeGreaterThan(100)
      } finally {
        closeInspection(inspection)
      }
    } finally {
      document.destroy()
    }
    await fs.writeFile(resultPath, rotated.bytes)
  })

  it('Square を作成、移動、保存、削除できる', () => {
    const created = applyAndSave(sampleBytes, [{
      kind: 'createSquare', pageIndex: 0, rect: [300, 150, 400, 220], color: [1, 0, 0], borderWidth: 2,
    }])
    const movedRect: Rect = [320, 180, 440, 260]
    const moved = applyAndSave(created.bytes, [{
      kind: 'updateSquare', objNum: created.created[0], pageIndex: 0, rect: movedRect, color: [0, 0, 1], borderWidth: 3,
    }])
    const movedDocument = openPdf(moved.bytes)
    try {
      const square = listAnnotations(movedDocument, 0).find((item) => item.objNum === created.created[0])!
      expectRect(square.rect, movedRect)
      expect(square.strokeColor).toEqual([0, 0, 1])
      expect(square.borderWidth).toBeCloseTo(3)
    } finally {
      movedDocument.destroy()
    }

    const deleted = applyAndSave(moved.bytes, [{ kind: 'delete', objNum: created.created[0], pageIndex: 0 }])
    const deletedDocument = openPdf(deleted.bytes)
    try {
      expect(listAnnotations(deletedDocument, 0).some((item) => item.objNum === created.created[0])).toBe(false)
    } finally {
      deletedDocument.destroy()
    }
  })

  it('増分保存では元バイト列を先頭に残す', () => {
    const document = openPdf(sampleBytes)
    try {
      const applied = applyEdits(document, [{
        kind: 'createSquare', pageIndex: 1, rect: [72, 72, 180, 130], color: [1, 0, 0], borderWidth: 1,
      }], fontResource)
      expect(applied.errors).toEqual([])
      const saved = saveDocument(document, 'incremental')
      expect(saved.mode).toBe('incremental')
      expect(saved.bytes.subarray(0, sampleBytes.length)).toEqual(sampleBytes)
    } finally {
      document.destroy()
    }
  })

  it('実物資料で増分量と未編集ページの画素不変を確認する', async () => {
    let realBytes: Uint8Array
    try {
      realBytes = new Uint8Array(await fs.readFile(realPath))
    } catch {
      return
    }
    const beforeDocument = openPdf(realBytes)
    const untouchedPages = [1, 2, 3]
    let before: Uint8Array[]
    try {
      before = untouchedPages.map((pageIndex) => renderPage(beforeDocument, pageIndex))
    } finally {
      beforeDocument.destroy()
    }

    const saved = applyAndSave(realBytes, [0, 10, 20].map((pageIndex, index) => ({
      kind: 'createFreeText' as const,
      pageIndex,
      rect: [72, 72, 272, 115] as Rect,
      text: `実物資料の注釈 ${index + 1}`,
      fontSize: 10.5,
      color: [1, 0, 0] as [number, number, number],
      font: 'BIZUDGothic' as const,
    })), 'incremental')
    expect(saved.mode).toBe('incremental')
    const increase = saved.bytes.length - realBytes.length
    expect(increase).toBeLessThan(300 * 1024)
    const afterDocument = openPdf(saved.bytes)
    try {
      for (const [index, pageIndex] of untouchedPages.entries()) {
        expect(renderPage(afterDocument, pageIndex)).toEqual(before[index])
      }
    } finally {
      afterDocument.destroy()
    }
    console.info(`ANNOT_METRIC real_increment_bytes=${increase} real_save_ms=${saved.ms.toFixed(3)}`)
  }, 120_000)
})
