import mupdf, {
  type PDFAnnotation,
  type PDFAnnotationType,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from 'mupdf'
import { createDefaultAppearance, parseDefaultAppearance } from './defaultAppearance'
import { encodeCharacter, replaceMissingCharacters, type FontResource } from './fontMetrics'
import { layoutText } from './textLayout'

export type Rect = [number, number, number, number]
export type RGB = [number, number, number]

export interface AnnotationInfo {
  objNum: number
  pageIndex: number
  type: string
  editable: boolean
  rect: Rect
  contents: string
  fontSize: number | null
  textColor: RGB | null
  strokeColor: RGB | null
  borderWidth: number | null
  madeByKaru: boolean
}

export type AnnotationEdit =
  | { kind: 'createFreeText'; pageIndex: number; rect: Rect; text: string; fontSize: number; color: RGB; font: 'BIZUDGothic' }
  | { kind: 'updateFreeText'; objNum: number; pageIndex: number; rect: Rect; text: string; fontSize: number; color: RGB; font: 'BIZUDGothic' }
  | { kind: 'createSquare'; pageIndex: number; rect: Rect; color: RGB; borderWidth: number }
  | { kind: 'updateSquare'; objNum: number; pageIndex: number; rect: Rect; color: RGB; borderWidth: number }
  | { kind: 'delete'; objNum: number; pageIndex: number }

export interface ApplyError {
  editIndex: number
  kind: AnnotationEdit['kind']
  pageIndex: number
  objNum?: number
  message: string
}

export interface ApplyResult {
  created: number[]
  replacedCharacters: number
  errors: ApplyError[]
}

interface AppearanceTask {
  editIndex: number
  page: PDFPage
  annotation: PDFAnnotation
  width: number
  height: number
  text: string
  fontSize: number
  color: RGB
  temporaryPageIndex?: number
}

function objectNumber(annotation: PDFAnnotation): number {
  const object = annotation.getObject()
  try {
    return object.asIndirect()
  } finally {
    object.destroy()
  }
}

function readString(object: PDFObject, key: string): string | null {
  const value = object.get(key)
  try {
    return value.isString() ? value.asString() : null
  } finally {
    value.destroy()
  }
}

function asRGB(color: number[]): RGB | null {
  if (color.length === 1) return [color[0], color[0], color[0]]
  if (color.length === 3) return [color[0], color[1], color[2]]
  if (color.length === 4) {
    const [cyan, magenta, yellow, black] = color
    return [
      1 - Math.min(1, cyan + black),
      1 - Math.min(1, magenta + black),
      1 - Math.min(1, yellow + black),
    ]
  }
  return null
}

export function listAnnotations(doc: PDFDocument, pageIndex: number): AnnotationInfo[] {
  const page = doc.loadPage(pageIndex)
  try {
    return page.getAnnotations().map((annotation) => {
      try {
        const type = annotation.getType()
        const object = annotation.getObject()
        try {
          const da = readString(object, 'DA')
          const parsed = da === null
            ? { fontName: null, fontSize: null, color: null }
            : parseDefaultAppearance(da)
          return {
            objNum: object.asIndirect(),
            pageIndex,
            type,
            editable: type === 'FreeText' || type === 'Square',
            // 型定義上は全注釈に getRect() があるが、MuPDF 1.28.1 は
            // Highlight など /Rect を直接扱わない種類では例外にする。
            rect: [...(annotation.hasRect() ? annotation.getRect() : annotation.getBounds())] as Rect,
            contents: type === 'FreeText' ? annotation.getContents() : '',
            fontSize: type === 'FreeText' ? parsed.fontSize : null,
            textColor: type === 'FreeText' ? parsed.color : null,
            strokeColor: type === 'Square' ? asRGB(annotation.getColor()) : null,
            borderWidth: type === 'Square' ? annotation.getBorderWidth() : null,
            madeByKaru: type === 'FreeText'
              && (parsed.fontName === 'BIZUDGothic' || parsed.fontName === 'BIZUDMincho'),
          }
        } finally {
          object.destroy()
        }
      } finally {
        annotation.destroy()
      }
    })
  } finally {
    page.destroy()
  }
}

function findAnnotation(page: PDFPage, wantedObjectNumber: number): PDFAnnotation | null {
  let found: PDFAnnotation | null = null
  for (const annotation of page.getAnnotations()) {
    if (found === null && objectNumber(annotation) === wantedObjectNumber) found = annotation
    else annotation.destroy()
  }
  return found
}

function setPdfString(doc: PDFDocument, object: PDFObject, key: string, value: string): void {
  const string = doc.newString(value)
  try {
    object.put(key, string)
  } finally {
    string.destroy()
  }
}

function setPdfNumber(doc: PDFDocument, object: PDFObject, key: string, value: number): void {
  const number = Number.isInteger(value) ? doc.newInteger(value) : doc.newReal(value)
  try {
    object.put(key, number)
  } finally {
    number.destroy()
  }
}

let annotationNameSequence = 0

function newAnnotationName(): string {
  annotationNameSequence += 1
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return `karu-${Date.now().toString(36)}-${annotationNameSequence.toString(36)}-${random}`
}

function configureFreeText(
  doc: PDFDocument,
  annotation: PDFAnnotation,
  rect: Rect,
  text: string,
  fontSize: number,
  color: RGB,
  isNew: boolean,
): void {
  annotation.setRect(rect)
  annotation.setContents(text)
  const object = annotation.getObject()
  try {
    setPdfString(doc, object, 'DA', createDefaultAppearance('BIZUDGothic', fontSize, color))
    const borderStyle = doc.newDictionary()
    try {
      setPdfNumber(doc, borderStyle, 'W', 0)
      object.put('BS', borderStyle)
    } finally {
      borderStyle.destroy()
    }
    setPdfNumber(doc, object, 'F', 4)
    if (isNew) setPdfString(doc, object, 'NM', newAnnotationName())
    object.delete('T')
    object.delete('RC')
  } finally {
    object.destroy()
  }
  annotation.setModificationDate(new Date())
  annotation.update()
  // update() の後に触ると外観の再生成対象になる属性は変更しない。
  // /T と /RC は MuPDF が補う場合にも残さない。
  const updatedObject = annotation.getObject()
  try {
    updatedObject.delete('T')
    updatedObject.delete('RC')
  } finally {
    updatedObject.destroy()
  }
}

function configureSquare(
  annotation: PDFAnnotation,
  rect: Rect,
  color: RGB,
  borderWidth: number,
): void {
  annotation.setRect(rect)
  annotation.setColor(color)
  annotation.setBorderWidth(borderWidth)
  annotation.setInteriorColor([])
  annotation.update()
}

function addTemporaryPage(doc: PDFDocument, width: number, height: number): number {
  const pageObject = doc.addPage([0, 0, width, height], 0, {}, '')
  try {
    const index = doc.countPages()
    doc.insertPage(-1, pageObject)
    return index
  } finally {
    pageObject.destroy()
  }
}

function referenceAppearanceFromPage(doc: PDFDocument, page: PDFPage, annotation: PDFAnnotation): void {
  const annotationObject = annotation.getObject()
  const appearance = annotationObject.get('AP', 'N')
  const pageObject = page.getObject()
  const resources = doc.newDictionary()
  const xobjects = doc.newDictionary()
  let contents: PDFObject | undefined
  try {
    xobjects.put('Fm0', appearance)
    resources.put('XObject', xobjects)
    pageObject.put('Resources', resources)
    contents = doc.addStream('q /Fm0 Do Q', {})
    pageObject.put('Contents', contents)
  } finally {
    contents?.destroy()
    xobjects.destroy()
    resources.destroy()
    pageObject.destroy()
    appearance.destroy()
    annotationObject.destroy()
  }
}

function makeTemporaryAppearance(
  temporaryDocument: PDFDocument,
  task: AppearanceTask,
  fontResource: FontResource,
): void {
  const pageIndex = addTemporaryPage(temporaryDocument, task.width, task.height)
  task.temporaryPageIndex = pageIndex
  const page = temporaryDocument.loadPage(pageIndex)
  const annotation = page.createAnnotation('FreeText')
  const displayList = new mupdf.DisplayList([0, 0, task.width, task.height])
  const device = new mupdf.DisplayListDevice(displayList)
  const text = new mupdf.Text()
  try {
    configureFreeText(
      temporaryDocument,
      annotation,
      [0, 0, task.width, task.height],
      task.text,
      task.fontSize,
      task.color,
      true,
    )
    const layout = layoutText({
      text: task.text,
      fontSize: task.fontSize,
      boxWidth: task.width,
      ascent: fontResource.ascent,
      advance: (character) => encodeCharacter(fontResource.font, character).advance,
    })

    for (const line of layout.lines) {
      let x = line.x
      for (const character of [...line.text]) {
        const encoded = encodeCharacter(fontResource.font, character)
        // MuPDF のページ座標は y 下向きだが、グリフ座標は y 上向き。
        // d=-fontSize として反転すると、baseline-ascent が箱の上側になる。
        text.showGlyph(
          fontResource.font,
          [task.fontSize, 0, 0, -task.fontSize, x, line.baseline],
          encoded.glyph,
          encoded.unicode,
        )
        x += encoded.advance * task.fontSize
      }
    }
    device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, task.color, 1)
    device.close()
    annotation.setAppearanceFromDisplayList(null, null, mupdf.Matrix.identity, displayList)
    referenceAppearanceFromPage(temporaryDocument, page, annotation)
  } finally {
    text.destroy()
    device.destroy()
    displayList.destroy()
    annotation.destroy()
    page.destroy()
  }
}

