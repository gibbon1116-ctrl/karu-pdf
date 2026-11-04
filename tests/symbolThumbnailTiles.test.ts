import { describe, expect, it } from 'vitest'
import type { Rect } from '../src/core/annotations'
import {
  planThumbnailTile,
  THUMBNAIL_TILE_MAX_ITEMS,
  THUMBNAIL_TILE_MAX_PIXELS,
  THUMBNAIL_TILE_MAX_SIDE,
  type ThumbnailRequest,
} from '../src/core/symbolThumbnailTiles'

describe('symbol thumbnail tiles', () => {
  it('uses the first request scale and rounded device rectangle for a single thumbnail', () => {
    const first: ThumbnailRequest = { id: 'first', rect: [.25, .5, 10.25, 5.5] }
    const tile = planThumbnailTile(first, [], 96)

    expect(tile.renderScale).toBe(96 / 10)
    expect(tile.deviceRect).toEqual([2, 4, 99, 53])
    expect(tile.items).toEqual([{ id: 'first', sx: 0, sy: 0, width: 97, height: 49 }])
  })

  it('adds nearby requests in distance order, preserves ties and offsets crops inside the tile', () => {
    const first: ThumbnailRequest = { id: 'first', rect: [0, 0, 12, 6] }
    const others: ThumbnailRequest[] = [
      { id: 'right', rect: [12, 0, 24, 6] },
      { id: 'left', rect: [-12, 0, 0, 6] },
      { id: 'near', rect: [3, 1, 15, 7] },
    ]
    const tile = planThumbnailTile(first, others, 96)

    expect(tile.renderScale).toBe(8)
    expect(tile.deviceRect).toEqual([-96, 0, 192, 56])
    expect(tile.items).toEqual([
      { id: 'first', sx: 96, sy: 0, width: 96, height: 48 },
      { id: 'near', sx: 120, sy: 8, width: 96, height: 48 },
      { id: 'right', sx: 192, sy: 0, width: 96, height: 48 },
      { id: 'left', sx: 0, sy: 0, width: 96, height: 48 },
    ])
  })

  it('skips a request exceeding the area limit and still adds a farther small request', () => {
    const first: ThumbnailRequest = { id: 'first', rect: [0, 0, 10, 10] }
    const others: ThumbnailRequest[] = [
      { id: 'small', rect: [350, 0, 351, 1] },
      { id: 'too-much-area', rect: [220, 220, 230, 230] },
    ]
    // The rejected union is 2208 x 2208: each side fits, but its area does not.
    expect(2208).toBeLessThan(THUMBNAIL_TILE_MAX_SIDE)
    expect(2208 * 2208).toBeGreaterThan(THUMBNAIL_TILE_MAX_PIXELS)
    const tile = planThumbnailTile(first, others, 96)

    expect(tile.deviceRect).toEqual([0, 0, 3370, 96])
    expect(tile.items).toEqual([
      { id: 'first', sx: 0, sy: 0, width: 96, height: 96 },
      { id: 'small', sx: 3360, sy: 0, width: 10, height: 10 },
    ])
  })

  it.each([
    { rect: [430, 0, 440, 10] as Rect },
    { rect: [0, 430, 10, 440] as Rect },
  ])('enforces the side limit for $rect', ({ rect }) => {
    const tile = planThumbnailTile({ id: 'first', rect: [0, 0, 10, 10] }, [{ id: 'far', rect }], 96)

    expect(tile.items.map(item => item.id)).toEqual(['first'])
    expect(tile.deviceRect).toEqual([0, 0, 96, 96])
  })

  it('allows a 1.5 times longer side but excludes any larger request', () => {
    const tile = planThumbnailTile({ id: 'first', rect: [0, 0, 10, 10] }, [
      { id: 'too-large', rect: [0, 0, 15.01, 10] },
      { id: 'at-limit', rect: [0, 0, 10, 15] },
    ], 96)

    expect(tile.items.map(item => item.id)).toEqual(['first', 'at-limit'])
    expect(tile.deviceRect).toEqual([0, 0, 96, 144])
  })

  it('stops at 64 items including the first request', () => {
    const first: ThumbnailRequest = { id: 'first', rect: [0, 0, 10, 10] }
    const others = Array.from({ length: 80 }, (_, index): ThumbnailRequest => ({
      id: `other-${index}`, rect: [0, 0, 10, 10],
    }))
    const tile = planThumbnailTile(first, others, 96)

    expect(THUMBNAIL_TILE_MAX_ITEMS).toBe(64)
    expect(tile.items.map(item => item.id)).toEqual(['first', ...others.slice(0, 63).map(item => item.id)])
  })

  it('rounds maxPx and caps the thumbnail scale at 512 pixels', () => {
    const first: ThumbnailRequest = { id: 'first', rect: [0, 0, 10, 5] }

    expect(planThumbnailTile(first, [], 95.6).renderScale).toBe(96 / 10)
    expect(planThumbnailTile(first, [], 1000).renderScale).toBe(512 / 10)
  })

  it('does not modify requests, their rectangles or the order of others', () => {
    const first: ThumbnailRequest = { id: 'first', rect: [0, 0, 10, 10] }
    const others: ThumbnailRequest[] = [
      { id: 'far', rect: [20, 20, 30, 30] },
      { id: 'near', rect: [-1, -1, 9, 9] },
    ]
    const before = JSON.stringify({ first, others })
    for (const request of [first, ...others]) {
      Object.freeze(request.rect)
      Object.freeze(request)
    }
    Object.freeze(others)
    const tile = planThumbnailTile(first, others, 96)

    expect(JSON.stringify({ first, others })).toBe(before)
    expect(tile.deviceRect).not.toBe(first.rect)
    tile.deviceRect[0] = -999
    expect(JSON.stringify({ first, others })).toBe(before)
  })
})
