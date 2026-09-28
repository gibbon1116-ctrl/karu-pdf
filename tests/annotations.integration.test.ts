import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf, { type PDFAnnotation, type PDFDocument, type PDFObject, type PDFPage } from 'mupdf'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  applyEdits,
  listAnnotations,
  type AnnotationEdit,
  type Point,
  type Rect,
  type RGB,
} from '../src/core/annotations'
import { createFontResource, type FontResource, type FontResources } from '../src/core/fontMetrics'
import { saveDocument, type SaveMode } from '../src/core/save'
import { ensureSamplePdf } from './fixtures'

const realPath = path.resolve('test-data/real/公共建築工事標準仕様書_建築_R7.pdf')
const fontPath = path.resolve('public/fonts/BIZUDGothic-Regular.ttf')
const minchoFontPath = path.resolve('public/fonts/BIZUDMincho-Regular.ttf')
const resultPath = path.resolve('test-results/annot-roundtrip.pdf')
const calloutResultPath = path.resolve('test-results/callout-check.pdf')
const firstText = '日本語の書き込みテスト①（半角ABC 123）'
const firstRect: Rect = [72, 320, 272, 362]
const rotatedRect: Rect = [100, 100, 300, 145]

let fontResource: FontResource
let minchoFontResource: FontResource
let fontResources: FontResources
let sampleBytes: Uint8Array

beforeAll(async () => {
  sampleBytes = new Uint8Array(await fs.readFile(await ensureSamplePdf()))
  fontResource = createFontResource(new Uint8Array(await fs.readFile(fontPath)))
  minchoFontResource = createFontResource(
    new Uint8Array(await fs.readFile(minchoFontPath)),
    'BIZUDMincho',
  )
  fontResources = { BIZUDGothic: fontResource, BIZUDMincho: minchoFontResource }
  await fs.mkdir(path.dirname(resultPath), { recursive: true })
})

afterAll(() => {
  fontResource.font.destroy()
  minchoFontResource.font.destroy()
})

function openPdf(bytes: Uint8Array): PDFDocument {
  return new mupdf.PDFDocument(bytes)
}

