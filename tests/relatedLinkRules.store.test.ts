import { expect, it } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import type { RelatedOriginMatch } from '../src/core/related/types'
import {
  computeLinks,
  fixtureLinkError,
  fixtureLinkSources,
  readFixtureLink,
} from '../src/core/fixtureLink'
import { QuantityIndex } from '../src/core/quantityIndex'
import {
  collectShapeMetrics,
  type ShapeAnnotation,
} from '../src/core/shapeMetrics'
import { computeRcMember, rcMemberError } from '../src/core/rcMember'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import {
  scopeLinkPlan,
  type ScopeRuleOptions,
} from '../src/app/relatedLinkRules'

const style: CountFixture['style'] = {
  shape: 'circle',
  fill: 'none',
  color: [1, 0, 0],
  size: 10,
  opacity: .8,
  showCode: true,
}

const mmPerPoint = 100 * 25.4 / 72
const coordinate = (metres: number): number => metres * 1000 / mmPerPoint

function fixture(
  id: string,
  name: string,
  kind: CountFixture['kind'],
  method: CountFixture['method'],
  category = '例',
): CountFixture {
  return { id, name, code: id, category, kind, method, style, order: 0 }
}

function line(
  id: string,
  itemId: string,
  lengthM: number,
  method: 'polyline' | 'lengthHeight' | 'lengthWidthDepth',
  dimensions: { heightM?: number; widthM?: number; depthM?: number } = {},
): ShapeAnnotation {
  return {
    id,
    pageIndex: 0,
    vertices: [[0, 0], [coordinate(lengthM), 0]],
    measure: { mmPerPoint },
    quantity: {
      version: 1, id, itemId, method, ...dimensions,
    },
  }
}

function rectangle(
  id: string,
  itemId: string,
  widthM: number,
  heightM: number,
): ShapeAnnotation {
  return {
    id,
    pageIndex: 0,
    vertices: [
      [0, 0],
      [coordinate(widthM), 0],
      [coordinate(widthM), coordinate(heightM)],
      [0, coordinate(heightM)],
    ],
    measure: { mmPerPoint },
    quantity: { version: 1, id, itemId, method: 'polygon' },
  }
}

const wallMatches: readonly RelatedOriginMatch[] = [{
  categories: ['壁下地'],
  names: ['軽量鉄骨壁下地'],
}]

const wallOptions: ScopeRuleOptions = {
  originMatch: wallMatches,
  projectMode: '改修',
}

function apply(
  store: AnnotationStore,
  originId: string,
  target: CountFixture,
  classId: string | undefined,
  options: ScopeRuleOptions = wallOptions,
): ReturnType<AnnotationStore['applyRelatedAdditions']> {
  return store.applyRelatedAdditions(
    originId, [target], undefined,
    (origin, resolved) => scopeLinkPlan({
      ...options,
      ruleId: classId === 'MARK' ? 'A-wall-01'
        : classId === 'BASEBOARD' ? 'B-111'
          : classId === 'FILTER_ROUTE' ? 'E-020'
            : classId === 'PROTECT' ? 'B-X01'
              : undefined,
      classId,
      origin,
      target: resolved,
    }),
  )
}

function wallSetup(): {
  store: AnnotationStore
  wallA: CountFixture
  wallB: CountFixture
  annotations: ShapeAnnotation[]
} {
  const store = new AnnotationStore()
  const wallA = fixture('wall-a', '軽量鉄骨壁下地', 'area', 'lengthHeight', '壁下地')
  const wallB = fixture('wall-b', '軽量鉄骨壁下地', 'area', 'polygon', '壁下地')
  const board = fixture(
    'wall-board', '壁せっこうボード張り', 'area', 'lengthHeight', '壁下地',
  )
  const removal = fixture(
    'wall-removal', '軽量鉄骨壁下地撤去', 'area', 'lengthHeight', '壁下地',
  )
  store.setCountFixtures([wallA, wallB, board, removal])
  return {
    store, wallA, wallB,
    annotations: [
      line('a', wallA.id, 10, 'lengthHeight', { heightM: 3.6 }),
      rectangle('b', wallB.id, 5, 3.6),
      line('board', board.id, 10, 'lengthHeight', { heightM: 3.6 }),
      line('removal', removal.id, 4, 'lengthHeight', { heightM: 3.6 }),
    ],
  }
}

