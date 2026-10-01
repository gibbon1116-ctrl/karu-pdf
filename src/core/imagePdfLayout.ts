import { orientedSize, type ExifOrientation } from './exif'

export interface ImageDimensions { width: number; height: number; orientation?: ExifOrientation }
export interface ImagePdfSettings {
  paper: 'a4' | 'a3' | 'b5' | 'b4' | 'image'
  orientation: 'auto' | 'portrait' | 'landscape'
  margin: 0 | 5 | 10 | 15
  perPage: 1 | 2 | 4
  quality: 'original' | 'standard' | 'small'
}
export const DEFAULT_IMAGE_PDF_SETTINGS: ImagePdfSettings = { paper: 'a4', orientation: 'auto', margin: 10, perPage: 1, quality: 'standard' }
export const MM = 72 / 25.4
export interface ImagePlacement { index: number; x: number; y: number; width: number; height: number }
export interface ImagesPageLayout { width: number; height: number; placements: ImagePlacement[] }

export function layoutImages(images: readonly ImageDimensions[], settings: ImagePdfSettings): ImagesPageLayout[] {
  const sizes = { a4: [210, 297], a3: [297, 420], b5: [182, 257], b4: [257, 364] }
  if (settings.paper === 'image' && settings.perPage !== 1) throw new Error('画像の大きさは1ページに1枚のときだけ選べます。')
  return Array.from({ length: Math.ceil(images.length / settings.perPage) }, (_, page) => {
    const start = page * settings.perPage, group = images.slice(start, start + settings.perPage)
    const first = orientedSize(group[0].width, group[0].height, group[0].orientation)
    let width: number, height: number
    if (settings.paper === 'image') { width = first.width * 72 / 150; height = first.height * 72 / 150 }
    else {
      ;[width, height] = sizes[settings.paper].map(n => n * MM)
      if (settings.orientation === 'landscape' || settings.orientation === 'auto' && settings.perPage === 1 && first.width > first.height) [width, height] = [height, width]
    }
    const margin = settings.paper === 'image' ? 0 : settings.margin * MM
    const columns = settings.perPage === 4 ? 2 : 1, rows = settings.perPage === 1 ? 1 : 2, gap = 5 * MM
    const cellWidth = (width - 2 * margin - (columns - 1) * gap) / columns
    const cellHeight = (height - 2 * margin - (rows - 1) * gap) / rows
    const placements = group.map((image, i) => {
      const size = orientedSize(image.width, image.height, image.orientation)
      if (size.width <= 0 || size.height <= 0) throw new Error('画像の大きさが不正です。')
      const scale = Math.min(cellWidth / size.width, cellHeight / size.height)
      const w = size.width * scale, h = size.height * scale
      return { index: start + i, x: margin + (i % columns) * (cellWidth + gap) + (cellWidth - w) / 2,
        y: margin + Math.floor(i / columns) * (cellHeight + gap) + (cellHeight - h) / 2, width: w, height: h }
    })
    return { width, height, placements }
  })
}

// EXIF acts on the raw JPEG. Coordinates here are PDF's bottom-left unit square.
export function imagePlacementMatrix(paperHeight: number, place: Omit<ImagePlacement, 'index'>, orientation: ExifOrientation = 1): number[] {
  const transforms = [
    [1, 0, 0, 1, 0, 0], [-1, 0, 0, 1, 1, 0], [-1, 0, 0, -1, 1, 1], [1, 0, 0, -1, 0, 1],
    [0, -1, -1, 0, 1, 1], [0, -1, 1, 0, 0, 1], [0, 1, 1, 0, 0, 0], [0, 1, -1, 0, 1, 0],
  ]
  const [a, b, c, d, e, f] = transforms[orientation - 1]
  return [place.width * a, place.height * b, place.width * c, place.height * d,
    place.x + place.width * e, paperHeight - place.y - place.height + place.height * f]
}
