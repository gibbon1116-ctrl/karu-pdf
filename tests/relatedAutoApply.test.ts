import { describe, expect, it } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import { countFixtureId, type CountMark } from '../src/core/counts'
import type { QuantityMark } from '../src/core/quantity'
import {
  AnnotationStore,
  relatedAdditionKind,
  type EditableAnnotation,
} from '../src/editor/AnnotationStore'
import { relatedAdditionStatus } from '../src/app/fixtureAdd'

type Snapshot = EditableAnnotation[] & {
  fixtures?: CountFixture[]
  pickupMemory?: unknown
}
type Step = { before: Snapshot; after: Snapshot }

function fixture(
  id: string,
  kind: CountFixture['kind'] = 'count',
  method?: CountFixture['method'],
): CountFixture {
  return {
    id, name: id, code: id, category: '試験', order: 0, kind,
    ...(method ? { method } : {}),
    style: {
      shape: 'circle', fill: 'none', color: [1, 0, 0],
      size: 10, opacity: 1, showCode: true,
    },
  }
}

function count(id: string, fixtureId: string): CountMark {
  return { version: 2, id, fixtureId }
}

function harness(
  initialFixtures: CountFixture[],
  marks: Array<{ count?: CountMark; quantity?: QuantityMark }> = [],
) {
  let fixtures = structuredClone(initialFixtures)
  const annotations = new Map<string, EditableAnnotation>(
    marks.map((mark, index) => {
      const annotation = {
        id: `mark-${index}`,
        pageIndex: 0,
        objNum: null,
        kind: mark.count ? 'count' : 'perimeter',
        rect: [0, 0, 100, 100],
        color: [1, 0, 0],
        fillColor: null,
        opacity: 1,
        borderWidth: 1,
        fontSize: 12,
        text: '',
        vertices: [[0, 0], [50, 0], [50, 50]],
        measure: { kind: 'perimeter', mmPerPoint: 100 },
        ...structuredClone(mark),
        deleted: false,
        madeByKaru: true,
        revision: 0,
      } as unknown as EditableAnnotation
      return [annotation.id, annotation]
    }),
  )
  const components = new Map()
  const routes = new Map()
  const steps: Step[] = []
  let notifications = 0
  const store = Object.create(AnnotationStore.prototype) as AnnotationStore
  Object.assign(store, {
    annotations,
    lastRouteMembers: routes,
    lastRouteConditions: new Map(),
    lastCondition: new Map(),
    lastCountComponents: components,
    routeTemplate: null,
    getCountFixtures: () => fixtures,
    getCountFixture: (id: string) => fixtures.find(value => value.id === id),
    countMarkIdsOf: (id: string) => [...annotations.values()]
      .filter(annotation => annotation.count
        && countFixtureId(annotation.count) === id)
      .map(annotation => annotation.id),
    hasLinkedPickup: () => false,
    replaceFixtures: (next: CountFixture[]) => { fixtures = next },
    refreshQuantity: () => {},
    markTouched: () => {},
    pruneHiddenSelection: () => {},
    notify: () => { notifications++ },
    history: { push: (step: Step) => { steps.push(step) } },
  })

  const restore = (snapshot: Snapshot) => {
    if (snapshot.fixtures !== undefined) {
      fixtures = structuredClone(snapshot.fixtures)
    }
    for (const annotation of snapshot) {
      annotations.set(annotation.id, structuredClone(annotation))
    }
    if (snapshot.pickupMemory !== undefined) {
      const internal = store as unknown as {
        restorePickupMemory(memory: unknown): void
      }
      internal.restorePickupMemory(snapshot.pickupMemory)
    }
  }
  const snapshot = () => structuredClone({
    fixtures,
    marks: [...annotations.values()].map(annotation => ({
      id: annotation.id,
      count: annotation.count ?? null,
      quantity: annotation.quantity ?? null,
    })),
    components: [...components.entries()],
    routes: [...routes.entries()],
    routeTemplate: store.routeTemplate,
  })

  return {
    store, annotations, components, steps, restore, snapshot,
    fixtures: () => fixtures,
    notifications: () => notifications,
  }
}

