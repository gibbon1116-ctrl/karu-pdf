import { describe, expect, it } from 'vitest'
import type { Point, Rect } from '../src/core/annotations'
import { sampleBoxForMatch, unionRect } from '../src/core/symbolSampleBox'

describe('symbol sample box', () => {
  const body: Rect = [10, 10, 20, 20], sampleBox: Rect = [8, 8, 30, 22]
  const center: Point = [115, 215]

  it('translates the sample box for a zero-degree match', () => {
    expect(sampleBoxForMatch(sampleBox, body, { center, angle: 0 })).toEqual([108, 208, 130, 222])
  })

  it.each([.5, 359.5, 360])('only translates for a nearly zero-degree match at %s degrees', angle => {
    expect(sampleBoxForMatch(sampleBox, body, { center, angle })).toEqual([108, 208, 130, 222])
  })

  it('unites the translated and rotated boxes for a 90-degree match', () => {
    // Offsets [-7, 15] x [-7, 7] rotate to [-7, 7] x [-7, 15].
    // Rotated [108, 208, 122, 230] unites with translated [108, 208, 130, 222].
    const result = sampleBoxForMatch(sampleBox, body, { center, angle: 90 })
    const expected = [108, 208, 130, 230]
    expected.forEach((value, i) => expect(result[i]).toBeCloseTo(value, 10))
  })

  it('unites the translated and rotated boxes for a 180-degree match', () => {
    // Offsets rotate to [-15, 7] x [-7, 7], giving [100, 208, 122, 222].
    const result = sampleBoxForMatch(sampleBox, body, { center, angle: 180 })
    const expected = [100, 208, 130, 222]
    expected.forEach((value, i) => expect(result[i]).toBeCloseTo(value, 10))
  })

  it('returns new arrays without changing the sample box, body or match center', () => {
    for (const angle of [0, 90, 180]) {
      const result = sampleBoxForMatch(sampleBox, body, { center, angle })
      expect(result).not.toBe(sampleBox)
      result[0] = -999
      expect(sampleBox).toEqual([8, 8, 30, 22])
      expect(body).toEqual([10, 10, 20, 20])
      expect(center).toEqual([115, 215])
    }
  })

  it('unites rectangles without changing or reusing either input', () => {
    const result = unionRect(sampleBox, body)
    expect(result).toEqual([8, 8, 30, 22])
    expect(result).not.toBe(sampleBox)
    expect(result).not.toBe(body)
    result[0] = -999
    expect(sampleBox).toEqual([8, 8, 30, 22])
    expect(body).toEqual([10, 10, 20, 20])
    expect(unionRect([8, 12, 18, 22], body)).toEqual([8, 10, 20, 22])
  })
})
