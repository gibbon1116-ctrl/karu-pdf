import type { Point } from './annotations'
import { countFixtureId, type CountMark } from './counts'
import { fixtureOpeningSize, quantityMethod, type CountFixture } from './countFixtures'
import { quantityValue, routeMembers, routePortions, type QuantityMark, type RoutePart } from './quantity'
import { normalizeFloor } from './location'
import { polylineLength } from './measure'
import { computeLinks, fixtureLinkSources, fixtureCrossingBarriers, fixtureLinkError, fixtureLinkRoundsUp, ceilLinkQuantity, type LinkResult } from './fixtureLink'
import { collectShapeMetrics } from './shapeMetrics'
import { calculateBackfillVolume, type BackfillVolume } from './backfill'
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
  value: number; raw?: number; routeCount?: number; part?: RoutePart; riseIndex?: number; condition?: string
  routePerM?: number; routeWidthM?: number; routeDepthM?: number
  backfill?: BackfillVolume
}
export interface ConditionTotal { plan: number; rise: number; slack: number; other: number; total: number; raw: number; annotationIds: Set<string> }
export function quantityPartLabel(part: RoutePart): string {
  return { plan: '平面', rise: '立上り・立下り', slack: 'その他の加算' }[part]
}
export function quantityPartSummary(total: Pick<ConditionTotal, 'plan' | 'rise' | 'slack'>, includeSlack = true, decimals = 1): string {
  return (['plan', 'rise', ...(includeSlack ? ['slack' as const] : [])] as const)
    .filter(part => total[part] !== 0).map(part => `${quantityPartLabel(part)} ${total[part].toFixed(decimals)}`).join(' ／ ')
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
  private readonly rawTotals = new Map<string, number>()
  private readonly conditions = new Map<string, Map<string, ConditionTotal>>()
  // Zero/excluded routes still belong to their page/location, but have no portions.
  private readonly emptyRoutes = new Map<string, QuantityEntry[]>()
  private readonly links = new Map<string, LinkResult>()
  static build(annotations: Iterable<IndexedAnnotation>, fixtures: readonly CountFixture[]): QuantityIndex {
    const index = new QuantityIndex(), linkedFixtures: CountFixture[] = [], linkIds = new Set<string>()
    // Collect links during the existing fixture pass, without another pass for ordinary documents.
    const lengths = new Set(fixtures.filter(f => {
      if (f.link !== undefined) { linkedFixtures.push(f); linkIds.add(f.id) }
      return f.link === undefined && quantityMethod(f) === 'polyline'
    }).map(f => f.id))
    const trenches = new Map(fixtures.filter(f =>
      f.link === undefined && quantityMethod(f) === 'lengthWidthDepth',
    ).map(f => [f.id, f] as const))
    const clicks = new Set(fixtures.filter(f => f.link === undefined && quantityMethod(f) === 'click').map(f => f.id))
    // 設定のない文書には、管検索用のMapや控除計算を追加しない。
    const backfillFixtures = [...trenches.values()].some(f => f.backfill?.deductPipes)
      ? new Map(fixtures.map(f => [f.id, f] as const)) : undefined
    // Retain annotations only for geometry links, including one-shot iterables.
    const geometryAnnotations: IndexedAnnotation[] | undefined =
      linkedFixtures.some(f => f.link?.kind === 'rc' || f.link?.kind === 'shape'
        || f.link?.kind === 'crossing' || f.link?.kind === 'steel') ? [] : undefined
    const openingSize = fixtureOpeningSize(fixtures)
    const factors = new Map(fixtures.flatMap(f => f.convert ? [[f.id, f.convert.factor] as const] : []))
    const add = (entry: QuantityEntry, linked = false) => {
      if (!linked && linkIds.has(entry.itemId)) return
      const raw = entry.value, factor = linked ? undefined : factors.get(entry.itemId)
      if (factor !== undefined) {
        entry.raw = raw
        entry.value = raw * factor
      }
      index.rawTotals.set(entry.itemId, (index.rawTotals.get(entry.itemId) ?? 0) + raw)
      const list = index.items.get(entry.itemId)
      if (list) list.push(entry); else index.items.set(entry.itemId, [entry])
      const pages = index.pages.get(entry.itemId) ?? new Map<number, number>()
      pages.set(entry.pageIndex, (pages.get(entry.pageIndex) ?? 0) + entry.value); index.pages.set(entry.itemId, pages)
      index.totals.set(entry.itemId, (index.totals.get(entry.itemId) ?? 0) + entry.value)
      const conditions = index.conditions.get(entry.itemId) ?? new Map<string, ConditionTotal>()
      const key = entry.condition ?? '', total = conditions.get(key) ?? { plan: 0, rise: 0, slack: 0, other: 0, total: 0, raw: 0, annotationIds: new Set<string>() }
      total[entry.part ?? 'other'] += entry.value; total.total += entry.value; total.raw += raw; total.annotationIds.add(entry.annotationId)
      conditions.set(key, total); index.conditions.set(entry.itemId, conditions)
    }
    for (const a of annotations) {
      geometryAnnotations?.push(a)
      if (a.deleted) continue
      const q = a.quantity
      if (q && a.vertices && a.measure) {
        const planM = q.method === 'polyline' ? polylineLength(a.vertices) * a.measure.mmPerPoint / 1000 : 0
        const common = { annotationId: a.id, pageIndex: a.pageIndex, ...(q.floor ? { floor: q.floor } : {}), ...(q.room ? { room: q.room } : {}) }
        if (q.method === 'polyline') {
          for (const [i, member] of routeMembers(q).entries()) if (!linkIds.has(member.itemId)
            && (i === 0 || lengths.has(member.itemId) || trenches.has(member.itemId))) {
            const trench = i > 0 ? trenches.get(member.itemId) : undefined
            const dimension = (value: number | undefined) =>
              value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
            const widthM = trench ? dimension(trench.defaults?.widthM) : undefined
            const depthM = trench ? dimension(trench.defaults?.depthM) : undefined
            const perM = member.perM ?? 1
            const portions = routePortions(planM, trench ? {} : q, member.cond)
            const backfill = trench?.backfill?.deductPipes && backfillFixtures
              ? calculateBackfillVolume(
                planM, q, member, trench, id => backfillFixtures.get(id),
              ) : undefined
            if (!portions.length) {
              const empty: QuantityEntry = { ...common, itemId: member.itemId, value: 0, ...(factors.has(member.itemId) ? { raw: 0 } : {}) }
              const list = index.emptyRoutes.get(member.itemId) ?? []
              list.push(empty); index.emptyRoutes.set(member.itemId, list)
              if (!index.items.has(member.itemId)) index.items.set(member.itemId, [])
              if (!index.totals.has(member.itemId)) index.totals.set(member.itemId, 0)
              const pages = index.pages.get(member.itemId) ?? new Map<number, number>()
              if (!pages.has(a.pageIndex)) pages.set(a.pageIndex, 0)
              index.pages.set(member.itemId, pages)
            }
            for (const { lengthM, ...portion } of portions) add({
              ...common,
              ...portion,
              itemId: member.itemId,
              value: backfill?.valueM3 ?? lengthM * member.count * perM
                * (trench ? widthM! * depthM! : 1),
              ...(backfill ? { backfill } : {}),
              routeCount: member.count,
              ...(member.perM !== undefined ? { routePerM: member.perM } : {}),
              ...(trench ? { routeWidthM: widthM, routeDepthM: depthM } : {}),
            })
          }
        } else add({ ...common, itemId: q.itemId, value: quantityValue(a.vertices, a.measure.mmPerPoint, q, openingSize), condition: q.condition })
      } else if (a.count && !linkIds.has(countFixtureId(a.count))) {
        const c = a.count
        const entry = { itemId: countFixtureId(c), annotationId: a.id, pageIndex: a.pageIndex, value: 1, ...(c.version === 2 ? { floor: c.floor, room: c.room, condition: c.condition } : {}) }
        add(entry)
        const counts = index.countPages.get(a.pageIndex)
        if (counts) counts.push(entry); else index.countPages.set(a.pageIndex, [entry])
        if (c.version === 2) for (const e of c.extra ?? []) if (clicks.has(e.itemId)) {
          add({ itemId: e.itemId, annotationId: a.id, pageIndex: a.pageIndex, value: e.count, floor: c.floor, room: c.room, condition: e.condition })
        }
      }
    }
    if (linkedFixtures.length) {
      let metricsOf: Parameters<typeof computeLinks>[2]
      if (geometryAnnotations !== undefined) {
        const itemIds = new Set(
          linkedFixtures.some(f => f.link?.kind === 'rc' || f.link?.kind === 'shape')
            ? fixtures.filter(f => f.rc !== undefined).map(f => f.id) : [],
        )
        const crossingItemIds = new Set<string>()
        for (const fixture of linkedFixtures) {
          const kind = fixture.link?.kind
          if ((kind !== 'rc' && kind !== 'shape' && kind !== 'crossing' && kind !== 'steel')
            || fixtureLinkError(fixture)) continue
          const sources = fixtureLinkSources(fixtures, fixture)
          for (const source of sources) {
            itemIds.add(source.itemId)
            if (kind === 'crossing') crossingItemIds.add(source.itemId)
          }
          if (kind === 'crossing') {
            for (const barrier of fixtureCrossingBarriers(
              fixtures, fixture, new Set(sources.map(source => source.itemId)),
            )) {
              itemIds.add(barrier.id)
              crossingItemIds.add(barrier.id)
            }
          }
        }
        const metrics = collectShapeMetrics(
          geometryAnnotations, fixtures, itemIds, crossingItemIds,
        )
        metricsOf = itemId => metrics.get(itemId) ?? []
      }
      const results = computeLinks(fixtures, itemId => index.entries(itemId), metricsOf)
      for (const fixture of linkedFixtures) {
        const result = results.get(fixture.id)!
        index.links.set(fixture.id, result)
        if (!index.items.has(fixture.id)) index.items.set(fixture.id, [])
        for (const entry of result.entries) add(entry, true)
        index.totals.set(fixture.id, result.total)
        if (result.overridden) {
          const key = fixture.link!.condition?.value ?? ''
          index.conditions.set(fixture.id, new Map([[key, {
            plan: 0, rise: 0, slack: 0, other: result.total,
            total: result.total, raw: 0, annotationIds: new Set<string>(),
          }]]))
        } else if (fixtureLinkRoundsUp(fixture) && (fixture.link!.rounding ?? 'total') === 'total') {
          for (const total of index.conditions.get(fixture.id)?.values() ?? []) {
            total.total = ceilLinkQuantity(total.total)
          }
        }
      }
    }
    for (const [id, pages] of index.pages) index.pages.set(id, new Map([...pages].sort((a, b) => a[0] - b[0])))
    return index
  }
  countEntriesOnPage(pageIndex: number): readonly QuantityEntry[] { return this.countPages.get(pageIndex) ?? [] }
  itemIds(): IterableIterator<string> { return this.items.keys() }
  entries(itemId: string): readonly QuantityEntry[] { return this.items.get(itemId) ?? [] }
  total(itemId: string): number { return this.totals.get(itemId) ?? 0 }
  rawTotal(itemId: string): number { return this.rawTotals.get(itemId) ?? 0 }
  linkResult(itemId: string): LinkResult | undefined { return this.links.get(itemId) }
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