function expectOneUndo(
  h: ReturnType<typeof harness>,
  before: ReturnType<ReturnType<typeof harness>['snapshot']>,
) {
  expect(h.steps).toHaveLength(1)
  expect(h.notifications()).toBe(1)
  const after = h.snapshot()
  h.restore(h.steps[0].before)
  expect(h.snapshot()).toEqual(before)
  h.restore(h.steps[0].after)
  expect(h.snapshot()).toEqual(after)
}

describe('applyRelatedAdditions', () => {
  it('個数の全印とこれからの印に、複数の構成要素を数1で入れ、Undoをまとめる', () => {
    const origin = fixture('switch')
    const box = fixture('box')
    const cover = fixture('cover')
    const h = harness([origin], Array.from({ length: 12 }, (_, index) => ({
      count: count(`c-${index}`, origin.id),
    })))
    const before = h.snapshot()

    const result = h.store.applyRelatedAdditions(origin.id, [box, cover])
    expect(result.error).toBeUndefined()
    expect(result.componentMarks).toBe(24)
    expect(result.componentSkipped).toBe(0)
    expect(h.fixtures()).toHaveLength(3)
    for (const annotation of h.annotations.values()) {
      expect(annotation.count).toMatchObject({
        version: 2,
        fixtureId: origin.id,
        extra: [
          { itemId: box.id, count: 1 },
          { itemId: cover.id, count: 1 },
        ],
      })
    }
    expect(h.components.get(origin.id)).toEqual([
      { itemId: box.id, count: 1 },
      { itemId: cover.id, count: 1 },
    ])
    expectOneUndo(h, before)
  })

  it.each([
    ['polygon', 'area', 'polygon'],
    ['lengthHeight', 'area', 'lengthHeight'],
    ['click', 'length', 'polyline'],
    ['click', 'area', 'polygon'],
    ['click', 'volume', 'polygonDepth'],
    ['polygonDepth', 'volume', 'polygonDepth'],
    ['lengthWidthDepth', 'volume', 'lengthWidthDepth'],
  ] as const)(
    '%s → %s を係数1で連動にし、追加と連動をUndo1回で戻す',
    (originMethod, targetKind, targetMethod) => {
      const originKind = originMethod === 'click'
        ? 'count'
        : originMethod === 'polygon' || originMethod === 'lengthHeight'
          ? 'area' : 'volume'
      const origin = fixture('origin', originKind, originMethod)
      const target = fixture('target', targetKind, targetMethod)
      const h = harness([origin])
      const before = h.snapshot()

      const result = h.store.applyRelatedAdditions(origin.id, [target])
      expect(result.error).toBeUndefined()
      expect(result.linked).toBe(1)
      expect(result.guidance).toBe(0)
      expect(h.fixtures().find(value => value.id === target.id)?.link).toEqual({
        kind: 'factor',
        sources: [{ itemId: origin.id, factor: 1 }],
      })
      expectOneUndo(h, before)
    },
  )

  it('囲む面積 → 長さを形・周長の連動にする', () => {
    const origin = fixture('ceiling', 'area', 'polygon')
    const target = fixture('edge', 'length', 'polyline')
    const h = harness([origin])
    const before = h.snapshot()

    const result = h.store.applyRelatedAdditions(origin.id, [target])
    expect(result.linked).toBe(1)
    expect(h.fixtures()[1].link).toEqual({
      kind: 'shape',
      shape: { output: 'perimeter' },
      sources: [{ itemId: origin.id }],
    })
    expectOneUndo(h, before)
  })

  it('同じ項目を再利用して2つ目の元を足し、同じ元は重複させない', () => {
    const a = fixture('ceiling-a', 'area', 'polygon')
    const b = fixture('ceiling-b', 'area', 'polygon')
    const target = fixture('base', 'area', 'polygon')
    const h = harness([a, b])

    h.store.applyRelatedAdditions(a.id, [target])
    const beforeSecond = h.snapshot()
    const second = h.store.applyRelatedAdditions(b.id, [{
      ...target, id: 'another-id',
    }])
    expect(second.sourcesAdded).toBe(1)
    expect(h.fixtures()).toHaveLength(3)
    expect(h.fixtures()[2].link?.sources).toEqual([
      { itemId: a.id, factor: 1 },
      { itemId: b.id, factor: 1 },
    ])
    expect(h.steps).toHaveLength(2)

    const afterSecond = h.snapshot()
    h.restore(h.steps[1].before)
    expect(h.snapshot()).toEqual(beforeSecond)
    h.restore(h.steps[1].after)
    expect(h.snapshot()).toEqual(afterSecond)

    const repeated = h.store.applyRelatedAdditions(b.id, [target])
    expect(repeated.sourcesAdded).toBe(0)
    expect(repeated.effects[0].kind).toBe('unchanged')
    expect(h.steps).toHaveLength(2)
  })

  it('印のある既存項目は連動にせず、他の新規項目の追加はUndoで戻す', () => {
    const origin = fixture('origin', 'area', 'polygon')
    const target = fixture('target', 'area', 'polygon')
    const additional = fixture('additional')
    const h = harness([origin, target], [{
      quantity: {
        version: 1, id: 'q', itemId: target.id, method: 'polygon',
      },
    }])
    const before = h.snapshot()

    const result = h.store.applyRelatedAdditions(origin.id, [target, additional])
    expect(result.guidance).toBe(2)
    expect(result.linked).toBe(0)
    expect(h.fixtures().find(value => value.id === target.id)?.link).toBeUndefined()
    expect(result.effects.find(effect => effect.itemId === target.id)?.reason)
      .toContain('印・拾い')
    expectOneUndo(h, before)
  })

  it('個数の構成要素として使われている項目も印ありと数える', () => {
    const main = fixture('main')
    const member = fixture('member')
    const h = harness([main, member], [{
      count: {
        version: 2, id: 'c', fixtureId: main.id,
        extra: [{ itemId: member.id, count: 1 }],
      },
    }])

    expect(h.store.fixtureMarkCount(member.id)).toBe(1)
    expect(h.store.fixtureMarkCount(main.id)).toBe(1)
  })

  it('面積 → 個数は追加だけにし、Undo1回で戻す', () => {
    const origin = fixture('ceiling', 'area', 'polygon')
    const target = fixture('inspection')
    const h = harness([origin])
    const before = h.snapshot()

    const result = h.store.applyRelatedAdditions(origin.id, [target])
    expect(result.guidance).toBe(1)
    expect(result.linked).toBe(0)
    expect(h.fixtures()[1].link).toBeUndefined()
    expect(relatedAdditionStatus(origin, result))
      .toContain('inspection は図面で拾ってください')
    expectOneUndo(h, before)
  })

  it('長さ×高さの面積 → 長さは追加だけにする', () => {
    const origin = fixture('wall', 'area', 'lengthHeight')
    const target = fixture('edge', 'length', 'polyline')
    const h = harness([origin])
    const before = h.snapshot()

    const result = h.store.applyRelatedAdditions(origin.id, [target])
    expect(result.guidance).toBe(1)
    expect(h.fixtures()[1].link).toBeUndefined()
    expectOneUndo(h, before)
  })

  it('起点が連動の項目なら追加だけにする', () => {
    const source = fixture('source', 'area', 'polygon')
    const origin: CountFixture = {
      ...fixture('origin', 'area', 'polygon'),
      link: { kind: 'factor', sources: [{ itemId: source.id, factor: 1 }] },
    }
    const h = harness([source, origin])
    const before = h.snapshot()

    const result = h.store.applyRelatedAdditions(origin.id, [
      fixture('target', 'area', 'polygon'),
    ])
    expect(result.guidance).toBe(1)
    expect(result.linked).toBe(0)
    expect(h.fixtures()[2].link).toBeUndefined()
    expectOneUndo(h, before)
  })

  it('fixtureLinkErrorで連動を拒否した項目も追加自体は残す', () => {
    const origin = fixture('origin', 'area', 'polygon')
    const target: CountFixture = {
      ...fixture('target', 'area', 'polygon'),
      // 換算のある項目は連動にできない（fixtureLinkError）。換算自体は保存できる値にする。
      convert: { unit: '㎡', factor: 1, basis: '試験' },
    }
    const h = harness([origin])
    const before = h.snapshot()

    const result = h.store.applyRelatedAdditions(origin.id, [target])
    expect(result.error).toBeUndefined()
    expect(result.guidance).toBe(1)
    expect(result.effects[0].reason).toContain('数量の換算')
    expect(h.fixtures()[1].link).toBeUndefined()
    expectOneUndo(h, before)
  })

  it('係数の元50件を超えず、理由を返す', () => {
    const sources = Array.from({ length: 50 }, (_, index) =>
      fixture(`source-${index}`, 'area', 'polygon'))
    const origin = fixture('origin', 'area', 'polygon')
    const target: CountFixture = {
      ...fixture('target', 'area', 'polygon'),
      link: {
        kind: 'factor',
        sources: sources.map(source => ({ itemId: source.id, factor: 1 })),
      },
    }
    const h = harness([...sources, origin, target])

    const result = h.store.applyRelatedAdditions(origin.id, [target])
    expect(result.sourcesAdded).toBe(0)
    expect(result.guidance).toBe(1)
    expect(result.effects[0].reason).toContain('50件')
    expect(h.fixtures().at(-1)?.link?.sources).toHaveLength(50)
    expect(h.steps).toHaveLength(0)
  })

  it('既存IDでは引数の内容より保存済みの項目を優先する', () => {
    const origin = fixture('origin', 'area', 'polygon')
    const target = fixture('target')
    const h = harness([origin, target])

    const result = h.store.applyRelatedAdditions(origin.id, [{
      ...target, kind: 'area', method: 'polygon',
    }])
    expect(result.guidance).toBe(1)
    expect(h.fixtures()[1]).toEqual(target)
    expect(h.steps).toHaveLength(0)
  })

  it('線要素・頂点の個数・新規項目を同じ履歴で戻す', () => {
    const origin = fixture('origin', 'length', 'polyline')
    const line = fixture('line', 'length', 'polyline')
    const point = fixture('point')
    const h = harness([origin], [{
      quantity: {
        version: 1, id: 'q', itemId: origin.id, method: 'polyline',
        cond: {},
      },
    }])
    const before = h.snapshot()

    const result = h.store.applyRelatedAdditions(
      origin.id, [line, point], 'mark-0',
    )
    expect(result.error).toBeUndefined()
    expect(result.changed).toBe(1)
    expect(result.pointRows).toBe(1)
    expect(h.annotations.get('mark-0')?.quantity?.extra).toEqual([
      { itemId: line.id, count: 1, cond: {} },
    ])
    // 3頂点の経路では、使っていない最初の中間の頂点（1）に入る（R6a）。
    expect(h.annotations.get('mark-0')?.quantity?.points).toEqual([
      { itemId: point.id, at: 1, count: 1 },
    ])
    expectOneUndo(h, before)
  })

  it('反映メソッドを呼ばなければ状態と履歴は変わらない', () => {
    const origin = fixture('origin', 'area', 'polygon')
    const target = fixture('target', 'area', 'polygon')
    const h = harness([origin, target])
    const before = h.snapshot()

    expect(relatedAdditionKind(origin, target)).toBe('factor')
    expect(h.snapshot()).toEqual(before)
    expect(h.steps).toHaveLength(0)
    expect(h.notifications()).toBe(0)
  })
})
