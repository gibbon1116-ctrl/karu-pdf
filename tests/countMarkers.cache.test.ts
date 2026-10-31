import { describe, expect, it } from 'vitest'
import { countHex, type CountStyle } from '../src/core/countFixtures'
import { countMarkerData, countSvgPath } from '../src/editor/countMarkers'

function markerDigest(): { hash: string; count: number } {
  const shapes = ['circle','doubleCircle','square','roundedSquare','triangle','invertedTriangle','diamond','pentagon','hexagon','octagon','star','hourglass','cross','plus']
  const fills = ['none','solid','half','dot','hatch']
  const out: string[] = []
  for (const shape of shapes) for (const fill of fills) for (const size of [6, 10, 13.5]) for (const [x, y] of [[0, 0], [123.25, 456.5], [-7.1, 3.3]]) {
    const d = countMarkerData({ shape, fill, color: [0.2, 0.6, 0.9], size, opacity: 0.8, showCode: true } as CountStyle, x, y)
    out.push(JSON.stringify(d) + countSvgPath(d.outline) + countSvgPath(d.fills) + countSvgPath(d.strokes, false))
  }
  let h = 0x811c9dc5; for (const b of new TextEncoder().encode(out.join('\n'))) h = Math.imul(h ^ b, 0x01000193) >>> 0
  const hash = h.toString(16).padStart(8, '0')
  return { hash, count: out.length }
}

describe('count marker geometry cache', () => {
  it('matches the pre-change digest on both the first and cached pass', () => {
    expect(markerDigest()).toEqual({ hash: '2debee81', count: 630 })
    expect(markerDigest()).toEqual({ hash: '2debee81', count: 630 })
  })

  it('keeps returned polygons independent from the cached geometry', () => {
    for (const fill of ['solid', 'hatch'] as const) {
      const style: CountStyle = {
        shape: 'doubleCircle', fill, color: [0.2, 0.6, 0.9],
        size: 10, opacity: 0.8, showCode: true,
      }
      const expected = structuredClone(countMarkerData(style, 123.25, -7.1))
      const changed = countMarkerData(style, 123.25, -7.1)

      changed.outline[0][0][0] = 9999
      changed.outline[0].push([111, 222])
      changed.outline.push([[333, 444]])
      if (changed.fills.length) changed.fills[0][0][1] = 9999
      if (changed.strokes.length) changed.strokes[0][0][0] = 9999

      const next = countMarkerData(style, 123.25, -7.1)
      expect(next).toEqual(expected)
      expect(next.outline).not.toBe(changed.outline)
      expect(next.outline[0]).not.toBe(changed.outline[0])
      expect(next.outline[0][0]).not.toBe(changed.outline[0][0])
    }
  })

  it('calculates color, brightness, opacity and code placement on every call', () => {
    const style: CountStyle = {
      shape: 'circle', fill: 'none', color: [0, 0, 0],
      size: 10, opacity: 0.8, showCode: true,
    }
    const first = countMarkerData(style, 2, 3)
    const nextStyle: CountStyle = {
      ...style, color: [1, 1, 1], opacity: 0.25, showCode: false,
    }
    const next = countMarkerData(nextStyle, 2, 3)

    expect(next.outline).toEqual(first.outline)
    expect(first.bright).toBe(false)
    expect(next.bright).toBe(true)
    expect(next.color).toBe(countHex(nextStyle.color))
    expect(next.opacity).toBe(0.25)
    expect(next.code).toEqual({ x: 7, y: -2, size: 7 })
  })

  it('preserves output after overflowing the geometry cache', () => {
    const style: CountStyle = {
      shape: 'star', fill: 'hatch', color: [0.2, 0.6, 0.9],
      size: 10, opacity: 0.8, showCode: true,
    }
    const expected = structuredClone(countMarkerData(style, -7.1, 3.3))
    for (let size = 20; size < 277; size++) {
      countMarkerData({ ...style, size })
    }
    expect(countMarkerData(style, -7.1, 3.3)).toEqual(expected)
  })
})
