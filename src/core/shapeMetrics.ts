import type { Point } from './annotations'
import { countFixtureId, type CountMark } from './counts'
import {
  fixtureOpeningSize, quantityMethod, type CountFixture, type QuantityMethod,
} from './countFixtures'
import {
  quantityValue, routeMembers, routePortions, routeRises, riseCondition, type QuantityMark,
} from './quantity'
import { polygonArea, polylineLength } from './measure'
import { BAR_COUNT_TOLERANCE_M } from './breakdown/rcData'

export interface ShapeMetrics {
  itemId: string
  annotationId: string
  pageIndex: number
  floor?: string
  room?: string
  condition?: string
  method: QuantityMethod
  count: number
  areaM2: number
  grossAreaM2: number
  perimeterM: number
  lengthM: number
  heightM?: number
  widthM?: number
  depthM?: number
  /** PDF coordinates; enclosing pickups include the closing edge. */
  pathPoints?: Array<[number, number]>
  /** Number of physical rises, independent of route multiplicity. */
  riseCount?: number
  /** Physical crossings grouped by original construction condition. */
  crossingParts?: Array<{ condition?: string; plan: boolean; riseCount: number }>
  /** Supplementary geometry with no ordinary length/area metric. */
  crossingOnly?: boolean
  polygonM?: {
    outer: Array<[number, number]>
    holes: Array<Array<[number, number]>>
  }
}

export interface ShapeAnnotation {
  id: string
  pageIndex: number
  deleted?: boolean
  count?: CountMark | null
  quantity?: QuantityMark | null
  vertices?: readonly Point[] | null
  measure?: { mmPerPoint: number } | null
}

