import type { Point, Rect } from './annotations'

export function unionRect(a: Rect, b: Rect): Rect {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
}

/** Map the user's sample box onto one match of the sample body. */
export function sampleBoxForMatch(sampleBox: Rect, body: Rect, match: { center: Point; angle: number }): Rect {
  const bodyCenter: Point = [(body[0] + body[2]) / 2, (body[1] + body[3]) / 2]
  const d: Point = [match.center[0] - bodyCenter[0], match.center[1] - bodyCenter[1]]
  const translated: Rect = [sampleBox[0] + d[0], sampleBox[1] + d[1], sampleBox[2] + d[0], sampleBox[3] + d[1]]
  const theta = match.angle * Math.PI / 180, cos = Math.cos(theta), sin = Math.sin(theta)
  if (Math.abs(sin) <= .01 && cos > 0) return translated
  const corners: Point[] = [[sampleBox[0], sampleBox[1]], [sampleBox[2], sampleBox[1]],
    [sampleBox[2], sampleBox[3]], [sampleBox[0], sampleBox[3]]]
  const transformed = corners.map(([x, y]): Point => [
    match.center[0] + cos * (x - bodyCenter[0]) - sin * (y - bodyCenter[1]),
    match.center[1] + sin * (x - bodyCenter[0]) + cos * (y - bodyCenter[1]),
  ])
  return unionRect(translated, [Math.min(...transformed.map(p => p[0])), Math.min(...transformed.map(p => p[1])),
    Math.max(...transformed.map(p => p[0])), Math.max(...transformed.map(p => p[1]))])
}
