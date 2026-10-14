import { describe, expect, it } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import type { QuantityMark, RouteExtra } from '../src/core/quantity'
import { AnnotationStore, type EditableAnnotation } from '../src/editor/AnnotationStore'

type Template = NonNullable<AnnotationStore['routeTemplate']>
type Snapshot = EditableAnnotation[] & {
  fixtures?: CountFixture[]
  pickupMemory?: unknown
}
type Step = { before: Snapshot; after: Snapshot }

/**
 * コンストラクタ・PDF読み込みから独立して、実メソッドの更新と履歴を検査する。
 * Undo/Redo相当の復元は、記録された履歴スナップショットを適用する。
 * 実UIのCtrl+Zはe2eで検査する。
 */
function harness(initialFixtures: CountFixture[], quantities: QuantityMark[] = []) {
  let fixtures = structuredClone(initialFixtures)
  const annotations = new Map<string, EditableAnnotation>(
    quantities.map((quantity, index) => {
      const annotation = {
        id: `route-${index}`,
        pageIndex: 0,
        objNum: null,
        kind: 'perimeter',
        rect: [0, 0, 100, 100],
        color: [1, 0, 0],
        fillColor: null,
        opacity: 1,
        borderWidth: 1,
        fontSize: 12,
        text: '',
        vertices: [[0, 0], [50, 0], [50, 50]],
        measure: { kind: 'perimeter', mmPerPoint: 100 },
        quantity: structuredClone(quantity),
        deleted: false,
        madeByKaru: true,
        revision: 0,
      } as unknown as EditableAnnotation
      return [annotation.id, annotation]
    }),
  )
  const remembered = new Map<string, Template>()
  const steps: Step[] = []
  const store = Object.create(AnnotationStore.prototype) as AnnotationStore
  Object.assign(store, {
    annotations,
    lastRouteMembers: remembered,
    lastRouteConditions: new Map(),
    lastCondition: new Map(),
    lastCountComponents: new Map(),
    routeTemplate: null,
    getCountFixtures: () => fixtures,
    getCountFixture: (id: string) => fixtures.find(fixture => fixture.id === id),
    hasLinkedPickup: () => false,
    replaceFixtures: (next: CountFixture[]) => { fixtures = next },
    refreshQuantity: () => {},
    markTouched: () => {},
    pruneHiddenSelection: () => {},
    notify: () => {},
    history: { push: (step: Step) => { steps.push(step) } },
  })

  const restore = (snapshot: Snapshot) => {
    if (snapshot.fixtures) fixtures = structuredClone(snapshot.fixtures)
    for (const annotation of snapshot) {
      annotations.set(annotation.id, structuredClone(annotation))
    }
    if (snapshot.pickupMemory) {
      const internal = store as unknown as {
        restorePickupMemory(memory: unknown): void
      }
      internal.restorePickupMemory(snapshot.pickupMemory)
    }
  }
  return {
    store, annotations, remembered, steps,
    fixtures: () => fixtures,
    restore,
  }
}

function fixture(id: string, extra: Partial<CountFixture> = {}): CountFixture {
  return {
    id, name: id, code: id, category: '電線管', order: 0,
    kind: 'length', method: 'polyline',
    style: {
      shape: 'circle', fill: 'none', color: [1, 0, 0],
      size: 10, opacity: 1, showCode: true,
    },
    ...extra,
  }
}

function quantity(id: string, extra: RouteExtra[] = []): QuantityMark {
  return {
    version: 1, id, itemId: 'origin', method: 'polyline',
    cond: { plan: '主の条件' }, extra,
  }
}