export function collectShapeMetrics(
  annotations: Iterable<ShapeAnnotation>,
  fixtures: readonly CountFixture[],
  itemIds: ReadonlySet<string>,
  crossingItemIds: ReadonlySet<string> = new Set<string>(),
): Map<string, ShapeMetrics[]> {
  const result = new Map<string, ShapeMetrics[]>()
  if (!itemIds.size) return result

  const byId = new Map(fixtures.map(f => [f.id, f]))
  const openingSize = fixtureOpeningSize(fixtures)
  const eligible = (id: string): boolean => {
    const fixture = byId.get(id)
    return itemIds.has(id) && fixture !== undefined && fixture.link === undefined
  }
  const add = (metric: ShapeMetrics): void => {
    const list = result.get(metric.itemId)
    if (list) list.push(metric)
    else result.set(metric.itemId, [metric])
  }

  for (const annotation of annotations) {
    if (annotation.deleted) continue
    const q = annotation.quantity
    const vertices = annotation.vertices
    const scale = annotation.measure?.mmPerPoint

    if (q && vertices && (annotation.measure || crossingItemIds.size > 0)) {
      if (!vertices.every(point => point.every(Number.isFinite))) continue
      const hasScale = scale !== undefined && Number.isFinite(scale) && scale > 0
      const metricScale = hasScale ? scale! : 0
      const eligibleGeometry = (id: string): boolean =>
        eligible(id) && (hasScale || crossingItemIds.has(id))
      const toMeters = (points: readonly Point[]): Array<[number, number]> =>
        points.map(point => [point[0] * metricScale / 1000, point[1] * metricScale / 1000])
      const pdfPoints = (): Array<[number, number]> =>
        vertices.map(point => [point[0], point[1]])
      const lengthM = hasScale ? polylineLength(vertices) * metricScale / 1000 : 0
      const common = {
        annotationId: annotation.id,
        pageIndex: annotation.pageIndex,
        ...(q.floor ? { floor: q.floor } : {}),
        ...(q.room ? { room: q.room } : {}),
      }

      if (q.method === 'polyline') {
        for (const [memberIndex, member] of routeMembers(q).entries()) {
          if (!eligibleGeometry(member.itemId)) continue
          if (memberIndex > 0 && quantityMethod(byId.get(member.itemId)!) !== 'polyline') continue

          const rises = routeRises(q)
          const pathPoints = pdfPoints()
          let crossingParts: ShapeMetrics['crossingParts']
          if (crossingItemIds.has(member.itemId)) {
            const parts = new Map<string | undefined, {
              condition?: string; plan: boolean; riseCount: number
            }>()
            const partFor = (condition: string | null | undefined) => {
              // Length exclusions do not remove physical penetrations.
              const key = typeof condition === 'string' ? condition : undefined
              let part = parts.get(key)
              if (!part) {
                part = {
                  ...(key !== undefined ? { condition: key } : {}),
                  plan: false, riseCount: 0,
                }
                parts.set(key, part)
              }
              return part
            }
            partFor(member.cond.plan).plan = true
            rises.forEach((_, i) => partFor(riseCondition(member.cond, i)).riseCount++)
            crossingParts = [...parts.values()]
          }

          // Keep route multiplicity separate from the length of one route.
          // Portions sharing a condition belong to the same pickup.
          const lengths = new Map<string | undefined, number>()
          for (const portion of routePortions(lengthM, q, member.cond)) {
            lengths.set(portion.condition,
              (lengths.get(portion.condition) ?? 0) + portion.lengthM)
          }
          if (!lengths.size && crossingItemIds.has(member.itemId)) {
            lengths.set(undefined, 0)
          }
          for (const [condition, routeLengthM] of lengths) {
            add({
              ...common,
              itemId: member.itemId,
              method: 'polyline',
              count: member.count,
              areaM2: 0,
              grossAreaM2: 0,
              perimeterM: routeLengthM,
              lengthM: routeLengthM,
              pathPoints,
              riseCount: rises.length,
              ...(crossingParts !== undefined ? { crossingParts } : {}),
              ...(!hasScale || routeLengthM === 0 ? { crossingOnly: true } : {}),
              ...(condition !== undefined ? { condition } : {}),
            })
          }
        }
        continue
      }

      if (!eligibleGeometry(q.itemId)) continue
      const enclosing = q.method === 'polygon' || q.method === 'polygonDepth'
      const grossAreaM2 = enclosing
        ? polygonArea(vertices) * metricScale ** 2 / 1e6
        : q.method === 'lengthHeight'
          ? lengthM * (q.heightM ?? 0)
          : lengthM * (q.widthM ?? 0)
      const areaM2 = enclosing
        ? quantityValue(vertices, metricScale, {
          ...q,
          method: 'polygon',
          // polygonDepth has holes, but does not deduct catalog openings.
          openings: q.method === 'polygon' ? q.openings : undefined,
        }, openingSize)
        : q.method === 'lengthHeight'
          ? quantityValue(vertices, metricScale, q, openingSize)
          : grossAreaM2

      let perimeterM = lengthM
      if (enclosing && vertices.length > 1) {
        const first = vertices[0], last = vertices[vertices.length - 1]
        perimeterM += Math.hypot(last[0] - first[0], last[1] - first[1]) * metricScale / 1000
      }
      const pathPoints = enclosing ? pdfPoints() : undefined
      if (pathPoints && pathPoints.length > 1) {
        const first = pathPoints[0], last = pathPoints[pathPoints.length - 1]
        if (first[0] !== last[0] || first[1] !== last[1]) {
          pathPoints.push([first[0], first[1]])
        }
      }

      add({
        ...common,
        itemId: q.itemId,
        method: q.method,
        count: 1,
        areaM2,
        grossAreaM2,
        perimeterM,
        lengthM: enclosing ? 0 : lengthM,
        ...(pathPoints !== undefined ? { pathPoints } : {}),
        ...(!hasScale ? { crossingOnly: true } : {}),
        ...(q.condition !== undefined ? { condition: q.condition } : {}),
        ...(q.heightM !== undefined ? { heightM: q.heightM } : {}),
        ...(q.widthM !== undefined ? { widthM: q.widthM } : {}),
        ...(q.depthM !== undefined ? { depthM: q.depthM } : {}),
        ...(enclosing ? {
          polygonM: {
            outer: toMeters(vertices),
            holes: (q.holes ?? []).map(toMeters),
          },
        } : {}),
      })
    } else if (annotation.count) {
      const count = annotation.count
      const common = {
        annotationId: annotation.id,
        pageIndex: annotation.pageIndex,
        method: 'click' as const,
        areaM2: 0,
        grossAreaM2: 0,
        perimeterM: 0,
        lengthM: 0,
        ...(count.version === 2 ? { floor: count.floor, room: count.room } : {}),
      }
      const itemId = countFixtureId(count)
      if (eligible(itemId)) {
        add({
          ...common, itemId, count: 1,
          ...(count.version === 2 && count.condition !== undefined
            ? { condition: count.condition } : {}),
        })
      }
      if (count.version === 2) {
        for (const extra of count.extra ?? []) {
          if (!eligible(extra.itemId)
            || quantityMethod(byId.get(extra.itemId)!) !== 'click') continue
          add({
            ...common,
            itemId: extra.itemId,
            count: extra.count,
            ...(extra.condition !== undefined ? { condition: extra.condition } : {}),
          })
        }
      }
    }
  }
  return result
}

