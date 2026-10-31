import type { PDFDocument, PDFObject } from 'mupdf'
import { readDrawingInfo, type DrawingInfo } from './drawingInfo'
import { readPageScale, readScaleRegions, type PageScale, type ScaleRegion } from './measure'
import type { PageSize } from './mupdfDoc'
import { readPageRoomSet, readRoomRegions, readRoomSets, type RoomRegion, type RoomSetLink } from './rooms'

// Match MuPDF 1.28.1 pdf_page_obj_transform_box for ordinary page rectangles.
// Other geometry uses MuPDF's loaded page, including its repair/default rules.
function basicPageSize(obj: PDFObject): PageSize | null {
  function box(key: string): number[] | null {
    const value = obj.getInheritable(key)
    try {
      if (!value.isArray() || value.length !== 4) return null
      const result: number[] = []
      for (let i = 0; i < 4; i++) {
        const number = value.get(i)
        try { if (!number.isNumber()) return null; result.push(number.asNumber()) } finally { number.destroy() }
      }
      return result.every(Number.isFinite) && result[2] > result[0] && result[3] > result[1] ? result : null
    } finally { value.destroy() }
  }
  const media = box('MediaBox'), cropObject = obj.getInheritable('CropBox')
  const rotationObject = obj.getInheritable('Rotate'), unitObject = obj.get('UserUnit')
  try {
    if (!media || !rotationObject.isNull() && !rotationObject.isNumber() || !unitObject.isNull() && !unitObject.isNumber()) return null
    const crop = cropObject.isNull() ? media : box('CropBox')
    const rotation = rotationObject.isNull() ? 0 : rotationObject.asNumber()
    const unit = unitObject.isNull() ? 1 : unitObject.asNumber()
    if (!crop || !Number.isFinite(rotation) || Math.abs(rotation) > 2147483647 || rotation % 90 !== 0 || !Number.isFinite(unit) || unit <= 0 || unit > 75000) return null
    const x0 = Math.max(media[0], crop[0]), y0 = Math.max(media[1], crop[1])
    const x1 = Math.min(media[2], crop[2]), y1 = Math.min(media[3], crop[3])
    if (x1 - x0 < 1 || y1 - y0 < 1) return null
    // MuPDF applies its transform in float32, including the translated origin.
    const width = Math.fround(Math.fround(x1 * unit) - Math.fround(x0 * unit))
    const height = Math.fround(Math.fround(y1 * unit) - Math.fround(y0 * unit))
    if (![width, height].every(n => Number.isFinite(n) && n > 0)) return null
    return rotation % 180 === 0 ? { width, height } : { width: height, height: width }
  } finally { unitObject.destroy(); rotationObject.destroy(); cropObject.destroy() }
}

function hasPageMetadata(obj: PDFObject, roomLinks: boolean): boolean {
  for (const key of ['KaruDrawing', 'VP', 'KaruRooms', ...(roomLinks ? ['KaruRoomSet'] : [])]) {
    const value = obj.get(key)
    try { if (!value.isNull()) return true } finally { value.destroy() }
  }
  return false
}

// Page dictionaries provide ordinary dimensions without constructing annotation
// appearances on every page. Pages with metadata or unusual geometry still use
// MuPDF, sharing one loaded page for all readers and preserving their semantics.
export function readDocumentMetadata(doc: PDFDocument) {
  const pageSizes: PageSize[] = []
  const pageDrawingInfos: (DrawingInfo | null)[] = []
  const pageScales: (PageScale | null)[] = []
  const pageScaleRegions: Array<[number, ScaleRegion[]]> = []
  const pageRoomRegions: Array<[number, RoomRegion[]]> = []
  const pageRoomSets: Array<[number, RoomSetLink]> = []
  const roomSets = readRoomSets(doc)
  const roomSetIds = new Set(roomSets.map(set => set.id))
  let sizesMs = 0
  const pageCount = doc.countPages()
  for (let index = 0; index < pageCount; index++) {
    const started = performance.now()
    const obj = doc.findPage(index)
    try {
      const size = !hasPageMetadata(obj, roomSetIds.size > 0) ? basicPageSize(obj) : null
      if (size) {
        pageSizes.push(size)
        pageDrawingInfos.push(null)
        pageScales.push(null)
        sizesMs += performance.now() - started
        continue
      }
    } finally { obj.destroy() }
    const page = doc.loadPage(index)
    try {
      const [x0, y0, x1, y1] = page.getBounds()
      pageSizes.push({ width: x1 - x0, height: y1 - y0 })
      sizesMs += performance.now() - started
      pageDrawingInfos.push(readDrawingInfo(page))
      pageScales.push(readPageScale(page))
      const scales = readScaleRegions(page)
      if (scales.length) pageScaleRegions.push([index, scales])
      const rooms = readRoomRegions(page)
      if (rooms.length) pageRoomRegions.push([index, rooms])
      if (roomSetIds.size) {
        const link = readPageRoomSet(page)
        if (link && roomSetIds.has(link.id)) pageRoomSets.push([index, link])
      }
    } finally { page.destroy() }
  }
  return { pageSizes, pageDrawingInfos, pageScales, pageScaleRegions, pageRoomRegions, roomSets, pageRoomSets, sizesMs }
}