it('ボード・撤去を除いて墨出し15㎡・幅木30mになり、同名の壁を後から追加できる', () => {
  const { store, wallA, annotations } = wallSetup()
  const mark = fixture('mark', '墨出し', 'area', 'polygon')
  const result = apply(store, wallA.id, mark, 'MARK')

  expect(result.error).toBeUndefined()
  expect(result.linked).toBe(1)

  const saved = store.getCountFixture(mark.id)!
  expect(saved.link?.sources).toEqual([])
  expect(saved.link?.auto).toEqual({
    nameIncludes: ['軽量鉄骨壁下地'],
    nameExcludes: ['撤去'],
    kinds: ['area', 'length'],
  })
  expect(saved.link?.shape).toEqual({
    output: 'lengthTimesHeight', heightM: 1, lengthBasis: 'baseEdge',
  })

  const baseboard = fixture('baseboard', 'ビニル幅木', 'length', 'polyline')
  expect(apply(store, wallA.id, baseboard, 'BASEBOARD').linked).toBe(1)

  let index = QuantityIndex.build(annotations, store.getCountFixtures())
  expect(index.total(wallA.id)).toBeCloseTo(36, 9)
  expect(index.total('wall-b')).toBeCloseTo(18, 9)
  expect(index.total('wall-board')).toBeCloseTo(36, 9)
  expect(index.total('wall-removal')).toBeCloseTo(14.4, 9)
  expect(index.total(mark.id)).toBeCloseTo(15, 9)
  expect(index.total(baseboard.id)).toBeCloseTo(30, 9)

  const wallC: CountFixture = {
    ...fixture('wall-c', '軽量鉄骨壁下地', 'area', 'lengthHeight', '別分類'),
    code: '別略号',
    spec: '別規格',
  }
  store.setCountFixtures([...store.getCountFixtures(), wallC])
  annotations.push(line('c', wallC.id, 2, 'lengthHeight', { heightM: 3.6 }))

  index = QuantityIndex.build(annotations, store.getCountFixtures())
  expect(index.total(mark.id)).toBeCloseTo(17, 9)
  expect(index.total(baseboard.id)).toBeCloseTo(34, 9)
})

it('幅木は壁の底辺の両面30mで、扉幅0.8mを両面分引くと28.4mになる', () => {
  const { store, wallA, annotations } = wallSetup()
  const baseboard = fixture('baseboard', 'ビニル幅木', 'length', 'polyline')
  expect(apply(store, wallA.id, baseboard, 'BASEBOARD').error).toBeUndefined()

  let index = QuantityIndex.build(annotations, store.getCountFixtures())
  expect(index.total(baseboard.id)).toBeCloseTo(30, 9)

  const door: CountFixture = {
    ...fixture('door', '片開き扉', 'count', 'click'),
    opening: { widthM: .8, heightM: 2 },
  }
  store.setCountFixtures([...store.getCountFixtures(), door])
  const first = annotations[0]!
  annotations[0] = {
    ...first,
    quantity: {
      ...first.quantity!,
      openings: [{ itemId: door.id, count: 1 }],
    },
  }

  index = QuantityIndex.build(annotations, store.getCountFixtures())
  expect(index.total(baseboard.id)).toBeCloseTo(28.4, 9)
  expect(index.total(wallA.id)).toBeCloseTo(34.4, 9)
})

it('窓は幅木から引かず、開口幅超過は拾いごとに0と警告にする', () => {
  const { store, wallA, annotations } = wallSetup()
  const baseboard = fixture('baseboard', '巾木', 'length', 'polyline')
  apply(store, wallA.id, baseboard, 'BASEBOARD')

  const window: CountFixture = {
    ...fixture('window', '窓', 'count', 'click'),
    opening: { widthM: 1, heightM: 1 },
  }
  const door: CountFixture = {
    ...fixture('door', '出入口', 'count', 'click'),
    opening: { widthM: 11, heightM: 2 },
  }
  store.setCountFixtures([...store.getCountFixtures(), window, door])
  const first = annotations[0]!

  annotations[0] = {
    ...first,
    quantity: {
      ...first.quantity!,
      openings: [{ itemId: window.id, count: 1 }],
    },
  }
  expect(QuantityIndex.build(annotations, store.getCountFixtures()).total(baseboard.id))
    .toBeCloseTo(30, 9)

  annotations[0] = {
    ...first,
    quantity: {
      ...first.quantity!,
      openings: [{ itemId: door.id, count: 1 }],
    },
  }
  const index = QuantityIndex.build(annotations, store.getCountFixtures())
  expect(index.total(baseboard.id)).toBeCloseTo(10, 9)
  expect(index.linkResult(baseboard.id)?.warnings.join(' ')).toContain('扉の幅が')
})

