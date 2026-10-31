import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import {
  serializeQuantityMark, type QuantityMark, type RoutePoint,
} from '../src/core/quantity'
import { AnnotationStore, type EditableAnnotation } from '../src/editor/AnnotationStore'

const { renames } = vi.hoisted(() => ({
  renames: new Map<string, Map<string, string>>(),
}))

vi.mock('../src/core/countFixtures', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/core/countFixtures')>()
  return {
    ...actual,
    quantityMethod: (fixture: { id: string }) =>
      fixture.id === 'cable' ? 'polyline' : 'click',
    fixtureConditionRenames: (fixture: { id: string }) =>
      renames.get(fixture.id) ?? new Map<string, string>(),
    fixtureDimensionUpdateEnabled: () => false,
    serializeCountFixtures: () => '',
  }
})

type TestAnnotation = EditableAnnotation & {
  deleted: boolean
  revision: number
  objNum: number | null
  madeByKaru: boolean
}
type Snapshot = TestAnnotation[] & { fixtures?: CountFixture[] }
interface Step { before: Snapshot; after: Snapshot }

const fixture = (id: string, extra: object = {}) => ({
  id, code: id, name: id, category: '試験', spec: '', ...extra,
}) as CountFixture

function mark(points?: RoutePoint[]): QuantityMark {
  return {
    version: 1, id: 'quantity', itemId: 'cable', method: 'polyline', cond: {},
    ...(points !== undefined ? { points } : {}),
  }
}

function stored(id = 'route', quantity = mark()): TestAnnotation {
  return {
    id, pageIndex: 0, kind: 'distance', objNum: null, madeByKaru: true,
    deleted: false, revision: 0, legacyChange: null,
    rect: [0, 0, 30, 0], vertices: [[0, 0], [10, 0], [20, 0], [30, 0]],
    measure: { kind: 'distance', mmPerPoint: 1000 },
    quantity, count: null, text: '経路',
    color: [1, 0, 0], borderColor: null, interiorColor: null,
    borderWidth: 1, opacity: 1, fontSize: 10.5, font: 'BIZUDGothic',
    textOpacity: 1, boxOpacity: 1,
    line: null, quads: null, inkList: null, calloutPoint: null,
    issue: null, symbol: null,
  } as unknown as TestAnnotation
}

/**
 * コンストラクターやPDF操作に依存せず、実際のストアメソッドと mutate が
 * history.push に渡す状態を検査する。
 * undo/redo は記録された状態を復元する試験用処理であり、
 * ストアの実際の undo/redo メソッドの代用試験ではない。
 */
function harness(initial = stored(), initialFixtures = [
  fixture('cable'), fixture('fire'), fixture('linked', { link: { sources: [] } }),
]) {
  const store = Object.create(AnnotationStore.prototype) as AnnotationStore
  const annotations = new Map<string, TestAnnotation>([[initial.id, initial]])
  const steps: Step[] = []
  let cursor = 0
  const refreshQuantity = vi.fn()
  let currentFixtures = structuredClone(initialFixtures)

  const restore = (step: Step, snapshot: Snapshot) => {
    for (const id of new Set([...step.before, ...step.after].map(a => a.id))) {
      annotations.delete(id)
    }
    for (const a of snapshot) annotations.set(a.id, structuredClone(a))
    if (snapshot.fixtures) {
      currentFixtures = structuredClone(snapshot.fixtures)
      Object.assign(store, { fixtures: currentFixtures })
    }
  }

  Object.assign(store, {
    annotations,
    selection: new Set<string>(),
    fixtures: currentFixtures,
    recentFixtures: [],
    contentRevision: 0,
    vertexHighlight: null,
    riseHighlight: null,
    lastRouteConditions: new Map(),
    lastRouteMembers: new Map(),
    lastCountComponents: new Map(),
    lastCondition: new Map(),
    routeTemplate: undefined,
    history: {
      push(step: Step) {
        steps.splice(cursor)
        steps.push(structuredClone(step))
        cursor++
      },
    },
    get: (id: string) => annotations.get(id) ?? null,
    getCountFixture: (id: string) => currentFixtures.find(f => f.id === id),
    getCountFixtures: () => structuredClone(currentFixtures),
    replaceFixtures: (fixtures: CountFixture[]) => {
      currentFixtures = fixtures
      Object.assign(store, { fixtures })
    },
    refreshQuantity,
    quantityText: () => '経路',
    applyFixtureToQuantity: (a: TestAnnotation, f: CountFixture) => {
      a.quantity!.itemId = f.id
      refreshQuantity(a)
    },
    markTouched: vi.fn(),
    notify: vi.fn(),
    pruneHiddenSelection: vi.fn(),
    drawingFilterActive: () => false,
  })

  return {
    store, annotations, steps, refreshQuantity,
    undo() {
      if (cursor === 0) return
      const step = steps[--cursor]
      restore(step, step.before)
    },
    redo() {
      if (cursor >= steps.length) return
      const step = steps[cursor++]
      restore(step, step.after)
    },
  }
}