function orientAppearanceForAnnotation(
  doc: PDFDocument,
  annotationObject: PDFObject,
  appearance: PDFObject,
): void {
  const rotateObject = annotationObject.get('Rotate')
  let rotation = 0
  try {
    if (rotateObject.isNumber()) rotation = ((rotateObject.asNumber() % 360) + 360) % 360
  } finally {
    rotateObject.destroy()
  }
  if (rotation === 0) return

  const rectObject = annotationObject.get('Rect')
  try {
    const [x0, y0, x1, y1] = rectObject.asJS() as Rect
    let transform: [number, number, number, number, number, number]
    if (rotation === 90) transform = [0, 1, -1, 0, x1, y0]
    else if (rotation === 180) transform = [-1, 0, 0, -1, x1, y1]
    else if (rotation === 270) transform = [0, -1, 1, 0, x0, y1]
    else throw new Error(`FreeText の回転角 ${rotation} 度には対応していません。`)

    const stream = appearance.readStream()
    try {
      appearance.writeStream(`q\n${transform.join(' ')} cm\n${stream.asString()}\nQ\n`)
    } finally {
      stream.destroy()
    }

    const bbox = doc.newArray()
    try {
      for (const value of [x0, y0, x1, y1]) bbox.push(value)
      appearance.put('BBox', bbox)
    } finally {
      bbox.destroy()
    }
  } finally {
    rectObject.destroy()
  }
}