it('底辺を取得できない立面は外周へ代替せず0と警告にする', () => {
  const { store, wallB } = wallSetup()
  const baseboard = fixture('baseboard', '幅木', 'length', 'polyline')
  apply(store, wallB.id, baseboard, 'BASEBOARD')

  const annotation: ShapeAnnotation = {
    id: 'diamond',
    pageIndex: 0,
    vertices: [[0, 50], [50, 0], [100, 50], [50, 100]],
    measure: { mmPerPoint },
    quantity: {
      version: 1, id: 'diamond', itemId: wallB.id, method: 'polygon',
    },
  }
  const index = QuantityIndex.build([annotation], store.getCountFixtures())
  expect(index.total(baseboard.id)).toBe(0)
  expect(index.linkResult(baseboard.id)?.warnings.join(' ')).toContain('底辺を取得できない')
})

it('床6m×4mの幅木は標準規則の周長20mになる', () => {
  const store = new AnnotationStore()
  const floor = fixture('floor', '床仕上げ', 'area', 'polygon', '床')
  const baseboard = fixture('baseboard', 'ビニル幅木', 'length', 'polyline')
  store.setCountFixtures([floor])

  apply(store, floor.id, baseboard, 'BASEBOARD', {
    originMatch: [{ categories: ['床'] }],
  })
  const index = QuantityIndex.build(
    [rectangle('floor-mark', floor.id, 6, 4)],
    store.getCountFixtures(),
  )
  expect(index.total(baseboard.id)).toBeCloseTo(20, 9)
})

it('床の周長から手動の建具を開口幅で引ける', () => {
  const floor = fixture('floor', '床', 'area', 'polygon')
  const door: CountFixture = {
    ...fixture('door', '扉', 'count', 'click'),
    opening: { widthM: .8, heightM: 2 },
  }
  const baseboard: CountFixture = {
    ...fixture('baseboard', '幅木', 'length', 'polyline'),
    link: {
      kind: 'shape',
      shape: { output: 'perimeter' },
      sources: [
        { itemId: floor.id },
        { itemId: door.id, factorFrom: 'openingWidth', sign: -1 },
      ],
    },
  }
  const result = computeLinks(
    [floor, door, baseboard],
    id => id === door.id ? [{
      itemId: door.id, annotationId: 'door-mark', pageIndex: 0, value: 1,
    }] : [],
    id => id === floor.id ? [{
      itemId: floor.id, annotationId: 'floor-mark', pageIndex: 0,
      method: 'polygon', count: 1, areaM2: 24, grossAreaM2: 24,
      perimeterM: 20, lengthM: 0,
    }] : [],
  )
  expect(result.get(baseboard.id)?.total).toBeCloseTo(19.2, 9)
})

it('C51塗装の面積と長さは同じ呼び径だけを自動の元にする', () => {
  const store = new AnnotationStore()
  const conduit: CountFixture = {
    ...fixture('c51', '薄鋼電線管', 'length', 'polyline', '電線管'),
    code: 'Ｃ５１',
    attributes: { outerDiameterMm: 51 },
  }
  const other: CountFixture = {
    ...fixture('c25', '薄鋼電線管', 'length', 'polyline', '電線管'),
    code: 'C25',
    attributes: { outerDiameterMm: 25.4 },
  }
  const paintArea = {
    ...fixture('paint-area', '配管塗装 C51', 'area', 'polygon'),
    code: 'PA',
  }
  const paintLength = {
    ...fixture('paint-length', '配管塗装', 'length', 'polyline'),
    code: 'PL', spec: 'C51',
  }
  const options: ScopeRuleOptions = {
    originMatch: [{ categories: ['電線管'] }],
  }
  store.setCountFixtures([conduit, other])
  apply(store, conduit.id, paintArea, 'FILTER_ROUTE', options)
  apply(store, conduit.id, paintLength, 'FILTER_ROUTE', options)

  const fixtures = store.getCountFixtures()
  const savedArea = store.getCountFixture(paintArea.id)!
  const savedLength = store.getCountFixture(paintLength.id)!
  expect(savedLength.link).toBeUndefined()
  expect(savedArea.link?.auto?.sizeMatch).toBe('C51')
  expect(fixtureLinkSources(fixtures, savedArea).map(source => source.itemId))
    .toEqual([conduit.id])

  const index = QuantityIndex.build([
    line('c51-mark', conduit.id, 19.6, 'polyline'),
    line('c25-mark', other.id, 100, 'polyline'),
  ], fixtures)
  expect(index.total(paintArea.id)).toBeCloseTo(Math.PI * .051 * 19.6, 9)
  // SPEC-T12: polyline の提案先は係数連動ではなく経路への配置。
  // この試験では Store に実経路を登録していないため、配置後の数量は生成しない。
  expect(index.total(paintLength.id)).toBe(0)
  expect(index.linkResult(paintArea.id)?.sources[0]?.note)
    .toContain('外径 51.0mm')
})

