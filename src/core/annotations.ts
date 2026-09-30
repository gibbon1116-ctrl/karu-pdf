import mupdf, {
  type PDFAnnotation,
  type PDFAnnotationLineEndingStyle,
  type PDFAnnotationType,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
  type Path,
  type DisplayListDevice,
  type Point as MuPdfPoint,
} from 'mupdf'
import { createDefaultAppearance, parseDefaultAppearance } from './defaultAppearance'
import {
  encodeCharacter,
  replaceMissingCharacters,
  type FontName,
  type FontResource,
  type FontResources,
} from './fontMetrics'
import { layoutText } from './textLayout'

export type Rect = [number, number, number, number]
export type RGB = [number, number, number]
export type Point = MuPdfPoint
export type AnnotationColor = RGB | []
export const SYMBOL_OPTIONS = [
  { name: 'check', glyph: '✓', label: 'チェック' },
  { name: 'heavyCheck', glyph: '✔', label: '太いチェック' },
  { name: 'circle', glyph: '○', label: '丸' },
  { name: 'doubleCircle', glyph: '◎', label: '二重丸' },
  { name: 'filledCircle', glyph: '●', label: '黒丸' },
  { name: 'cross', glyph: '×', label: 'バツ' },
  { name: 'triangle', glyph: '△', label: '三角' },
  { name: 'filledTriangle', glyph: '▲', label: '黒三角' },
  { name: 'square', glyph: '□', label: '四角' },
  { name: 'filledSquare', glyph: '■', label: '黒四角' },
  { name: 'star', glyph: '☆', label: '星' },
  { name: 'filledStar', glyph: '★', label: '黒星' },
] as const
export type SymbolName = typeof SYMBOL_OPTIONS[number]['name']
export type LineEnding = {
  start: PDFAnnotationLineEndingStyle
  end: PDFAnnotationLineEndingStyle
}
export type AnnotationKind =
  | 'freetext'
  | 'callout'
  | 'line'
  | 'arrow'
  | 'square'
  | 'circle'
  | 'highlight'
  | 'ink'
  | 'symbol'
  | 'other'

export interface AnnotationInfo {
  objNum: number
  pageIndex: number
  type: string
  kind: AnnotationKind
  editable: boolean
  rect: Rect
  contents: string
  fontName: string | null
  fontSize: number | null
  textColor: RGB | null
  strokeColor: RGB | null
  interiorColor: RGB | null
  borderWidth: number | null
  opacity: number | null
  textOpacity?: number | null
  boxOpacity?: number | null
  line: [Point, Point] | null
  lineEnding: LineEnding | null
  inkList: Point[][] | null
  calloutPoint: Point | null
  calloutLine: [Point, Point] | null
  symbol: SymbolName | null
  madeByKaru: boolean
}

export type AnnotationEdit =
  | { kind: 'createFreeText'; pageIndex: number; rect: Rect; text: string; fontSize: number; color: RGB; font: FontName; backgroundColor?: RGB | null; borderColor?: RGB | null; borderWidth?: number; textOpacity?: number; boxOpacity?: number }
  | { kind: 'updateFreeText'; objNum: number; pageIndex: number; rect: Rect; text: string; fontSize: number; color: RGB; font: FontName; backgroundColor?: RGB | null; borderColor?: RGB | null; borderWidth?: number; textOpacity?: number; boxOpacity?: number }
  | { kind: 'createCallout'; pageIndex: number; rect: Rect; point: Point; text: string; fontSize: number; color: RGB; font: FontName; backgroundColor?: RGB | null; borderColor?: RGB | null; borderWidth?: number; textOpacity?: number; boxOpacity?: number }
  | { kind: 'updateCallout'; objNum: number; pageIndex: number; rect: Rect; point: Point; text: string; fontSize: number; color: RGB; font: FontName; backgroundColor?: RGB | null; borderColor?: RGB | null; borderWidth?: number; textOpacity?: number; boxOpacity?: number }
  | { kind: 'createSquare'; pageIndex: number; rect: Rect; color: AnnotationColor; borderWidth: number; interiorColor?: RGB | null; opacity?: number }
  | { kind: 'updateSquare'; objNum: number; pageIndex: number; rect: Rect; color: AnnotationColor; borderWidth: number; interiorColor?: RGB | null; opacity?: number }
  | { kind: 'createLine'; pageIndex: number; line: [Point, Point]; color: RGB; borderWidth: number; lineEnding: LineEnding; opacity?: number }
  | { kind: 'updateLine'; objNum: number; pageIndex: number; line: [Point, Point]; color: RGB; borderWidth: number; lineEnding: LineEnding; opacity?: number }
  | { kind: 'createCircle'; pageIndex: number; rect: Rect; color: AnnotationColor; borderWidth: number; interiorColor?: RGB | null; opacity?: number }
  | { kind: 'updateCircle'; objNum: number; pageIndex: number; rect: Rect; color: AnnotationColor; borderWidth: number; interiorColor?: RGB | null; opacity?: number }
  | { kind: 'createInk'; pageIndex: number; inkList: Point[][]; color: RGB; borderWidth: number; opacity: number; inkKind?: 'highlight' | 'ink' }
  | { kind: 'updateInk'; objNum: number; pageIndex: number; inkList: Point[][]; color: RGB; borderWidth: number; opacity: number; inkKind?: 'highlight' | 'ink' }
  | { kind: 'createSymbol'; pageIndex: number; rect: Rect; color: RGB; symbol: SymbolName; opacity?: number }
  | { kind: 'updateSymbol'; objNum: number; pageIndex: number; rect: Rect; color: RGB; symbol: SymbolName; opacity?: number }
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
  unsupportedCharacters: string[]
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
  fontName: FontName
  textRect: Rect
  backgroundColor: RGB | null
  borderColor: RGB | null
  borderWidth: number
  textOpacity: number
  boxOpacity: number
  calloutLine: [Point, Point] | null
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

