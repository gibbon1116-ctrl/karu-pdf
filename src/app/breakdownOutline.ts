import type { BreakdownPosition, CountFixture } from '../core/countFixtures'

export type BreakdownGroupPosition = Pick<BreakdownPosition, 'book' | 'section' | 'subject' | 'middle'>
export type BreakdownHeadingLevel = 0 | 1 | 2 | 3 | 4
export interface BreakdownHeading {
  category: string
  level: BreakdownHeadingLevel
  groupKey: string
}
export interface QuantityBreakdownOrder {
  groups: ReadonlyMap<string, number>
  rows: ReadonlyMap<string, { index: number; separate: boolean }>
}

export function quantityBreakdownGroupKey(position: BreakdownGroupPosition): string {
  return JSON.stringify([position.book, position.section, position.subject, position.middle ?? ''])
}

export function quantityBreakdownRowKey(position: BreakdownPosition): string {
  return JSON.stringify([position.book, position.section, position.subject, position.middle ?? '', position.item])
}

/** Accept master entries as data; never import the master statically. */
export function createQuantityBreakdownOrder(
  entries: readonly (BreakdownGroupPosition & { row: { name: string; separate?: boolean } })[],
): QuantityBreakdownOrder {
  const groups = new Map<string, number>()
  const rows = new Map<string, { index: number; separate: boolean }>()
  entries.forEach((entry, index) => {
    const groupKey = quantityBreakdownGroupKey(entry)
    if (!groups.has(groupKey)) groups.set(groupKey, index)
    const rowKey = quantityBreakdownRowKey({ ...entry, item: entry.row.name })
    if (!rows.has(rowKey)) rows.set(rowKey, { index, separate: entry.row.separate === true })
  })
  return { groups, rows }
}

/** Order every heading by its minimum fixture order; ordinary details precede separate details. */
export function orderByBreakdown<T>(
  items: readonly T[],
  fixtureOf: (item: T) => CountFixture,
  order: QuantityBreakdownOrder,
): T[] {
  const minimumPrefixes = Array.from({ length: 4 }, () => new Map<string, number>())
  const groups = new Map<string, {
    path: string[]
    items: T[]
    rowMinimumOrders: Map<string, number>
  }>()
  for (const item of items) {
    const fixture = fixtureOf(item)
    const position = fixture.breakdown
    const path = position ? [position.book, position.section, position.subject, position.middle ?? ''] : []
    const key = position ? quantityBreakdownGroupKey(position) : ''
    let group = groups.get(key)
    if (!group) {
      group = { path, items: [], rowMinimumOrders: new Map() }
      groups.set(key, group)
    }
    group.items.push(item)
    if (!position) continue
    for (let level = 0; level < 4; level++) {
      const prefix = JSON.stringify(path.slice(0, level + 1))
      const previous = minimumPrefixes[level].get(prefix)
      if (previous === undefined || fixture.order < previous) minimumPrefixes[level].set(prefix, fixture.order)
    }
    const rowKey = quantityBreakdownRowKey(position)
    const previous = group.rowMinimumOrders.get(rowKey)
    if (previous === undefined || fixture.order < previous) group.rowMinimumOrders.set(rowKey, fixture.order)
  }
  const compareKeys = (a: string, b: string) =>
    a.localeCompare(b, 'ja', { numeric: true }) || (a < b ? -1 : a > b ? 1 : 0)
  return [...groups.values()].sort((a, b) => {
    if (!a.path.length) return b.path.length ? 1 : 0
    if (!b.path.length) return -1
    for (let level = 0; level < 4; level++) {
      const aKey = JSON.stringify(a.path.slice(0, level + 1))
      const bKey = JSON.stringify(b.path.slice(0, level + 1))
      if (aKey === bKey) continue
      return minimumPrefixes[level].get(aKey)! - minimumPrefixes[level].get(bKey)!
        || compareKeys(aKey, bKey)
    }
    return 0
  }).flatMap(group => group.items.sort((a, b) => {
    const af = fixtureOf(a), bf = fixtureOf(b)
    if (!group.path.length) return af.order - bf.order
    const aKey = quantityBreakdownRowKey(af.breakdown!)
    const bKey = quantityBreakdownRowKey(bf.breakdown!)
    if (aKey === bKey) return af.order - bf.order
    // 細目 themselves precede 別紙明細 groups.
    const aSeparate = order.rows.get(aKey)?.separate === true, bSeparate = order.rows.get(bKey)?.separate === true
    if (aSeparate !== bSeparate) return aSeparate ? 1 : -1
    return group.rowMinimumOrders.get(aKey)! - group.rowMinimumOrders.get(bKey)!
      || compareKeys(aKey, bKey)
  }))
}