it('外径不明の塗装は0と警告にする', () => {
  const store = new AnnotationStore()
  const pipe = fixture('unknown', '配管', 'length', 'polyline', '配管')
  const paint = fixture('paint', '配管塗装', 'area', 'polygon')
  store.setCountFixtures([pipe])
  apply(store, pipe.id, paint, 'FILTER_ROUTE', {
    originMatch: [{ categories: ['配管'] }],
  })
  const index = QuantityIndex.build(
    [line('pipe', pipe.id, 10, 'polyline')],
    store.getCountFixtures(),
  )
  expect(index.total(paint.id)).toBe(0)
  expect(index.linkResult(paint.id)?.warnings.join(' '))
    .toContain('外径が分かりません（項目の外径を入れてください）')
})

it('平面長を使う墨出しは立上り・余長を含めず条数を一度だけ掛ける', () => {
  const store = new AnnotationStore()
  const wall = fixture('wall', '壁下地', 'length', 'polyline', '壁下地')
  const mark = fixture('mark', '墨出し', 'area', 'polygon')
  store.setCountFixtures([wall])
  apply(store, wall.id, mark, 'MARK', {
    originMatch: [{ categories: ['壁下地'] }],
  })
  const annotation = line('wall', wall.id, 10, 'polyline')
  annotation.quantity = {
    ...annotation.quantity!,
    count: 2,
    rises: [{ m: 3 }],
    slackM: 4,
    cond: { plan: '平面', rise: '立上り', slack: '余長' },
  }
  const index = QuantityIndex.build([annotation], store.getCountFixtures())
  expect(index.total(wall.id)).toBeCloseTo(34, 9)
  expect(index.total(mark.id)).toBeCloseTo(20, 9)
})

it('長さ×幅×深さの梁を2項目登録し、型枠連動と鉄筋に値が出る', () => {
  const store = new AnnotationStore()
  const beam = (id: string): CountFixture => ({
    ...fixture(id, 'RC梁', 'volume', 'lengthWidthDepth', 'コンクリート'),
    defaults: { widthM: .3, depthM: .6 },
    rc: {
      kind: 'beam',
      bars: [{ role: 'top', size: 'D16', count: 2 }],
    },
  })
  const first = beam('beam-1')
  const second = beam('beam-2')
  expect(rcMemberError(first.rc, { fromSection: true })).toBeUndefined()
  expect(rcMemberError(second.rc, { fromSection: true })).toBeUndefined()

  const formwork: CountFixture = {
    ...fixture('formwork', '普通合板型枠（地上軸部）', 'area', 'polygon'),
    link: {
      kind: 'rc',
      rc: { output: 'formwork' },
      sources: [],
      auto: { rcKinds: ['slab', 'wall', 'beam', 'column'] },
    },
  }
  store.setCountFixtures([first, second, formwork])

  const annotations = [
    line('beam-1-mark', first.id, 6, 'lengthWidthDepth', { widthM: .3, depthM: .6 }),
    // 印に寸法がない場合は項目の既定を使う。
    line('beam-2-mark', second.id, 6, 'lengthWidthDepth'),
  ]
  const fixtures = store.getCountFixtures()
  const index = QuantityIndex.build(annotations, fixtures)
  expect(index.total(formwork.id)).toBeCloseTo(18, 9)
  expect(index.linkResult(formwork.id)?.warnings).toEqual([])

  const metrics = collectShapeMetrics(annotations, fixtures, new Set([first.id, second.id]))
  const result = computeRcMember(first.rc!, metrics.get(first.id)![0]!)
  expect(result.concreteM3).toBeCloseTo(1.08, 9)
  expect(result.formworkM2).toBeCloseTo(9, 9)
  expect(result.bars[0]?.massKg).toBeGreaterThan(0)
})