function applyAndSave(bytes: Uint8Array, edits: AnnotationEdit[], mode: SaveMode = 'full') {
  const document = openPdf(bytes)
  try {
    const applied = applyEdits(document, edits, fontResources)
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

function arrayValue(object: PDFObject, ...keys: string[]): number[] {
  const value = object.get(...keys)
  try {
    return value.asJS() as number[]
  } finally {
    value.destroy()
  }
}

function numberValue(object: PDFObject, ...keys: string[]): number {
  const value = object.get(...keys)
  try { return value.asNumber() } finally { value.destroy() }
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

function expectPoint(actual: Point, expected: Point): void {
  expect(actual[0]).toBeCloseTo(expected[0], 2)
  expect(actual[1]).toBeCloseTo(expected[1], 2)
}

function expectColor(actual: RGB | null, expected: RGB): void {
  expect(actual).not.toBeNull()
  for (let index = 0; index < 3; index += 1) {
    expect(actual![index]).toBeCloseTo(expected[index], 2)
  }
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

  it('線・丸・蛍光ペン・手書き・旧白塗り・明朝を保存して属性を読み戻す', () => {
    const arrowLine: [Point, Point] = [[300, 340], [470, 380]]
    const highlightInk: Point[][] = [[[72, 450], [140, 455], [230, 450]]]
    const handwritingInk: Point[][] = [
      [[300, 500], [330, 480], [360, 510]],
      [[370, 480], [400, 510], [430, 485]],
    ]
    const saved = applyAndSave(sampleBytes, [
      {
        kind: 'createLine', pageIndex: 0, line: arrowLine,
        color: [1, 0, 0], borderWidth: 3,
        lineEnding: { start: 'None', end: 'OpenArrow' },
      },
      {
        kind: 'createCircle', pageIndex: 0, rect: [300, 400, 400, 465],
        color: [0, 0, 1], borderWidth: 2, interiorColor: null,
      },
      {
        kind: 'createInk', pageIndex: 0, inkList: highlightInk,
        color: [1, 1, 0], borderWidth: 12, opacity: 0.35,
      },
      {
        kind: 'createInk', pageIndex: 0, inkList: handwritingInk,
        color: [0, 0.7, 0], borderWidth: 1.5, opacity: 1,
      },
      {
        kind: 'createSquare', pageIndex: 0, rect: [300, 145, 450, 200],
        color: [], borderWidth: 0, interiorColor: [1, 1, 1],
      },
      {
        kind: 'createFreeText', pageIndex: 0, rect: [72, 560, 272, 605],
        text: '明朝体の日本語', fontSize: 12, color: [0.8, 0, 0.8], font: 'BIZUDMincho',
      },
    ])
    expect(saved.created).toHaveLength(6)

    const document = openPdf(saved.bytes)
    try {
      const infos = saved.created.map((objNum) => (
        listAnnotations(document, 0).find((info) => info.objNum === objNum)!
      ))
      const [line, circle, highlight, handwriting, whiteout, mincho] = infos

      for (const objNum of saved.created) {
        const page = document.loadPage(0)
        const annotation = findAnnotation(page, objNum)
        try {
          expect(annotation.getFlags() & 4).toBe(4)
        } finally {
          annotation.destroy()
          page.destroy()
        }
      }

      expect(line).toMatchObject({
        type: 'Line', kind: 'arrow', editable: true,
        strokeColor: [1, 0, 0], borderWidth: 3,
        lineEnding: { start: 'None', end: 'OpenArrow' },
      })
      expectPoint(line.line![0], arrowLine[0])
      expectPoint(line.line![1], arrowLine[1])

      expect(circle).toMatchObject({
        type: 'Circle', kind: 'circle', editable: true,
        strokeColor: [0, 0, 1], interiorColor: null, borderWidth: 2,
      })
      expectRect(circle.rect, [300, 400, 400, 465])

      expect(highlight).toMatchObject({
        type: 'Ink', kind: 'highlight', editable: true,
        strokeColor: [1, 1, 0], borderWidth: 12,
      })
      expect(highlight.opacity).toBeCloseTo(0.35, 2)
      expect(highlight.inkList).toEqual(highlightInk)

      expect(handwriting).toMatchObject({
        type: 'Ink', kind: 'ink', editable: true, borderWidth: 1.5,
      })
      expectColor(handwriting.strokeColor, [0, 0.7, 0])
      expect(handwriting.opacity).toBeCloseTo(1, 2)
      expect(handwriting.inkList).toEqual(handwritingInk)

      expect(whiteout).toMatchObject({
        type: 'Square', kind: 'square', editable: true,
        strokeColor: null, interiorColor: [1, 1, 1], borderWidth: 0,
      })

      expect(mincho).toMatchObject({
        type: 'FreeText', kind: 'freetext', editable: true,
        fontName: 'BIZUDMincho', madeByKaru: true,
      })
      const inspection = inspectFreeText(document, 0, saved.created[5])
      try {
        expect(inspection.baseFont).toMatch(/^[A-Z]{6}\+BIZUDMincho/)
        expect(inspection.embeddedFontBytes).toBeGreaterThan(0)
        expect(inspection.embeddedFontBytes).toBeLessThan(300 * 1024)
        expect(inspection.hasToUnicode).toBe(true)
        expect(annotationText(inspection.annotation)).toContain('明朝体の日本語')
        console.info(`ANNOT_METRIC mincho_subset_font_bytes=${inspection.embeddedFontBytes}`)
      } finally {
        closeInspection(inspection)
      }
    } finally {
      document.destroy()
    }
  })

  it('塗りつぶし、文字の背景と枠、吹き出しを往復保存する', async () => {
    const textRect: Rect = [72, 390, 260, 435]
    const calloutRect: Rect = [300, 430, 460, 480]
    const calloutPoint: Point = [250, 360]
    const saved = applyAndSave(sampleBytes, [
      {
        kind: 'createSquare', pageIndex: 0, rect: [72, 300, 190, 360],
        color: [], borderWidth: 2, interiorColor: [0, 0.25, 1], opacity: 0.5,
      },
      {
        kind: 'createCircle', pageIndex: 0, rect: [210, 300, 290, 370],
        color: [], borderWidth: 2, interiorColor: [1, 0.9, 0], opacity: 0.5,
      },
      {
        kind: 'createFreeText', pageIndex: 0, rect: textRect,
        text: '背景と枠つきの文字', fontSize: 10.5, color: [1, 0, 0], font: 'BIZUDGothic',
        backgroundColor: [1, 0.9, 0], borderColor: [0, 0, 0], borderWidth: 1.5,
      },
      {
        kind: 'createCallout', pageIndex: 0, rect: calloutRect, point: calloutPoint,
        text: '吹き出しの本文', fontSize: 10.5, color: [1, 0, 0], font: 'BIZUDGothic',
        backgroundColor: [1, 1, 1], borderColor: [1, 0, 0], borderWidth: 1,
      },
    ])
    expect(saved.created).toHaveLength(4)
    const document = openPdf(saved.bytes)
    try {
      const infos = saved.created.map((objNum) => listAnnotations(document, 0).find((item) => item.objNum === objNum)!)
      expect(infos[0]).toMatchObject({ kind: 'square', strokeColor: null, interiorColor: [0, 0.25, 1], borderWidth: 0 })
      expect(infos[0].opacity).toBeCloseTo(0.5, 2)
      expect(infos[1]).toMatchObject({ kind: 'circle', strokeColor: null, borderWidth: 0 })
      expectColor(infos[1].interiorColor, [1, 0.9, 0])
      expect(infos[1].opacity).toBeCloseTo(0.5, 2)

      const shapePage = document.loadPage(0)
      try {
        for (const objNum of saved.created.slice(0, 2)) {
          const shape = findAnnotation(shapePage, objNum)
          const shapeObject = shape.getObject()
          const resolvedShape = shapeObject.resolve()
          try {
            expect(arrayValue(resolvedShape, 'IC')).toHaveLength(3)
            expect(arrayValue(resolvedShape, 'C')).toEqual([])
            expect(numberValue(resolvedShape, 'CA')).toBeCloseTo(0.5, 2)
            expect(numberValue(resolvedShape, 'BS', 'W')).toBe(0)
          } finally {
            resolvedShape.destroy()
            shapeObject.destroy()
            shape.destroy()
          }
        }
      } finally {
        shapePage.destroy()
      }
      expect(infos[2]).toMatchObject({
        kind: 'freetext', contents: '背景と枠つきの文字',
        strokeColor: [0, 0, 0], borderWidth: 1.5,
      })
      expectColor(infos[2].interiorColor, [1, 0.9, 0])
      expectRect(infos[2].rect, textRect)
      expect(infos[3]).toMatchObject({
        kind: 'callout', contents: '吹き出しの本文',
        interiorColor: [1, 1, 1], strokeColor: [1, 0, 0], borderWidth: 1,
      })
      expectRect(infos[3].rect, calloutRect)
      expectPoint(infos[3].calloutPoint!, calloutPoint)
      expectPoint(infos[3].calloutLine![1], [300, 455])

      for (const index of [2, 3]) {
        const inspection = inspectFreeText(document, 0, saved.created[index])
        try {
          expect(inspection.baseFont).toMatch(/^[A-Z]{6}\+BIZUDGothic/)
          expect(inspection.embeddedFontBytes).toBeGreaterThan(0)
          expect(inspection.embeddedFontBytes).toBeLessThan(300 * 1024)
          expect(inspection.hasToUnicode).toBe(true)
        } finally {
          closeInspection(inspection)
        }
      }

      const page = document.loadPage(0)
      const callout = findAnnotation(page, saved.created[3])
      const object = callout.getObject()
      const resolved = object.resolve()
      try {
        expect(callout.getIntent()).toBe('FreeTextCallout')
        expect(callout.getCalloutStyle()).toBe('OpenArrow')
        expect(arrayValue(resolved, 'IC')).toEqual([1, 1, 1])
        expect(arrayValue(resolved, 'C')).toEqual([1, 0, 0])
        expect(arrayValue(resolved, 'RD').some((value) => value > 0)).toBe(true)
        expect(arrayValue(resolved, 'Rect')).toHaveLength(4)
        expect(arrayValue(resolved, 'KaruStyle', 'Fill')).toEqual([1, 1, 1])
        expect(arrayValue(resolved, 'KaruStyle', 'Border')).toEqual([1, 0, 0])
        expect(numberValue(resolved, 'KaruStyle', 'BorderWidth')).toBe(1)
      } finally {
        resolved.destroy()
        object.destroy()
        callout.destroy()
        page.destroy()
      }
    } finally {
      document.destroy()
    }
    await fs.writeFile(calloutResultPath, saved.bytes)
  })

  it('他ソフト由来相当の Line・Circle・Ink を editable として更新できる', () => {
    const source = openPdf(sampleBytes)
    const page = source.loadPage(1)
    const objectNumbers: number[] = []
    try {
      const line = page.createAnnotation('Line')
      const circle = page.createAnnotation('Circle')
      const ink = page.createAnnotation('Ink')
      try {
        line.setLine([72, 100], [220, 130])
        line.setColor([0, 0, 0])
        line.setBorderWidth(1)
        line.setLineEndingStyles('None', 'None')
        line.update()
        circle.setRect([72, 180, 180, 250])
        circle.setColor([0, 0, 0])
        circle.setBorderWidth(1)
        circle.setInteriorColor([])
        circle.update()
        ink.setInkList([[[72, 300], [130, 320], [200, 300]]])
        ink.setColor([0, 0, 0])
        ink.setBorderWidth(1)
        ink.setOpacity(1)
        ink.update()
        for (const annotation of [line, circle, ink]) {
          const object = annotation.getObject()
          try { objectNumbers.push(object.asIndirect()) } finally { object.destroy() }
        }
      } finally {
        ink.destroy()
        circle.destroy()
        line.destroy()
      }
      const foreignBytes = saveDocument(source, 'full').bytes
      const listed = listAnnotations(source, 1).filter((info) => objectNumbers.includes(info.objNum))
      expect(listed).toHaveLength(3)
      expect(listed.every((info) => info.editable)).toBe(true)

      const updated = applyAndSave(foreignBytes, [
        {
          kind: 'updateLine', objNum: objectNumbers[0], pageIndex: 1,
          line: [[90, 110], [250, 160]], color: [1, 0, 0], borderWidth: 2,
          lineEnding: { start: 'None', end: 'OpenArrow' },
        },
        {
          kind: 'updateCircle', objNum: objectNumbers[1], pageIndex: 1,
          rect: [90, 190, 220, 270], color: [0, 0, 1], borderWidth: 3,
          interiorColor: null,
        },
        {
          kind: 'updateInk', objNum: objectNumbers[2], pageIndex: 1,
          inkList: [[[90, 310], [160, 340], [240, 315]]],
          color: [0, 0.7, 0], borderWidth: 2, opacity: 0.5,
        },
      ])
      const reopened = openPdf(updated.bytes)
      try {
        const infos = listAnnotations(reopened, 1)
        const lineInfo = infos.find((info) => info.objNum === objectNumbers[0])!
        const circleInfo = infos.find((info) => info.objNum === objectNumbers[1])!
        const inkInfo = infos.find((info) => info.objNum === objectNumbers[2])!
        expect(lineInfo.kind).toBe('arrow')
        expectPoint(lineInfo.line![0], [90, 110])
        expectPoint(lineInfo.line![1], [250, 160])
        expectRect(circleInfo.rect, [90, 190, 220, 270])
        expect(circleInfo.borderWidth).toBeCloseTo(3, 2)
        expect(inkInfo.kind).toBe('highlight')
        expect(inkInfo.opacity).toBeCloseTo(0.5, 2)
        expect(inkInfo.inkList).toEqual([[[90, 310], [160, 340], [240, 315]]])
      } finally {
        reopened.destroy()
      }
    } finally {
      page.destroy()
      source.destroy()
    }
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
      }], fontResources)
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
