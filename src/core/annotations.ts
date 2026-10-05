import { parseQuantityMark, quantityPoints, quantityDashes, type QuantityMark } from './quantity'
import { QUANTITY_DASHES, type QuantityLineStyle } from './countFixtures'
import { arrowHeadSize } from './lineGeometry'
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
  type Quad,
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
import { cloudArcs, cloudBounds, rectVertices, type CloudIntensity } from './cloud'
import { parseIssue, issueColor, issueFontSize, type Issue } from './issues'
import { parseCount, type CountMark } from './counts'
import { writeCountFixtures, type CountFixture } from './countFixtures'
import { countMarkerData } from '../editor/countMarkers'
import { createMeasureDictionary, invertMatrix, measureBounds, measureLabel, measureText, pageUnitFactor, readMeasureSettings, transformMeasurePoint, writePageScale, type MeasureKind, type MeasureSettings, type PageScale } from './measure'

export type Rect = [number, number, number, number]
export type RGB = [number, number, number]
export type Point = MuPdfPoint
export type AnnotationColor = RGB | []
// Session-only copy used to undo deletion, including deletion already saved to PDF.
export interface LegacyChangeData { pdf: Uint8Array; preview: string; bounds: Rect }
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
  | 'cloudSquare' | 'cloudPolygon' | 'issue'
  | MeasureKind
  | 'freetext'
  | 'callout'
  | 'line'
  | 'arrow'
  | 'square'
  | 'circle'
  | 'highlight'
  | 'ink'
  | 'textHighlight'
  | 'underline'
  | 'strikeout'
  | 'symbol'
  | 'other'

export interface AnnotationInfo {
  legacyChange?: boolean
  legacyChangeData?: LegacyChangeData
  quantity?: QuantityMark | null
  quantityDash?: QuantityLineStyle['dash']
  count?: CountMark | null
  arrowHeadSize?: number | null
  cloudIntensity?: CloudIntensity | null
  issue?: Issue | null
  measure?: MeasureSettings | null
  vertices?: Point[] | null
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
  quads: Quad[] | null
  markedText: string | null
  calloutPoint: Point | null
  calloutLine: [Point, Point] | null
  symbol: SymbolName | null
  madeByKaru: boolean
}

export type AnnotationEdit =
  | { kind: 'createCloud'; pageIndex: number; shape: 'square' | 'polygon'; rect: Rect; vertices: Point[] | null; color: RGB; borderWidth: number; interiorColor: RGB | null; opacity: number; cloudIntensity: CloudIntensity }
  | { kind: 'updateCloud'; objNum: number; pageIndex: number; shape: 'square' | 'polygon'; rect: Rect; vertices: Point[] | null; color: RGB; borderWidth: number; interiorColor: RGB | null; opacity: number; cloudIntensity: CloudIntensity }
  | { kind: 'createIssue'; pageIndex: number; rect: Rect; issue: Issue; text: string; color: RGB }
  | { kind: 'updateIssue'; objNum: number; pageIndex: number; rect: Rect; issue: Issue; text: string; color: RGB }
  | { kind: 'createLegacyChange'; pageIndex: number; data: LegacyChangeData }
  | { kind: 'setPageScale'; pageIndex: number; scale: PageScale | null }
  | { kind: 'createMeasure'; pageIndex: number; vertices: Point[]; measure: MeasureSettings; text: string; color: RGB; borderWidth: number; fontSize: number; opacity: number; quantity?: QuantityMark | null; quantityDash?: QuantityLineStyle['dash'] }
  | { kind: 'updateMeasure'; objNum: number; pageIndex: number; vertices: Point[]; measure: MeasureSettings; text: string; color: RGB; borderWidth: number; fontSize: number; opacity: number; quantity?: QuantityMark | null; quantityDash?: QuantityLineStyle['dash'] }
  | { kind: 'createFreeText'; pageIndex: number; rect: Rect; text: string; fontSize: number; color: RGB; font: FontName; backgroundColor?: RGB | null; borderColor?: RGB | null; borderWidth?: number; textOpacity?: number; boxOpacity?: number }
  | { kind: 'updateFreeText'; objNum: number; pageIndex: number; rect: Rect; text: string; fontSize: number; color: RGB; font: FontName; backgroundColor?: RGB | null; borderColor?: RGB | null; borderWidth?: number; textOpacity?: number; boxOpacity?: number }
  | { kind: 'createCallout'; pageIndex: number; rect: Rect; point: Point; text: string; fontSize: number; color: RGB; font: FontName; backgroundColor?: RGB | null; borderColor?: RGB | null; borderWidth?: number; textOpacity?: number; boxOpacity?: number; arrowHeadSize?: number | null }
  | { kind: 'updateCallout'; objNum: number; pageIndex: number; rect: Rect; point: Point; text: string; fontSize: number; color: RGB; font: FontName; backgroundColor?: RGB | null; borderColor?: RGB | null; borderWidth?: number; textOpacity?: number; boxOpacity?: number; arrowHeadSize?: number | null }
  | { kind: 'createSquare'; pageIndex: number; rect: Rect; color: AnnotationColor; borderWidth: number; interiorColor?: RGB | null; opacity?: number }
  | { kind: 'updateSquare'; objNum: number; pageIndex: number; rect: Rect; color: AnnotationColor; borderWidth: number; interiorColor?: RGB | null; opacity?: number }
  | { kind: 'createLine'; pageIndex: number; line: [Point, Point]; color: RGB; borderWidth: number; lineEnding: LineEnding; opacity?: number; arrowHeadSize?: number | null }
  | { kind: 'updateLine'; objNum: number; pageIndex: number; line: [Point, Point]; color: RGB; borderWidth: number; lineEnding: LineEnding; opacity?: number; arrowHeadSize?: number | null }
  | { kind: 'createCircle'; pageIndex: number; rect: Rect; color: AnnotationColor; borderWidth: number; interiorColor?: RGB | null; opacity?: number }
  | { kind: 'updateCircle'; objNum: number; pageIndex: number; rect: Rect; color: AnnotationColor; borderWidth: number; interiorColor?: RGB | null; opacity?: number }
  | { kind: 'createInk'; pageIndex: number; inkList: Point[][]; color: RGB; borderWidth: number; opacity: number; inkKind?: 'highlight' | 'ink' }
  | { kind: 'updateInk'; objNum: number; pageIndex: number; inkList: Point[][]; color: RGB; borderWidth: number; opacity: number; inkKind?: 'highlight' | 'ink' }
  | { kind: 'createTextMarkup'; pageIndex: number; markup: 'Highlight' | 'Underline' | 'StrikeOut'; quads: Quad[]; color: RGB; opacity: number; markedText: string }
  | { kind: 'updateTextMarkup'; objNum: number; pageIndex: number; markup: 'Highlight' | 'Underline' | 'StrikeOut'; quads: Quad[]; color: RGB; opacity: number; markedText: string }
  | { kind: 'setCountFixtures'; pageIndex: number; fixtures: CountFixture[] }
  | { kind: 'createSymbol'; pageIndex: number; rect: Rect; color: RGB; symbol: SymbolName; opacity?: number; count?: CountMark | null; countFixture?: CountFixture }
  | { kind: 'updateSymbol'; objNum: number; pageIndex: number; rect: Rect; color: RGB; symbol: SymbolName; opacity?: number; count?: CountMark | null; countFixture?: CountFixture }
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
  countFixture?: CountFixture
  issue?: Issue
  visibleRect?: Rect
  measurement?: { points: Point[]; kind: MeasureKind; rect: Rect; opacity: number; dash?: QuantityLineStyle['dash'] }
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
  arrowHeadSize?: number | null
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
  if (type === 'Line' && intent === 'LineDimension') return 'distance'
  if (type === 'PolyLine' && intent === 'PolyLineDimension') return 'perimeter'
  if (type === 'Polygon' && intent === 'PolygonDimension') return 'area'
  if (type === 'FreeText') return intent === 'FreeTextCallout' ? 'callout' : 'freetext'
  if (type === 'Line') return lineEnding?.end === 'OpenArrow' ? 'arrow' : 'line'
  if (type === 'Square') return 'square'
  if (type === 'Circle') return 'circle'
  if (type === 'Ink') {
    if (inkKind === 'Highlight') return 'highlight'
    if (inkKind === 'Ink') return 'ink'
    return opacity !== null && opacity < 1 ? 'highlight' : 'ink'
  }
  if (type === 'Highlight') return 'textHighlight'
  if (type === 'Underline') return 'underline'
  if (type === 'StrikeOut') return 'strikeout'
  if (type === 'Stamp' && symbol) return 'symbol'
  return 'other'
}

