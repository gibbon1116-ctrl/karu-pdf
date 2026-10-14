import { validFixtureBreakdown, type BreakdownPosition, type CountFixture } from '../core/countFixtures'

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
  /** 編ごとの別紙明細の名前。標準書式に無い位置へ移した別紙明細も別紙明細として扱うため（R6e）。 */
  separateNames?: ReadonlyMap<string, ReadonlySet<string>>
}

/** その位置の行が別紙明細か。標準書式に無い位置は、同じ編に同じ名前の別紙明細があれば別紙明細とする。 */
export function breakdownRowSeparate(order: QuantityBreakdownOrder, position: BreakdownPosition): boolean {
  const row = order.rows.get(quantityBreakdownRowKey(position))
  if (row) return row.separate
  return order.separateNames?.get(position.book)?.has(position.item) === true
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
  const separateNames = new Map<string, Set<string>>()
  entries.forEach((entry, index) => {
    if (entry.row.separate === true) {
      const names = separateNames.get(entry.book) ?? new Set<string>()
      names.add(entry.row.name)
      separateNames.set(entry.book, names)
    }
    const groupKey = quantityBreakdownGroupKey(entry)
    if (!groups.has(groupKey)) groups.set(groupKey, index)
    const rowKey = quantityBreakdownRowKey({ ...entry, item: entry.row.name })
    if (!rows.has(rowKey)) rows.set(rowKey, { index, separate: entry.row.separate === true })
  })
  return { groups, rows, separateNames }
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
    const aSeparate = breakdownRowSeparate(order, af.breakdown!), bSeparate = breakdownRowSeparate(order, bf.breakdown!)
    if (aSeparate !== bSeparate) return aSeparate ? 1 : -1
    return group.rowMinimumOrders.get(aKey)! - group.rowMinimumOrders.get(bKey)!
      || compareKeys(aKey, bKey)
  }))
}

export type BreakdownOutlineTarget =
  | { kind: 'fixture'; id: string; side: 'before' | 'after' }
  | { kind: 'heading'; key: string; side: 'before' | 'after' | 'inside' }

function outlinePositionsEqual(
  a: BreakdownPosition | undefined,
  b: BreakdownPosition | undefined,
): boolean {
  return a === undefined || b === undefined
    ? a === b
    : quantityBreakdownRowKey(a) === quantityBreakdownRowKey(b)
}

function sameOutlinePosition(a: CountFixture, b: CountFixture): boolean {
  return outlinePositionsEqual(a.breakdown, b.breakdown)
}