function installTemporaryAppearances(
  doc: PDFDocument,
  tasks: AppearanceTask[],
  fontResource: FontResource,
): void {
  if (tasks.length === 0) return
  const temporaryDocument = new mupdf.PDFDocument()
  let graftMap: ReturnType<PDFDocument['newGraftMap']> | undefined
  try {
    for (const task of tasks) makeTemporaryAppearance(temporaryDocument, task, fontResource)
    // 元文書には subsetFonts() を呼ばない。一時文書のページ内容が参照する
    // 外観だけをサブセット化してから、外観オブジェクトを移す。
    temporaryDocument.subsetFonts()
    graftMap = doc.newGraftMap()
    for (const task of tasks) {
      const temporaryPage = temporaryDocument.loadPage(task.temporaryPageIndex!)
      const temporaryAnnotation = temporaryPage.getAnnotations()[0]
      const sourceObject = temporaryAnnotation.getObject()
      const sourceAppearance = sourceObject.get('AP', 'N')
      let graftedAppearance: PDFObject | undefined
      try {
        graftedAppearance = graftMap.graftObject(sourceAppearance)
        const targetObject = task.annotation.getObject()
        const appearanceDictionary = doc.newDictionary()
        try {
          // MuPDF は回転ページの FreeText に /Rotate と、回転前座標の
          // /Rect を設定する。標準 AP と同じ絶対 BBox と行列に直す。
          orientAppearanceForAnnotation(doc, targetObject, graftedAppearance)
          appearanceDictionary.put('N', graftedAppearance)
          targetObject.put('AP', appearanceDictionary)
        } finally {
          appearanceDictionary.destroy()
          targetObject.destroy()
        }
      } finally {
        graftedAppearance?.destroy()
        sourceAppearance.destroy()
        sourceObject.destroy()
        temporaryAnnotation.destroy()
        temporaryPage.destroy()
      }
    }
  } finally {
    graftMap?.destroy()
    temporaryDocument.destroy()
  }
}

