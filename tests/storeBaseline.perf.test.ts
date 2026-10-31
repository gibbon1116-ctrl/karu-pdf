// @vitest-environment node

import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { dirname } from 'node:path'
import type { Point, Rect } from '../src/core/annotations'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import { QuantityIndex } from '../src/core/quantityIndex'
import {
  AnnotationStore,
  type DirtySummary,
  type SymbolSearchCandidate,
} from '../src/editor/AnnotationStore'
import {
  buildQuantityTableData,
  projectQuantityTable,
} from '../src/app/QuantityTable'
import { linkRelations } from '../src/app/linkRelations'
import {
  getPerfCounters,
  isPerfEnabled,
  perfCount,
  perfTime,
  resetPerfCounters,
  setPerfEnabled,
  type PerfCounter,
} from '../src/perf/counters'

type CounterSnapshot = Record<string, PerfCounter>
type PickupPoint = { pageIndex: number; center: Point }
type CandidateInput = Parameters<AnnotationStore['appendSymbolCandidates']>[0][number]
type ReferenceMark = PickupPoint & { fixtureId: string }
type CandidateState = SymbolSearchCandidate['state']

interface CandidateSummary {
  states: Record<CandidateState, number>
  otherFixture: number
  hash: string
}

const categories: CountFixture['category'][] = [
  '電灯', 'コンセント', '幹線', '動力', '弱電',
  '火報', '空調', '衛生', '建築', 'その他',
]

let uuidSerial = 0

beforeAll(() => {
  setPerfEnabled(true)
  // Keep UUID-bearing QuantityEntry fields deterministic as well as input data.
  vi.stubGlobal('crypto', {
    randomUUID: () =>
      `00000000-0000-4000-8000-${(++uuidSerial).toString(16).padStart(12, '0')}`,
  })
})

afterAll(() => {
  setPerfEnabled(false)
  resetPerfCounters()
  vi.unstubAllGlobals()
})

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(value)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return {
    median: sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle],
    p95: sorted[Math.ceil(0.95 * sorted.length) - 1],
    max: sorted[sorted.length - 1],
    samples,
    totalMs: samples.reduce((sum, value) => sum + value, 0),
  }
}

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now()
  const value = fn()
  return { value, ms: performance.now() - start }
}

function benchmark<T>(
  fn: () => T,
  repetitions = 10,
  prepare?: () => void,
  verify?: (value: T) => void,
) {
  prepare?.()
  const warmup = fn()
  verify?.(warmup)
  const samples: number[] = []
  for (let i = 0; i < repetitions; i++) {
    prepare?.()
    const measured = timed(fn)
    samples.push(measured.ms)
    verify?.(measured.value)
  }
  return summarize(samples)
}

