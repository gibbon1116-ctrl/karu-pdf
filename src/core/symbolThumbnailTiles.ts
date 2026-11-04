import type { Rect } from './annotations'

export interface ThumbnailRequest { id: string; rect: Rect }
export interface ThumbnailTileItem { id: string; sx: number; sy: number; width: number; height: number }
export interface ThumbnailTile { renderScale: number; deviceRect: Rect; items: ThumbnailTileItem[] }

export const THUMBNAIL_TILE_MAX_SIDE = 4096
export const THUMBNAIL_TILE_MAX_PIXELS = 2048 * 2048
export const THUMBNAIL_TILE_MAX_ITEMS = 64

export function planThumbnailTile(first: ThumbnailRequest, others: readonly ThumbnailRequest[], maxPx: number): ThumbnailTile {
  const longest = Math.max(first.rect[2] - first.rect[0], first.rect[3] - first.rect[1])
  const renderScale = Math.min(512, Math.round(maxPx)) / longest
  const device = (rect: Rect): Rect => [
    Math.floor(rect[0] * renderScale), Math.floor(rect[1] * renderScale),
    Math.ceil(rect[2] * renderScale), Math.ceil(rect[3] * renderScale),
  ]
  const centerX = (first.rect[0] + first.rect[2]) / 2
  const centerY = (first.rect[1] + first.rect[3]) / 2
  const distance = (rect: Rect) => ((rect[0] + rect[2]) / 2 - centerX) ** 2
    + ((rect[1] + rect[3]) / 2 - centerY) ** 2
  const fits = (rect: Rect) => {
    const width = rect[2] - rect[0], height = rect[3] - rect[1]
    return width <= THUMBNAIL_TILE_MAX_SIDE && height <= THUMBNAIL_TILE_MAX_SIDE
      && width * height <= THUMBNAIL_TILE_MAX_PIXELS
  }
  let deviceRect = device(first.rect)
  const selected = [{ id: first.id, rect: deviceRect }]
  if (fits(deviceRect)) {
    const sorted = others.map((request, index) => ({ request, index, distance: distance(request.rect) }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index)
    for (const { request } of sorted) {
      if (selected.length >= THUMBNAIL_TILE_MAX_ITEMS) break
      if (Math.max(request.rect[2] - request.rect[0], request.rect[3] - request.rect[1]) > longest * 1.5) continue
      const rect = device(request.rect)
      const union: Rect = [
        Math.min(deviceRect[0], rect[0]), Math.min(deviceRect[1], rect[1]),
        Math.max(deviceRect[2], rect[2]), Math.max(deviceRect[3], rect[3]),
      ]
      if (!fits(union)) continue
      selected.push({ id: request.id, rect })
      deviceRect = union
    }
  }
  const items = selected.map(({ id, rect }) => ({
    id, sx: rect[0] - deviceRect[0], sy: rect[1] - deviceRect[1],
    width: Math.max(1, rect[2] - rect[0]), height: Math.max(1, rect[3] - rect[1]),
  }))
  return { renderScale, deviceRect, items }
}