beforeEach(() => { renames.clear() })

describe('AnnotationStore の頂点の個数', () => {
  it('1回の履歴に記録し、呼び出し元の配列と切り離す', () => {
    const h = harness()
    const points: RoutePoint[] = [
      { itemId: 'fire', at: 1, count: 2, condition: '壁' },
    ]
    expect(h.store.setRoutePoints('route', points)).toBeUndefined()
    expect(h.steps).toHaveLength(1)
    expect(h.steps[0].before[0].quantity).not.toHaveProperty('points')
    expect(h.steps[0].after[0].quantity?.points).toEqual(points)
    expect(h.refreshQuantity).toHaveBeenCalledTimes(1)

    points[0].count = 9
    expect(h.store.get('route')?.quantity?.points?.[0].count).toBe(2)

    h.undo()
    expect(h.store.get('route')?.quantity).not.toHaveProperty('points')
    h.redo()
    expect(h.store.get('route')?.quantity?.points).toEqual([
      { itemId: 'fire', at: 1, count: 2, condition: '壁' },
    ])
  })

  it('空配列で points を消し、その前の状態も履歴に残す', () => {
    const original = [{ itemId: 'fire', at: 1, count: 2 }]
    const h = harness(stored('route', mark(original)))
    expect(h.store.setRoutePoints('route', [])).toBeUndefined()
    expect(h.store.get('route')?.quantity).not.toHaveProperty('points')
    expect(h.steps).toHaveLength(1)
    h.undo()
    expect(h.store.get('route')?.quantity?.points).toEqual(original)
    h.redo()
    expect(h.store.get('route')?.quantity).not.toHaveProperty('points')
  })

  it('存在しない項目・長さの項目・連動項目を拒否する', () => {
    const h = harness()
    expect(h.store.setRoutePoints('route', [
      { itemId: 'missing', at: 1, count: 1 },
    ])).toMatch(/見つかりません/)
    expect(h.store.setRoutePoints('route', [
      { itemId: 'cable', at: 1, count: 1 },
    ])).toMatch(/個数の項目/)
    expect(h.store.setRoutePoints('route', [
      { itemId: 'linked', at: 1, count: 1 },
    ])).toMatch(/連動/)
    expect(h.steps).toHaveLength(0)
    expect(h.store.get('route')?.quantity).not.toHaveProperty('points')
  })

  it('不正な数・重複・51件を拒否し、状態を変えない', () => {
    const h = harness()
    expect(h.store.setRoutePoints('route', [
      { itemId: 'fire', at: 1, count: 0 },
    ])).toBeTypeOf('string')
    expect(h.store.setRoutePoints('route', [
      { itemId: 'fire', at: 1, count: 1 },
      { itemId: 'fire', at: 1, count: 2 },
    ])).toBeTypeOf('string')
    expect(h.store.setRoutePoints('route', Array.from({ length: 51 }, (_, at) => ({
      itemId: 'fire', at, count: 1,
    })))).toBeTypeOf('string')
    expect(h.steps).toHaveLength(0)
    expect(h.store.get('route')?.quantity).not.toHaveProperty('points')
  })

  it('経路以外・削除済み・存在しない印には設定できない', () => {
    const area = stored('area', { ...mark(), method: 'polygon' })
    expect(harness(area).store.setRoutePoints('area', []))
      .toMatch(/設定できません/)
    const deleted = stored()
    deleted.deleted = true
    expect(harness(deleted).store.setRoutePoints('route', []))
      .toMatch(/設定できません/)
    expect(harness().store.setRoutePoints('missing', []))
      .toMatch(/設定できません/)
  })

  it('8,000字を超える編集を履歴や状態を変える前に拒否する', () => {
    const itemId = 'x'.repeat(80)
    const h = harness(stored(), [fixture('cable'), fixture(itemId)])
    const points = Array.from({ length: 50 }, (_, i) => ({
      itemId, at: 1_000_000_000 + i, count: 99, condition: 'あ'.repeat(30),
    }))
    expect(serializeQuantityMark({ ...mark(), points }).length).toBeGreaterThan(8000)
    expect(h.store.setRoutePoints('route', points)).toMatch(/保存容量/)
    expect(h.steps).toHaveLength(0)
    expect(h.store.get('route')?.quantity).not.toHaveProperty('points')
  })

  it('分割頂点以上の点を後ろへ移し、頂点番号を引く', () => {
    const points = [
      { itemId: 'fire', at: 0, count: 1 },
      { itemId: 'fire', at: 1, count: 2 },
      { itemId: 'fire', at: 2, count: 3, condition: '壁' },
      { itemId: 'fire', at: 99, count: 4 },
    ]
    const h = harness(stored('route', mark(points)))
    const newId = h.store.splitRoute('route', 2)
    expect(newId).toBeTypeOf('string')
    expect(h.store.get('route')?.quantity?.points).toEqual(points.slice(0, 2))
    expect(h.store.get(newId!)?.quantity?.points).toEqual([
      { itemId: 'fire', at: 0, count: 3, condition: '壁' },
      { itemId: 'fire', at: 97, count: 4 },
    ])
    expect(h.steps).toHaveLength(1)
    h.undo()
    expect(h.store.get(newId!)).toBeNull()
    expect(h.store.get('route')?.quantity?.points).toEqual(points)
    h.redo()
    expect(h.store.get(newId!)?.quantity?.points?.[0].at).toBe(0)
  })

  it('分割で点がなくなった側には points を残さない', () => {
    const h = harness(stored('route', mark([
      { itemId: 'fire', at: 2, count: 1 },
    ])))
    const newId = h.store.splitRoute('route', 2)
    expect(h.store.get('route')?.quantity).not.toHaveProperty('points')
    expect(h.store.get(newId!)?.quantity?.points).toEqual([
      { itemId: 'fire', at: 0, count: 1 },
    ])
  })

  it('項目を削除すると、点だけで参照していた経路からも消える', () => {
    const original = [{ itemId: 'fire', at: 1, count: 2 }]
    const h = harness(stored('route', mark(original)))
    h.store.setCountFixtures([fixture('cable')], ['fire'])
    expect(h.store.get('route')?.quantity).not.toHaveProperty('points')
    expect(h.store.get('route')).toBeDefined()
    expect(h.store.fixtureMarkCount('fire')).toBe(0)
    expect(h.steps).toHaveLength(1)
    h.undo()
    expect(h.store.get('route')?.quantity?.points).toEqual(original)
    expect(h.store.getCountFixture('fire')).toBeDefined()
  })

  it('点だけで参照した項目の施工条件も改名する', () => {
    const h = harness(stored('route', mark([
      { itemId: 'fire', at: 1, count: 2, condition: '旧条件' },
      { itemId: 'fire', at: 2, count: 1 },
    ])), [fixture('cable'), fixture('fire', { conditions: ['旧条件'] })])
    renames.set('fire', new Map([['旧条件', '新条件']]))
    h.store.setCountFixtures([
      fixture('cable'), fixture('fire', { conditions: ['新条件'] }),
    ])
    expect(h.store.get('route')?.quantity?.points).toEqual([
      { itemId: 'fire', at: 1, count: 2, condition: '新条件' },
      { itemId: 'fire', at: 2, count: 1 },
    ])
    expect(h.steps).toHaveLength(1)
    h.undo()
    expect(h.store.get('route')?.quantity?.points?.[0].condition).toBe('旧条件')
  })

  it('fixtureMarkCount は点の数によらず参照する経路を1件と数える', () => {
    const h = harness(stored('route', mark([
      { itemId: 'fire', at: 0, count: 2 },
      { itemId: 'fire', at: 1, count: 3 },
    ])))
    h.annotations.set('other', stored('other', mark([
      { itemId: 'fire', at: 1, count: 1 },
    ])))
    const deleted = stored('deleted', mark([
      { itemId: 'fire', at: 1, count: 1 },
    ]))
    deleted.deleted = true
    h.annotations.set('deleted', deleted)
    expect(h.store.fixtureMarkCount('fire')).toBe(2)
    expect(h.store.fixtureMarkCount('missing')).toBe(0)
  })
})