function counterDelta(before: CounterSnapshot, after: CounterSnapshot) {
  return Object.fromEntries(
    [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
      .map(name => {
        const previous = before[name] ?? { count: 0, totalMs: 0, maxMs: 0 }
        const current = after[name] ?? { count: 0, totalMs: 0, maxMs: 0 }
        return [name, {
          count: current.count - previous.count,
          totalMs: current.totalMs - previous.totalMs,
          // A cumulative maximum is not additive; retain both endpoints.
          maxMsBefore: previous.maxMs,
          maxMsAfter: current.maxMs,
        }]
      }),
  )
}

function mergeCounters(target: CounterSnapshot, source: CounterSnapshot): void {
  for (const [name, counter] of Object.entries(source)) {
    const current = target[name] ?? { count: 0, totalMs: 0, maxMs: 0 }
    current.count += counter.count
    current.totalMs += counter.totalMs
    current.maxMs = Math.max(current.maxMs, counter.maxMs)
    target[name] = current
  }
}

function pickup(j: number, pages: number): PickupPoint {
  return {
    pageIndex: (j * 7) % pages,
    center: [
      20 + (j % 40) * 11,
      20 + (Math.floor(j / 40) % 50) * 11,
    ],
  }
}

function makeFixtures(count: number): CountFixture[] {
  return Array.from({ length: count }, (_, i): CountFixture => ({
    id: 'f' + i,
    code: 'F' + String(i).padStart(4, '0'),
    name: '項目' + i,
    category: categories[i % 10],
    order: i,
    kind: 'count',
    style: nextCountStyle([]),
    ...(i % 10 === 0 ? {
      breakdown: {
        book: '電気設備',
        section: '庁舎',
        subject: '電灯設備',
        middle: '電灯分岐',
        item: '分電盤',
      },
    } : {}),
  }))
}

function candidateSummary(
  candidates: readonly Pick<SymbolSearchCandidate, 'pageIndex' | 'state' | 'otherFixture'>[],
): CandidateSummary {
  const states: Record<CandidateState, number> = {
    pending: 0, chosen: 0, counted: 0,
  }
  let otherFixture = 0
  for (const candidate of candidates) {
    states[candidate.state]++
    if (candidate.otherFixture !== undefined) otherFixture++
  }
  return {
    states,
    otherFixture,
    hash: fnv1a(candidates
      .map(candidate =>
        `${candidate.pageIndex}:${candidate.state}:${candidate.otherFixture ?? ''}`)
      .join('|')),
  }
}

function referenceCandidateSummary(
  candidates: readonly CandidateInput[],
  marks: readonly ReferenceMark[],
): CandidateSummary {
  const byPage = new Map<number, ReferenceMark[]>()
  for (const mark of marks) {
    const list = byPage.get(mark.pageIndex) ?? []
    list.push(mark)
    byPage.set(mark.pageIndex, list)
  }
  return candidateSummary(candidates.map(candidate => {
    const onPage = byPage.get(candidate.pageIndex) ?? []
    const distance = (mark: ReferenceMark) =>
      Math.hypot(
        mark.center[0] - candidate.center[0],
        mark.center[1] - candidate.center[1],
      )
    if (onPage.some(mark => mark.fixtureId === 'f0' && distance(mark) <= 6)) {
      return { pageIndex: candidate.pageIndex, state: 'counted' as const }
    }
    let nearestDistance = Infinity
    let otherFixture: string | undefined
    for (const mark of onPage) {
      if (mark.fixtureId === 'f0') continue
      const currentDistance = distance(mark)
      if (currentDistance <= 6 && currentDistance < nearestDistance) {
        nearestDistance = currentDistance
        otherFixture = mark.fixtureId
      }
    }
    return { pageIndex: candidate.pageIndex, state: 'pending' as const, otherFixture }
  }))
}

function selectionBenchmark(
  store: AnnotationStore,
  fixtureCount: number,
  uiRecompute: () => unknown,
  withListener: boolean,
) {
  const expectedIndex = store.quantityIndex()
  const unsubscribe = withListener
    ? store.subscribe(() => { uiRecompute() })
    : () => {}
  try {
    store.selectFixture('f0')
    resetPerfCounters()
    const samples: number[] = []
    const counterDeltas: ReturnType<typeof counterDelta>[] = []
    for (let k = 0; k < 100; k++) {
      const before = getPerfCounters()
      const measured = timed(() =>
        store.selectFixture('f' + ((k * 7) % fixtureCount)))
      samples.push(measured.ms)
      counterDeltas.push(counterDelta(before, getPerfCounters()))
    }
    const counters = getPerfCounters()
    expect(store.selectedFixtureId).toBe('f' + ((99 * 7) % fixtureCount))
    expect(store.quantityIndex()).toBe(expectedIndex)
    expect(counters['store.notify.uiOnly']?.count).toBe(100)
    expect(counters['store.notify.ui']?.count ?? 0).toBe(0)
    expect(counters['store.notify.quantity']?.count ?? 0).toBe(0)
    expect(counters['store.listenerCalls']?.count ?? 0).toBe(withListener ? 100 : 0)
    expect(counters['store.getCountFixtures']?.count ?? 0).toBe(withListener ? 100 : 0)
    expect(counters['QuantityIndex.build']?.count ?? 0).toBe(0)
    return { ...summarize(samples), counters, counterDeltas }
  } finally {
    unsubscribe()
  }
}

function mutationBenchmark(
  store: AnnotationStore,
  points: PickupPoint[],
  repetitions: number,
) {
  const baselineTotal = store.quantityIndex().total('f1')
  const addSamples: number[] = []
  const undoSamples: number[] = []
  const redoSamples: number[] = []
  for (let trial = -1; trial < repetitions; trial++) {
    if (trial === 0) resetPerfCounters()
    const added = timed(() => {
      const ids = store.createCountMarks('f1', points)
      return { ids, index: store.quantityIndex() }
    })
    expect(added.value.ids).toHaveLength(points.length)
    expect(added.value.index.total('f1')).toBe(baselineTotal + points.length)

    const undone = timed(() => {
      store.undo()
      return store.quantityIndex()
    })
    expect(undone.value.total('f1')).toBe(baselineTotal)
    expect(added.value.ids.every(id => store.get(id) === undefined)).toBe(true)

    const redone = timed(() => {
      store.redo()
      return store.quantityIndex()
    })
    expect(redone.value.total('f1')).toBe(baselineTotal + points.length)
    expect(added.value.ids.every(id => store.get(id) !== undefined)).toBe(true)

    if (trial >= 0) {
      addSamples.push(added.ms)
      undoSamples.push(undone.ms)
      redoSamples.push(redone.ms)
    }
    // Restore active quantities before the next sample.
    store.undo()
    expect(store.quantityIndex().total('f1')).toBe(baselineTotal)
  }
  return {
    addAndIndex: summarize(addSamples),
    undoAndIndex: summarize(undoSamples),
    redoAndIndex: summarize(redoSamples),
    countersIncludingCleanup: getPerfCounters(),
  }
}

function symbolBenchmark(
  store: AnnotationStore,
  markCount: number,
  pages: number,
  candidateCount: number,
  referenceMarks: ReferenceMark[],
) {
  const candidates: CandidateInput[] = Array.from(
    { length: candidateCount },
    (_, c) => {
      const point = c % 2 === 0
        ? pickup((c * 13) % markCount, pages)
        : {
          pageIndex: c % pages,
          center: [25 + (c % 37) * 13, 25 + (c % 41) * 13] as Point,
        }
      const [x, y] = point.center
      return {
        ...point,
        rect: [x - 6, y - 6, x + 6, y + 6] as Rect,
        score: 0.9,
        confidence: c % 3 === 0 ? 'high' : 'check',
      }
    },
  )
  const addedPoint: PickupPoint = { pageIndex: 0, center: [470, 590] }
  const expectedAppend = referenceCandidateSummary(candidates, referenceMarks)
  const expectedAdd = referenceCandidateSummary(
    candidates, [...referenceMarks, { ...addedPoint, fixtureId: 'f1' }],
  )
  const baselineTotal = store.quantityIndex().total('f1')
  const appendSamples: number[] = []
  const addSamples: number[] = []
  const appendCounters: CounterSnapshot = {}
  const addCounters: CounterSnapshot = {}
  let afterAppend: CandidateSummary | undefined
  let afterAdd: CandidateSummary | undefined

  for (let trial = -1; trial < 10; trial++) {
    store.selectFixture('f0')
    store.beginSymbolCandidates('f0', [0, 0, 12, 12])
    let added = false
    try {
      resetPerfCounters()
      const appended = timed(() => store.appendSymbolCandidates(candidates))
      const currentAppendCounters = getPerfCounters()
      afterAppend = candidateSummary(store.symbolCandidates!)
      expect(store.symbolCandidates).toHaveLength(candidateCount)
      expect(afterAppend).toEqual(expectedAppend)
      expect(afterAppend.states.counted).toBeGreaterThan(0)
      expect(afterAppend.otherFixture).toBeGreaterThan(0)
      expect(currentAppendCounters['store.refreshSymbolCandidates']?.count).toBe(1)

      resetPerfCounters()
      const creation = timed(() => store.createCountMarks('f1', [addedPoint]))
      added = true
      const currentAddCounters = getPerfCounters()
      afterAdd = candidateSummary(store.symbolCandidates!)
      expect(creation.value).toHaveLength(1)
      expect(afterAdd).toEqual(expectedAdd)
      expect(store.quantityIndex().total('f1')).toBe(baselineTotal + 1)
      expect(currentAddCounters['store.refreshSymbolCandidates']?.count).toBe(1)

      if (trial >= 0) {
        appendSamples.push(appended.ms)
        addSamples.push(creation.ms)
        mergeCounters(appendCounters, currentAppendCounters)
        mergeCounters(addCounters, currentAddCounters)
      }
    } finally {
      if (added) store.undo()
      store.clearSymbolCandidates()
    }
    expect(store.quantityIndex().total('f1')).toBe(baselineTotal)
    expect(store.symbolCandidates).toBeNull()
  }
  return {
    K: candidateCount,
    append: summarize(appendSamples),
    addWithCandidateRefresh: summarize(addSamples),
    appendCounters,
    addCounters,
    afterAppend: afterAppend!,
    afterAdd: afterAdd!,
  }
}

async function runConfig(F: number, M: number, P: number) {
  uuidSerial = 0
  const fixtures = makeFixtures(F)
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  const loadedFixtures = store.getCountFixtures()
  expect(loadedFixtures).toHaveLength(F)
  expect(loadedFixtures.filter(fixture => fixture.breakdown !== undefined))
    .toHaveLength(F / 10)

  const byFixture: PickupPoint[][] = Array.from({ length: F }, () => [])
  for (let j = 0; j < M; j++) byFixture[j % F].push(pickup(j, P))
  for (let i = 0; i < F; i++) {
    expect(store.createCountMarks('f' + i, byFixture[i]))
      .toHaveLength(byFixture[i].length)
  }

  const index = store.quantityIndex()
  for (let i = 0; i < F; i++) expect(index.total('f' + i)).toBe(M / F)

  // These are the public annotations requested by the SPEC, without a cast.
  const allPickups = Array.from({ length: P }, (_, p) =>
    store.getPageAnnotations(p)).flat()
  expect(allPickups).toHaveLength(M)
  const referenceMarks: ReferenceMark[] = allPickups.map(annotation => {
    const count = annotation.count
    if (!count || count.version !== 2) throw new Error('Expected version-2 count')
    return {
      fixtureId: count.fixtureId,
      pageIndex: annotation.pageIndex,
      center: [
        (annotation.rect[0] + annotation.rect[2]) / 2,
        (annotation.rect[1] + annotation.rect[3]) / 2,
      ],
    }
  })

  const data = buildQuantityTableData(index, fixtures)
  const project = (groupByBreakdown: boolean) =>
    projectQuantityTable(data, 'page', {}, () => null, { groupByBreakdown })
  const groupedProjection = project(true)
  const plainProjection = project(false)
  expect(data).toHaveLength(F)
  expect(data.reduce((sum, item) => sum + item.total, 0)).toBe(M)
  expect(groupedProjection.rows.filter(row => row.item)).toHaveLength(F)
  // Without breakdownOrder, the supplied implementation uses category order.
  expect(groupedProjection.rows).toEqual(plainProjection.rows)

  const expectedDirty: DirtySummary = {
    annotations: M, fixtures: false, scales: [], drawings: [],
    rooms: [], roomSets: false,
  }
  expect(store.dirtySummary()).toEqual(expectedDirty)
  const equivalence = {
    totalsHash: fnv1a(JSON.stringify(
      data.map(item => [item.fixture.id, item.total] as const)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
    )),
    groupedRows: groupedProjection.rows.length,
    groupedRowsHash: fnv1a(JSON.stringify(groupedProjection.rows)),
    dirtySummary: store.dirtySummary(),
    dirtySummaryJson: JSON.stringify(store.dirtySummary()),
  }

  const uiRecompute = () => {
    const currentFixtures = store.getCountFixtures()
    const relations = linkRelations(currentFixtures)
    const currentData = buildQuantityTableData(store.quantityIndex(), currentFixtures)
    const projection = projectQuantityTable(
      currentData, 'page', {}, () => null, { groupByBreakdown: true },
    )
    return { relations, projection }
  }

  resetPerfCounters()
  const timings = {
    getCountFixtures: benchmark(
      () => store.getCountFixtures(), 10, undefined,
      value => { expect(value).toHaveLength(F) },
    ),
    quantityIndexBuild: benchmark(
      () => QuantityIndex.build(allPickups, fixtures), 10, undefined,
      value => { expect(value.total('f0')).toBe(M / F) },
    ),
    buildQuantityTableData: benchmark(
      () => buildQuantityTableData(index, fixtures), 10, undefined,
      value => {
        expect(value).toHaveLength(F)
        expect(value.reduce((sum, item) => sum + item.total, 0)).toBe(M)
      },
    ),
    linkRelations: benchmark(
      () => linkRelations(fixtures), 10, undefined,
      value => {
        expect(value.sources.size).toBe(0)
        expect(value.dependents.size).toBe(0)
      },
    ),
    projectGrouped: benchmark(
      () => project(true), 10, undefined,
      value => { expect(value.rows.length).toBe(groupedProjection.rows.length) },
    ),
    projectUngrouped: benchmark(
      () => project(false), 10, undefined,
      value => { expect(value.rows.length).toBe(plainProjection.rows.length) },
    ),
    uiRecompute: benchmark(
      uiRecompute, 10, undefined,
      value => { expect(value.projection.rows.length).toBe(groupedProjection.rows.length) },
    ),
  }

  const selection = {
    withoutListener: selectionBenchmark(store, F, uiRecompute, false),
    withUiListener: selectionBenchmark(store, F, uiRecompute, true),
  }

  resetPerfCounters()
  // Selection is a UI-only notification (SPEC-P02): the cached summary is kept.
  store.dirtySummary()
  resetPerfCounters()
  for (let k = 0; k < 10; k++) { store.selectFixture('f' + k); store.dirtySummary() }
  const dirtySummaryAfterSelection = getPerfCounters()['store.dirtySummary.compute']?.count ?? 0
  expect(dirtySummaryAfterSelection).toBe(0)
  resetPerfCounters()
  // Force the full computation (same work as before SPEC-P02) to keep its time comparable.
  const dirtySummary = benchmark(
    () => store.dirtySummary(), 10,
    () => { (store as unknown as { contentRevision: number }).contentRevision += 1 },
    value => { expect(value).toEqual(expectedDirty) },
  )
  const dirtySummaryCounters = getPerfCounters()
  expect(dirtySummaryCounters['store.dirtySummary.compute']?.count).toBe(11)
  const cachedDirty = store.dirtySummary()
  expect(store.dirtySummary()).toBe(cachedDirty)
  expect(getPerfCounters()['store.dirtySummary.compute']?.count).toBe(11)

  const tenPages = Array.from({ length: 10 }, (_, p) => p)
  const pageScans = {
    getPageAnnotations: benchmark(
      () => tenPages.map(p => store.getPageAnnotations(p)), 10, undefined,
      value => {
        expect(value).toHaveLength(10)
        for (let p = 0; p < value.length; p++) {
          expect(value[p]).toHaveLength(M / P)
          expect(value[p].every(annotation => annotation.pageIndex === p)).toBe(true)
        }
      },
    ),
    countOverlayObjNums: benchmark(
      () => tenPages.map(p => store.countOverlayObjNums(p)), 10, undefined,
      value => { expect(value).toEqual(tenPages.map(() => [])) },
    ),
    issueOverlayObjNums: benchmark(
      () => tenPages.map(p => store.issueOverlayObjNums(p)), 10, undefined,
      value => { expect(value).toEqual(tenPages.map(() => [])) },
    ),
  }

  const onePoint = mutationBenchmark(
    store, [{ pageIndex: 0, center: [480, 590] }], 10,
  )
  const hundredPoints = mutationBenchmark(
    store,
    Array.from({ length: 100 }, (_, i): PickupPoint => ({
      pageIndex: 0, center: [(i + 1) * 5, 590],
    })),
    5,
  )
  const symbolCandidates = {
    K500: symbolBenchmark(store, M, P, 500, referenceMarks),
    K2000: symbolBenchmark(store, M, P, 2000, referenceMarks),
  }

  for (let i = 0; i < F; i++) {
    expect(store.quantityIndex().total('f' + i)).toBe(M / F)
  }
  expect(store.dirtySummary()).toEqual(expectedDirty)

  return {
    F, M, P,
    timingUnit: 'ms',
    warmups: 1,
    repetitions: 10,
    selectionRepetitions: 100,
    hundredPointRepetitions: 5,
    hashEncoding: 'UTF-8',
    candidateHashSeparator: '|',
    breakdownOrderProvided: false,
    effectiveProjectionGrouping: 'category',
    overlayInputs: 'unsaved count marks with null objNum; no issues',
    mutationCleanup: 'undo after redo; deleted annotations remain in the store',
    equivalence,
    timings,
    selection,
    dirtySummary,
    dirtySummaryCounters,
    dirtySummaryAfterSelection,
    pageScans,
    onePoint,
    hundredPoints,
    symbolCandidates,
  }
}

it('preserves counter values, cloning, disabled calls and thrown errors', () => {
  resetPerfCounters()
  try {
    expect(isPerfEnabled()).toBe(true)
    perfCount('test.count')
    perfCount('test.count', 4)
    expect(getPerfCounters()['test.count'])
      .toEqual({ count: 5, totalMs: 0, maxMs: 0 })

    const snapshot = getPerfCounters()
    snapshot['test.count'].count = 999
    delete snapshot['test.count']
    expect(getPerfCounters()['test.count'].count).toBe(5)

    const value = { unchanged: true }
    expect(perfTime('test.return', () => value)).toBe(value)
    const failure = new Error('expected failure')
    expect(() => perfTime('test.throw', () => { throw failure })).toThrow(failure)
    expect(getPerfCounters()['test.return'].count).toBe(1)
    expect(getPerfCounters()['test.throw'].count).toBe(1)

    setPerfEnabled(false)
    const before = getPerfCounters()
    const now = vi.spyOn(performance, 'now')
    try {
      perfCount('test.disabled')
      expect(perfTime('test.disabled', () => value)).toBe(value)
      expect(() => perfTime('test.disabled', () => { throw failure })).toThrow(failure)
      expect(now).not.toHaveBeenCalled()
      expect(getPerfCounters()).toEqual(before)
    } finally {
      now.mockRestore()
    }

    resetPerfCounters()
    expect(getPerfCounters()).toEqual({})
  } finally {
    setPerfEnabled(true)
    resetPerfCounters()
  }
}, 300_000)

it('records the deterministic S and L store baselines', async () => {
  const configs = {
    S: await runConfig(100, 1_000, 10),
    L: await runConfig(1_000, 10_000, 100),
  }
  let commit: string | null = null
  try {
    commit = execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    commit = null
  }

  const cpus = os.cpus()
  const result = {
    kind: 'karu-store-baseline',
    node: process.version,
    cpu: cpus[0]?.model,
    cpuCount: cpus.length,
    totalMemGiB: os.totalmem() / (1024 ** 3),
    commit,
    configs,
  }
  console.log('KARU-PERF-STORE ' + JSON.stringify(result))

  const outputPath = process.env.KARU_PERF_OUT
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8')
  }
}, 300_000)