/** Heading keys are the groupKey emitted by breakdownHeadingRows, not UI section keys. */
function movableHeadingPath(key: string): string[] | null {
  try {
    const value: unknown = JSON.parse(key)
    if (!Array.isArray(value) || value.length < 1 || value.length > 5
      || !value.every((part, index) =>
        typeof part === 'string' && (part !== '' || (value.length === 5 && index === 3)),
      )) return null
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

const OUTLINE_ITEM_DROP_STATUS = '科目より下の見出しか項目へ落としてください'
const OUTLINE_HEADING_DROP_STATUS = '同じ階層の見出し、または1つ上の見出しへ落としてください'
const UNLOCATED_HEADING_KEY = JSON.stringify([null])

function outlinePositionError(position: BreakdownPosition | undefined): string | null {
  if (position === undefined || validFixtureBreakdown(position)) return null
  return '移す先の内訳書の位置が保存条件を満たしません（編、空欄、文字数、前後の空白・改行を確認してください）'
}

function fixtureAtOutlinePosition(
  fixture: CountFixture,
  position: BreakdownPosition | undefined,
): CountFixture {
  if (outlinePositionsEqual(fixture.breakdown, position)) return fixture
  if (position !== undefined) return { ...fixture, breakdown: { ...position } }
  const next = { ...fixture }
  delete next.breakdown
  return next
}

export function fixtureOutlineMoveError(
  _source: CountFixture,
  position: BreakdownPosition | undefined,
  _order: QuantityBreakdownOrder,
): string | null {
  return outlinePositionError(position)
}

type ResolvedOutlineFixtureMove =
  | {
    position: BreakdownPosition | undefined
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
  if (!source) return { error: '移す項目が見つかりません' }

  if (target.kind === 'fixture') {
    const destination = fixtures.find(fixture => fixture.id === target.id)
    if (!destination) return { error: '移す先の項目が見つかりません' }
    const position = destination.breakdown
    const error = outlinePositionError(position)
    return error ? { error } : { position, destination, side: target.side }
  }

  if (target.key === UNLOCATED_HEADING_KEY) {
    const destination = fixtures.filter(fixture =>
      fixture.id !== sourceId && fixture.breakdown === undefined,
    ).sort((a, b) => a.order - b.order).at(-1)
    return { position: undefined, destination, side: 'after' }
  }

  const path = movableHeadingPath(target.key)
  if (!path || path.length < 3) return { error: OUTLINE_ITEM_DROP_STATUS }
  const position: BreakdownPosition = {
    book: path[0] as BreakdownPosition['book'],
    section: path[1],
    subject: path[2],
    ...(path[3] ? { middle: path[3] } : {}),
    item: path.length === 5 ? path[4] : source.breakdown?.item ?? source.name.slice(0, 40),
  }
  const error = outlinePositionError(position)
  if (error) return { error }

  const headingMembers = orderByBreakdown(fixtures, fixture => fixture, order)
    .filter(fixture => belongsToHeading(fixture, path, order))
  if (!headingMembers.length) return { error: '移す先の見出しが見つかりません' }
  const members = headingMembers.filter(fixture =>
    fixture.id !== sourceId
      && quantityBreakdownGroupKey(fixture.breakdown!) === quantityBreakdownGroupKey(position),
  )
  const peers = members.filter(fixture =>
    quantityBreakdownRowKey(fixture.breakdown!) === quantityBreakdownRowKey(position),
  )
  if (peers.length) return { position, destination: peers.at(-1), side: 'after' }
  if (path.length === 5) return { position, destination: members.at(-1), side: 'after' }

  const destination = members.filter(fixture =>
    !breakdownRowSeparate(order, fixture.breakdown!),
  ).at(-1)
  if (destination) return { position, destination, side: 'after' }
  // A new ordinary detail precedes the group's separate details.
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

/** Append one fixture, or its whole detail, to a valid position, including no position. */
export function moveFixturesToOutlinePosition(
  fixtures: readonly CountFixture[],
  sourceId: string,
  position: BreakdownPosition | undefined,
  order: QuantityBreakdownOrder,
  allAtPosition = false,
): CountFixture[] | null {
  const source = fixtures.find(fixture => fixture.id === sourceId)
  if (!source || fixtureOutlineMoveError(source, position, order)) return null
  if (outlinePositionsEqual(source.breakdown, position)) return null

  const ordered = orderByBreakdown(fixtures, fixture => fixture, order)
  const block = ordered.filter(fixture =>
    fixture.id === sourceId || (allAtPosition && sameOutlinePosition(source, fixture)),
  )
  const movingIds = new Set(block.map(fixture => fixture.id))
  const remaining = ordered.filter(fixture => !movingIds.has(fixture.id))
  const rowKey = position ? quantityBreakdownRowKey(position) : ''
  const groupKey = position ? quantityBreakdownGroupKey(position) : ''
  const rowIndexes = remaining.flatMap((fixture, index) =>
    outlinePositionsEqual(fixture.breakdown, position) ? [index] : [],
  )
  let insertion: number
  if (rowIndexes.length) {
    insertion = rowIndexes.at(-1)! + 1
  } else if (!position) {
    insertion = remaining.length
  } else {
    const groupIndexes = remaining.flatMap((fixture, index) =>
      fixture.breakdown && quantityBreakdownGroupKey(fixture.breakdown) === groupKey ? [index] : [],
    )
    if (groupIndexes.length) {
      const separate = breakdownRowSeparate(order, position)
      const ordinaryIndexes = groupIndexes.filter(index =>
        !breakdownRowSeparate(order, remaining[index].breakdown!),
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
  remaining.splice(insertion, 0, ...block.map(fixture => fixtureAtOutlinePosition(fixture, position)))
  // 置いた並びで order を付け直してから、見出しの並びにそろえる（古い order で並べると移した位置がずれる）。
  return assignOutlineOrders(orderByBreakdown(assignOutlineOrders(remaining), fixture => fixture, order))
}

export function moveFixtureInOutline(
  fixtures: readonly CountFixture[],
  sourceId: string,
  target: BreakdownOutlineTarget,
  order: QuantityBreakdownOrder,
): CountFixture[] | null {
  const source = fixtures.find(fixture => fixture.id === sourceId)
  if (!source) return null

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
  moved.splice(targetIndex + (side === 'after' ? 1 : 0), 0, fixtureAtOutlinePosition(source, position))
  if (outlinePositionsEqual(source.breakdown, position)
    && moved.every((fixture, index) => fixture.id === ordered[index].id)) return null
  return assignOutlineOrders(orderByBreakdown(assignOutlineOrders(moved), fixture => fixture, order))
}

type ResolvedOutlineHeadingMove =
  | {
    sourcePath: string[]
    targetPath: string[]
    block: CountFixture[]
    movedBlock: CountFixture[]
  }
  | { error: string }

function resolveOutlineHeadingMove(
  fixtures: readonly CountFixture[],
  headingKey: string,
  target: BreakdownOutlineTarget,
  order: QuantityBreakdownOrder,
): ResolvedOutlineHeadingMove {
  if (target.kind !== 'heading') return { error: OUTLINE_HEADING_DROP_STATUS }
  const sourcePath = movableHeadingPath(headingKey)
  const targetPath = movableHeadingPath(target.key)
  if (!sourcePath || sourcePath.length < 2 || !targetPath
    || (targetPath.length !== sourcePath.length && targetPath.length !== sourcePath.length - 1)) {
    return { error: OUTLINE_HEADING_DROP_STATUS }
  }

  const ordered = orderByBreakdown(fixtures, fixture => fixture, order)
  const block = ordered.filter(fixture => belongsToHeading(fixture, sourcePath, order))
  if (!block.length) return { error: '移す見出しが見つかりません' }
  if (!ordered.some(fixture => belongsToHeading(fixture, targetPath, order))) {
    return { error: '移す先の見出しが見つかりません' }
  }
  const parentPath = targetPath.length === sourcePath.length ? targetPath.slice(0, -1) : targetPath
  const nextPath = [...parentPath, sourcePath.at(-1)!]
  const movedBlock: CountFixture[] = []
  for (const fixture of block) {
    const current = fixture.breakdown!
    const currentPath = [current.book, current.section, current.subject, current.middle ?? '', current.item]
    const rewritten = [...nextPath, ...currentPath.slice(sourcePath.length)]
    const position: BreakdownPosition = {
      book: rewritten[0] as BreakdownPosition['book'],
      section: rewritten[1],
      subject: rewritten[2],
      ...(rewritten[3] ? { middle: rewritten[3] } : {}),
      item: rewritten[4],
    }
    const error = outlinePositionError(position)
    if (error) return { error }
    movedBlock.push(fixtureAtOutlinePosition(fixture, position))
  }
  return { sourcePath, targetPath, block, movedBlock }
}

export function headingOutlineDropError(
  fixtures: readonly CountFixture[],
  headingKey: string,
  target: BreakdownOutlineTarget,
  order: QuantityBreakdownOrder,
): string | null {
  const resolved = resolveOutlineHeadingMove(fixtures, headingKey, target, order)
  return 'error' in resolved ? resolved.error : null
}

export function moveHeadingInOutline(
  fixtures: readonly CountFixture[],
  headingKey: string,
  target: BreakdownOutlineTarget,
  order: QuantityBreakdownOrder,
): CountFixture[] | null {
  if (target.kind === 'heading' && headingKey === target.key) return null
  const resolved = resolveOutlineHeadingMove(fixtures, headingKey, target, order)
  if ('error' in resolved || target.kind !== 'heading') return null
  const { sourcePath, targetPath, block, movedBlock } = resolved

  const ordered = orderByBreakdown(fixtures, fixture => fixture, order)
  const movingIds = new Set(block.map(fixture => fixture.id))
  const remaining = ordered.filter(fixture => !movingIds.has(fixture.id))
  const targetIndexes = remaining.flatMap((fixture, index) =>
    belongsToHeading(fixture, targetPath, order) ? [index] : [],
  )
  if (!targetIndexes.length) return null
  const sameLevel = sourcePath.length === targetPath.length
  const destination = sameLevel && target.side === 'before'
    ? targetIndexes[0] : targetIndexes.at(-1)! + 1
  remaining.splice(destination, 0, ...movedBlock)
  // 置いた並びで order を付け直してから見出しの並びにそろえる（古い order で並べると移した位置がずれる）。
  const next = orderByBreakdown(assignOutlineOrders(remaining), fixture => fixture, order)
  if (next.every((fixture, index) => fixture.id === ordered[index].id
    && outlinePositionsEqual(fixture.breakdown, ordered[index].breakdown))) return null
  return assignOutlineOrders(next)
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
  const separate = breakdownRowSeparate(order, position)
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
