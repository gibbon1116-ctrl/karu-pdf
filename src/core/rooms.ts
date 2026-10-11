import type { PDFDocument, PDFPage } from 'mupdf'
import type { Point, Rect } from './annotations'
import type { MeasureKind } from './measure'
import { quantityPoints, type QuantityMark } from './quantity'
import { normalizeFloor } from './location'

export interface RoomSet {
  id: string
  name: string
  floor?: string
  anchor?: Point
  regions: RoomRegion[]
}

export interface RoomSetLink {
  id: string
  dx?: number
  dy?: number
}

export function parseRoomSetLink(raw: unknown): RoomSetLink | undefined {
  let value = raw
  if (typeof value === 'string') {
    if (!value.length || value.trim() !== value) return
    if (value.startsWith('{') || value.startsWith('[')) {
      try { value = JSON.parse(value) } catch { return }
    } else {
      return { id: value }
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'string'
    || !candidate.id.length || candidate.id.trim() !== candidate.id) return
  for (const key of ['dx', 'dy'] as const) {
    const offset = candidate[key]
    if (offset !== undefined && (typeof offset !== 'number'
      || !Number.isFinite(offset) || Math.abs(offset) > 100_000)) return
  }
  const dx = typeof candidate.dx === 'number' ? candidate.dx : 0
  const dy = typeof candidate.dy === 'number' ? candidate.dy : 0
  return {
    id: candidate.id,
    ...(dx !== 0 ? { dx } : {}),
    ...(dy !== 0 ? { dy } : {}),
  }
}

export function translateRoomRegion(
  region: RoomRegion,
  dx = 0,
  dy = 0,
): RoomRegion {
  if (dx === 0 && dy === 0) return region
  return {
    ...region,
    points: region.points.map(point => [point[0] + dx, point[1] + dy] as Point),
  }
}

export interface RoomRegion {
  id: string
  name: string
  floor?: string
  points: Point[]
}

const MAX_ROOM_REGIONS = 200
const MAX_ROOM_POINTS = 500
const MAX_LOCATION_LENGTH = 40
const MAX_ROOM_SETS = 100

function parseRegion(raw: unknown): RoomRegion | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
  const value = raw as Record<string, unknown>
  if (typeof value.id !== 'string') return
  if (typeof value.name !== 'string'
    || !value.name.length
    || value.name.length > MAX_LOCATION_LENGTH
    || value.name.trim() !== value.name
    || /[\r\n\u0085\u2028\u2029]/u.test(value.name)) return
  if (value.floor !== undefined
    && (typeof value.floor !== 'string'
      || value.floor.length > MAX_LOCATION_LENGTH)) return
  if (!Array.isArray(value.points)
    || value.points.length < 3
    || value.points.length > MAX_ROOM_POINTS) return

  const points: Point[] = []
  for (const point of value.points) {
    if (!Array.isArray(point)
      || point.length !== 2
      || typeof point[0] !== 'number'
      || typeof point[1] !== 'number'
      || !Number.isFinite(point[0])
      || !Number.isFinite(point[1])) return
    points.push([point[0], point[1]])
  }
  return {
    id: value.id,
    name: value.name,
    ...(typeof value.floor === 'string' && value.floor.length
      ? { floor: value.floor } : {}),
    points,
  }
}

export function parseRoomRegions(raw: unknown): RoomRegion[] {
  let value = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value)) return []

  const regions: RoomRegion[] = []
  for (const item of value) {
    const region = parseRegion(item)
    if (!region) continue
    regions.push(region)
    if (regions.length === MAX_ROOM_REGIONS) break
  }
  return regions
}

export function serializeRoomRegions(regions: readonly RoomRegion[]): string {
  return JSON.stringify(parseRoomRegions(regions))
}

export function readRoomRegions(page: PDFPage): RoomRegion[] {
  const obj = page.getObject()
  try {
    const value = obj.get('KaruRooms')
    try {
      return value.isString() ? parseRoomRegions(value.asString()) : []
    } finally { value.destroy() }
  } finally { obj.destroy() }
}

export function writeRoomRegions(
  doc: PDFDocument,
  page: PDFPage,
  regions: readonly RoomRegion[],
): void {
  const valid = parseRoomRegions(regions)
  const obj = page.getObject()
  try {
    if (!valid.length) {
      obj.delete('KaruRooms')
      return
    }
    const value = doc.newString(JSON.stringify(valid))
    try { obj.put('KaruRooms', value) } finally { value.destroy() }
  } finally { obj.destroy() }
}