export type BreakdownOutlineTarget =
  | { kind: 'fixture'; id: string; side: 'before' | 'after' }
  | { kind: 'heading'; key: string; side: 'before' | 'after' | 'inside' }

function sameOutlinePosition(a: CountFixture, b: CountFixture): boolean {
  return a.breakdown !== undefined && b.breakdown !== undefined
    && quantityBreakdownRowKey(a.breakdown) === quantityBreakdownRowKey(b.breakdown)
}

/** Heading keys are the groupKey emitted by breakdownHeadingRows, not UI section keys. */
function movableHeadingPath(key: string): string[] | null {
  try {
    const value: unknown = JSON.parse(key)
    if (!Array.isArray(value) || value.length < 3 || value.length > 5
      || !value.every(part => typeof part === 'string')
      || value[value.length - 1] === '') return null
    return value as string[]
  } catch {
    return null
  }
}

function belongsToHeading(
  fixture: CountFixture,
  path: readonly string[],
  order: QuantityBreakdownOrder,
): boolean {
  const fixturePath = breakdownHeadingPath(fixture, order)
  return fixturePath !== null && path.every((part, index) => fixturePath[index] === part)
}

function assignOutlineOrders(fixtures: readonly CountFixture[]): CountFixture[] {
  return fixtures.map((fixture, order) => fixture.order === order ? fixture : { ...fixture, order })
}

/** Preserve existing order slots when moving within one detail. */
function moveWithinOutlinePosition(
  fixtures: readonly CountFixture[],
  source: CountFixture,
  destination: CountFixture,
  side: 'before' | 'after',
): CountFixture[] | null {
  if (source.id === destination.id) return null
  const peers = fixtures.filter(fixture => sameOutlinePosition(source, fixture))
    .sort((a, b) => a.order - b.order)
  const moved = peers.filter(fixture => fixture.id !== source.id)
  const targetIndex = moved.findIndex(fixture => fixture.id === destination.id)
  if (targetIndex < 0) return null
  moved.splice(targetIndex + (side === 'after' ? 1 : 0), 0, source)
  if (moved.every((fixture, index) => fixture.id === peers[index].id)) return null
  const orders = new Map(moved.map((fixture, index) => [fixture.id, peers[index].order]))
  return fixtures.map(fixture => {
    const order = orders.get(fixture.id)
    return order === undefined || order === fixture.order ? fixture : { ...fixture, order }
  })
}

const OUTLINE_MOVE_STATUS = '同じ編の別紙明細同士、または同じ名前の細目がある中科目へ移せます'

export function fixtureOutlineMoveError(
  source: CountFixture,
  position: BreakdownPosition,
  order: QuantityBreakdownOrder,
): string | null {
  if (!source.breakdown) return OUTLINE_MOVE_STATUS
  if (source.breakdown.book !== position.book) return '違う編へは移せません'

  const sourceSeparate = order.rows.get(quantityBreakdownRowKey(source.breakdown))?.separate === true
  const destinationRow = order.rows.get(quantityBreakdownRowKey(position))
  if (sourceSeparate) {
    return destinationRow?.separate === true ? null : OUTLINE_MOVE_STATUS
  }
  if (position.item !== source.breakdown.item) return OUTLINE_MOVE_STATUS
  if (!destinationRow) return `移す先の中科目に「${source.breakdown.item}」の細目がありません`
  return destinationRow.separate ? OUTLINE_MOVE_STATUS : null
}

type ResolvedOutlineFixtureMove =
  | {
    position: BreakdownPosition
    destination?: CountFixture
    side: 'before' | 'after'
  }
  | { error: string }