function readName(object: PDFObject, key: string): string | null {
  const value = object.get(key)
  try {
    return value.isName() ? value.asName() : null
  } finally {
    value.destroy()
  }
}

function asSymbolName(value: string | null): SymbolName | null {
  return SYMBOL_OPTIONS.some((item) => item.name === value) ? value as SymbolName : null
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

function readNumberArray(object: PDFObject, key: string): number[] | null {
  const value = object.get(key)
  try {
    if (!value.isArray()) return null
    const result = value.asJS()
    return Array.isArray(result) && result.every((item) => typeof item === 'number') ? result : null
  } finally {
    value.destroy()
  }
}

function readNumber(object: PDFObject, key: string): number | null {
  const value = object.get(key)
  try {
    return value.isNumber() ? value.asNumber() : null
  } finally {
    value.destroy()
  }
}

interface KaruStyle {
  present: boolean
  fill: RGB | null
  border: RGB | null
  borderWidth: number | null
  textOpacity: number | null
  boxOpacity: number | null
}

function readKaruStyle(object: PDFObject): KaruStyle {
  const raw = object.get('KaruStyle')
  let style: PDFObject | undefined
  try {
    if (raw.isNull()) return { present: false, fill: null, border: null, borderWidth: null, textOpacity: null, boxOpacity: null }
    style = raw.isIndirect() ? raw.resolve() : undefined
    const dictionary = style ?? raw
    if (!dictionary.isDictionary()) return { present: false, fill: null, border: null, borderWidth: null, textOpacity: null, boxOpacity: null }
    return {
      present: true,
      fill: asRGB(readNumberArray(dictionary, 'Fill') ?? []),
      border: asRGB(readNumberArray(dictionary, 'Border') ?? []),
      borderWidth: readNumber(dictionary, 'BorderWidth'),
      textOpacity: readNumber(dictionary, 'TextOpacity'),
      boxOpacity: readNumber(dictionary, 'BoxOpacity'),
    }
  } finally {
    style?.destroy()
    raw.destroy()
  }
}

function transformPoint(point: Point, matrix: readonly number[]): Point {
  return [
    point[0] * matrix[0] + point[1] * matrix[2] + matrix[4],
    point[0] * matrix[1] + point[1] * matrix[3] + matrix[5],
  ]
}

function readCalloutLine(page: PDFPage, object: PDFObject): [Point, Point] | null {
  const raw = readNumberArray(object, 'CL')
  if (!raw || raw.length < 4) return null
  const matrix = page.getTransform()
  return [
    transformPoint([raw[0], raw[1]], matrix),
    transformPoint([raw[raw.length - 2], raw[raw.length - 1]], matrix),
  ]
}

function annotationKind(
  type: PDFAnnotationType,
  lineEnding: LineEnding | null,
  opacity: number | null,
  intent: string | null,
  symbol: SymbolName | null,
  inkKind: string | null,
): AnnotationKind {
  if (type === 'FreeText') return intent === 'FreeTextCallout' ? 'callout' : 'freetext'
  if (type === 'Line') return lineEnding?.end === 'OpenArrow' ? 'arrow' : 'line'
  if (type === 'Square') return 'square'
  if (type === 'Circle') return 'circle'
  if (type === 'Ink') {
    if (inkKind === 'Highlight') return 'highlight'
    if (inkKind === 'Ink') return 'ink'
    return opacity !== null && opacity < 1 ? 'highlight' : 'ink'
  }
  if (type === 'Stamp' && symbol) return 'symbol'
  return 'other'
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
          const editable = type === 'FreeText'
            || type === 'Square'
            || type === 'Line'
            || type === 'Circle'
            || type === 'Ink'
            || (type === 'Stamp' && asSymbolName(readName(object, 'KaruSymbol')) !== null)
          const hasStroke = type === 'FreeText'
            || type === 'Square'
            || type === 'Line'
            || type === 'Circle'
            || type === 'Ink'
          const hasColor = hasStroke || type === 'Stamp'
          const hasInterior = type === 'FreeText' || type === 'Square' || type === 'Circle'
          const standardStroke = hasColor ? asRGB(readNumberArray(object, 'C') ?? []) : null
          const standardInterior = hasInterior ? asRGB(readNumberArray(object, 'IC') ?? []) : null
          const style = type === 'FreeText' ? readKaruStyle(object) : null
          const strokeColor = style?.present ? style.border : standardStroke
          const interiorColor = style?.present ? style.fill : standardInterior
          const borderWidth = hasStroke ? annotation.getBorderWidth() : null
          const opacity = type === 'Ink' || type === 'Square' || type === 'Circle' || type === 'Line' || type === 'Stamp'
            ? annotation.getOpacity()
            : null
          const lineEnding = type === 'Line' ? annotation.getLineEndingStyles() : null
          const intent = type === 'FreeText' ? annotation.getIntent() : null
          const calloutLine = type === 'FreeText' && intent === 'FreeTextCallout'
            ? readCalloutLine(page, object)
            : null
          const symbol = type === 'Stamp' ? asSymbolName(readName(object, 'KaruSymbol')) : null
          const inkKind = type === 'Ink' ? readName(object, 'KaruInkKind') : null
          return {
            objNum: object.asIndirect(),
            pageIndex,
            type,
            kind: annotationKind(type, lineEnding, opacity, intent, symbol, inkKind),
            editable,
            // 型定義上は全注釈に getRect() があるが、MuPDF 1.28.1 は
            // Highlight など /Rect を直接扱わない種類では例外にする。
            rect: [...(annotation.hasRect() ? annotation.getRect() : annotation.getBounds())] as Rect,
            contents: type === 'FreeText' ? annotation.getContents() : '',
            fontName: type === 'FreeText' ? parsed.fontName : null,
            fontSize: type === 'FreeText' ? parsed.fontSize : null,
            textColor: type === 'FreeText' ? parsed.color : null,
            strokeColor,
            interiorColor,
            borderWidth: style?.present ? style.borderWidth ?? borderWidth : borderWidth,
            opacity,
            textOpacity: type === 'FreeText' ? style?.textOpacity ?? 1 : null,
            boxOpacity: type === 'FreeText' ? style?.boxOpacity ?? 1 : null,
            line: type === 'Line' ? annotation.getLine() as [Point, Point] : null,
            lineEnding,
            inkList: type === 'Ink' ? annotation.getInkList() : null,
            calloutPoint: calloutLine?.[0] ?? null,
            calloutLine,
            symbol,
            madeByKaru: (type === 'FreeText'
              && (parsed.fontName === 'BIZUDGothic' || parsed.fontName === 'BIZUDMincho'))
              || symbol !== null,
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

function setPdfName(doc: PDFDocument, object: PDFObject, key: string, value: string): void {
  const name = doc.newName(value)
  try {
    object.put(key, name)
  } finally {
    name.destroy()
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

function setPdfNumberArray(doc: PDFDocument, object: PDFObject, key: string, values: readonly number[]): void {
  const array = doc.newArray()
  try {
    for (const value of values) array.push(value)
    object.put(key, array)
  } finally {
    array.destroy()
  }
}

export function nearestCalloutEdgePoint(rect: Rect, point: Point): Point {
  const [x0, y0, x1, y1] = rect
  const candidates: Point[] = [
    [(x0 + x1) / 2, y0],
    [x1, (y0 + y1) / 2],
    [(x0 + x1) / 2, y1],
    [x0, (y0 + y1) / 2],
  ]
  return candidates.reduce((nearest, candidate) => (
    Math.hypot(candidate[0] - point[0], candidate[1] - point[1])
      < Math.hypot(nearest[0] - point[0], nearest[1] - point[1])
      ? candidate
      : nearest
  ))
}

function calloutOuterRect(textRect: Rect, point: Point, borderWidth: number): Rect {
  const margin = Math.max(4, borderWidth * 4)
  return [
    Math.min(textRect[0], point[0] - margin),
    Math.min(textRect[1], point[1] - margin),
    Math.max(textRect[2], point[0] + margin),
    Math.max(textRect[3], point[1] + margin),
  ]
}

function writeFreeTextStyle(
  doc: PDFDocument,
  object: PDFObject,
  backgroundColor: RGB | null,
  borderColor: RGB | null,
  borderWidth: number,
  textOpacity: number,
  boxOpacity: number,
): void {
  if (backgroundColor) setPdfNumberArray(doc, object, 'IC', backgroundColor)
  else object.delete('IC')
  setPdfNumberArray(doc, object, 'C', borderColor ?? [])

  const borderStyle = doc.newDictionary()
  try {
    setPdfNumber(doc, borderStyle, 'W', borderColor ? borderWidth : 0)
    object.put('BS', borderStyle)
  } finally {
    borderStyle.destroy()
  }

  const karuStyle = doc.newDictionary()
  try {
    if (backgroundColor) setPdfNumberArray(doc, karuStyle, 'Fill', backgroundColor)
    if (borderColor) setPdfNumberArray(doc, karuStyle, 'Border', borderColor)
    setPdfNumber(doc, karuStyle, 'BorderWidth', borderWidth)
    setPdfNumber(doc, karuStyle, 'TextOpacity', textOpacity)
    setPdfNumber(doc, karuStyle, 'BoxOpacity', boxOpacity)
    object.put('KaruStyle', karuStyle)
  } finally {
    karuStyle.destroy()
  }
}

function writeCalloutGeometry(
  doc: PDFDocument,
  annotation: PDFAnnotation,
  textRect: Rect,
  point: Point,
  borderWidth: number,
): { outerRect: Rect; line: [Point, Point] } {
  const outerRect = calloutOuterRect(textRect, point, borderWidth)
  const line: [Point, Point] = [[...point], nearestCalloutEdgePoint(textRect, point)]
  annotation.setIntent('FreeTextCallout')
  annotation.setRect(outerRect)
  annotation.setCalloutLine(line)
  annotation.setCalloutStyle('OpenArrow')
  const object = annotation.getObject()
  try {
    // /RD は PDF 座標で left, bottom, right, top の順。距離なので、
    // y 下向きのページ座標では下辺と上辺の差だけを入れ替える。
    setPdfNumberArray(doc, object, 'RD', [
      textRect[0] - outerRect[0],
      outerRect[3] - textRect[3],
      outerRect[2] - textRect[2],
      textRect[1] - outerRect[1],
    ])
  } finally {
    object.destroy()
  }
  return { outerRect, line }
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
  fontName: FontName,
  backgroundColor: RGB | null,
  borderColor: RGB | null,
  borderWidth: number,
  textOpacity: number,
  boxOpacity: number,
  isNew: boolean,
): void {
  annotation.setRect(rect)
  annotation.setContents(text)
  const object = annotation.getObject()
  try {
    setPdfString(doc, object, 'DA', createDefaultAppearance(fontName, fontSize, color))
    writeFreeTextStyle(doc, object, backgroundColor, borderColor, borderWidth, textOpacity, boxOpacity)
    setPdfNumber(doc, object, 'F', 4)
    if (isNew) setPdfString(doc, object, 'NM', newAnnotationName())
    object.delete('T')
    object.delete('RC')
  } finally {
    object.destroy()
  }
  annotation.setModificationDate(new Date())
  annotation.setOpacity(1)
  annotation.update()
  // update() の後に触ると外観の再生成対象になる属性は変更しない。
  // /T と /RC は MuPDF が補う場合にも残さない。
  const updatedObject = annotation.getObject()
  try {
    setPdfNumber(doc, updatedObject, 'CA', 1)
    updatedObject.delete('T')
    updatedObject.delete('RC')
  } finally {
    updatedObject.destroy()
  }
}

function configureSquare(
  annotation: PDFAnnotation,
  rect: Rect,
  color: AnnotationColor,
  borderWidth: number,
  interiorColor: RGB | null = null,
  opacity = 1,
): void {
  annotation.setFlags(annotation.getFlags() | 4)
  annotation.setRect(rect)
  annotation.setColor(color)
  annotation.setBorderWidth(color.length === 0 ? 0 : borderWidth)
  annotation.setInteriorColor(interiorColor ?? [])
  annotation.setOpacity(opacity)
  annotation.update()
}

function configureLine(
  annotation: PDFAnnotation,
  line: [Point, Point],
  color: RGB,
  borderWidth: number,
  lineEnding: LineEnding,
  opacity = 1,
): void {
  annotation.setFlags(annotation.getFlags() | 4)
  annotation.setLine(line[0], line[1])
  annotation.setColor(color)
  annotation.setBorderWidth(borderWidth)
  annotation.setLineEndingStyles(lineEnding.start, lineEnding.end)
  annotation.setOpacity(opacity)
  annotation.update()
}

function configureCircle(
  annotation: PDFAnnotation,
  rect: Rect,
  color: AnnotationColor,
  borderWidth: number,
  interiorColor: RGB | null = null,
  opacity = 1,
): void {
  annotation.setFlags(annotation.getFlags() | 4)
  annotation.setRect(rect)
  annotation.setColor(color)
  annotation.setBorderWidth(color.length === 0 ? 0 : borderWidth)
  annotation.setInteriorColor(interiorColor ?? [])
  annotation.setOpacity(opacity)
  annotation.update()
}

function configureInk(
  doc: PDFDocument,
  annotation: PDFAnnotation,
  inkList: Point[][],
  color: RGB,
  borderWidth: number,
  opacity: number,
  inkKind: 'highlight' | 'ink',
): void {
  annotation.setFlags(annotation.getFlags() | 4)
  annotation.setInkList(inkList)
  annotation.setColor(color)
  annotation.setBorderWidth(borderWidth)
  annotation.setOpacity(opacity)
  const object = annotation.getObject()
  try {
    setPdfName(doc, object, 'KaruInkKind', inkKind === 'highlight' ? 'Highlight' : 'Ink')
  } finally {
    object.destroy()
  }
  annotation.update()
}

export function symbolBounds(rect: Rect): Rect {
  const width = Math.max(0, rect[2] - rect[0])
  const height = Math.max(0, rect[3] - rect[1])
  const size = Math.min(width, height)
  const x = rect[0] + (width - size) / 2
  const y = rect[1] + (height - size) / 2
  return [x, y, x + size, y + size]
}

export function symbolRectFromDrag(start: Point, end: Point, dragged: boolean, defaultSize = 16): Rect {
  if (!dragged) {
    const half = defaultSize / 2
    return [start[0] - half, start[1] - half, start[0] + half, start[1] + half]
  }
  const raw: Rect = [
    Math.min(start[0], end[0]),
    Math.min(start[1], end[1]),
    Math.max(start[0], end[0]),
    Math.max(start[1], end[1]),
  ]
  return symbolBounds(raw)
}

export function resizeSymbolRect(rect: Rect, handle: 'nw' | 'ne' | 'se' | 'sw', point: Point): Rect {
  const anchors = {
    nw: [rect[2], rect[3]],
    ne: [rect[0], rect[3]],
    se: [rect[0], rect[1]],
    sw: [rect[2], rect[1]],
  } as const
  const anchor = anchors[handle]
  const size = Math.max(4, Math.max(Math.abs(point[0] - anchor[0]), Math.abs(point[1] - anchor[1])))
  const x = handle.includes('w') ? anchor[0] - size : anchor[0]
  const y = handle.includes('n') ? anchor[1] - size : anchor[1]
  return [x, y, x + size, y + size]
}

function ellipse(path: Path, x0: number, y0: number, x1: number, y1: number): void {
  const k = 0.5522847498307936
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rx = (x1 - x0) / 2
  const ry = (y1 - y0) / 2
  path.moveTo(cx + rx, cy)
  path.curveTo(cx + rx, cy + k * ry, cx + k * rx, cy + ry, cx, cy + ry)
  path.curveTo(cx - k * rx, cy + ry, cx - rx, cy + k * ry, cx - rx, cy)
  path.curveTo(cx - rx, cy - k * ry, cx - k * rx, cy - ry, cx, cy - ry)
  path.curveTo(cx + k * rx, cy - ry, cx + rx, cy - k * ry, cx + rx, cy)
  path.closePath()
}

function polygon(path: Path, points: readonly Point[]): void {
  path.moveTo(points[0][0], points[0][1])
  for (const point of points.slice(1)) path.lineTo(point[0], point[1])
  path.closePath()
}

function starPoints(cx: number, cy: number, radius: number): Point[] {
  const points: Point[] = []
  for (let index = 0; index < 10; index += 1) {
    const angle = -Math.PI / 2 + index * Math.PI / 5
    const currentRadius = index % 2 === 0 ? radius : radius * 0.42
    points.push([cx + Math.cos(angle) * currentRadius, cy + Math.sin(angle) * currentRadius])
  }
  return points
}

function drawSymbol(
  device: DisplayListDevice,
  width: number,
  height: number,
  symbol: SymbolName,
  color: RGB,
): void {
  const content = symbolBounds([0, 0, width, height])
  const size = content[2] - content[0]
  const margin = size * 0.12
  const x0 = content[0] + margin
  const y0 = content[1] + margin
  const x1 = content[2] - margin
  const y1 = content[3] - margin
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const path = new mupdf.Path()
  const filled = symbol === 'filledCircle' || symbol === 'filledTriangle'
    || symbol === 'filledSquare' || symbol === 'filledStar'
  let strokeWidth = Math.max(0.8, size * 0.075)
  try {
    if (symbol === 'check' || symbol === 'heavyCheck') {
      path.moveTo(x0, cy)
      path.lineTo(cx - size * 0.08, y1)
      path.lineTo(x1, y0)
      if (symbol === 'heavyCheck') strokeWidth = Math.max(1.2, size * 0.14)
    } else if (symbol === 'circle' || symbol === 'filledCircle') {
      ellipse(path, x0, y0, x1, y1)
    } else if (symbol === 'doubleCircle') {
      ellipse(path, x0, y0, x1, y1)
      const inner = size * 0.19
      ellipse(path, x0 + inner, y0 + inner, x1 - inner, y1 - inner)
    } else if (symbol === 'cross') {
      path.moveTo(x0, y0)
      path.lineTo(x1, y1)
      path.moveTo(x1, y0)
      path.lineTo(x0, y1)
    } else if (symbol === 'triangle' || symbol === 'filledTriangle') {
      polygon(path, [[cx, y0], [x1, y1], [x0, y1]])
    } else if (symbol === 'square' || symbol === 'filledSquare') {
      path.rect(x0, y0, x1, y1)
    } else {
      polygon(path, starPoints(cx, cy, (x1 - x0) / 2))
    }

    if (filled) {
      device.fillPath(path, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, color, 1)
    } else {
      const stroke = new mupdf.StrokeState({
        lineCap: symbol === 'check' || symbol === 'heavyCheck' || symbol === 'cross' ? 'Round' : 'Butt',
        lineJoin: 'Round',
        lineWidth: strokeWidth,
        miterLimit: 10,
      })
      try {
        device.strokePath(path, stroke, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, color, 1)
      } finally {
        stroke.destroy()
      }
    }
  } finally {
    path.destroy()
  }
}

function configureSymbol(
  doc: PDFDocument,
  annotation: PDFAnnotation,
  rect: Rect,
  color: RGB,
  symbol: SymbolName,
  opacity: number,
  isNew: boolean,
): void {
  const width = rect[2] - rect[0]
  const height = rect[3] - rect[1]
  if (width <= 0 || height <= 0) throw new Error('記号の Rect は正の幅と高さが必要です。')
  annotation.setFlags(annotation.getFlags() | 4)
  annotation.setRect(rect)
  annotation.setColor(color)
  annotation.setOpacity(opacity)
  const object = annotation.getObject()
  try {
    setPdfName(doc, object, 'KaruSymbol', symbol)
    setPdfNumber(doc, object, 'F', 4)
    if (isNew) setPdfString(doc, object, 'NM', newAnnotationName())
    object.delete('T')
  } finally {
    object.destroy()
  }

  const displayList = new mupdf.DisplayList([0, 0, width, height])
  const device = new mupdf.DisplayListDevice(displayList)
  try {
    drawSymbol(device, width, height, symbol, color)
    device.close()
    // Stamp は update() を呼ばず、このフォント非依存の AP をそのまま使う。
    annotation.setAppearanceFromDisplayList(null, null, mupdf.Matrix.identity, displayList)
  } finally {
    device.destroy()
    displayList.destroy()
  }
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
  fallbackResource?: FontResource,
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
      task.fontName,
      task.backgroundColor,
      task.borderColor,
      task.borderWidth,
      task.textOpacity,
      task.boxOpacity,
      true,
    )
    const layout = layoutText({
      text: task.text,
      fontSize: task.fontSize,
      boxWidth: task.textRect[2] - task.textRect[0],
      ascent: fontResource.ascent,
      advance: (character) => encodeCharacter(fontResource.font, character, fallbackResource?.font).advance,
    })

    if (task.backgroundColor) {
      const background = new mupdf.Path()
      try {
        background.rect(task.textRect[0], task.textRect[1], task.textRect[2], task.textRect[3])
        device.fillPath(background, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, task.backgroundColor, task.boxOpacity)
      } finally {
        background.destroy()
      }
    }

    if (task.borderColor && task.borderWidth > 0) {
      const inset = task.borderWidth / 2
      const border = new mupdf.Path()
      const stroke = new mupdf.StrokeState({
        lineCap: 'Butt', lineJoin: 'Miter', lineWidth: task.borderWidth, miterLimit: 10,
      })
      try {
        border.rect(
          task.textRect[0] + inset,
          task.textRect[1] + inset,
          task.textRect[2] - inset,
          task.textRect[3] - inset,
        )
        device.strokePath(border, stroke, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, task.borderColor, task.boxOpacity)
      } finally {
        stroke.destroy()
        border.destroy()
      }
    }

    for (const line of layout.lines) {
      let x = task.textRect[0] + line.x
      for (const character of [...line.text]) {
        const encoded = encodeCharacter(fontResource.font, character, fallbackResource?.font)
        // MuPDF のページ座標は y 下向きだが、グリフ座標は y 上向き。
        // d=-fontSize として反転すると、baseline-ascent が箱の上側になる。
        text.showGlyph(
          encoded.font,
          [task.fontSize, 0, 0, -task.fontSize, x, task.textRect[1] + line.baseline],
          encoded.glyph,
          encoded.unicode,
        )
        x += encoded.advance * task.fontSize
      }
    }
    device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, task.color, task.textOpacity)

    if (task.calloutLine) {
      const [tip, end] = task.calloutLine
      const lineColor = task.borderColor ?? task.color
      const width = Math.max(0.5, task.borderWidth)
      const arrowSize = Math.max(8, width * 5)
      const angle = Math.atan2(end[1] - tip[1], end[0] - tip[0])
      const linePath = new mupdf.Path()
      const stroke = new mupdf.StrokeState({
        lineCap: 'Butt', lineJoin: 'Miter', lineWidth: width, miterLimit: 10,
      })
      try {
        linePath.moveTo(tip[0], tip[1])
        linePath.lineTo(end[0], end[1])
        linePath.moveTo(tip[0], tip[1])
        linePath.lineTo(
          tip[0] + Math.cos(angle - Math.PI / 6) * arrowSize,
          tip[1] + Math.sin(angle - Math.PI / 6) * arrowSize,
        )
        linePath.moveTo(tip[0], tip[1])
        linePath.lineTo(
          tip[0] + Math.cos(angle + Math.PI / 6) * arrowSize,
          tip[1] + Math.sin(angle + Math.PI / 6) * arrowSize,
        )
        device.strokePath(linePath, stroke, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, lineColor, task.boxOpacity)
      } finally {
        stroke.destroy()
        linePath.destroy()
      }
    }
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
  fontResources: FontResources,
): void {
  if (tasks.length === 0) return
  const temporaryDocument = new mupdf.PDFDocument()
  let graftMap: ReturnType<PDFDocument['newGraftMap']> | undefined
  try {
    for (const task of tasks) {
      const fontResource = fontResources[task.fontName]
      if (!fontResource) throw new Error(`${task.fontName} が読み込まれていません。`)
      makeTemporaryAppearance(temporaryDocument, task, fontResource, fontResources.ZapfDingbats)
    }
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
  fontResources: FontResources,
): ApplyResult {
  const result: ApplyResult = { created: [], replacedCharacters: 0, unsupportedCharacters: [], errors: [] }
  const unsupportedCharacters = new Set<string>()
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
        configureSquare(annotation, edit.rect, edit.color, edit.borderWidth, edit.interiorColor, edit.opacity)
        if (isNew) result.created.push(objectNumber(annotation))
        continue
      }

      if (edit.kind === 'createLine' || edit.kind === 'updateLine') {
        const isNew = edit.kind === 'createLine'
        annotation = isNew
          ? page.createAnnotation('Line')
          : findAnnotation(page, 'objNum' in edit ? edit.objNum : -1)
        if (!annotation) throw new Error(`注釈オブジェクト ${editObjectNumber(edit)} が見つかりません。`)
        if (!isNew && annotation.getType() !== 'Line') throw new Error('更新対象は Line ではありません。')
        configureLine(annotation, edit.line, edit.color, edit.borderWidth, edit.lineEnding, edit.opacity ?? 1)
        if (isNew) result.created.push(objectNumber(annotation))
        continue
      }

      if (edit.kind === 'createCircle' || edit.kind === 'updateCircle') {
        const isNew = edit.kind === 'createCircle'
        annotation = isNew
          ? page.createAnnotation('Circle')
          : findAnnotation(page, 'objNum' in edit ? edit.objNum : -1)
        if (!annotation) throw new Error(`注釈オブジェクト ${editObjectNumber(edit)} が見つかりません。`)
        if (!isNew && annotation.getType() !== 'Circle') throw new Error('更新対象は Circle ではありません。')
        configureCircle(annotation, edit.rect, edit.color, edit.borderWidth, edit.interiorColor, edit.opacity)
        if (isNew) result.created.push(objectNumber(annotation))
        continue
      }

      if (edit.kind === 'createInk' || edit.kind === 'updateInk') {
        const isNew = edit.kind === 'createInk'
        annotation = isNew
          ? page.createAnnotation('Ink')
          : findAnnotation(page, 'objNum' in edit ? edit.objNum : -1)
        if (!annotation) throw new Error(`注釈オブジェクト ${editObjectNumber(edit)} が見つかりません。`)
        if (!isNew && annotation.getType() !== 'Ink') throw new Error('更新対象は Ink ではありません。')
        configureInk(doc, annotation, edit.inkList, edit.color, edit.borderWidth, edit.opacity, edit.inkKind ?? (edit.opacity < 1 ? 'highlight' : 'ink'))
        if (isNew) result.created.push(objectNumber(annotation))
        continue
      }

      if (edit.kind === 'createSymbol' || edit.kind === 'updateSymbol') {
        const isNew = edit.kind === 'createSymbol'
        annotation = isNew
          ? page.createAnnotation('Stamp')
          : findAnnotation(page, 'objNum' in edit ? edit.objNum : -1)
        if (!annotation) throw new Error(`注釈オブジェクト ${editObjectNumber(edit)} が見つかりません。`)
        if (!isNew && annotation.getType() !== 'Stamp') throw new Error('更新対象は Stamp ではありません。')
        const object = annotation.getObject()
        try {
          if (!isNew && asSymbolName(readName(object, 'KaruSymbol')) === null) {
            throw new Error('他のソフトで作られた Stamp は編集できません。')
          }
        } finally {
          object.destroy()
        }
        configureSymbol(doc, annotation, edit.rect, edit.color, edit.symbol, edit.opacity ?? 1, isNew)
        if (isNew) result.created.push(objectNumber(annotation))
        continue
      }

      const isCallout = edit.kind === 'createCallout' || edit.kind === 'updateCallout'
      const isNew = edit.kind === 'createFreeText' || edit.kind === 'createCallout'
      annotation = isNew
        ? page.createAnnotation('FreeText')
        : findAnnotation(page, 'objNum' in edit ? edit.objNum : -1)
      if (!annotation) throw new Error(`注釈オブジェクト ${editObjectNumber(edit)} が見つかりません。`)
      if (!isNew && annotation.getType() !== 'FreeText') throw new Error('更新対象は FreeText ではありません。')
      const borderWidth = edit.borderWidth ?? 1
      const outerRect = isCallout ? calloutOuterRect(edit.rect, edit.point, borderWidth) : edit.rect
      const width = outerRect[2] - outerRect[0]
      const height = outerRect[3] - outerRect[1]
      if (width <= 0 || height <= 0) throw new Error('FreeText の Rect は正の幅と高さが必要です。')
      const fontResource = fontResources[edit.font]
      if (!fontResource) throw new Error(`${edit.font} が読み込まれていません。`)
      const replaced = replaceMissingCharacters(
        fontResource.font,
        edit.text,
        fontResources.ZapfDingbats?.font,
      )
      result.replacedCharacters += replaced.replacedCharacters
      for (const character of replaced.unsupportedCharacters) unsupportedCharacters.add(character)
      configureFreeText(
        doc,
        annotation,
        outerRect,
        replaced.text,
        edit.fontSize,
        edit.color,
        edit.font,
        edit.backgroundColor ?? null,
        edit.borderColor ?? null,
        borderWidth,
        edit.textOpacity ?? 1,
        edit.boxOpacity ?? 1,
        isNew,
      )
      let calloutLine: [Point, Point] | null = null
      if (isCallout) calloutLine = writeCalloutGeometry(doc, annotation, edit.rect, edit.point, borderWidth).line
      if (isNew) result.created.push(objectNumber(annotation))
      const textRect: Rect = [
        edit.rect[0] - outerRect[0],
        edit.rect[1] - outerRect[1],
        edit.rect[2] - outerRect[0],
        edit.rect[3] - outerRect[1],
      ]
      appearances.push({
        editIndex,
        page,
        annotation,
        width,
        height,
        text: replaced.text,
        fontSize: edit.fontSize,
        color: edit.color,
        fontName: edit.font,
        textRect,
        backgroundColor: edit.backgroundColor ?? null,
        borderColor: edit.borderColor ?? null,
        borderWidth,
        textOpacity: edit.textOpacity ?? 1,
        boxOpacity: edit.boxOpacity ?? 1,
        calloutLine: calloutLine ? [
          [calloutLine[0][0] - outerRect[0], calloutLine[0][1] - outerRect[1]],
          [calloutLine[1][0] - outerRect[0], calloutLine[1][1] - outerRect[1]],
        ] : null,
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
    installTemporaryAppearances(doc, appearances, fontResources)
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

  result.unsupportedCharacters = [...unsupportedCharacters]
  return result
}