export function parseRoomSets(raw: unknown): RoomSet[] {
  let value = raw
  if (typeof value === 'string') {
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const envelope = value as Record<string, unknown>
  if (envelope.version !== 1 || !Array.isArray(envelope.sets)) return []

  const sets: RoomSet[] = []
  const setIds = new Set<string>()
  const regionIds = new Set<string>()
  for (const item of envelope.sets) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const candidate = item as Record<string, unknown>
    if (typeof candidate.id !== 'string' || !candidate.id.length
      || candidate.id.trim() !== candidate.id || setIds.has(candidate.id)) continue
    if (typeof candidate.name !== 'string'
      || !candidate.name.length
      || candidate.name.length > MAX_LOCATION_LENGTH
      || candidate.name.trim() !== candidate.name
      || /[\r\n\u0085\u2028\u2029]/u.test(candidate.name)) continue
    if (candidate.floor !== undefined
      && (typeof candidate.floor !== 'string'
        || candidate.floor.length > MAX_LOCATION_LENGTH)) continue
    if (!Array.isArray(candidate.regions)) continue
    const floor = typeof candidate.floor === 'string'
      ? normalizeFloor(candidate.floor) : ''
    if (floor.length > MAX_LOCATION_LENGTH) continue

    const regions: RoomRegion[] = []
    for (const rawRegion of candidate.regions) {
      const region = parseRegion(rawRegion)
      if (!region || !region.id.length || regionIds.has(region.id)) continue
      regionIds.add(region.id)
      regions.push(region)
      if (regions.length === MAX_ROOM_REGIONS) break
    }
    const rawAnchor = candidate.anchor
    const anchor: Point | undefined = Array.isArray(rawAnchor)
      && rawAnchor.length === 2
      && typeof rawAnchor[0] === 'number' && Number.isFinite(rawAnchor[0])
      && typeof rawAnchor[1] === 'number' && Number.isFinite(rawAnchor[1])
      ? [rawAnchor[0], rawAnchor[1]] : undefined
    setIds.add(candidate.id)
    sets.push({
      id: candidate.id,
      name: candidate.name,
      ...(floor ? { floor } : {}),
      ...(anchor ? { anchor } : {}),
      regions,
    })
    if (sets.length === MAX_ROOM_SETS) break
  }
  return sets
}

export function readRoomSets(doc: PDFDocument): RoomSet[] {
  const trailer = doc.getTrailer()
  const root = trailer.get('Root')
  try {
    const value = root.get('KaruRoomSets')
    try {
      return value.isString() ? parseRoomSets(value.asString()) : []
    } finally { value.destroy() }
  } finally { root.destroy(); trailer.destroy() }
}

export function writeRoomSets(doc: PDFDocument, sets: readonly RoomSet[]): void {
  const valid = parseRoomSets({ version: 1, sets })
  const trailer = doc.getTrailer()
  const root = trailer.get('Root')
  try {
    if (!valid.length) {
      root.delete('KaruRoomSets')
      return
    }
    const value = doc.newString(JSON.stringify({ version: 1, sets: valid }))
    try { root.put('KaruRoomSets', value) } finally { value.destroy() }
  } finally { root.destroy(); trailer.destroy() }
}

export function readPageRoomSet(page: PDFPage): RoomSetLink | undefined {
  const obj = page.getObject()
  try {
    const value = obj.get('KaruRoomSet')
    try {
      return value.isString() ? parseRoomSetLink(value.asString()) : undefined
    } finally { value.destroy() }
  } finally { obj.destroy() }
}

export function writePageRoomSet(
  doc: PDFDocument,
  page: PDFPage,
  setId: string | null,
  dx?: number,
  dy?: number,
): void {
  const link = setId === null ? undefined : parseRoomSetLink({ id: setId, dx, dy })
  if (setId !== null && !link) {
    throw new Error('部屋の組の結び付けが不正です。')
  }
  const obj = page.getObject()
  try {
    if (setId === null) {
      obj.delete('KaruRoomSet')
      return
    }
    const value = doc.newString(link!.dx || link!.dy ? JSON.stringify(link) : link!.id)
    try { obj.put('KaruRoomSet', value) } finally { value.destroy() }
  } finally { obj.destroy() }
}

export function readDocumentPageRoomSets(
  doc: PDFDocument,
  sets: readonly RoomSet[] = readRoomSets(doc),
): Array<[number, RoomSetLink]> {
  const validIds = new Set(sets.map(set => set.id))
  if (!validIds.size) return []
  const entries: Array<[number, RoomSetLink]> = []
  for (let pageIndex = 0; pageIndex < doc.countPages(); pageIndex++) {
    const page = doc.loadPage(pageIndex)
    try {
      const link = readPageRoomSet(page)
      if (link && validIds.has(link.id)) entries.push([pageIndex, link])
    } finally { page.destroy() }
  }
  return entries
}

export function readDocumentRoomRegions(
  doc: PDFDocument,
  pageRoomSets?: Array<[number, RoomSetLink]>,
  sets: readonly RoomSet[] = [],
): Array<[number, RoomRegion[]]> {
  const entries: Array<[number, RoomRegion[]]> = []
  const validIds = pageRoomSets ? new Set(sets.map(set => set.id)) : undefined
  for (let pageIndex = 0; pageIndex < doc.countPages(); pageIndex++) {
    const page = doc.loadPage(pageIndex)
    try {
      const regions = readRoomRegions(page)
      if (regions.length) entries.push([pageIndex, regions])
      if (validIds?.size) {
        const link = readPageRoomSet(page)
        if (link && validIds.has(link.id)) pageRoomSets!.push([pageIndex, link])
      }
    } finally { page.destroy() }
  }
  return entries
}