function resolveOutlineFixtureMove(
  fixtures: readonly CountFixture[],
  sourceId: string,
  target: BreakdownOutlineTarget,
  order: QuantityBreakdownOrder,
): ResolvedOutlineFixtureMove {
  const source = fixtures.find(fixture => fixture.id === sourceId)
  if (!source?.breakdown) return { error: OUTLINE_MOVE_STATUS }
  const sourceSeparate = order.rows.get(quantityBreakdownRowKey(source.breakdown))?.separate === true

  if (target.kind === 'fixture') {
    const destination = fixtures.find(fixture => fixture.id === target.id)
    if (!destination?.breakdown) return { error: OUTLINE_MOVE_STATUS }
    if (sameOutlinePosition(source, destination)) {
      return { position: source.breakdown, destination, side: target.side }
    }

    const destinationSeparate = order.rows.get(quantityBreakdownRowKey(destination.breakdown))?.separate === true
    if (sourceSeparate !== destinationSeparate) return { error: OUTLINE_MOVE_STATUS }
    const position: BreakdownPosition = {
      ...destination.breakdown,
      item: sourceSeparate ? destination.breakdown.item : source.breakdown.item,
    }
    const error = fixtureOutlineMoveError(source, position, order)
    return error ? { error } : { position, destination, side: target.side }
  }

  const path = movableHeadingPath(target.key)
  if (!path || path.length !== (sourceSeparate ? 5 : 4)) return { error: OUTLINE_MOVE_STATUS }
  if (path[0] !== source.breakdown.book) return { error: '違う編へは移せません' }
  const position: BreakdownPosition = {
    book: source.breakdown.book,
    section: path[1],
    subject: path[2],
    ...(path[3] ? { middle: path[3] } : {}),
    item: sourceSeparate ? path[4] : source.breakdown.item,
  }
  const error = fixtureOutlineMoveError(source, position, order)
  if (error) return { error }

  const members = orderByBreakdown(fixtures, fixture => fixture, order)
    .filter(fixture => belongsToHeading(fixture, path, order))
  const destination = sourceSeparate
    ? members.at(-1)
    : members.filter(fixture =>
      order.rows.get(quantityBreakdownRowKey(fixture.breakdown!))?.separate !== true,
    ).at(-1)
  if (destination) return { position, destination, side: 'after' }
  // An ordinary row goes before the separate details when the middle has no ordinary fixtures.
  return { position, destination: members[0], side: 'before' }
}

export function fixtureOutlineDropError(
  fixtures: readonly CountFixture[],
  sourceId: string,
  target: BreakdownOutlineTarget,
  order: QuantityBreakdownOrder,
): string | null {
  const resolved = resolveOutlineFixtureMove(fixtures, sourceId, target, order)
  return 'error' in resolved ? resolved.error : null
}

/** Append one fixture, or its whole detail, to a master position, including an empty position. */
export function moveFixturesToOutlinePosition(
  fixtures: readonly CountFixture[],
  sourceId: string,
  position: BreakdownPosition,
  order: QuantityBreakdownOrder,
  allAtPosition = false,
): CountFixture[] | null {
  const source = fixtures.find(fixture => fixture.id === sourceId)
  if (!source?.breakdown || fixtureOutlineMoveError(source, position, order)) return null
  if (quantityBreakdownRowKey(source.breakdown) === quantityBreakdownRowKey(position)) return null

  const ordered = orderByBreakdown(fixtures, fixture => fixture, order)
  const block = ordered.filter(fixture =>
    fixture.id === sourceId || (allAtPosition && sameOutlinePosition(source, fixture)),
  )
  const movingIds = new Set(block.map(fixture => fixture.id))
  const remaining = ordered.filter(fixture => !movingIds.has(fixture.id))
  const rowKey = quantityBreakdownRowKey(position)
  const groupKey = quantityBreakdownGroupKey(position)
  const rowIndexes = remaining.flatMap((fixture, index) =>
    fixture.breakdown && quantityBreakdownRowKey(fixture.breakdown) === rowKey ? [index] : [],
  )
  let insertion: number
  if (rowIndexes.length) {
    insertion = rowIndexes.at(-1)! + 1
  } else {
    const groupIndexes = remaining.flatMap((fixture, index) =>
      fixture.breakdown && quantityBreakdownGroupKey(fixture.breakdown) === groupKey ? [index] : [],
    )
    if (groupIndexes.length) {
      const separate = order.rows.get(rowKey)?.separate === true
      const ordinaryIndexes = groupIndexes.filter(index =>
        order.rows.get(quantityBreakdownRowKey(remaining[index].breakdown!))?.separate !== true,
      )
      insertion = separate
        ? groupIndexes.at(-1)! + 1
        : ordinaryIndexes.length ? ordinaryIndexes.at(-1)! + 1 : groupIndexes[0]
    } else {
      // Place a new middle after the nearest existing ancestor, keeping unlocated items last.
      insertion = remaining.findIndex(fixture => fixture.breakdown === undefined)
      if (insertion < 0) insertion = remaining.length
      const path = [position.book, position.section, position.subject]
      for (let depth = path.length; depth >= 1; depth--) {
        const indexes = remaining.flatMap((fixture, index) => {
          const current = fixture.breakdown
          const currentPath = current ? [current.book, current.section, current.subject] : []
          return current && path.slice(0, depth).every((part, level) => currentPath[level] === part)
            ? [index] : []
        })
        if (indexes.length) {
          insertion = indexes.at(-1)! + 1
          break
        }
      }
    }
  }
  remaining.splice(insertion, 0, ...block.map(fixture => ({
    ...fixture,
    breakdown: { ...position },
  })))
  return assignOutlineOrders(remaining)
}

