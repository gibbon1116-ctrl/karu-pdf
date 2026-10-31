import fs from 'node:fs/promises'
import path from 'node:path'
import mupdf, { type PDFDocument } from 'mupdf'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DocumentSession } from '../src/app/documentModel'
import { applyEdits, type AnnotationEdit } from '../src/core/annotations'
import { createFontResource, type FontResources } from '../src/core/fontMetrics'
import { prepareDocumentOutput } from '../src/core/output'
import { saveDocument } from '../src/core/save'

let fonts: FontResources

beforeAll(async () => {
  fonts = {
    BIZUDGothic: createFontResource(new Uint8Array(await fs.readFile(path.resolve('public/fonts/BIZUDGothic-Regular.ttf')))),
  }
})

afterAll(() => {
  fonts.BIZUDGothic?.font.destroy()
})

function makeDocument(): PDFDocument {
  const document = new mupdf.PDFDocument()
  const page = document.addPage(
    [0, 0, 300, 400],
    0,
    { Font: { F1: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' } } },
    'BT /F1 18 Tf 40 350 Td (Original page) Tj ET',
  )
  try { document.insertPage(-1, page) } finally { page.destroy() }
  return document
}

function saveBytes(document: PDFDocument): Uint8Array {
  return saveDocument(document, 'full').bytes
}

function addTextWidget(document: PDFDocument): void {
  const page = document.loadPage(0)
  try {
    const widget = page.createAnnotation('Widget')
    try {
      widget.setRect([20, 20, 120, 45])
      const object = widget.getObject()
      const fieldType = document.newName('Tx')
      const fieldName = document.newString('kept-field')
      const fieldValue = document.newString('kept-value')
      try {
        object.put('FT', fieldType)
        object.put('T', fieldName)
        object.put('V', fieldValue)
        const root = document.getTrailer().get('Root')
        const formDictionary = document.newDictionary()
        const form = document.addObject(formDictionary)
        const fields = document.newArray()
        try {
          fields.push(object)
          form.put('Fields', fields)
          root.put('AcroForm', form)
        } finally {
          fields.destroy()
          form.destroy()
          formDictionary.destroy()
          root.destroy()
        }
      } finally {
        fieldValue.destroy()
        fieldName.destroy()
        fieldType.destroy()
        object.destroy()
      }
      widget.update()
    } finally { widget.destroy() }
  } finally { page.destroy() }
}

const textEdit: AnnotationEdit = {
  kind: 'createFreeText',
  pageIndex: 0,
  rect: [40, 80, 240, 125],
  text: '確定保存テスト',
  fontSize: 14,
  color: [1, 0, 0],
  font: 'BIZUDGothic',
}

describe('保存と仕上げ', () => {
  it('確定版は注釈をページへ焼き付け、Widgetと元文書を変えない', () => {
    const original = makeDocument()
    addTextWidget(original)
    const originalBytes = saveBytes(original)
    original.destroy()

    const finalized = prepareDocumentOutput(originalBytes, [textEdit], fonts, true)
    expect(finalized.applied.errors).toEqual([])

    const output = new mupdf.PDFDocument(finalized.bytes)
    try {
      const page = output.loadPage(0)
      try {
        const annotations = page.getAnnotations()
        try { expect(annotations).toHaveLength(0) } finally { annotations.forEach((item) => item.destroy()) }
        const widgets = page.getWidgets()
        try { expect(widgets).toHaveLength(1) } finally { widgets.forEach((item) => item.destroy()) }
        const structured = page.toStructuredText('preserve-spans')
        try { expect(structured.asText()).toContain('確定保存テスト') } finally { structured.destroy() }
      } finally { page.destroy() }
    } finally { output.destroy() }

    const unchanged = new mupdf.PDFDocument(originalBytes)
    try {
      const page = unchanged.loadPage(0)
      try {
        const annotations = page.getAnnotations()
        try { expect(annotations).toHaveLength(0) } finally { annotations.forEach((item) => item.destroy()) }
        const structured = page.toStructuredText('preserve-spans')
        try { expect(structured.asText()).not.toContain('確定保存テスト') } finally { structured.destroy() }
      } finally { page.destroy() }
    } finally { unchanged.destroy() }
  })

  it('印刷用PDFは編集可能な注釈と印刷フラグを持ち、元文書を変えない', () => {
    const original = makeDocument()
    const originalBytes = saveBytes(original)
    original.destroy()
    const printable = prepareDocumentOutput(originalBytes, [textEdit], fonts, false)
    const output = new mupdf.PDFDocument(printable.bytes)
    try {
      const page = output.loadPage(0)
      try {
        const annotations = page.getAnnotations()
        try {
          expect(annotations).toHaveLength(1)
          expect(annotations[0].getType()).toBe('FreeText')
          expect(annotations[0].getFlags() & 4).toBe(4)
        } finally { annotations.forEach((item) => item.destroy()) }
      } finally { page.destroy() }
    } finally { output.destroy() }
  })

  it('10回保存後の大きさを1回保存の1.5倍以内に抑える', () => {
    const source = makeDocument()
    const sourceBytes = saveBytes(source)
    source.destroy()

    const run = (count: number): Uint8Array => {
      let document = new mupdf.PDFDocument(sourceBytes)
      const budget = new DocumentSession({
        docId: `save-${count}`,
        name: 'size.pdf',
        byteLength: sourceBytes.byteLength,
        handle: null,
        pageSizes: [{ width: 300, height: 400 }],
      })
      let objectNumber: number | null = null
      let latest = sourceBytes
      try {
        for (let index = 0; index < count; index += 1) {
          const edit: AnnotationEdit = objectNumber === null ? textEdit : {
            ...textEdit,
            kind: 'updateFreeText',
            objNum: objectNumber,
          }
          const applied = applyEdits(document, [edit], fonts)
          expect(applied.errors).toEqual([])
          objectNumber ??= applied.created[0]
          const saved = saveDocument(document, budget.nextSaveMode())
          latest = saved.bytes
          budget.recordSave(saved.mode, latest.byteLength)
          if (saved.mode === 'full') {
            document.destroy()
            document = new mupdf.PDFDocument(latest)
          }
        }
        return latest
      } finally {
        document.destroy()
      }
    }

    const once = run(1)
    const tenTimes = run(10)
    expect(tenTimes.byteLength).toBeLessThanOrEqual(once.byteLength * 1.5)
  })
})
