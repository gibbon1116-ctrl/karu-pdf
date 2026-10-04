import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf, { type PDFAnnotation, type PDFDocument, type PDFPage } from 'mupdf'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { applyEdits, listAnnotations, type AnnotationEdit, type Rect } from '../src/core/annotations'
import { createFontResource, type FontResource } from '../src/core/fontMetrics'

let font: FontResource

beforeAll(async () => {
  font = createFontResource(new Uint8Array(await fs.readFile(path.resolve('public/fonts/BIZUDGothic-Regular.ttf'))))
})

afterAll(() => { font.font.destroy() })

function makeDocument(pageCount = 1): PDFDocument {
  const doc = new mupdf.PDFDocument()
  for (let i = 0; i < pageCount; i++) {
    const ref = doc.addPage([0, 0, 600, 800], 0, {}, '')
    try { doc.insertPage(-1, ref) } finally { ref.destroy() }
  }
  return doc
}

function square(pageIndex: number, rect: Rect): Extract<AnnotationEdit, { kind: 'createSquare' }> {
  return { kind: 'createSquare', pageIndex, rect, color: [0, 0, 1], borderWidth: 1 }
}

function freeText(pageIndex: number, text: string): Extract<AnnotationEdit, { kind: 'createFreeText' }> {
  return { kind: 'createFreeText', pageIndex, rect: [30, 30, 150, 60], text, fontSize: 12, color: [0, 0, 0], font: 'BIZUDGothic' }
}

function withSavedDocument(doc: PDFDocument, inspect: (saved: PDFDocument) => void): void {
  const buffer = doc.saveToBuffer('compress')
  try {
    const saved = new mupdf.PDFDocument(buffer.asUint8Array())
    try { inspect(saved) } finally { saved.destroy() }
  } finally { buffer.destroy() }
}

function expectAppearance(doc: PDFDocument, objNum: number): void {
  const page = doc.loadPage(0)
  const annotations = page.getAnnotations()
  try {
    const annotation = annotations.find(item => {
      const object = item.getObject()
      try { return object.asIndirect() === objNum } finally { object.destroy() }
    })
    expect(annotation).toBeDefined()
    const object = annotation!.getObject()
    const appearance = object.get('AP', 'N')
    try {
      expect(appearance.isStream()).toBe(true)
      const stream = appearance.readStream()
      try { expect(stream.asString().length).toBeGreaterThan(0) } finally { stream.destroy() }
      const fonts = appearance.get('Resources', 'Font')
      try { expect(fonts.isNull()).toBe(false) } finally { fonts.destroy() }
    } finally { appearance.destroy(); object.destroy() }
  } finally {
    for (const annotation of annotations) annotation.destroy()
    page.destroy()
  }
}