function editObjectNumber(edit: AnnotationEdit): number | undefined {
  return 'objNum' in edit ? edit.objNum : undefined
}

export function applyEdits(
  doc: PDFDocument,
  edits: readonly AnnotationEdit[],
  fontResource: FontResource,
): ApplyResult {
  const result: ApplyResult = { created: [], replacedCharacters: 0, errors: [] }
  const appearances: AppearanceTask[] = []

  for (const [editIndex, edit] of edits.entries()) {
    let page: PDFPage | undefined
    let annotation: PDFAnnotation | null = null
    let keepForAppearance = false
    try {
      page = doc.loadPage(edit.pageIndex)
      if (edit.kind === 'delete') {
        annotation = findAnnotation(page, edit.objNum)
        if (!annotation) throw new Error(`注釈オブジェクト ${edit.objNum} が見つかりません。`)
        page.deleteAnnotation(annotation)
        continue
      }

      if (edit.kind === 'createSquare' || edit.kind === 'updateSquare') {
        const isNew = edit.kind === 'createSquare'
        annotation = isNew
          ? page.createAnnotation('Square')
          : findAnnotation(page, 'objNum' in edit ? edit.objNum : -1)
        if (!annotation) throw new Error(`注釈オブジェクト ${editObjectNumber(edit)} が見つかりません。`)
        if (!isNew && annotation.getType() !== 'Square') throw new Error('更新対象は Square ではありません。')
        configureSquare(annotation, edit.rect, edit.color, edit.borderWidth)
        if (isNew) result.created.push(objectNumber(annotation))
        continue
      }

      const isNew = edit.kind === 'createFreeText'
      annotation = isNew
        ? page.createAnnotation('FreeText')
        : findAnnotation(page, 'objNum' in edit ? edit.objNum : -1)
      if (!annotation) throw new Error(`注釈オブジェクト ${editObjectNumber(edit)} が見つかりません。`)
      if (!isNew && annotation.getType() !== 'FreeText') throw new Error('更新対象は FreeText ではありません。')
      const width = edit.rect[2] - edit.rect[0]
      const height = edit.rect[3] - edit.rect[1]
      if (width <= 0 || height <= 0) throw new Error('FreeText の Rect は正の幅と高さが必要です。')
      const replaced = replaceMissingCharacters(fontResource.font, edit.text)
      result.replacedCharacters += replaced.replacedCharacters
      configureFreeText(doc, annotation, edit.rect, replaced.text, edit.fontSize, edit.color, isNew)
      if (isNew) result.created.push(objectNumber(annotation))
      appearances.push({
        editIndex,
        page,
        annotation,
        width,
        height,
        text: replaced.text,
        fontSize: edit.fontSize,
        color: edit.color,
      })
      keepForAppearance = true
    } catch (error) {
      result.errors.push({
        editIndex,
        kind: edit.kind,
        pageIndex: edit.pageIndex,
        objNum: editObjectNumber(edit),
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (!keepForAppearance) {
        annotation?.destroy()
        page?.destroy()
      }
    }
  }

  try {
    installTemporaryAppearances(doc, appearances, fontResource)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    for (const task of appearances) {
      result.errors.push({
        editIndex: task.editIndex,
        kind: edits[task.editIndex].kind,
        pageIndex: edits[task.editIndex].pageIndex,
        objNum: editObjectNumber(edits[task.editIndex]),
        message: `外観を作成できませんでした: ${message}`,
      })
    }
  } finally {
    for (const task of appearances) {
      task.annotation.destroy()
      task.page.destroy()
    }
  }

  return result
}