it('新築の墨出しには連動を付けない', () => {
  const { store, wallA } = wallSetup()
  const mark = fixture('mark', '墨出し', 'area', 'polygon')
  const result = apply(store, wallA.id, mark, 'MARK', {
    ...wallOptions, projectMode: '新築',
  })
  expect(result.linked).toBe(0)
  expect(result.guidance).toBe(1)
  expect(store.getCountFixture(mark.id)?.link).toBeUndefined()
  expect(result.effects.find(effect => effect.kind === 'guidance')?.reason)
    .toContain('新築の墨出しは延べ面積')
})

it('ルールの他の起点を混ぜず、分類や拾い方が違っても起点と同名だけを選ぶ', () => {
  const a = fixture('a', '壁A', 'area', 'polygon', '分類A')
  const b = fixture('b', '壁A', 'area', 'lengthHeight', '分類B')
  const other = fixture('other', '壁B', 'area', 'polygon', '分類A')
  const removal = fixture('removal', '壁A撤去', 'area', 'polygon', '分類A')
  const target = fixture('mark', '墨出し', 'area', 'polygon')
  const plan = scopeLinkPlan({
    ruleId: 'A-wall-01', classId: 'MARK', origin: a, target,
    originMatch: [
      { names: ['壁A'], categories: ['分類A'] },
      { names: ['壁B'], categories: ['分類B'] },
    ],
  })
  expect(plan.kind).toBe('link')
  if (plan.kind !== 'link') throw new Error('連動計画がありません')
  expect(plan.link.auto).toEqual({
    nameIncludes: ['壁A'],
    nameExcludes: ['撤去'],
    kinds: ['area', 'length'],
  })
  const linked = { ...target, link: plan.link }
  expect(fixtureLinkSources([a, b, other, removal, linked], linked)
    .map(source => source.itemId)).toEqual(['a', 'b'])
})

it('起点条件がなくても起点の名称からautoを作る', () => {
  const origin = fixture('wall', '壁', 'area', 'lengthHeight')
  const target = fixture('mark', '墨出し', 'area', 'polygon')
  const plan = scopeLinkPlan({
    ruleId: 'A-wall-01', classId: 'MARK', origin, target,
  })
  expect(plan.kind).toBe('link')
  if (plan.kind !== 'link') throw new Error('連動計画がありません')
  expect(plan.link.auto).toEqual({
    nameIncludes: ['壁'],
    nameExcludes: ['撤去'],
    kinds: ['area', 'length'],
  })
  expect(plan.link.sources).toEqual([])
})

it('起点の名称が不正な場合は押した1項目だけを使う', () => {
  const origin = fixture('wall', '壁\n下地', 'area', 'lengthHeight')
  const target = fixture('mark', '墨出し', 'area', 'polygon')
  const plan = scopeLinkPlan({
    ruleId: 'A-wall-01', classId: 'MARK', origin, target,
    originMatch: wallMatches,
  })
  expect(plan.kind).toBe('link')
  if (plan.kind !== 'link') throw new Error('連動計画がありません')
  expect(plan.link.auto).toBeUndefined()
  expect(plan.link.sources).toEqual([{ itemId: origin.id, factor: 1 }])
})

it('追加した墨出しと連動を一度のUndoで戻す', () => {
  const store = new AnnotationStore()
  const wall = fixture('wall', '軽量鉄骨壁下地', 'area', 'lengthHeight', '壁下地')
  const mark = fixture('mark', '墨出し', 'area', 'polygon')
  store.setCountFixtures([wall])
  expect(apply(store, wall.id, mark, 'MARK').linked).toBe(1)
  store.undo()
  expect(store.getCountFixtures()).toEqual([wall])
})

it('既存項目への連動も一度のUndoで戻す', () => {
  const store = new AnnotationStore()
  const wall = fixture('wall', '壁下地', 'area', 'lengthHeight')
  const mark = fixture('mark', '墨出し', 'area', 'polygon')
  store.setCountFixtures([wall, mark])
  expect(apply(store, wall.id, mark, 'MARK', {}).linked).toBe(1)
  store.undo()
  expect(store.getCountFixtures()).toEqual([wall, mark])
})