describe('applyEdits のページ単位の注釈索引', () => {
  it('1ページの2,000件をすべて更新し、ページ読込と注釈列挙は各1回にする', () => {
    const doc = makeDocument()
    try {
      const initial = applyEdits(doc, Array.from({ length: 2000 }, (_, i) => {
        const x = (i % 50) * 10, y = Math.floor(i / 50) * 10
        return square(0, [x, y, x + 5, y + 5])
      }), {})
      expect(initial.errors).toEqual([])
      expect(initial.created).toHaveLength(2000)
      const edits: AnnotationEdit[] = initial.created.map((objNum, i) => {
        const x = (i % 50) * 10 + 2, y = Math.floor(i / 50) * 10 + 3
        return { ...square(0, [x, y, x + 5, y + 5]), kind: 'updateSquare', objNum }
      })
      const load = vi.spyOn(doc, 'loadPage')
      const enumerate = vi.spyOn(mupdf.PDFPage.prototype, 'getAnnotations')
      try {
        const result = applyEdits(doc, edits, {})
        expect(result.errors).toEqual([])
        expect(result.created).toEqual([])
        expect(load).toHaveBeenCalledTimes(1)
        expect(enumerate).toHaveBeenCalledTimes(1)
      } finally { enumerate.mockRestore(); load.mockRestore() }

      withSavedDocument(doc, saved => {
        const annotations = listAnnotations(saved, 0)
        expect(annotations).toHaveLength(2000)
        expect(annotations.map(item => item.objNum)).toEqual(initial.created)
        expect(annotations.map(item => item.rect)).toEqual(edits.map(edit => 'rect' in edit ? edit.rect : null))
      })
    } finally { doc.destroy() }
  // Squares still get their appearance from MuPDF's update(), whose cost grows with the
  // annotations on the page; 2,000 of them take about 24 s alone and more in a parallel run.
  }, 120_000)

  it('ページを交互に更新しても、索引をページごと・呼出しごとに1回作る', () => {
    const doc = makeDocument(2)
    try {
      const initial = applyEdits(doc, [square(0, [10, 10, 20, 20]), square(1, [30, 30, 40, 40])], {})
      expect(initial.errors).toEqual([])
      const edits: AnnotationEdit[] = [0, 1, 0, 1].map((pageIndex, i) => ({
        ...square(pageIndex, [50 + i, 60, 70 + i, 80]), kind: 'updateSquare', objNum: initial.created[pageIndex],
      }))
      const load = vi.spyOn(doc, 'loadPage')
      const enumerate = vi.spyOn(mupdf.PDFPage.prototype, 'getAnnotations')
      try {
        expect(applyEdits(doc, edits, {}).errors).toEqual([])
        expect(load.mock.calls.map(([pageIndex]) => pageIndex)).toEqual([0, 1])
        expect(enumerate).toHaveBeenCalledTimes(2)
        expect(applyEdits(doc, edits, {}).errors).toEqual([])
        expect(load.mock.calls.map(([pageIndex]) => pageIndex)).toEqual([0, 1, 0, 1])
        expect(enumerate).toHaveBeenCalledTimes(4)
      } finally { enumerate.mockRestore(); load.mockRestore() }
      withSavedDocument(doc, saved => {
        expect(listAnnotations(saved, 0)[0].rect).toEqual([52, 60, 72, 80])
        expect(listAnnotations(saved, 1)[0].rect).toEqual([53, 60, 73, 80])
      })
    } finally { doc.destroy() }
  })

  it('更新・削除・索引作成前後の新規作成を混ぜても、順序と外観を保存する', () => {
    const doc = makeDocument()
    try {
      const initial = applyEdits(doc, [freeText(0, '旧本文'), square(0, [10, 10, 20, 20])], { BIZUDGothic: font })
      expect(initial.errors).toEqual([])
      const result = applyEdits(doc, [
        square(0, [200, 200, 210, 210]),
        { ...freeText(0, '更新本文'), kind: 'updateFreeText', objNum: initial.created[0] },
        { kind: 'delete', pageIndex: 0, objNum: initial.created[1] },
        freeText(0, '新規本文'),
        square(0, [300, 300, 310, 310]),
        { ...freeText(0, '最終本文'), kind: 'updateFreeText', objNum: initial.created[0] },
      ], { BIZUDGothic: font })
      expect(result.errors).toEqual([])
      expect(result.created).toHaveLength(3)
      withSavedDocument(doc, saved => {
        const annotations = listAnnotations(saved, 0)
        expect(annotations.map(item => item.objNum)).toEqual([initial.created[0], ...result.created])
        expect(annotations.some(item => item.objNum === initial.created[1])).toBe(false)
        expect(annotations.map(item => item.type)).toEqual(['FreeText', 'Square', 'FreeText', 'Square'])
        expect(annotations[0].contents).toBe('最終本文')
        expect(annotations[2].contents).toBe('新規本文')
        expect(annotations[1].rect).toEqual([200, 200, 210, 210])
        expect(annotations[3].rect).toEqual([300, 300, 310, 310])
        expectAppearance(saved, initial.created[0])
        expectAppearance(saved, result.created[1])
      })
    } finally { doc.destroy() }
  })

  it('存在しない番号と削除済み番号のエラーを記録し、続く編集を反映する', () => {
    const doc = makeDocument()
    try {
      const initial = applyEdits(doc, [square(0, [10, 10, 20, 20]), square(0, [30, 30, 40, 40])], {})
      expect(initial.errors).toEqual([])
      const missing = 999999
      const result = applyEdits(doc, [
        { ...square(0, [50, 50, 60, 60]), kind: 'updateSquare', objNum: missing },
        { kind: 'delete', pageIndex: 0, objNum: initial.created[0] },
        { ...square(0, [50, 50, 60, 60]), kind: 'updateSquare', objNum: initial.created[0] },
        { kind: 'delete', pageIndex: 0, objNum: initial.created[0] },
        { ...square(0, [70, 70, 80, 80]), kind: 'updateSquare', objNum: initial.created[1] },
        square(0, [90, 90, 100, 100]),
      ], {})
      expect(result.errors).toEqual([
        { editIndex: 0, kind: 'updateSquare', pageIndex: 0, objNum: missing, message: `注釈オブジェクト ${missing} が見つかりません。` },
        { editIndex: 2, kind: 'updateSquare', pageIndex: 0, objNum: initial.created[0], message: `注釈オブジェクト ${initial.created[0]} が見つかりません。` },
        { editIndex: 3, kind: 'delete', pageIndex: 0, objNum: initial.created[0], message: `注釈オブジェクト ${initial.created[0]} が見つかりません。` },
      ])
      expect(result.created).toHaveLength(1)
      withSavedDocument(doc, saved => {
        expect(listAnnotations(saved, 0).map(item => [item.objNum, item.rect])).toEqual([
          [initial.created[1], [70, 70, 80, 80]], [result.created[0], [90, 90, 100, 100]],
        ])
      })
    } finally { doc.destroy() }
  })

  it('外観生成が失敗しても、共有参照を注釈→ページの順で各1回解放する', () => {
    const doc = makeDocument()
    try {
      const initial = applyEdits(doc, [freeText(0, '旧本文'), square(0, [10, 10, 20, 20])], { BIZUDGothic: font })
      expect(initial.errors).toEqual([])
      const loadPage = doc.loadPage.bind(doc)
      const pages: PDFPage[] = []
      const annotations: PDFAnnotation[] = []
      const createdAnnotations: PDFAnnotation[] = []
      const destroyed: (PDFPage | PDFAnnotation)[] = []
      let destroyedAtAppearanceFailure: (PDFPage | PDFAnnotation)[] = []
      function watchAnnotation(annotation: PDFAnnotation): void {
        const destroy = annotation.destroy.bind(annotation)
        vi.spyOn(annotation, 'destroy').mockImplementation(() => { destroyed.push(annotation); destroy() })
      }
      const load = vi.spyOn(doc, 'loadPage').mockImplementation(pageIndex => {
        const page = loadPage(pageIndex)
        pages.push(page)
        const getAnnotations = page.getAnnotations.bind(page)
        vi.spyOn(page, 'getAnnotations').mockImplementation(() => {
          const items = getAnnotations()
          annotations.push(...items)
          for (const annotation of items) watchAnnotation(annotation)
          return items
        })
        const createAnnotation = page.createAnnotation.bind(page)
        vi.spyOn(page, 'createAnnotation').mockImplementation(type => {
          const annotation = createAnnotation(type)
          createdAnnotations.push(annotation)
          watchAnnotation(annotation)
          return annotation
        })
        const destroy = page.destroy.bind(page)
        vi.spyOn(page, 'destroy').mockImplementation(() => { destroyed.push(page); destroy() })
        return page
      })
      // Fail after edit processing, inside installTemporaryAppearances.
      const subset = vi.spyOn(mupdf.PDFDocument.prototype, 'subsetFonts').mockImplementation(() => {
        destroyedAtAppearanceFailure = [...destroyed]
        throw new Error('外観試験の失敗')
      })
      try {
        const result = applyEdits(doc, [
          { ...freeText(0, '更新本文'), kind: 'updateFreeText', objNum: initial.created[0] },
          { ...freeText(0, '最終本文'), kind: 'updateFreeText', objNum: initial.created[0] },
          { kind: 'delete', pageIndex: 0, objNum: initial.created[1] },
          freeText(0, '新規本文'),
          square(0, [200, 200, 210, 210]),
        ], { BIZUDGothic: font })
        expect(result.errors.map(error => [error.editIndex, error.message])).toEqual([
          [0, '外観を作成できませんでした: 外観試験の失敗'],
          [1, '外観を作成できませんでした: 外観試験の失敗'],
          [3, '外観を作成できませんでした: 外観試験の失敗'],
        ])
        expect(pages).toHaveLength(1)
        expect(annotations).toHaveLength(2)
        expect(createdAnnotations).toHaveLength(2)
        expect(result.created).toHaveLength(2)
        expect(destroyedAtAppearanceFailure).toEqual([createdAnnotations[1]])
        expect(destroyed).toEqual([createdAnnotations[1], ...annotations, createdAnnotations[0], ...pages])
      } finally {
        subset.mockRestore()
        load.mockRestore()
        for (const annotation of [...annotations, ...createdAnnotations]) vi.mocked(annotation.destroy).mockRestore()
        for (const page of pages) {
          vi.mocked(page.getAnnotations).mockRestore()
          vi.mocked(page.createAnnotation).mockRestore()
          vi.mocked(page.destroy).mockRestore()
        }
      }
    } finally { doc.destroy() }
  })
})
