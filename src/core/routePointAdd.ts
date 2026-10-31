import type { RoutePoint } from './quantity'

/**
 * 使っていない最初の中間頂点、なければ終点。
 * 同じ項目が終点にもある場合は、追加先なし。
 */
export function nextRoutePointAt(
  points: readonly RoutePoint[],
  vertexCount: number,
  itemId: string,
): number | undefined {
  if (!Number.isInteger(vertexCount) || vertexCount < 2) return undefined

  const last = vertexCount - 1
  const used = new Set(points.map(point => point.at))
  for (let at = 1; at < last; at++) {
    if (!used.has(at)) return at
  }
  return points.some(point => point.itemId === itemId && point.at === last)
    ? undefined : last
}