export function readDocumentRoomMetadata(doc: PDFDocument): {
  pageRoomRegions: Array<[number, RoomRegion[]]>
  roomSets: RoomSet[]
  pageRoomSets: Array<[number, RoomSetLink]>
} {
  const roomSets = readRoomSets(doc)
  const pageRoomSets: Array<[number, RoomSetLink]> = []
  const pageRoomRegions = readDocumentRoomRegions(doc, pageRoomSets, roomSets)
  return { pageRoomRegions, roomSets, pageRoomSets }
}

// Translate coordinates before calculating area and centroid to reduce
// cancellation when a small polygon is far from the page origin.
function polygonMoments(points: readonly Point[]): {
  twiceArea: number
  xMoment: number
  yMoment: number
} {
  const origin = points[0]
  if (!origin) return { twiceArea: 0, xMoment: 0, yMoment: 0 }
  let twiceArea = 0, xMoment = 0, yMoment = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    const ax = a[0] - origin[0], ay = a[1] - origin[1]
    const bx = b[0] - origin[0], by = b[1] - origin[1]
    const cross = ax * by - bx * ay
    twiceArea += cross
    xMoment += (ax + bx) * cross
    yMoment += (ay + by) * cross
  }
  return { twiceArea, xMoment, yMoment }
}

export function polygonCentroid(points: readonly Point[]): Point | undefined {
  if (!points.length) return
  const { twiceArea, xMoment, yMoment } = polygonMoments(points)
  if (twiceArea !== 0) {
    const x = points[0][0] + xMoment / (3 * twiceArea)
    const y = points[0][1] + yMoment / (3 * twiceArea)
    if (Number.isFinite(x) && Number.isFinite(y)) return [x, y]
  }
  // A zero-area polygon uses the arithmetic mean of its vertices.
  let x = 0, y = 0
  for (const point of points) {
    x += point[0] / points.length
    y += point[1] / points.length
  }
  return [x, y]
}

function onSegment(point: Point, a: Point, b: Point): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const px = point[0] - a[0], py = point[1] - a[1]
  const length = Math.hypot(dx, dy)
  const tolerance = Number.EPSILON * 16 * Math.max(
    1,
    Math.abs(point[0]), Math.abs(point[1]),
    Math.abs(a[0]), Math.abs(a[1]),
    Math.abs(b[0]), Math.abs(b[1]),
  )
  if (!length) return Math.hypot(px, py) <= tolerance
  if (Math.abs(dx * py - dy * px) > tolerance * length) return false
  return point[0] >= Math.min(a[0], b[0]) - tolerance
    && point[0] <= Math.max(a[0], b[0]) + tolerance
    && point[1] >= Math.min(a[1], b[1]) - tolerance
    && point[1] <= Math.max(a[1], b[1]) + tolerance
}

export function pointInRoomRegion(region: RoomRegion, point: Point): boolean {
  if (region.points.length < 3 || !point.every(Number.isFinite)) return false
  let inside = false
  for (let i = 0, j = region.points.length - 1; i < region.points.length; j = i++) {
    const a = region.points[j], b = region.points[i]
    if (onSegment(point, a, b)) return true
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) {
      inside = !inside
    }
  }
  return inside
}

export function roomAt(
  regions: readonly RoomRegion[],
  point: Point,
): RoomRegion | undefined {
  let selected: RoomRegion | undefined
  let selectedArea = Infinity
  for (const region of regions) {
    if (!pointInRoomRegion(region, point)) continue
    const area = Math.abs(polygonMoments(region.points).twiceArea) / 2
    if (!selected || area < selectedArea) {
      selected = region
      selectedArea = area
    }
  }
  return selected
}

export interface PickupGeometry {
  count?: unknown
  rect?: Rect
  quantity?: Pick<QuantityMark, 'method'> | null
  measure?: { kind: MeasureKind } | null
  vertices?: readonly Point[] | null
}

export function pickupPoint(annotation: PickupGeometry): Point | undefined {
  if (annotation.count != null) {
    const rect = annotation.rect
    return rect
      ? [rect[0] / 2 + rect[2] / 2, rect[1] / 2 + rect[3] / 2]
      : undefined
  }
  const points = annotation.vertices
  if (!points?.length) return
  if (annotation.quantity) {
    return quantityPoints(annotation.quantity.method) === 'polygon'
      ? polygonCentroid(points)
      : [...points[0]] as Point
  }
  if (annotation.measure) {
    return annotation.measure.kind === 'area'
      ? polygonCentroid(points)
      : [...points[0]] as Point
  }
  return
}