describe('addRouteMemberToFixture', () => {
  it('3本中、既存の1本を除いた2本を変更し、条件をまねない', () => {
    const h = harness([fixture('origin'), fixture('member')], [
      quantity('q0'),
      quantity('q1', [{ itemId: 'member', count: 1, cond: {} }]),
      quantity('q2'),
    ])
    expect(h.store.addRouteMemberToFixture(
      'origin', { itemId: 'member', count: 1, cond: {} },
    )).toEqual({ changed: 2, skipped: 0 })
    expect(h.steps).toHaveLength(1)
    expect(h.annotations.get('route-0')!.quantity!.extra).toEqual([
      { itemId: 'member', count: 1, cond: {} },
    ])
    expect(h.remembered.get('origin')!.extra).toEqual([
      { itemId: 'member', count: 1, cond: {} },
    ])

    // 同じ操作では印も記憶も変わらず、履歴を増やさない。
    expect(h.store.addRouteMemberToFixture(
      'origin', { itemId: 'member', count: 1, cond: {} },
    )).toEqual({ changed: 0, skipped: 0 })
    expect(h.steps).toHaveLength(1)
  })

  it('追加10件の経路は見送り、これからの構成には入る', () => {
    const extras = Array.from({ length: 10 }, (_, index) => ({
      itemId: `e${index}`, count: 1, cond: {},
    }))
    const h = harness([
      fixture('origin'), fixture('member'),
      ...extras.map(extra => fixture(extra.itemId)),
    ], [quantity('q0', extras)])
    expect(h.store.addRouteMemberToFixture(
      'origin', { itemId: 'member', count: 1, cond: {} },
    )).toEqual({ changed: 0, skipped: 1 })
    expect(h.annotations.get('route-0')!.quantity!.extra).toHaveLength(10)
    expect(h.remembered.get('origin')!.extra[0].itemId).toBe('member')
  })

  it('保存上限を超える印を見送り、ほかの印は変更する', () => {
    const oversized = {
      ...quantity('q0'),
      points: [{ itemId: 'count', at: 1, count: 1 }],
      // 既存印の保存サイズを意図的に大きくする。
      id: 'q'.repeat(8000),
    }
    const h = harness([
      fixture('origin'), fixture('member'),
      fixture('count', { kind: 'count', method: 'click' }),
    ], [oversized, quantity('q1')])
    expect(h.store.addRouteMemberToFixture(
      'origin', { itemId: 'member', count: 1, cond: {} },
    )).toEqual({ changed: 1, skipped: 1 })
    expect(h.annotations.get('route-0')!.quantity!.extra).toEqual([])
    expect(h.annotations.get('route-1')!.quantity!.extra).toHaveLength(1)
  })

  it('新しい面積項目・周長・記憶・テンプレートを一つの履歴に保存する', () => {
    const origin = fixture('origin', { name: 'ダクト 200×100' })
    const surface = fixture('surface', { kind: 'area', method: 'polygon' })
    const h = harness([origin], [quantity('q0')])
    h.store.routeTemplate = {
      itemId: 'origin', count: 2, cond: { plan: '主の条件' },
      extra: [], name: '試験構成',
    }
    const initialTemplate = structuredClone(h.store.routeTemplate)

    expect(h.store.addRelatedFixturesToRoute('origin', [surface])).toEqual({
      changed: 1, skipped: 0, pointRows: 0, pointSkipped: 0,
    })
    expect(h.steps).toHaveLength(1)
    const member = { itemId: 'surface', count: 1, cond: {}, perM: 0.6 }
    expect(h.annotations.get('route-0')!.quantity!.extra).toEqual([member])
    expect(h.remembered.get('origin')!.extra).toEqual([member])
    expect(h.store.routeTemplate!.extra).toEqual([member])
    expect(h.fixtures().map(value => value.id)).toEqual(['origin', 'surface'])

    h.restore(h.steps[0].before)
    expect(h.fixtures().map(value => value.id)).toEqual(['origin'])
    expect(h.annotations.get('route-0')!.quantity!.extra).toEqual([])
    expect(h.remembered.has('origin')).toBe(false)
    expect(h.store.routeTemplate).toEqual(initialTemplate)

    h.restore(h.steps[0].after)
    expect(h.fixtures().map(value => value.id)).toEqual(['origin', 'surface'])
    expect(h.annotations.get('route-0')!.quantity!.extra).toEqual([member])
    expect(h.remembered.get('origin')!.extra).toEqual([member])
    expect(h.store.routeTemplate!.extra).toEqual([member])

    // routeTemplateItemsは次に引く経路が使う既存の入口。
    expect(h.store.routeTemplateItems('origin').extra).toEqual([member])
  })

  it('複数追加の線項目と個数項目を同じ履歴にまとめる', () => {
    const h = harness([fixture('origin')], [quantity('q0'), quantity('q1')])
    const added = [
      fixture('member'),
      fixture('fire', { kind: 'count', method: 'click' }),
      fixture('other', { kind: 'count', method: 'click' }),
    ]
    expect(h.store.addRelatedFixturesToRoute('origin', added, 'route-0')).toEqual({
      changed: 2, skipped: 0, pointRows: 2, pointSkipped: 0,
    })
    expect(h.steps).toHaveLength(1)
    expect(h.annotations.get('route-0')!.quantity!.points).toEqual([
      { itemId: 'fire', at: 1, count: 1 },
      { itemId: 'other', at: 2, count: 1 },
    ])
    expect(h.annotations.get('route-1')!.quantity!.points).toBeUndefined()
  })

  it('既存項目は増やさず、2本の経路・記憶・テンプレートをUndo一回分にまとめる', () => {
    const origin = fixture('origin')
    const member = fixture('member', { name: 'PF22' })
    const h = harness([origin, member], [quantity('q0'), quantity('q1')])
    h.store.routeTemplate = {
      itemId: 'origin', count: 1, cond: {},
      extra: [], name: '試験構成',
    }
    const beforeFixtures = structuredClone(h.fixtures())
    const beforeTemplate = structuredClone(h.store.routeTemplate)
    const extra = { itemId: 'member', count: 1, cond: {} }

    expect(h.store.addRelatedFixturesToRoute(
      'origin', [member], 'route-0',
    )).toEqual({
      changed: 2, skipped: 0, pointRows: 0, pointSkipped: 0,
    })
    expect(h.fixtures()).toEqual(beforeFixtures)
    expect(h.steps).toHaveLength(1)
    for (const id of ['route-0', 'route-1']) {
      expect(h.annotations.get(id)!.quantity!.extra).toEqual([extra])
    }
    expect(h.remembered.get('origin')!.extra).toEqual([extra])
    expect(h.store.routeTemplate!.extra).toEqual([extra])

    h.restore(h.steps[0].before)
    expect(h.fixtures()).toEqual(beforeFixtures)
    for (const id of ['route-0', 'route-1']) {
      expect(h.annotations.get(id)!.quantity!.extra).toEqual([])
    }
    expect(h.remembered.has('origin')).toBe(false)
    expect(h.store.routeTemplate).toEqual(beforeTemplate)

    h.restore(h.steps[0].after)
    expect(h.fixtures()).toEqual(beforeFixtures)
    expect(h.store.routeTemplateItems('origin').extra).toEqual([extra])
  })

  it('既存と新規を混ぜたときは新規だけ追加し、既存IDの内容は文書側を使う', () => {
    const member = fixture('member', { name: 'PF22' })
    const h = harness([fixture('origin'), member], [quantity('q0')])
    const staleMember = fixture('member', {
      name: '古い内容', kind: 'count', method: 'click',
    })
    const added = fixture('added')

    expect(h.store.addRelatedFixturesToRoute(
      'origin', [staleMember, added], 'route-0',
    )).toEqual({
      changed: 1, skipped: 0, pointRows: 0, pointSkipped: 0,
    })
    expect(h.fixtures().map(value => value.id)).toEqual([
      'origin', 'member', 'added',
    ])
    expect(h.fixtures().find(value => value.id === 'member')).toEqual(member)
    expect(h.annotations.get('route-0')!.quantity!.extra).toEqual([
      { itemId: 'member', count: 1, cond: {} },
      { itemId: 'added', count: 1, cond: {} },
    ])
    expect(h.annotations.get('route-0')!.quantity!.points).toBeUndefined()
    expect(h.steps).toHaveLength(1)

    h.restore(h.steps[0].before)
    expect(h.fixtures().map(value => value.id)).toEqual(['origin', 'member'])
    expect(h.annotations.get('route-0')!.quantity!.extra).toEqual([])
    expect(h.remembered.has('origin')).toBe(false)
  })

  it('既存の個数項目は選んだ経路の頂点だけに入り、項目は増えない', () => {
    const count = fixture('fire', { kind: 'count', method: 'click' })
    const h = harness([fixture('origin'), count], [
      quantity('q0'), quantity('q1'),
    ])
    const beforeFixtures = structuredClone(h.fixtures())

    expect(h.store.addRelatedFixturesToRoute(
      'origin', [count], 'route-0',
    )).toEqual({
      changed: 0, skipped: 0, pointRows: 1, pointSkipped: 0,
    })
    expect(h.fixtures()).toEqual(beforeFixtures)
    expect(h.annotations.get('route-0')!.quantity!.points).toEqual([
      { itemId: 'fire', at: 1, count: 1 },
    ])
    expect(h.annotations.get('route-1')!.quantity!.points).toBeUndefined()
    expect(h.steps).toHaveLength(1)

    h.restore(h.steps[0].before)
    expect(h.fixtures()).toEqual(beforeFixtures)
    expect(h.annotations.get('route-0')!.quantity!.points).toBeUndefined()
    expect(h.annotations.get('route-1')!.quantity!.points).toBeUndefined()
  })

  it('routeIdなしでは個数を追加しない', () => {
    const h = harness([fixture('origin')], [quantity('q0')])
    h.store.addRelatedFixturesToRoute('origin', [
      fixture('fire', { kind: 'count', method: 'click' }),
    ])
    expect(h.annotations.get('route-0')!.quantity!.points).toBeUndefined()
    expect(h.fixtures()).toHaveLength(2)
    expect(h.steps).toHaveLength(1)
  })

  it('線項目でない起点、個数の線要素はエラーで履歴を作らない', () => {
    const h = harness([
      fixture('origin', { kind: 'count', method: 'click' }),
      fixture('member'),
    ])
    expect(h.store.addRouteMemberToFixture(
      'origin', { itemId: 'member', count: 1, cond: {} },
    ).error).toBeTruthy()
    expect(h.steps).toHaveLength(0)

    const h2 = harness([
      fixture('origin'),
      fixture('count', { kind: 'count', method: 'click' }),
    ])
    expect(h2.store.addRouteMemberToFixture(
      'origin', { itemId: 'count', count: 1, cond: {} },
    ).error).toBeTruthy()
    expect(h2.steps).toHaveLength(0)
  })
})
