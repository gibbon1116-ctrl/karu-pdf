import { describe, expect, it } from 'vitest'
import type { Rect } from '../src/core/annotations'
import { prepareVectorTemplate } from '../src/core/vectorSymbolSearch'
import { circleLines } from './symbolLabelFixtures'

const circle = circleLines(12,12,4)
const body = [...circle,11,8.1,11,15.9,13,8.1,13,15.9]
const prepare = (lines: number[], rect: Rect = [0,0,18,18]) =>
  prepareVectorTemplate(new Float32Array(lines), new Float32Array(lines.length / 4).fill(.42), rect)

describe('SPEC-08b bent wiring cleanup', () => {
  it('removes three segments through two right-angle bends up to a circle interior contact', () => {
    const x = (circle[60] + circle[62]) / 2, y = (circle[61] + circle[63]) / 2
    const result = prepare([...body,-3,5,0,5,0,5,3,5,3,5,3,y,3,y,x,y])
    expect(result.segments).toEqual(new Float32Array(body))
    expect(result.removed.wiring).toBe(3)
  })
  it('removes a path that ends freely inside the rectangle', () => {
    const result = prepare([...body,0,3,2,3,2,3,2,6,2,6,5,6])
    expect(result.segments).toEqual(new Float32Array(body))
    expect(result.removed.wiring).toBe(3)
  })
  it('also removes a wholly interior pendant path terminating at a closed ring (page 71 extension)', () => {
    const result = prepare([...body,3,3,5,3,5,3,5,12,5,12,8,12])
    expect(result.segments).toEqual(new Float32Array(body))
    expect(result.removed.wiring).toBe(3)
  })
  it('keeps wholly interior open symbols and internal chords between ring midpoints', () => {
    const open = [3,3,5,3,5,3,5,5,5,5,3,5]
    expect(prepare(open).segments).toEqual(new Float32Array(open))
    expect(prepare(body).segments).toEqual(new Float32Array(body))
  })
  it('follows an outside page endpoint even when the inside endpoint is away from the boundary', () => {
    const result = prepare([...body,-3,5,2,5,2,5,2,7,2,7,5,7])
    expect(result.segments).toEqual(new Float32Array(body))
    expect(result.removed.wiring).toBe(2)
  })
  it('also seeds an endpoint touching the middle of an outside page line crossing the rectangle', () => {
    const result = prepare([...body,-3,5,25,5,2,5,2,7,2,7,5,7])
    expect(result.segments).toEqual(new Float32Array(body))
    expect(result.removed.wiring).toBe(2)
  })
  it('stops at a three-way junction without following the symbol strokes', () => {
    const square = [8,8,16,8,16,8,16,16,16,16,8,16,8,16,8,8]
    const result = prepare([...square,0,4,8,4,8,4,8,8])
    expect(result.segments).toEqual(new Float32Array(square))
    expect(result.removed.wiring).toBe(2)
  })
  it('protects a closed square touching the boundary, including an internal midpoint chord', () => {
    const square = [0,4,8,4,8,4,8,12,8,12,0,12,0,12,0,4]
    for (const lines of [square, [...square,0,6,8,6,0,10,8,10]]) {
      const result = prepare(lines)
      expect(result.segments).toEqual(new Float32Array(lines))
      expect(result.removed.wiring).toBe(0)
    }
  })
  it('protects internal strokes between circle midpoints even with the circle on the boundary', () => {
    const result = prepare(body, [8,8,16,16])
    expect(result.segments).toEqual(new Float32Array(body))
    expect(result.removed.wiring).toBe(0)
  })
  it('protects a loop with a boundary junction while removing its incoming wire', () => {
    const square = [0,4,8,4,8,4,8,12,8,12,0,12,0,12,0,4]
    const result = prepare([...square,-4,4,0,4])
    expect(result.segments).toEqual(new Float32Array(square))
    expect(result.removed.wiring).toBe(0)
  })
  it('rolls back bent-path removal below 40% length or two retained segments', () => {
    for (const lines of [[0,0,3,0,3,0,3,3,1,0,1,5], [0,0,8,0,8,0,8,8,4,0,4,1,4,1,5,1]]) {
      const result = prepare(lines,[0,0,10,10])
      expect(result.segments).toEqual(new Float32Array(lines))
      expect(result.removed.wiring).toBe(0)
    }
  })
})
