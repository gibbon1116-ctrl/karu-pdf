import type { Point } from './annotations'
import { countFixtureId, type CountMark } from './counts'
import { quantityMethod, type CountFixture } from './countFixtures'
import { quantityValue, routeMembers, routePortions, type QuantityMark, type RoutePart } from './quantity'
import { normalizeFloor } from './location'
import { polylineLength } from './measure'
/** Recognized floors precede free-form names; basement numbers run down to up. */
export function compareFloors(a: string, b: string): number {
  const rank = (s: string): [number, number] => {
    const n = normalizeFloor(s)
    let m: RegExpMatchArray | null
    if ((m = n.match(/^B(\d+)階$/))) return [0, -Number(m[1])]
    if ((m = n.match(/^(\d+)階$/))) return [1, Number(m[1])]
    if ((m = n.match(/^M(\d+)階$/))) return [1, Number(m[1]) + .5]
    if (n === 'RF') return [2, 0]
    if ((m = n.match(/^PH(?:(\d+))?階$/))) return [3, Number(m[1] ?? 0)]
    return [4, 0]
  }
  const x = rank(a), y = rank(b)
  return x[0] - y[0] || x[1] - y[1] || a.localeCompare(b, 'ja', { numeric: true })
}
export interface QuantityEntry {
  itemId: string; annotationId: string; pageIndex: number; floor?: string; room?: string
  value: number; routeCount?: number; part?: RoutePart; riseIndex?: number; condition?: string
}
export interface ConditionTotal { plan: number; rise: number; slack: number; other: number; total: number; annotationIds: Set<string> }
export function quantityPartLabel(part: RoutePart): string {
  return { plan: '平面', rise: '立上り・立下り', slack: 'その他の加算' }[part]
}
export function quantityPartSummary(total: Pick<ConditionTotal, 'plan' | 'rise' | 'slack'>, includeSlack = true): string {
  return (['plan', 'rise', ...(includeSlack ? ['slack' as const] : [])] as const)
    .filter(part => total[part] !== 0).map(part => `${quantityPartLabel(part)} ${total[part].toFixed(1)}`).join(' ／ ')
}
interface IndexedAnnotation {
  id: string; pageIndex: number; deleted?: boolean; count?: CountMark | null; quantity?: QuantityMark | null
  vertices?: readonly Point[] | null; measure?: { mmPerPoint: number } | null
}
export class QuantityIndex {
  private readonly countPages = new Map<number, QuantityEntry[]>()
  private readonly items = new Map<string, QuantityEntry[]>()
  private readonly pages = new Map<string, Map<number, number>>()
  private readonly totals = new Map<string, number>()
  private readonly conditions = new Map<string, Map<string, ConditionTotal>>()
  // Zero/excluded routes still belong to their page/location, but have no portions.
  private readonly emptyRoutes = new Map<string, QuantityEntry[]>()
  static build(annotations: Iterable<IndexedAnnotation>, fixtures: readonly CountFixture[]): QuantityIndex {
    const index = new QuantityIndex(), lengths = new Set(fixtures.filter(f => quantityMethod(f) === 'polyline').map(f => f.id))
    const add = (entry: QuantityEntry) => {
      const list = index.items.get(entry.itemId)
      if (list) list.push(entry); else index.items.set(entry.itemId, [entry])
      const pages = index.pages.get(entry.itemId) ?? new Map<number, number>()
      pages.set(entry.pageIndex, (pages.get(entry.pageIndex) ?? 0) + entry.value); index.pages.set(entry.itemId, pages)
      index.totals.set(entry.itemId, (index.totals.get(entry.itemId) ?? 0) + entry.value)
      const conditions = index.conditions.get(entry.itemId) ?? new Map<string, ConditionTotal>()
      const key = entry.condition ?? '', total = conditions.get(key) ?? { plan: 0, rise: 0, slack: 0, other: 0, total: 0, annotationIds: new Set<string>() }
      total[entry.part ?? 'other'] += entry.value; total.total += entry.value; total.annotationIds.add(entry.annotationId)
      conditions.set(key, total); index.conditions.set(entry.itemId, conditions)
    }
    for (const a of annotations) {
      if (a.deleted) continue
      const q = a.quantity
      if (q && a.vertices && a.measure) {
        const planM = q.method === 'polyline' ? polylineLength(a.vertices) * a.measure.mmPerPoint / 1000 : 0
        const common = { annotationId: a.id, pageIndex: a.pageIndex, ...(q.floor ? { floor: q.floor } : {}), ...(q.room ? { room: q.room } : {}) }
        if (q.method === 'polyline') {
          for (const [i, member] of routeMembers(q).entries()) if (i === 0 || lengths.has(member.itemId)) {
            const portions = routePortions(planM, q, member.cond)
            if (!portions.length) {
              const empty = { ...common, itemId: member.itemId, value: 0 }
              const list = index.emptyRoutes.get(member.itemId) ?? []
              list.push(empty); index.emptyRoutes.set(member.itemId, list)
              if (!index.items.has(member.itemId)) index.items.set(member.itemId, [])
              if (!index.totals.has(member.itemId)) index.totals.set(member.itemId, 0)
              const pages = index.pages.get(member.itemId) ?? new Map<number, number>()
              if (!pages.has(a.pageIndex)) pages.set(a.pageIndex, 0)
              index.pages.set(member.itemId, pages)
            }
            for (const { lengthM, ...portion } of portions) add({ ...common, ...portion, itemId: member.itemId, value: lengthM * member.count, routeCount: member.count })
          }
        } else add({ ...common, itemId: q.itemId, value: quantityValue(a.vertices, a.measure.mmPerPoint, q), condition: q.condition })
      } else if (a.count) {
        const c = a.count
        const entry = { itemId: countFixtureId(c), annotationId: a.id, pageIndex: a.pageIndex, value: 1, ...(c.version === 2 ? { floor: c.floor, room: c.room, condition: c.condition } : {}) }
        add(entry)
        const counts = index.countPages.get(a.pageIndex)
        if (counts) counts.push(entry); else index.countPages.set(a.pageIndex, [entry])
      }
    }
    for (const [id, pages] of index.pages) index.pages.set(id, new Map([...pages].sort((a, b) => a[0] - b[0])))
    return index
  }
  countEntriesOnPage(pageIndex: number): readonly QuantityEntry[] { return this.countPages.get(pageIndex) ?? [] }
  itemIds(): IterableIterator<string> { return this.items.keys() }
  entries(itemId: string): readonly QuantityEntry[] { return this.items.get(itemId) ?? [] }
  total(itemId: string): number { return this.totals.get(itemId) ?? 0 }
  byCondition(itemId: string): Map<string, ConditionTotal> {
    return new Map([...this.conditions.get(itemId) ?? []].map(([key, value]) => [key, { ...value, annotationIds: new Set(value.annotationIds) }]))
  }
  byPage(itemId: string): Map<number, number> {
    return new Map(this.pages.get(itemId) ?? [])
  }
  private byLocation(itemId: string, key: 'floor' | 'room'): Map<string, number> {
    const result = new Map<string, number>()
    for (const e of [...this.entries(itemId), ...this.emptyRoutes.get(itemId) ?? []]) result.set(e[key] ?? '', (result.get(e[key] ?? '') ?? 0) + e.value)
    return result
  }
  byFloor(itemId: string): Map<string, number> { return this.byLocation(itemId, 'floor') }
  byRoom(itemId: string): Map<string, number> { return this.byLocation(itemId, 'room') }
  byFloorRoom(itemId: string): Map<string, Map<string, number>> {
    const result = new Map<string, Map<string, number>>()
    for (const e of [...this.entries(itemId), ...this.emptyRoutes.get(itemId) ?? []]) {
      const rooms = result.get(e.floor ?? '') ?? new Map<string, number>()
      rooms.set(e.room ?? '', (rooms.get(e.room ?? '') ?? 0) + e.value); result.set(e.floor ?? '', rooms)
    }
    return result
  }
  pagesOf(itemId: string): number[] { return [...this.byPage(itemId).keys()] }
  locations(): { floors: string[]; rooms: string[] } {
    const floors = new Set<string>(), rooms = new Set<string>()
    for (const list of [...this.items.values(), ...this.emptyRoutes.values()]) for (const e of list) { if (e.floor) floors.add(e.floor); if (e.room) rooms.add(e.room) }
    return { floors: [...floors].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true })), rooms: [...rooms].sort((a, b) => a.localeCompare(b, 'ja')) }
  }
}