type PolygonM = NonNullable<ShapeMetrics['polygonM']>
const EPSILON = 1e-9

/** 0 = outside, 1 = inside, 2 = boundary. */
function pointPosition(
  ring: readonly [number, number][],
  x: number,
  y: number,
): 0 | 1 | 2 {
  let inside = false
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length]
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const cross = (x - a[0]) * dy - (y - a[1]) * dx
    if (Math.abs(cross) <= EPSILON * Math.max(1, Math.hypot(dx, dy))
      && x >= Math.min(a[0], b[0]) - EPSILON
      && x <= Math.max(a[0], b[0]) + EPSILON
      && y >= Math.min(a[1], b[1]) - EPSILON
      && y <= Math.max(a[1], b[1]) + EPSILON) return 2
    if ((a[1] > y) !== (b[1] > y)
      && x < a[0] + (y - a[1]) * dx / dy) inside = !inside
  }
  return inside ? 1 : 0
}

function insidePolygon(polygon: PolygonM, x: number, y: number): boolean {
  const outer = pointPosition(polygon.outer, x, y)
  if (outer === 0) return false
  let inside = true
  for (const hole of polygon.holes) {
    const position = pointPosition(hole, x, y)
    if (position === 2) return false
    if (position === 1) inside = !inside
  }
  return inside
}

/**
 * Include the exterior boundary, exclude hole boundaries, and merge adjacent
 * interior intervals. Each disconnected interval is a separate bar.
 */
export function clipParallelBars(
  polygon: PolygonM,
  direction: 'x' | 'y',
  spacingM: number,
): number[] {
  if (direction !== 'x' && direction !== 'y') {
    throw new Error('配筋の向きはxまたはyで指定してください。')
  }
  if (!Number.isFinite(spacingM) || spacingM <= 0) {
    throw new Error('配筋間隔は0より大きい有限の数で指定してください。')
  }
  if (polygon.outer.length < 3) return []
  const rings = [polygon.outer, ...polygon.holes]
  if (!rings.every(ring => ring.length >= 3
    && ring.every(point => point.every(Number.isFinite)))) {
    throw new Error('配筋する多角形の座標が正しくありません。')
  }
  if (polygonArea(polygon.outer) === 0) return []

  const along = direction === 'x' ? 0 : 1
  const across = direction === 'x' ? 1 : 0
  let minimum = Infinity, maximum = -Infinity
  for (const point of polygon.outer) {
    minimum = Math.min(minimum, point[across])
    maximum = Math.max(maximum, point[across])
  }
  const span = maximum - minimum
  if (span <= 0) return []
  const steps = Math.max(1, Math.ceil((span - BAR_COUNT_TOLERANCE_M) / spacingM))
  // Bound work before allocating or iterating over untrusted imported spacing.
  if (!Number.isSafeInteger(steps) || steps > 1_000_000) {
    throw new Error('配筋の平行線は1方向1000001本までです。')
  }

  const lengths: number[] = []
  for (let line = 0; line <= steps; line++) {
    // The final line is on the far boundary, including non-integral spacing.
    const position = line === steps ? maximum : minimum + line * spacingM
    const cuts: number[] = []
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length]
        const delta = b[across] - a[across]
        if (delta === 0) {
          if (Math.abs(position - a[across]) <= EPSILON) {
            cuts.push(a[along], b[along])
          }
        } else {
          const t = (position - a[across]) / delta
          if (t >= 0 && t <= 1) cuts.push(a[along] + t * (b[along] - a[along]))
        }
      }
    }
    cuts.sort((a, b) => a - b)
    const unique = cuts.filter((value, i) =>
      i === 0 || value - cuts[i - 1] > EPSILON)
    let start: number | undefined
    let end = 0
    const flush = (): void => {
      if (start !== undefined && end - start > EPSILON) lengths.push(end - start)
      start = undefined
    }
    for (let i = 1; i < unique.length; i++) {
      const a = unique[i - 1], b = unique[i]
      const midpoint = (a + b) / 2
      const inside = direction === 'x'
        ? insidePolygon(polygon, midpoint, position)
        : insidePolygon(polygon, position, midpoint)
      if (inside) {
        if (start === undefined) start = a
        end = b
      } else flush()
    }
    flush()
  }
  return lengths
}