const legacyChangeSnapshots = new WeakMap<PDFDocument, Map<number, LegacyChangeData>>()
function snapshotLegacyChange(doc: PDFDocument, annotation: PDFAnnotation, object: PDFObject): LegacyChangeData {
  let snapshots = legacyChangeSnapshots.get(doc)
  if (!snapshots) { snapshots = new Map(); legacyChangeSnapshots.set(doc, snapshots) }
  const cached = snapshots.get(object.asIndirect())
  if (cached) return cached
  const copy = new mupdf.PDFDocument(), dictionary = doc.newDictionary()
  const pageRef = copy.addPage([0,0,1,1], 0, {}, '')
  try {
    // P links back to the whole source document. Copy only the annotation and its resources.
    object.forEach((value, key) => { if (key !== 'P') dictionary.put(key, value) })
    copy.insertPage(-1, pageRef)
    const grafted = copy.graftObject(dictionary), reference = copy.addObject(grafted), page = copy.findPage(0)
    try { page.put('Annots', [reference]) } finally { page.destroy(); reference.destroy(); grafted.destroy() }
    const buffer = copy.saveToBuffer('compress')
    let pdf: Uint8Array
    try { pdf = new Uint8Array(buffer.asUint8Array()) } finally { buffer.destroy() }
    const bounds = annotation.getBounds() as Rect
    // A bounded stamp preview, never page rendering, text extraction or OCR.
    const factor = Math.min(2, 512 / Math.max(1, bounds[2]-bounds[0], bounds[3]-bounds[1]))
    const pixmap = annotation.toPixmap(mupdf.Matrix.scale(factor, factor), mupdf.ColorSpace.DeviceRGB, true)
    try {
      let binary = ''
      for (const byte of pixmap.asPNG()) binary += String.fromCharCode(byte)
      const data = { pdf, preview: `data:image/png;base64,${btoa(binary)}`, bounds }
      snapshots.set(object.asIndirect(), data)
      return data
    } finally { pixmap.destroy() }
  } finally { pageRef.destroy(); dictionary.destroy(); copy.destroy() }
}

