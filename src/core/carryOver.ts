import type { Point } from './annotations'
import type { CountFixture } from './countFixtures'
import { countMembers, type CountMark } from './counts'
import { PT_MM, ratioScale, validScale, type PageScale, type ScaleRegion } from './measure'
import { routeMembers, type QuantityMark } from './quantity'
import type { RoomRegion, RoomSetLink } from './rooms'

export type CarryOverMatchReason = 'name' | 'number' | 'order' | 'manual'
export interface CarryOverPageInfo {
  pageIndex: number
  number?: string
  name?: string
  width: number
  height: number
}
export interface CarryOverMatch {
  oldPage: number
  newPage: number | null
  reason: CarryOverMatchReason | null
}

type PageSize = Pick<CarryOverPageInfo, 'width' | 'height'>
type Pickup = { quantity?: QuantityMark | null; count?: CountMark | null }

export function normalizeDrawingKey(value: string | undefined): string | undefined {
  return value?.normalize('NFKC').replace(/\s/gu, '').toLowerCase() || undefined
}

export function matchCarryOverPages(
  oldPages: readonly CarryOverPageInfo[],
  newPages: readonly CarryOverPageInfo[],
): CarryOverMatch[] {
  const byName = new Map<string, CarryOverPageInfo[]>()
  const byNumber = new Map<string, CarryOverPageInfo[]>()
  const add = (pages: Map<string, CarryOverPageInfo[]>, key: string | undefined, page: CarryOverPageInfo) => {
    if (!key) return
    const entries = pages.get(key)
    if (entries) entries.push(page)
    else pages.set(key, [page])
  }
  for (const page of newPages) {
    add(byName, normalizeDrawingKey(page.name), page)
    add(byNumber, normalizeDrawingKey(page.number), page)
  }

  const matches: CarryOverMatch[] = oldPages.map(page => {
    const oldPage = page.pageIndex
    const name = normalizeDrawingKey(page.name)
    const number = normalizeDrawingKey(page.number)
    const names = name ? byName.get(name) ?? [] : []
    const narrowed = names.length > 1 && number
      ? names.filter(candidate => normalizeDrawingKey(candidate.number) === number) : names
    if (narrowed.length === 1) return { oldPage, newPage: narrowed[0].pageIndex, reason: 'name' }
    const numbers = number ? byNumber.get(number) : undefined
    if (numbers?.length === 1) return { oldPage, newPage: numbers[0].pageIndex, reason: 'number' }
    return { oldPage, newPage: null, reason: null }
  })

  const taken = new Set<number>()
  for (const match of [...matches].sort((a, b) => a.oldPage - b.oldPage)) {
    if (match.newPage === null) continue
    if (taken.has(match.newPage)) {
      match.newPage = null
      match.reason = null
    } else taken.add(match.newPage)
  }
  return matches
}

export function fillCarryOverByOrder(matches: readonly CarryOverMatch[], newPageCount: number): CarryOverMatch[] {
  const taken = new Set(matches.flatMap(match => match.newPage === null ? [] : [match.newPage]))
  return matches.map(match => {
    const { oldPage, newPage } = match
    if (newPage !== null || oldPage < 0 || oldPage >= newPageCount || taken.has(oldPage)) return { ...match }
    taken.add(oldPage)
    return { oldPage, newPage: oldPage, reason: 'order' }
  })
}

export interface CarryOverTransform { factor: number; warning?: 'aspect' }
export function carryOverTransform(oldSize: PageSize, newSize: PageSize): CarryOverTransform {
  if ([oldSize.width, oldSize.height, newSize.width, newSize.height].some(n => !Number.isFinite(n) || n <= 0)) {
    throw new Error('用紙の大きさが不正です。')
  }
  const oldAspect = oldSize.width / oldSize.height, newAspect = newSize.width / newSize.height
  if (newAspect < oldAspect * 0.99 || newAspect > oldAspect * 1.01) return { factor: 1, warning: 'aspect' }
  return { factor: newSize.width / oldSize.width }
}

export function transformCarryOverPoint(point: Point, { factor }: CarryOverTransform): Point {
  return [point[0] * factor, point[1] * factor]
}

export function convertCarryOverScale(scale: PageScale, factor: number, newSize: PageSize | undefined): PageScale {
  if (!validScale(scale) || !Number.isFinite(factor) || factor <= 0) throw new Error('縮尺が不正です。')
  const result = structuredClone(scale)
  if (factor === 1) return result
  if (scale.source === 'ratio' && scale.paper !== 'PDF') {
    if (!newSize) throw new Error('新版の用紙の大きさを確認できません。')
    Object.assign(result, ratioScale(scale.denominator, scale.paper, newSize, scale.unit, scale.decimals))
  } else {
    result.mmPerPoint /= factor
    if (scale.paper === 'PDF') result.denominator = result.mmPerPoint / PT_MM
  }
  if (result.calibration) result.calibration.pointsLength *= factor
  if (!validScale(result) || (result.calibration && !Number.isFinite(result.calibration.pointsLength))) {
    throw new Error('縮尺が不正です。')
  }
  return result
}

export function isPagePickup(mark: Pickup & { deleted?: boolean; legacyChange?: boolean }): boolean {
  return !mark.deleted && !mark.legacyChange && !!(mark.count || mark.quantity)
}

export function pickupUsesLinkedFixture(mark: Pickup, getFixture: (id: string) => CountFixture | undefined): boolean {
  return !!mark.quantity && routeMembers(mark.quantity).some(e => getFixture(e.itemId)?.link !== undefined)
    || !!mark.count && countMembers(mark.count).some(e => getFixture(e.itemId)?.link !== undefined)
}

export interface CarryOverInclude { fixtures: boolean; pickups: boolean; rooms: boolean; scales: boolean }
interface CarryOverPageContents<T> {
  pickups: T[]
  roomRegions: RoomRegion[]
  roomSetLink?: RoomSetLink
  scale?: PageScale | null
  scaleRegions?: ScaleRegion[]
}
export type CarryOverSourcePage<T> = CarryOverPageInfo & CarryOverPageContents<T>
export type CarryOverPage<T> = CarryOverPageContents<T> & { oldPage: number; newPage: number; factor: number }

export function hasCarryOverPageContents<T>(page: CarryOverSourcePage<T>, include: CarryOverInclude): boolean {
  return (include.pickups && page.pickups.length > 0)
    || (include.rooms && (page.roomRegions.length > 0 || !!page.roomSetLink))
    || (include.scales && (!!page.scale || !!page.scaleRegions?.length))
}

export function planCarryOverPages<T>(
  oldPages: ReadonlyMap<number, CarryOverSourcePage<T>>,
  newPages: readonly CarryOverPageInfo[],
  matches: readonly CarryOverMatch[],
): CarryOverPage<T>[] {
  const targets = new Map(newPages.map(page => [page.pageIndex, page]))
  return matches.flatMap(({ oldPage, newPage }) => {
    if (newPage === null) return []
    const source = oldPages.get(oldPage), target = targets.get(newPage)
    if (!source || !target) throw new Error('対応するページが見つかりません。')
    const { pickups, roomRegions, roomSetLink, scale, scaleRegions } = source
    return [{ oldPage, newPage, factor: carryOverTransform(source, target).factor,
      pickups, roomRegions, roomSetLink, scale, scaleRegions }]
  })
}