export function moveFixtureInOutline(
  fixtures: readonly CountFixture[],
  sourceId: string,
  target: BreakdownOutlineTarget,
  order: QuantityBreakdownOrder,
): CountFixture[] | null {
  const source = fixtures.find(fixture => fixture.id === sourceId)
  if (!source?.breakdown) return null

  const resolved = resolveOutlineFixtureMove(fixtures, sourceId, target, order)
  if ('error' in resolved) return null
  const { position, destination, side } = resolved
  if (!destination) return moveFixturesToOutlinePosition(fixtures, sourceId, position, order)

  if (sameOutlinePosition(source, destination)) {
    return moveWithinOutlinePosition(fixtures, source, destination, side)
  }
  const ordered = orderByBreakdown(fixtures, fixture => fixture, order)

  const moved = ordered.filter(fixture => fixture.id !== sourceId)
  const targetIndex = moved.findIndex(fixture => fixture.id === destination.id)
  if (targetIndex < 0) return null
  moved.splice(targetIndex + (side === 'after' ? 1 : 0), 0, {
    ...source,
    breakdown: { ...position },
  })
  if (quantityBreakdownRowKey(source.breakdown) === quantityBreakdownRowKey(position)
    && moved.every((fixture, index) => fixture.id === ordered[index].id)) return null
  return assignOutlineOrders(moved)
}

export function moveHeadingInOutline(
  fixtures: readonly CountFixture[],
  headingKey: string,
  target: BreakdownOutlineTarget,
  order: QuantityBreakdownOrder,
): CountFixture[] | null {
  if (target.kind !== 'heading' || target.side === 'inside' || headingKey === target.key) return null
  const sourcePath = movableHeadingPath(headingKey)
  const targetPath = movableHeadingPath(target.key)
  if (!sourcePath || !targetPath || sourcePath.length !== targetPath.length
    || JSON.stringify(sourcePath.slice(0, -1)) !== JSON.stringify(targetPath.slice(0, -1))) {
    return null
  }

  const ordered = orderByBreakdown(fixtures, fixture => fixture, order)
  const block = ordered.filter(fixture => belongsToHeading(fixture, sourcePath, order))
  if (!block.length) return null
  const remaining = ordered.filter(fixture => !belongsToHeading(fixture, sourcePath, order))
  const targetIndexes = remaining.flatMap((fixture, index) =>
    belongsToHeading(fixture, targetPath, order) ? [index] : [],
  )
  if (!targetIndexes.length) return null
  const destination = target.side === 'before' ? targetIndexes[0] : targetIndexes.at(-1)! + 1
  remaining.splice(destination, 0, ...block)
  if (remaining.every((fixture, index) => fixture.id === ordered[index].id)) return null
  return assignOutlineOrders(remaining)
}

/** Known master rows first, unknown positions next, unlocated fixtures last. */
export function sortByBreakdownMaster(
  fixtures: readonly CountFixture[],
  order: QuantityBreakdownOrder,
): CountFixture[] {
  const sorted = [...fixtures].sort((a, b) => {
    if (!a.breakdown) return b.breakdown ? 1 : a.order - b.order
    if (!b.breakdown) return -1
    const aRank = order.rows.get(quantityBreakdownRowKey(a.breakdown))?.index ?? Infinity
    const bRank = order.rows.get(quantityBreakdownRowKey(b.breakdown))?.index ?? Infinity
    return aRank - bRank || a.order - b.order
  })
  return assignOutlineOrders(sorted)
}

export function breakdownHeadingPath(
  fixture: CountFixture,
  order: QuantityBreakdownOrder,
): string[] | null {
  const position = fixture.breakdown
  if (!position) return null
  const separate = order.rows.get(quantityBreakdownRowKey(position))?.separate === true
  return [
    position.book, position.section, position.subject, position.middle ?? '',
    separate ? position.item : '',
  ]
}

/** Emit only headings that changed from the previous item's path. */
export function breakdownHeadingRows(
  path: readonly string[] | null,
  previousPath?: readonly string[] | null,
): BreakdownHeading[] {
  if (path === null) {
    return previousPath === null ? [] : [{
      category: '（内訳書の位置なし）',
      level: 0,
      groupKey: JSON.stringify([null]),
    }]
  }
  const rows: BreakdownHeading[] = []
  let changed = previousPath == null
  for (const level of [0, 1, 2, 3, 4] as const) {
    changed = changed || previousPath?.[level] !== path[level]
    if (changed && (level < 3 || path[level])) {
      rows.push({
        category: level === 4 ? `${path[level]}（別紙明細）` : path[level],
        level,
        groupKey: JSON.stringify(path.slice(0, level + 1)),
      })
    }
  }
  return rows
}