it('養生は項目だけ追加し、面積の係数1を付けない', () => {
  const store = new AnnotationStore()
  const floor = fixture('floor', '床仕上げ', 'area', 'polygon')
  const protect = fixture('protect', '養生', 'area', 'polygon')
  store.setCountFixtures([floor])
  const result = apply(store, floor.id, protect, 'PROTECT', {})
  expect(result.error).toBeUndefined()
  expect(result.guidance).toBe(1)
  expect(store.getCountFixture(protect.id)?.link).toBeUndefined()
  store.undo()
  expect(store.getCountFixtures()).toEqual([floor])
})

it('既存の別連動を自動で上書きしない', () => {
  const store = new AnnotationStore()
  const wall = fixture('wall', '壁下地', 'area', 'lengthHeight')
  const other = fixture('other', '別の面', 'area', 'polygon')
  const mark: CountFixture = {
    ...fixture('mark', '墨出し', 'area', 'polygon'),
    link: { kind: 'factor', sources: [{ itemId: other.id, factor: 2 }] },
  }
  store.setCountFixtures([wall, other, mark])
  const result = apply(store, wall.id, mark, 'MARK', {})
  expect(result.linked).toBe(0)
  expect(result.guidance).toBe(0)
  expect(result.effects.some(effect => effect.kind === 'unchanged')).toBe(true)
  expect(store.getCountFixture(mark.id)?.link).toEqual(mark.link)
})

it('RECORD は構成要素にも配置せず項目だけ追加する', () => {
  const store = new AnnotationStore()
  const origin = fixture('equipment', '照明器具', 'count', 'click')
  const target = fixture('record', '確認記録', 'count', 'click')
  store.setCountFixtures([origin])

  const result = store.applyRelatedAdditions(
    origin.id,
    [target],
    undefined,
    (currentOrigin, currentTarget) => scopeLinkPlan({
      ruleId: 'RECORD-TEST',
      classId: 'RECORD',
      origin: currentOrigin,
      target: currentTarget,
    }),
  )

  expect(result.error).toBeUndefined()
  expect(result.componentMarks).toBe(0)
  expect(result.linked).toBe(0)
  expect(result.guidance).toBe(1)
  expect(result.effects.every(effect => effect.kind !== 'component')).toBe(true)
  expect(store.getCountFixture(target.id)?.link).toBeUndefined()

  store.undo()
  expect(store.getCountFixtures()).toEqual([origin])
})

it('許可した配置と既存の振り分けが違う場合は配置しない', () => {
  const store = new AnnotationStore()
  const origin = fixture('equipment', '照明器具', 'count', 'click')
  const target = fixture('target', '確認項目', 'count', 'click')
  store.setCountFixtures([origin])

  const result = store.applyRelatedAdditions(
    origin.id,
    [target],
    undefined,
    () => ({ kind: 'placement', placement: 'route' }),
  )

  expect(result.componentMarks).toBe(0)
  expect(result.changed).toBe(0)
  expect(result.linked).toBe(0)
  expect(result.guidance).toBe(1)
  expect(result.effects[0]?.reason).toContain('一致しない')
})

it('許可した component と計画のない従来の追加を維持する', () => {
  for (const scoped of [true, false]) {
    const store = new AnnotationStore()
    const origin = fixture('equipment', '照明器具', 'count', 'click')
    const target = fixture('box', '器具用ボックス', 'count', 'click')
    store.setCountFixtures([origin])

    const result = store.applyRelatedAdditions(
      origin.id,
      [target],
      undefined,
      scoped
        ? (currentOrigin, currentTarget) => scopeLinkPlan({
          ruleId: 'E-034',
          classId: 'POINT',
          origin: currentOrigin,
          target: currentTarget,
        })
        : undefined,
    )

    expect(result.error).toBeUndefined()
    expect(result.effects.some(effect => effect.kind === 'component')).toBe(true)
    expect(result.guidance).toBe(0)
    store.undo()
    expect(store.getCountFixtures()).toEqual([origin])
  }
})

it('新しい省略可能フィールドを検証・読込して保持する', () => {
  const target: CountFixture = {
    ...fixture('baseboard', '幅木', 'length', 'polyline'),
    link: {
      kind: 'shape',
      shape: { output: 'baseLength', deductDoorWidths: true },
      factor: 2,
      sources: [],
      auto: {
        categories: ['壁下地'],
        kinds: ['area', 'length'],
        originAny: [{ categories: ['壁下地'] }],
        sizeMatch: 'C51',
        factorFrom: 'outerCircumference',
      },
    },
  }
  expect(fixtureLinkError(target)).toBeUndefined()
  expect(readFixtureLink(target)).toEqual(target.link)
})