export function listAnnotations(doc: PDFDocument, pageIndex: number): AnnotationInfo[] {
  const page = doc.loadPage(pageIndex)
  try {
    return page.getAnnotations().map((annotation) => {
      try {
          const type = annotation.getType()
        const object = annotation.getObject()
        try {
          const be = object.get('BE')
          const cloud = (type === 'Square' || type === 'Polygon') && !be.isNull() && readName(be, 'S') === 'C'
          const cloudIntensity: CloudIntensity | null = cloud ? Math.max(0, Math.min(2, Math.round(readNumber(be, 'I') ?? 1))) as CloudIntensity : null
          be.destroy()
          const savedIssue = type === 'Stamp' ? parseIssue(readString(object, 'KaruIssue')) : null
          const savedCount = type === 'Stamp' ? parseCount(readString(object, 'KaruCount')) : null
          const legacyChange = savedIssue?.recordKind === 'change'
          const issue = legacyChange ? null : savedIssue
          const dimensionIntent = readName(object, 'IT')
          const measureKind: MeasureKind | null = type === 'Line' && dimensionIntent === 'LineDimension' ? 'distance'
            : type === 'PolyLine' && dimensionIntent === 'PolyLineDimension' ? 'perimeter'
            : type === 'Polygon' && dimensionIntent === 'PolygonDimension' ? 'area' : null
          const measurement = measureKind ? readMeasureSettings(object, measureKind, pageUnitFactor(page)) : null
          const parsedQuantity = parseQuantityMark(readString(object, 'KaruQuantity'))
          const quantity = parsedQuantity && measurement && (quantityPoints(parsedQuantity.method) === 'polygon' ? measureKind === 'area' : measureKind === 'perimeter') ? parsedQuantity : null
          const savedDash = quantity ? readString(object, 'KaruQuantityDash') : null
          const quantityDash = quantity ? QUANTITY_DASHES.includes(savedDash as QuantityLineStyle['dash']) ? savedDash as QuantityLineStyle['dash'] : 'solid' : undefined
          const measureVertices = measureKind === 'distance' ? annotation.getLine() as Point[] : measureKind || (cloud && type === 'Polygon') ? annotation.getVertices() : null
          const da = readString(object, 'DA')
          const parsed = da === null
            ? { fontName: null, fontSize: null, color: null }
            : parseDefaultAppearance(da)
          const isTextMarkup = type === 'Highlight' || type === 'Underline' || type === 'StrikeOut'
          const editable = type === 'FreeText'
            || cloud || issue !== null
            || (measureKind !== null && measurement !== null)
            || type === 'Square'
            || type === 'Line'
            || type === 'Circle'
            || type === 'Ink'
            || isTextMarkup
            || (type === 'Stamp' && asSymbolName(readName(object, 'KaruSymbol')) !== null)
          const hasStroke = type === 'FreeText'
            || cloud
            || measureKind !== null
            || type === 'Square'
            || type === 'Line'
            || type === 'Circle'
            || type === 'Ink'
          const hasColor = hasStroke || type === 'Stamp' || isTextMarkup
          const hasInterior = type === 'FreeText' || type === 'Square' || type === 'Circle' || cloud
          const standardStroke = hasColor ? asRGB(readNumberArray(object, 'C') ?? []) : null
          const standardInterior = hasInterior ? asRGB(readNumberArray(object, 'IC') ?? []) : null
          const style = type === 'FreeText' ? readKaruStyle(object) : null
          const strokeColor = style?.present ? style.border : standardStroke
          const interiorColor = style?.present ? style.fill : standardInterior
          const borderWidth = hasStroke ? annotation.getBorderWidth() : null
          const opacity = cloud || measureKind !== null || type === 'Ink' || type === 'Square' || type === 'Circle' || type === 'Line' || type === 'Stamp' || isTextMarkup
            ? annotation.getOpacity()
            : null
          const lineEnding = type === 'Line' ? annotation.getLineEndingStyles() : null
          const intent = type === 'FreeText' ? annotation.getIntent() : dimensionIntent
          const calloutLine = type === 'FreeText' && intent === 'FreeTextCallout'
            ? readCalloutLine(page, object)
            : null
          const symbol = type === 'Stamp' ? asSymbolName(readName(object, 'KaruSymbol')) : null
          const countRect = savedCount ? readNumberArray(object, 'KaruCountRect') : null
          const countBounds = countRect?.length === 4 && countRect.every(Number.isFinite) ? vertexBounds([
            transformMeasurePoint([countRect[0], countRect[1]], page.getTransform()),
            transformMeasurePoint([countRect[2], countRect[3]], page.getTransform()),
          ]) : null
          const inkKind = type === 'Ink' ? readName(object, 'KaruInkKind') : null
          return {
            cloudIntensity, issue, legacyChange, legacyChangeData: legacyChange ? snapshotLegacyChange(doc, annotation, object) : undefined,
            count: savedCount, quantity, quantityDash,
            measure: measurement,
            vertices: measureVertices,
            objNum: object.asIndirect(),
            pageIndex,
            type,
            kind: issue || legacyChange ? 'issue' : cloud ? type === 'Square' ? 'cloudSquare' : 'cloudPolygon' : annotationKind(type, lineEnding, opacity, intent, symbol, inkKind),
            editable: !legacyChange && editable,
            // 型定義上は全注釈に getRect() があるが、MuPDF 1.28.1 は
            // Highlight など /Rect を直接扱わない種類では例外にする。
            rect: countBounds ?? (cloud && type === 'Square' ? cloudSquareRect(page, object) : cloud && measureVertices ? vertexBounds(measureVertices) : [...(annotation.hasRect() ? annotation.getRect() : annotation.getBounds())] as Rect),
            contents: !quantity && measurement && measureVertices && readString(object, 'KaruMeasure')
              ? measureText(measureVertices, measurement) : savedIssue || type === 'FreeText' || measureKind || savedCount ? annotation.getContents() : '',
            fontName: type === 'FreeText' ? parsed.fontName : null,
            fontSize: type === 'FreeText' ? parsed.fontSize : measureKind ? readNumber(object, 'KaruMeasureFontSize') ?? 10.5 : null,
            textColor: type === 'FreeText' ? parsed.color : null,
            strokeColor,
            interiorColor,
            arrowHeadSize: readNumber(object, 'KaruArrowHeadSize'),
            borderWidth: style?.present ? style.borderWidth ?? borderWidth : borderWidth,
            opacity,
            textOpacity: type === 'FreeText' ? style?.textOpacity ?? 1 : null,
            boxOpacity: type === 'FreeText' ? style?.boxOpacity ?? 1 : null,
            line: type === 'Line' && !measureKind ? annotation.getLine() as [Point, Point] : null,
            lineEnding,
            inkList: type === 'Ink' ? annotation.getInkList() : null,
            quads: isTextMarkup ? annotation.getQuadPoints() : null,
            markedText: isTextMarkup ? annotation.getContents() : null,
            calloutPoint: calloutLine?.[0] ?? null,
            calloutLine,
            symbol,
            madeByKaru: (type === 'FreeText'
              && (parsed.fontName === 'BIZUDGothic' || parsed.fontName === 'BIZUDMincho'))
              || issue !== null || symbol !== null || readString(object, 'KaruMeasure') !== null,
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

function vertexBounds(points: readonly Point[]): Rect {
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]
}
function cloudSquareRect(page: PDFPage, object: PDFObject): Rect {
  const r = readNumberArray(object, 'Rect')!, rd = readNumberArray(object, 'RD') ?? [0, 0, 0, 0]
  const matrix = page.getTransform()
  return vertexBounds(rectVertices([r[0] + rd[0], r[1] + rd[1], r[2] - rd[2], r[3] - rd[3]]).map(p => transformPoint(p, matrix)))
}
function setVisibleRect(doc: PDFDocument, page: PDFPage, object: PDFObject, rect: Rect): Rect {
  const inv = invertMatrix(page.getTransform())
  const raw = vertexBounds(rectVertices(rect).map(p => transformPoint(p, inv)))
  setPdfNumberArray(doc, object, 'Rect', raw)
  return raw
}
function configureCloud(doc: PDFDocument, page: PDFPage, annotation: PDFAnnotation, edit: Extract<AnnotationEdit, { kind: 'createCloud' | 'updateCloud' }>): void {
  const points = edit.shape === 'square' ? rectVertices(edit.rect) : edit.vertices
  if (!points || points.length < 3 || points.some(p => p.some(n => !Number.isFinite(n)))) throw new Error('雲の頂点が不正です。')
  if (edit.shape === 'square' && (edit.rect[2] <= edit.rect[0] || edit.rect[3] <= edit.rect[1])) throw new Error('雲の大きさが不正です。')
  annotation.setFlags(annotation.getFlags() | 4)
  if (edit.shape === 'square') annotation.setRect(edit.rect)
  else annotation.setVertices(points)
  annotation.setColor(edit.color); annotation.setBorderWidth(edit.borderWidth)
  annotation.setInteriorColor(edit.interiorColor ?? []); annotation.setOpacity(edit.opacity)
  // Clear MuPDF's regeneration flag before installing our common SVG/PDF path.
  annotation.update()
  const rect = cloudBounds(points, edit.cloudIntensity, edit.borderWidth)
  const object = annotation.getObject(), be = doc.newDictionary()
  try {
    be.put('S', 'C'); be.put('I', edit.cloudIntensity); object.put('BE', be)
    const raw = setVisibleRect(doc, page, object, rect)
    if (edit.shape === 'polygon') setPdfName(doc, object, 'IT', 'PolygonCloud')
    else {
      const inner = vertexBounds(points.map(p => transformPoint(p, invertMatrix(page.getTransform()))))
      setPdfNumberArray(doc, object, 'RD', [inner[0] - raw[0], inner[1] - raw[1], raw[2] - inner[2], raw[3] - inner[3]])
    }
    if (edit.kind === 'createCloud') setPdfString(doc, object, 'NM', newAnnotationName())
    object.delete('T')
  } finally { be.destroy(); object.destroy() }
  const display = new mupdf.DisplayList([0, 0, rect[2] - rect[0], rect[3] - rect[1]])
  const device = new mupdf.DisplayListDevice(display), path = new mupdf.Path()
  const stroke = new mupdf.StrokeState({ lineWidth: edit.borderWidth, lineJoin: 'Round', lineCap: 'Round', miterLimit: 10 })
  try {
    const arcs = cloudArcs(points.map(p => [p[0] - rect[0], p[1] - rect[1]]), edit.cloudIntensity, edit.borderWidth)
    if (!arcs.length) throw new Error('雲の辺がありません。')
    path.moveTo(...arcs[0].start)
    for (const arc of arcs) path.curveTo(...arc.c1, ...arc.c2, ...arc.end)
    path.closePath()
    if (edit.interiorColor) device.fillPath(path, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, edit.interiorColor, 1)
    device.strokePath(path, stroke, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, edit.color, 1)
    device.close(); annotation.setAppearanceFromDisplayList(null, null, mupdf.Matrix.identity, display)
    const target = annotation.getObject(), ap = target.get('AP', 'N')
    try { orientVisibleAppearance(doc, page, rect, target, ap) } finally { ap.destroy(); target.destroy() }
  } finally { stroke.destroy(); path.destroy(); device.destroy(); display.destroy() }
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

function calloutOuterRect(textRect: Rect, point: Point, borderWidth: number, size?: number | null): Rect {
  const margin = Math.max(4, borderWidth * 4, arrowHeadSize(size, borderWidth) + borderWidth)
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
  size?: number | null,
): { outerRect: Rect; line: [Point, Point] } {
  const outerRect = calloutOuterRect(textRect, point, borderWidth, size)
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

function writeArrowSize(doc: PDFDocument, annotation: PDFAnnotation, size?: number | null): void {
  if (size != null && (!Number.isFinite(size) || size < 2 || size > 72)) throw new Error('矢印先端の大きさは2～72 ptで指定してください。')
  const object = annotation.getObject()
  try {
    if (size == null) object.delete('KaruArrowHeadSize')
    else setPdfNumber(doc, object, 'KaruArrowHeadSize', size)
  } finally { object.destroy() }
}

function configureArrowAppearance(doc: PDFDocument, page: PDFPage, annotation: PDFAnnotation, edit: Extract<AnnotationEdit, { kind: 'createLine' | 'updateLine' }>): void {
  writeArrowSize(doc, annotation, edit.arrowHeadSize)
  if (edit.lineEnding.end !== 'OpenArrow' || edit.lineEnding.start !== 'None') return
  const size = arrowHeadSize(edit.arrowHeadSize, edit.borderWidth), [start, end] = edit.line
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0])
  const left: Point = [end[0] - Math.cos(angle - Math.PI / 6) * size, end[1] - Math.sin(angle - Math.PI / 6) * size]
  const right: Point = [end[0] - Math.cos(angle + Math.PI / 6) * size, end[1] - Math.sin(angle + Math.PI / 6) * size]
  const margin = Math.max(1, edit.borderWidth), bounds = vertexBounds([start, end, left, right])
  const rect: Rect = [bounds[0] - margin, bounds[1] - margin, bounds[2] + margin, bounds[3] + margin]
  const object = annotation.getObject()
  try { setVisibleRect(doc, page, object, rect) } finally { object.destroy() }
  const display = new mupdf.DisplayList([0, 0, rect[2] - rect[0], rect[3] - rect[1]])
  const device = new mupdf.DisplayListDevice(display), path = new mupdf.Path()
  const stroke = new mupdf.StrokeState({ lineWidth: edit.borderWidth, lineCap: 'Butt', lineJoin: 'Miter', miterLimit: 10 })
  try {
    path.moveTo(start[0] - rect[0], start[1] - rect[1]); path.lineTo(end[0] - rect[0], end[1] - rect[1])
    path.moveTo(left[0] - rect[0], left[1] - rect[1]); path.lineTo(end[0] - rect[0], end[1] - rect[1]); path.lineTo(right[0] - rect[0], right[1] - rect[1])
    device.strokePath(path, stroke, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, edit.color, 1)
    device.close(); annotation.setAppearanceFromDisplayList(null, null, mupdf.Matrix.identity, display)
    const target = annotation.getObject(), ap = target.get('AP', 'N')
    try { orientVisibleAppearance(doc, page, rect, target, ap) } finally { ap.destroy(); target.destroy() }
  } finally { stroke.destroy(); path.destroy(); device.destroy(); display.destroy() }
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

function configureTextMarkup(
  annotation: PDFAnnotation,
  quads: Quad[],
  color: RGB,
  opacity: number,
  markedText: string,
): void {
  annotation.setFlags(annotation.getFlags() | 4)
  annotation.setQuadPoints(quads)
  annotation.setColor(color)
  annotation.setOpacity(opacity)
  annotation.setContents(markedText)
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
  countAppearance = false,
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

  if (countAppearance) return
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

function drawMeasurement(device: DisplayListDevice, text: InstanceType<typeof mupdf.Text>, task: AppearanceTask, font: FontResource, fallback?: FontResource): void {
  const measurement = task.measurement!
  const points = measurement.points
  const path = new mupdf.Path(), stroke = new mupdf.StrokeState({ lineWidth: task.borderWidth, lineJoin: 'Round', lineCap: 'Butt', miterLimit: 10, dashes: quantityDashes(measurement.dash, task.borderWidth) })
  try {
    path.moveTo(...points[0])
    for (const point of points.slice(1)) path.lineTo(...point)
    if (measurement.kind === 'area') {
      path.closePath()
      device.fillPath(path, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, task.color, .15)
    }
    if (measurement.kind === 'distance') {
      const angle = Math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0])
      const dx = -Math.sin(angle) * 5, dy = Math.cos(angle) * 5
      for (const p of points) { path.moveTo(p[0] - dx, p[1] - dy); path.lineTo(p[0] + dx, p[1] + dy) }
    }
    device.strokePath(path, stroke, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, task.color, 1)
  } finally { stroke.destroy(); path.destroy() }
  const { anchor, angle } = measureLabel(points, measurement.kind, task.fontSize)
  const encoded = [...task.text].map(c => encodeCharacter(font.font, c, fallback?.font))
  const width = encoded.reduce((sum, c) => sum + c.advance * task.fontSize, 0)
  const c = Math.cos(angle), s = Math.sin(angle)
  const rotate = (x: number, y: number): Point => [anchor[0] + c * x - s * y, anchor[1] + s * x + c * y]
  const background = new mupdf.Path()
  try {
    polygon(background, [rotate(-width / 2 - 2, -task.fontSize * .65), rotate(width / 2 + 2, -task.fontSize * .65), rotate(width / 2 + 2, task.fontSize * .65), rotate(-width / 2 - 2, task.fontSize * .65)])
    device.fillPath(background, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, [1, 1, 1], 1)
  } finally { background.destroy() }
  let x = -width / 2
  for (const char of encoded) {
    const p = rotate(x, task.fontSize * .3)
    text.showGlyph(char.font, [task.fontSize * c, task.fontSize * s, task.fontSize * s, -task.fontSize * c, p[0], p[1]], char.glyph, char.unicode)
    x += char.advance * task.fontSize
  }
  device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, task.color, 1)
}

function orientVisibleAppearance(doc: PDFDocument, page: PDFPage, rect: Rect, object: PDFObject, appearance: PDFObject): void {
  // AP is authored in visible-page coordinates. Convert its LOCAL PDF (y-up)
  // coordinates into the target page's raw PDF coordinates, including CropBox,
  // UserUnit and rotation. Absolute BBox prevents annotation fitting/rescaling.
  const inv = invertMatrix(page.getTransform())
  const origin = transformMeasurePoint([rect[0], rect[3]], inv)
  const transform = [inv[0], inv[1], -inv[2], -inv[3], origin[0], origin[1]]
  const stream = appearance.readStream(), bbox = object.get('Rect')
  try { appearance.writeStream(`q\n${transform.join(' ')} cm\n${stream.asString()}\nQ\n`); appearance.put('BBox', bbox); setPdfNumberArray(doc, appearance, 'Matrix', [1, 0, 0, 1, 0, 0]) }
  finally { bbox.destroy(); stream.destroy() }
}

function drawIssue(device: DisplayListDevice, text: InstanceType<typeof mupdf.Text>, task: AppearanceTask, font: FontResource): void {
  const size = Math.min(task.width, task.height), issue = task.issue!, color = issueColor(issue, task.color)
  const path = new mupdf.Path(), stroke = new mupdf.StrokeState({ lineWidth: size * .06, lineCap: 'Round', lineJoin: 'Round', miterLimit: 10 })
  try {
    ellipse(path, size * .05, size * .05, size * .95, size * .95)
    device.fillPath(path, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, [1, 1, 1], 1)
    device.strokePath(path, stroke, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, color, 1)
  } finally { stroke.destroy(); path.destroy() }
  const encoded = [...String(issue.number)].map(c => encodeCharacter(font.font, c))
  const fs = issueFontSize(issue.number, size), width = encoded.reduce((sum, c) => sum + c.advance * fs, 0)
  let x = (size - width) / 2
  for (const char of encoded) {
    text.showGlyph(char.font, [fs, 0, 0, -fs, x, size / 2 + fs * .3], char.glyph, char.unicode)
    x += char.advance * fs
  }
  device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, color, 1)
}

function drawCountMarker(device: DisplayListDevice, text: InstanceType<typeof mupdf.Text>, task: AppearanceTask, font: FontResource, fallback?: FontResource): void {
  const fixture = task.countFixture!, s = fixture.style, top = s.showCode && fixture.code ? s.size * .7 * 1.2 : 0
  const data = countMarkerData(s, s.size / 2 + 1, top + s.size / 2 + 1)
  const draw = (polygons: Point[][], fill: boolean, rgb: RGB, width: number, close = true) => {
    const path = new mupdf.Path(), stroke = new mupdf.StrokeState({ lineWidth: width, lineJoin: 'Round', lineCap: 'Butt', miterLimit: 10 })
    try {
      for (const points of polygons) { if (!points.length) continue; path.moveTo(...points[0]); for (const p of points.slice(1)) path.lineTo(...p); if (close) path.closePath() }
      if (fill) device.fillPath(path, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, rgb, 1)
      else device.strokePath(path, stroke, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, rgb, 1)
    } finally { path.destroy(); stroke.destroy() }
  }
  if (data.bright) draw(data.outline, false, [64 / 255, 64 / 255, 64 / 255], 1.8)
  draw(data.fills, true, s.color, .8); draw(data.outline, false, s.color, .8); draw(data.strokes, false, s.color, .8, false)
  if (s.showCode && fixture.code) {
    let x = data.code.x
    for (const char of [...fixture.code].map(c => encodeCharacter(font.font, c, fallback?.font))) {
      text.showGlyph(char.font, [data.code.size, 0, 0, -data.code.size, x, data.code.y], char.glyph, char.unicode)
      x += char.advance * data.code.size
    }
    device.fillText(text, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, data.bright ? [64 / 255, 64 / 255, 64 / 255] : s.color, 1)
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
    // Count/issue templates get their entire AP from the display list below.
    // No generated FreeText appearance (and therefore no update()) is needed.
    if (task.countFixture || task.issue) annotation.setRect([0, 0, task.width, task.height])
    else configureFreeText(
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
    if (task.measurement || task.issue || task.countFixture) {
      if (task.countFixture) drawCountMarker(device, text, task, fontResource, fallbackResource)
      else if (task.issue) drawIssue(device, text, task, fontResource)
      else drawMeasurement(device, text, task, fontResource, fallbackResource)
      device.close()
      annotation.setAppearanceFromDisplayList(null, null, mupdf.Matrix.identity, displayList)
      referenceAppearanceFromPage(temporaryDocument, page, annotation)
      return
    }
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
      const arrowSize = arrowHeadSize(task.arrowHeadSize, width)
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
  checkpoint?: () => void,
): void {
  if (tasks.length === 0) return
  const temporaryDocument = new mupdf.PDFDocument()
  let graftMap: ReturnType<PDFDocument['newGraftMap']> | undefined
  const stampTemplates = new Map<number, { resources: PDFObject; contents: string }>()
  try {
    const countTemplates = new Map<string, number>()
    for (const task of tasks) {
      // Round the size: e.g. 10 * .7 carries float noise that differs by position and would split templates.
      const key = task.countFixture ? JSON.stringify([task.countFixture.style, task.countFixture.code, Math.round(task.width * 1000) / 1000, Math.round(task.height * 1000) / 1000]) : null
      const cached = key ? countTemplates.get(key) : undefined
      if (cached !== undefined) { task.temporaryPageIndex = cached; continue }
      const fontResource = fontResources[task.fontName]
      if (!fontResource) throw new Error(`${task.fontName} が読み込まれていません。`)
      makeTemporaryAppearance(temporaryDocument, task, fontResource, fontResources.ZapfDingbats)
      if (key) countTemplates.set(key, task.temporaryPageIndex!)
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
        const dashes = task.measurement ? quantityDashes(task.measurement.dash, task.borderWidth) : []
        if (dashes.length) {
          // MuPDF 1.28.1 accepts StrokeState.dashes but returns a zero dash length.
          // Retain the shared measurement appearance and repair only its dash operator.
          const stream = sourceAppearance.readStream()
          try {
            const contents = stream.asString()
            if (!/\[\s*[\d.]+[\d.\s]*\]\s+[\d.]+\s+d\b/.test(contents)) sourceAppearance.writeStream(`[${dashes.join(' ')}] 0 d\n${contents.replace(/\[\s*\]\s+[\d.]+\s+d\b/g, '')}`)
          } finally { stream.destroy() }
        }
        if (task.countFixture || task.issue) {
          let template = stampTemplates.get(task.temporaryPageIndex!)
          if (!template) {
            const sourceResources = sourceAppearance.get('Resources'), stream = sourceAppearance.readStream()
            let resources: PDFObject | undefined
            try {
              resources = graftMap.graftObject(sourceResources)
              // One indirect Resources dictionary per template, including subset fonts.
              const contents = stream.asString()
              template = { resources: resources.isIndirect() ? resources : doc.addObject(resources), contents }
              if (resources.isIndirect()) resources = undefined // cache owns this handle
              stampTemplates.set(task.temporaryPageIndex!, template)
            } finally { resources?.destroy(); stream.destroy(); sourceResources.destroy() }
          }
          const targetObject = task.annotation.getObject(), bbox = targetObject.get('Rect')
          try {
            // Same local y-up -> raw PDF conversion as orientVisibleAppearance.
            // An absolute BBox and identity Matrix retain CropBox/UserUnit/rotation
            // placement without fitting or rescaling the authored appearance.
            const rect = task.visibleRect!, inv = invertMatrix(task.page.getTransform())
            const origin = transformMeasurePoint([rect[0], rect[3]], inv)
            const transform = [inv[0], inv[1], -inv[2], -inv[3], origin[0], origin[1]]
            task.annotation.setAppearance('N', null, mupdf.Matrix.identity, bbox.asJS() as Rect,
              template.resources, `q\n${transform.join(' ')} cm\n${template.contents}\nQ\n`)
          } finally { bbox.destroy(); targetObject.destroy() }
          continue
        }
        graftedAppearance = graftMap.graftObject(sourceAppearance)
        const targetObject = task.annotation.getObject()
        const appearanceDictionary = doc.newDictionary()
        try {
          // MuPDF は回転ページの FreeText に /Rotate と、回転前座標の
          // /Rect を設定する。標準 AP と同じ絶対 BBox と行列に直す。
          if (task.measurement || task.visibleRect) orientVisibleAppearance(doc, task.page, task.visibleRect ?? task.measurement!.rect, targetObject, graftedAppearance)
          else orientAppearanceForAnnotation(doc, targetObject, graftedAppearance)
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
        checkpoint?.()
      }
    }
  } finally {
    for (const template of stampTemplates.values()) template.resources.destroy()
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
  options: { checkpoint?: () => void } = {},
): ApplyResult {
  const result: ApplyResult = { created: [], replacedCharacters: 0, unsupportedCharacters: [], errors: [] }
  const unsupportedCharacters = new Set<string>()
  const appearances: AppearanceTask[] = []
  const pages = new Map<number, PDFPage>()
  const annotationIndexes = new Map<number, Map<number, PDFAnnotation>>()
  // Keep ownership separate from the index: deleted annotations still need releasing.
  const cachedAnnotations = new Set<PDFAnnotation>()

  function lookupAnnotation(pageIndex: number, objNum: number): PDFAnnotation | null {
    let index = annotationIndexes.get(pageIndex)
    if (!index) {
      const annotations = pages.get(pageIndex)!.getAnnotations()
      // Own all handles before reading object numbers, including on a lookup failure.
      for (const annotation of annotations) cachedAnnotations.add(annotation)
      index = new Map<number, PDFAnnotation>()
      for (const annotation of annotations) {
        const number = objectNumber(annotation)
        if (!index.has(number)) index.set(number, annotation)
      }
      annotationIndexes.set(pageIndex, index)
    }
    return index.get(objNum) ?? null
  }

  try {
  for (const [editIndex, edit] of edits.entries()) {
    let page: PDFPage | undefined
    let annotation: PDFAnnotation | null = null
    let keepForAppearance = false
    try {
      if (edit.kind === 'setCountFixtures') { writeCountFixtures(doc, edit.fixtures); continue }
      page = pages.get(edit.pageIndex)
      if (!page) {
        page = doc.loadPage(edit.pageIndex)
        pages.set(edit.pageIndex, page)
      }
      if (edit.kind === 'setPageScale') {
        writePageScale(doc, page, edit.scale)
        continue
      }
      if (edit.kind === 'createLegacyChange') {
        const source = new mupdf.PDFDocument(new Uint8Array(edit.data.pdf)), sourcePage = source.findPage(0)
        const annots = sourcePage.get('Annots'), original = annots.get(0), raw = original.get('KaruIssue')
        try {
          if (!raw.isString() || parseIssue(raw.asString())?.recordKind !== 'change') throw new Error('旧版変更記録の復元データが不正です。')
          annotation = page.createAnnotation('Stamp')
          // Clear the new stamp's pending default appearance before installing the saved AP.
          annotation.update()
          const grafted = doc.graftObject(original), target = annotation.getObject()
          try { grafted.forEach((value, key) => { if (key !== 'P') target.put(key, value) }) }
          finally { target.destroy(); grafted.destroy() }
          result.created.push(objectNumber(annotation))
        } finally { raw.destroy(); original.destroy(); annots.destroy(); sourcePage.destroy(); source.destroy() }
        continue
      }
      if (edit.kind === 'createCloud' || edit.kind === 'updateCloud') {
        const type = edit.shape === 'square' ? 'Square' : 'Polygon'
        annotation = edit.kind === 'createCloud' ? page.createAnnotation(type) : lookupAnnotation(edit.pageIndex, edit.objNum)
        if (!annotation || annotation.getType() !== type) throw new Error('雲の注釈が見つかりません。')
        configureCloud(doc, page, annotation, edit)
        if (edit.kind === 'createCloud') result.created.push(objectNumber(annotation))
        continue
      }
      if (edit.kind === 'createIssue' || edit.kind === 'updateIssue') {
        if (!parseIssue(JSON.stringify(edit.issue))) throw new Error('指摘の番号または状態が不正です。')
        const width = edit.rect[2] - edit.rect[0], height = edit.rect[3] - edit.rect[1]
        if (width <= 0 || height <= 0) throw new Error('指摘の大きさが不正です。')
        annotation = edit.kind === 'createIssue' ? page.createAnnotation('Stamp') : lookupAnnotation(edit.pageIndex, edit.objNum)
        if (!annotation || annotation.getType() !== 'Stamp') throw new Error('指摘の注釈が見つかりません。')
        annotation.setFlags(annotation.getFlags() | 4); annotation.setRect(edit.rect)
        annotation.setColor(edit.color); annotation.setOpacity(1); annotation.setContents(edit.text)
        const object = annotation.getObject()
        try {
          setVisibleRect(doc, page, object, edit.rect)
          setPdfString(doc, object, 'KaruIssue', JSON.stringify(edit.issue))
          if (edit.kind === 'createIssue') setPdfString(doc, object, 'NM', newAnnotationName())
          object.delete('T')
        } finally { object.destroy() }
        if (edit.kind === 'createIssue') result.created.push(objectNumber(annotation))
        appearances.push({ editIndex, page, annotation, width, height, text: String(edit.issue.number), fontSize: issueFontSize(edit.issue.number, width), color: edit.color,
          fontName: 'BIZUDGothic', textRect: [0, 0, width, height], backgroundColor: null, borderColor: null, borderWidth: 1, textOpacity: 1, boxOpacity: 1, calloutLine: null,
          issue: edit.issue, visibleRect: edit.rect })
        keepForAppearance = true
        continue
      }
      if (edit.kind === 'createMeasure' || edit.kind === 'updateMeasure') {
        const isNew = edit.kind === 'createMeasure'
        const type = edit.measure.kind === 'distance' ? 'Line' : edit.measure.kind === 'perimeter' ? 'PolyLine' : 'Polygon'
        if (edit.vertices.length < (type === 'Polygon' ? 3 : 2) || (type === 'Line' && edit.vertices.length !== 2)
          || edit.vertices.some(p => p.some(n => !Number.isFinite(n))) || !Number.isFinite(edit.measure.mmPerPoint) || edit.measure.mmPerPoint <= 0) throw new Error('計測の点または縮尺が不正です。')
        annotation = isNew ? page.createAnnotation(type) : lookupAnnotation(edit.pageIndex, 'objNum' in edit ? edit.objNum : -1)
        if (!annotation || annotation.getType() !== type) throw new Error('計測の注釈が見つかりません。')
        const rect = measureBounds(edit.vertices, edit.measure.kind, edit.text, edit.fontSize)
        annotation.setFlags(annotation.getFlags() | 4)
        if (type === 'Line') annotation.setLine(edit.vertices[0], edit.vertices[1])
        else annotation.setVertices(edit.vertices)
        annotation.setColor(edit.color)
        annotation.setBorderWidth(edit.borderWidth)
        annotation.setOpacity(edit.opacity)
        annotation.setContents(edit.text)
        annotation.update()
        const object = annotation.getObject(), measure = createMeasureDictionary(doc, edit.measure, pageUnitFactor(page))
        try {
          const inv = invertMatrix(page.getTransform())
          const a = transformMeasurePoint([rect[0], rect[1]], inv), b = transformMeasurePoint([rect[2], rect[3]], inv)
          // These subtypes reject setRect(); their actual PDF /Rect still bounds
          // the AP. Set it after update() has cleared MuPDF's regeneration flag.
          setPdfNumberArray(doc, object, 'Rect', [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])])
          setPdfName(doc, object, 'IT', type === 'Line' ? 'LineDimension' : type === 'PolyLine' ? 'PolyLineDimension' : 'PolygonDimension')
          object.put('Measure', measure)
          setPdfString(doc, object, 'KaruMeasure', JSON.stringify(edit.measure))
          setPdfNumber(doc, object, 'KaruMeasureFontSize', edit.fontSize)
          if (edit.quantity) {
            const mark = parseQuantityMark(JSON.stringify(edit.quantity))
            if (!mark || (quantityPoints(mark.method) === 'polygon' ? type !== 'Polygon' : type !== 'PolyLine')) throw new Error('数量拾いの値が不正です。')
            setPdfString(doc, object, 'KaruQuantity', JSON.stringify(mark))
            if (edit.quantityDash && edit.quantityDash !== 'solid') setPdfString(doc, object, 'KaruQuantityDash', edit.quantityDash)
            else object.delete('KaruQuantityDash')
          } else { object.delete('KaruQuantity'); object.delete('KaruQuantityDash') }
          if (isNew) setPdfString(doc, object, 'NM', newAnnotationName())
          object.delete('T')
        } finally { measure.destroy(); object.destroy() }
        // Never call update() after installing our AP: it would replace the
        // Japanese label with MuPDF's generated dimension appearance.
        if (isNew) result.created.push(objectNumber(annotation))
        appearances.push({ editIndex, page, annotation, width: rect[2] - rect[0], height: rect[3] - rect[1], text: edit.text, fontSize: edit.fontSize,
          color: edit.color, fontName: 'BIZUDGothic', textRect: [0, 0, rect[2] - rect[0], rect[3] - rect[1]], backgroundColor: null, borderColor: null,
          borderWidth: edit.borderWidth, textOpacity: 1, boxOpacity: 1, calloutLine: null,
          measurement: { dash: edit.quantityDash, points: edit.vertices.map(p => [p[0] - rect[0], p[1] - rect[1]]), kind: edit.measure.kind, rect, opacity: edit.opacity } })
        keepForAppearance = true
        continue
      }
      if (edit.kind === 'delete') {
        annotation = lookupAnnotation(edit.pageIndex, edit.objNum)
        if (!annotation) throw new Error(`注釈オブジェクト ${edit.objNum} が見つかりません。`)
        page.deleteAnnotation(annotation)
        annotationIndexes.get(edit.pageIndex)!.delete(edit.objNum)
        continue
      }

      if (edit.kind === 'createSquare' || edit.kind === 'updateSquare') {
        const isNew = edit.kind === 'createSquare'
        annotation = isNew
          ? page.createAnnotation('Square')
          : lookupAnnotation(edit.pageIndex, 'objNum' in edit ? edit.objNum : -1)
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
          : lookupAnnotation(edit.pageIndex, 'objNum' in edit ? edit.objNum : -1)
        if (!annotation) throw new Error(`注釈オブジェクト ${editObjectNumber(edit)} が見つかりません。`)
        if (!isNew && annotation.getType() !== 'Line') throw new Error('更新対象は Line ではありません。')
        configureLine(annotation, edit.line, edit.color, edit.borderWidth, edit.lineEnding, edit.opacity ?? 1)
        configureArrowAppearance(doc, page, annotation, edit)
        if (isNew) result.created.push(objectNumber(annotation))
        continue
      }

      if (edit.kind === 'createCircle' || edit.kind === 'updateCircle') {
        const isNew = edit.kind === 'createCircle'
        annotation = isNew
          ? page.createAnnotation('Circle')
          : lookupAnnotation(edit.pageIndex, 'objNum' in edit ? edit.objNum : -1)
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
          : lookupAnnotation(edit.pageIndex, 'objNum' in edit ? edit.objNum : -1)
        if (!annotation) throw new Error(`注釈オブジェクト ${editObjectNumber(edit)} が見つかりません。`)
        if (!isNew && annotation.getType() !== 'Ink') throw new Error('更新対象は Ink ではありません。')
        configureInk(doc, annotation, edit.inkList, edit.color, edit.borderWidth, edit.opacity, edit.inkKind ?? (edit.opacity < 1 ? 'highlight' : 'ink'))
        if (isNew) result.created.push(objectNumber(annotation))
        continue
      }

      if (edit.kind === 'createTextMarkup' || edit.kind === 'updateTextMarkup') {
        const isNew = edit.kind === 'createTextMarkup'
        annotation = isNew
          ? page.createAnnotation(edit.markup)
          : lookupAnnotation(edit.pageIndex, 'objNum' in edit ? edit.objNum : -1)
        if (!annotation) throw new Error(`注釈オブジェクト ${editObjectNumber(edit)} が見つかりません。`)
        if (!isNew && annotation.getType() !== edit.markup) throw new Error(`更新対象は ${edit.markup} ではありません。`)
        configureTextMarkup(annotation, edit.quads, edit.color, edit.opacity, edit.markedText)
        if (isNew) result.created.push(objectNumber(annotation))
        continue
      }

      if (edit.kind === 'createSymbol' || edit.kind === 'updateSymbol') {
        const isNew = edit.kind === 'createSymbol'
        annotation = isNew
          ? page.createAnnotation('Stamp')
          : lookupAnnotation(edit.pageIndex, 'objNum' in edit ? edit.objNum : -1)
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
        configureSymbol(doc, annotation, edit.rect, edit.color, edit.symbol, edit.opacity ?? 1, isNew, !!edit.countFixture)
        const countObject = annotation.getObject()
        try {
          if (edit.count) {
            if (!parseCount(JSON.stringify(edit.count))) throw new Error('数量拾いの種類が不正です。')
            setPdfString(doc, countObject, 'KaruCount', JSON.stringify(edit.count))
            annotation.setContents(`個数: ${edit.countFixture ? `${edit.countFixture.code} ${edit.countFixture.name}`.trim() : edit.count.version === 1 ? edit.count.group : edit.count.fixtureId}`)
          } else countObject.delete('KaruCount')
        } finally { countObject.destroy() }
        if (edit.count && edit.countFixture) {
          const f = edit.countFixture, s = f.style, fs = s.size * .7
          const top = s.showCode && f.code ? fs * 1.2 : 0, extra = s.showCode ? [...f.code].length * fs : 0
          const visibleRect: Rect = [edit.rect[0] - 1, edit.rect[1] - top - 1, edit.rect[0] + s.size + extra + 1, edit.rect[1] + s.size + 1]
          annotation.setRect(visibleRect); annotation.setColor(s.color); annotation.setOpacity(s.opacity)
          const obj = annotation.getObject()
          const inverse = invertMatrix(page.getTransform())
          const markerBounds = vertexBounds([transformMeasurePoint([edit.rect[0], edit.rect[1]], inverse), transformMeasurePoint([edit.rect[2], edit.rect[3]], inverse)])
          try { setVisibleRect(doc, page, obj, visibleRect); setPdfNumberArray(doc, obj, 'KaruCountRect', markerBounds) } finally { obj.destroy() }
          appearances.push({ editIndex, page, annotation, countFixture: f, visibleRect, width: visibleRect[2] - visibleRect[0], height: visibleRect[3] - visibleRect[1], text: f.code, fontSize: fs, color: s.color, fontName: 'BIZUDGothic', textRect: [0, 0, 0, 0], backgroundColor: null, borderColor: null, borderWidth: 0, textOpacity: 1, boxOpacity: 1, calloutLine: null })
          keepForAppearance = true
        }
        if (isNew) result.created.push(objectNumber(annotation))
        continue
      }

      const isCallout = edit.kind === 'createCallout' || edit.kind === 'updateCallout'
      const isNew = edit.kind === 'createFreeText' || edit.kind === 'createCallout'
      annotation = isNew
        ? page.createAnnotation('FreeText')
        : lookupAnnotation(edit.pageIndex, 'objNum' in edit ? edit.objNum : -1)
      if (!annotation) throw new Error(`注釈オブジェクト ${editObjectNumber(edit)} が見つかりません。`)
      if (!isNew && annotation.getType() !== 'FreeText') throw new Error('更新対象は FreeText ではありません。')
      const borderWidth = edit.borderWidth ?? 1
      const outerRect = isCallout ? calloutOuterRect(edit.rect, edit.point, borderWidth, edit.arrowHeadSize) : edit.rect
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
      if (isCallout) calloutLine = writeCalloutGeometry(doc, annotation, edit.rect, edit.point, borderWidth, edit.arrowHeadSize).line
      if (isCallout) writeArrowSize(doc, annotation, edit.arrowHeadSize)
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
        arrowHeadSize: isCallout ? edit.arrowHeadSize : null,
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
      if (annotation && !keepForAppearance && !cachedAnnotations.has(annotation)) {
        annotation.destroy()
      }
      options.checkpoint?.()
    }
  }

  try {
    installTemporaryAppearances(doc, appearances, fontResources, options.checkpoint)
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
  }

  result.unsupportedCharacters = [...unsupportedCharacters]
  return result
  } finally {
    // Appearance tasks borrow cached pages/annotations. Release each handle once,
    // after appearance installation, and always release annotations before pages.
    for (const task of appearances) cachedAnnotations.add(task.annotation)
    for (const annotation of cachedAnnotations) annotation.destroy()
    for (const page of pages.values()) page.destroy()
  }
}
