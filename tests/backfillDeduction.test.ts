import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  nextCountStyle,
  parseCountFixtures,
  serializeCountFixtures,
  setFixtureDimensionUpdate,
  type CountFixture,
} from '../src/core/countFixtures'
import {
  backfillDetail,
  calculateBackfillVolume,
  pipeOuterDiameterMm,
} from '../src/core/backfill'
import { planFixtureDimensions } from '../src/core/fixtureDimensions'
import { QuantityIndex } from '../src/core/quantityIndex'
import { quantityLabel, type QuantityMark } from '../src/core/quantity'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import FixtureDialog from '../src/app/FixtureDialog'
import { RouteItems } from '../src/app/RouteItems'

function fixture(
  id: string,
  changes: Partial<CountFixture> = {},
): CountFixture {
  return {
    id, order: 0, code: id, name: id, category: '試験',
    kind: 'length', method: 'polyline', style: nextCountStyle([]),
    ...changes,
  }
}

const cable = fixture('cable', {
  code: 'CV', name: 'ケーブル',
  conditions: ['地中管路内'],
  // 外径があっても施工条件が一致しなければ引かない。
  attributes: { outerDiameterMm: 200 },
})
const pipe = fixture('pipe', {
  code: 'FEP65', name: '波付硬質合成樹脂管',
  conditions: ['地中埋設'],
  attributes: { outerDiameterMm: 82 },
})
const backfill = fixture('backfill', {
  code: '埋戻し', name: '溝埋戻し',
  kind: 'volume', method: 'lengthWidthDepth',
  defaults: { widthM: 0.6, depthM: 1.2 },
  backfill: { deductPipes: true, conditionIncludes: ['埋設'] },
})

function route(
  extra: NonNullable<QuantityMark['extra']> = [
    { itemId: pipe.id, count: 1, cond: { plan: '地中埋設' } },
    { itemId: backfill.id, count: 1, cond: { rise: null, slack: null } },
  ],
): QuantityMark {
  return {
    version: 1, id: 'route', itemId: cable.id, method: 'polyline',
    cond: { plan: '地中管路内' }, extra,
    addM: 3, slackM: 2,
  }
}

function annotation(mark = route(), lengthM = 19.32) {
  return {
    id: 'annotation', pageIndex: 0, quantity: mark,
    vertices: [[0, 0], [lengthM, 0]] as [number, number][],
    measure: { mmPerPoint: 1000 },
  }
}

async function storeWith(fixtures: CountFixture[]) {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => fixtures, async () => {})
  return store
}

function createPickup(
  store: AnnotationStore,
  mark: QuantityMark,
  lengthM = 10,
) {
  return store.create({
    pageIndex: 0, kind: 'perimeter', rect: [0, 0, lengthM, 20],
    vertices: [[0, 0], [lengthM, 0]],
    measure: { kind: 'perimeter', unit: 'm', decimals: 2, mmPerPoint: 1000 },
    quantity: mark,
  })
}

it('updates inherited/unset dimensions and restores fixtures and pickups with one undo', async () => {
  const initial = {
    ...backfill,
    defaults: { widthM: 0.6, depthM: 0.8 },
  }
  const store = await storeWith([cable, initial])
  const base: QuantityMark = {
    version: 1, id: 'inherited', itemId: initial.id,
    method: 'lengthWidthDepth', widthM: 0.6, depthM: 0.8,
  }
  const inherited = createPickup(store, base)
  const unset = createPickup(store, {
    ...base, id: 'unset', widthM: undefined, depthM: undefined,
  })
  const customized = createPickup(store, {
    ...base, id: 'customized', widthM: 0.7,
  })
  const composition = createPickup(store, {
    version: 1, id: 'composition', itemId: cable.id, method: 'polyline',
    cond: {}, extra: [{ itemId: initial.id, count: 1 }],
  })
  const before = [inherited, unset, customized, composition]
    .map(a => store.get(a.id)!.quantity)
  const next: CountFixture = {
    ...initial, defaults: { widthM: 0.9, depthM: 1.2 },
  }

  expect(store.fixtureDimensionMarks(next)).toEqual({ matched: 2, customized: 1 })
  setFixtureDimensionUpdate(next, true)
  store.setCountFixtures([cable, next])

  expect(store.get(inherited.id)?.quantity).toMatchObject({
    widthM: 0.9, depthM: 1.2,
  })
  expect(store.get(unset.id)?.quantity).toMatchObject({
    widthM: 0.9, depthM: 1.2,
  })
  expect(store.get(customized.id)?.quantity).toEqual(before[2])
  expect(store.get(composition.id)?.quantity).toEqual(before[3])
  expect(store.get(inherited.id)?.text).toContain('10.00×W0.90×D1.20=10.80')

  store.undo()
  expect(store.getCountFixture(initial.id)?.defaults).toEqual(initial.defaults)
  for (const [i, a] of [inherited, unset, customized, composition].entries()) {
    expect(store.get(a.id)?.quantity).toEqual(before[i])
  }
  store.redo()
  expect(store.getCountFixture(initial.id)?.defaults).toEqual(next.defaults)
  expect(store.get(inherited.id)?.quantity?.depthM).toBe(1.2)
})

it('changes 4.80 to 7.20 and leaves marks untouched when propagation is off', async () => {
  const initial = {
    ...backfill, backfill: undefined,
    defaults: { widthM: 0.6, depthM: 0.8 },
  }
  const store = await storeWith([initial])
  const pickup = createPickup(store, {
    version: 1, id: 'volume', itemId: initial.id,
    method: 'lengthWidthDepth', widthM: 0.6, depthM: 0.8,
  })
  expect(store.quantityIndex().total(initial.id)).toBeCloseTo(4.8, 12)

  const next = { ...initial, defaults: { widthM: 0.6, depthM: 1.2 } }
  setFixtureDimensionUpdate(next, true)
  store.setCountFixtures([next])
  expect(store.quantityIndex().total(initial.id)).toBeCloseTo(7.2, 12)
  store.undo()
  expect(store.quantityIndex().total(initial.id)).toBeCloseTo(4.8, 12)
  expect(store.get(pickup.id)?.quantity?.depthM).toBe(0.8)

  setFixtureDimensionUpdate(next, false)
  store.setCountFixtures([next])
  expect(store.getCountFixture(initial.id)?.defaults?.depthM).toBe(1.2)
  expect(store.get(pickup.id)?.quantity?.depthM).toBe(0.8)
  expect(store.quantityIndex().total(initial.id)).toBeCloseTo(4.8, 12)
})

it('updates height and removes cleared defaults without touching unrelated dimensions', async () => {
  const initial = fixture('wall', {
    kind: 'area', method: 'lengthHeight', defaults: { heightM: 2 },
  })
  const store = await storeWith([initial])
  const pickup = createPickup(store, {
    version: 1, id: 'wall', itemId: initial.id,
    method: 'lengthHeight', heightM: 2,
  })
  const next = { ...initial, defaults: { heightM: 3 } }
  setFixtureDimensionUpdate(next, true)
  store.setCountFixtures([next])
  expect(store.quantityIndex().total(initial.id)).toBeCloseTo(30, 12)

  const cleared = { ...next, defaults: {} }
  setFixtureDimensionUpdate(cleared, true)
  store.setCountFixtures([cleared])
  expect(store.get(pickup.id)?.quantity).not.toHaveProperty('heightM')
  store.undo()
  expect(store.get(pickup.id)?.quantity?.heightM).toBe(3)

  expect(planFixtureDimensions({
    version: 1, id: 'polygon', itemId: initial.id, method: 'polygon',
  }, initial, next)).toBeUndefined()
})

it('rejects invalid dimension edits atomically', async () => {
  const initial = {
    ...backfill, defaults: { widthM: 0.6, depthM: 0.8 },
  }
  const store = await storeWith([initial])
  const pickup = createPickup(store, {
    version: 1, id: 'volume', itemId: initial.id,
    method: 'lengthWidthDepth', widthM: 0.6, depthM: 0.8,
  })
  const invalid = { ...initial, defaults: { widthM: 0.6, depthM: -1 } }
  setFixtureDimensionUpdate(invalid, true)
  expect(() => store.setCountFixtures([invalid])).toThrow()
  expect(store.getCountFixture(initial.id)?.defaults).toEqual(initial.defaults)
  expect(store.get(pickup.id)?.quantity?.depthM).toBe(0.8)
  store.undo()
  expect(store.get(pickup.id)).toBeUndefined()
})

it('deducts an attributed 82mm FEP pipe using only its plan length', () => {
  const index = QuantityIndex.build([annotation()], [cable, pipe, backfill])
  const entry = index.entries(backfill.id)[0]
  const deduction = Math.PI / 4 * 0.082 ** 2 * 19.32

  expect(entry.backfill?.grossM3).toBeCloseTo(13.9104, 12)
  expect(entry.backfill?.deductionM3).toBeCloseTo(deduction, 12)
  expect(index.total(backfill.id).toFixed(2)).toBe('13.81')
  expect(entry.backfill?.pipes).toHaveLength(1)
  expect(entry.backfill?.warnings).toEqual([])
  expect(index.total(cable.id)).toBeCloseTo(24.32, 12)
  expect(index.total(pipe.id)).toBeCloseTo(24.32, 12)
  expect(backfillDetail(entry.backfill!)).toContain(
    '− 管 FEP65（φ82mm）× 19.32 = 0.10 ＝ 13.81 ㎥',
  )
})

it('uses FEP65 85mm from the buried-pipe table when no attribute is supplied', () => {
  const fromTable = { ...pipe, attributes: undefined }
  const index = QuantityIndex.build([annotation()], [cable, fromTable, backfill])
  expect(index.entries(backfill.id)[0].backfill?.pipes[0].outerDiameterMm).toBe(85)
  expect(index.total(backfill.id).toFixed(2)).toBe('13.80')

  expect(pipeOuterDiameterMm(fixture('split', { code: 'FEP', spec: '65' }))).toBe(85)
  expect(pipeOuterDiameterMm(fixture('conduit', { code: 'E', spec: '19' }))).toBe(19.1)
  expect(pipeOuterDiameterMm(fixture('steel', { code: 'SGP', spec: '65A' }))).toBe(76.3)
  expect(pipeOuterDiameterMm(fixture('code-steel', { code: '65A' }))).toBe(76.3)
  expect(pipeOuterDiameterMm(fixture('spec-conduit', { code: '', spec: 'G22' }))).toBe(26.5)
  expect(pipeOuterDiameterMm(fixture('priority', { code: 'FEP65', spec: 'E19' }))).toBe(19.1)
})

it('does not deduct unmatched conditions or excluded plan portions', () => {
  for (const cond of [
    { plan: '地中管路内' },
    { plan: null, rise: '地中埋設' },
    { plan: undefined, rise: '地中埋設' },
  ]) {
    const mark = route([
      { itemId: pipe.id, count: 1, cond },
      { itemId: backfill.id, count: 1 },
    ])
    const index = QuantityIndex.build([annotation(mark)], [cable, pipe, backfill])
    expect(index.total(backfill.id)).toBeCloseTo(13.9104, 12)
    expect(index.entries(backfill.id)[0].backfill?.deductionM3).toBe(0)
  }

  const excluded = route([
    { itemId: pipe.id, count: 1, cond: { plan: '地中埋設' } },
    { itemId: backfill.id, count: 1, cond: { plan: null } },
  ])
  const index = QuantityIndex.build([annotation(excluded)], [cable, pipe, backfill])
  expect(index.total(backfill.id)).toBe(0)
  expect(index.pagesOf(backfill.id)).toEqual([0])
})

it('uses pickup condition as fallback and supports multiple condition words', () => {
  const target = {
    ...backfill,
    backfill: { deductPipes: true as const, conditionIncludes: ['埋設', '地中配管'] },
  }
  const mark = route([
    { itemId: pipe.id, count: 1, cond: {} },
    { itemId: target.id, count: 1 },
  ])
  mark.condition = '地中配管'
  const index = QuantityIndex.build([annotation(mark)], [cable, pipe, target])
  // この試験ではケーブルもfallbackに一致するため、ケーブルの条件を明示して除く。
  expect(index.entries(target.id)[0].backfill?.pipes.map(p => p.itemId))
    .toEqual([pipe.id])
})

it('deducts both main and extra pipes, with pipe strands but without pipe perM', () => {
  const secondPipe = fixture('second-pipe', {
    code: 'E19', conditions: ['地中埋設'],
  })
  const target = route([
    { itemId: secondPipe.id, count: 3, perM: 4, cond: { plan: '地中埋設' } },
    { itemId: backfill.id, count: 2, perM: 1.5 },
  ])
  target.itemId = pipe.id
  target.count = 2
  target.cond = { plan: '地中埋設' }

  const index = QuantityIndex.build(
    [annotation(target)], [pipe, secondPipe, backfill],
  )
  const result = index.entries(backfill.id)[0].backfill!
  const expected = Math.PI / 4 * 19.32 * (0.082 ** 2 * 2 + 0.0191 ** 2 * 3)
  expect(result.grossM3).toBeCloseTo(19.32 * 0.6 * 1.2 * 2 * 1.5, 12)
  expect(result.deductionM3).toBeCloseTo(expected, 12)
  expect(result.pipes.map(p => p.itemId)).toEqual([pipe.id, secondPipe.id])
})

it('does not change unconfigured trenches or directly picked backfill', () => {
  const plain = { ...backfill, backfill: undefined }
  const plainIndex = QuantityIndex.build([annotation()], [cable, pipe, plain])
  expect(plainIndex.total(plain.id)).toBeCloseTo(13.9104, 12)
  expect(plainIndex.entries(plain.id)[0].backfill).toBeUndefined()

  const direct: QuantityMark = {
    version: 1, id: 'direct', itemId: backfill.id,
    method: 'lengthWidthDepth', widthM: 0.6, depthM: 1.2,
  }
  const index = QuantityIndex.build(
    [annotation(direct)], [cable, pipe, backfill],
  )
  expect(index.total(backfill.id)).toBeCloseTo(13.9104, 12)
  expect(index.entries(backfill.id)[0].backfill).toBeUndefined()
})

it('warns without deducting unknown diameters and clamps negative results', () => {
  const unknown = { ...pipe, code: 'FEP999', attributes: undefined }
  const index = QuantityIndex.build([annotation()], [cable, unknown, backfill])
  expect(index.total(backfill.id)).toBeCloseTo(13.9104, 12)
  expect(index.entries(backfill.id)[0].backfill?.warnings).toEqual([
    'FEP999 の外径が分からないため引いていません（項目の質量・寸法に外径を入れてください）',
  ])

  const oversized = { ...pipe, attributes: { outerDiameterMm: 2000 } }
  const clamped = QuantityIndex.build([annotation()], [cable, oversized, backfill])
  expect(clamped.total(backfill.id)).toBe(0)
  expect(clamped.entries(backfill.id)[0].backfill?.warnings.join('')).toContain('数量を0')
})

it('applies conversion after pipe deduction', () => {
  const converted = {
    ...backfill, convert: { factor: 2, unit: 't' as const, basis: '試験係数' },
  }
  const index = QuantityIndex.build([annotation()], [cable, pipe, converted])
  const expected = 13.9104 - Math.PI / 4 * 0.082 ** 2 * 19.32
  expect(index.rawTotal(backfill.id)).toBeCloseTo(expected, 12)
  expect(index.total(backfill.id)).toBeCloseTo(expected * 2, 12)
  expect(index.entries(backfill.id)[0].raw).toBeCloseTo(expected, 12)
})

it('round trips valid settings, drops invalid settings and rejects invalid saves', () => {
  const restored = parseCountFixtures(serializeCountFixtures([backfill]))
  expect(restored[0].backfill).toEqual(backfill.backfill)

  for (const invalid of [
    null, [], {},
    { deductPipes: false, conditionIncludes: ['埋設'] },
    { deductPipes: true, conditionIncludes: [] },
    { deductPipes: true, conditionIncludes: [''] },
    { deductPipes: true, conditionIncludes: [' 埋設'] },
    { deductPipes: true, conditionIncludes: ['a'.repeat(21)] },
    { deductPipes: true, conditionIncludes: Array(6).fill('埋設') },
    { deductPipes: true, conditionIncludes: [1] },
    { deductPipes: true, conditionIncludes: '埋設' },
  ]) {
    const raw = JSON.stringify({
      version: 1, fixtures: [{ ...backfill, backfill: invalid }],
    })
    const parsed = parseCountFixtures(raw)
    expect(parsed).toHaveLength(1)
    expect(parsed[0].backfill).toBeUndefined()
    expect(() => serializeCountFixtures([
      { ...backfill, backfill: invalid } as unknown as CountFixture,
    ])).toThrow()
  }

  const wrongMethod = { ...backfill, method: 'polygonDepth' as const }
  expect(parseCountFixtures(JSON.stringify({
    version: 1, fixtures: [wrongMethod],
  }))[0].backfill).toBeUndefined()
  expect(() => serializeCountFixtures([wrongMethod])).toThrow()

  const marked = { ...backfill }
  setFixtureDimensionUpdate(marked, true)
  expect(serializeCountFixtures([marked])).toBe(serializeCountFixtures([backfill]))
})

it('shows automatic backfill selection only when editing a named backfill fixture', () => {
  const initial = { ...backfill, backfill: undefined }
  const render = (editing: boolean) => renderToStaticMarkup(createElement(
    FixtureDialog, {
      initial, fixtures: [initial], editing,
      onSave: () => {}, onClose: () => {},
    },
  ))
  expect(render(true)).toMatch(
    /aria-label="埋戻し: 同じ経路の管の体積を引く"[^>]*checked=""/u,
  )
  expect(render(false)).not.toMatch(
    /aria-label="埋戻し: 同じ経路の管の体積を引く"[^>]*checked=""/u,
  )
})

it('shows pipe deduction in route rows and saved labels, refreshing after diameter edits', async () => {
  const store = await storeWith([cable, pipe, backfill])
  const pickup = createPickup(store, route(), 19.32)
  store.setRouteCondition([pickup.id], pipe.id, 'plan', '地中埋設')
  const current = store.get(pickup.id)!
  // 経路構成の行の表示は e2e（route-composition）で確かめる（RouteItems は useSyncExternalStore を使うためサーバー描画できない）。
  expect(current.text).toContain('−管 0.10')
  expect(current.text).toContain('13.81 ㎥')

  const changedPipe = { ...pipe, attributes: { outerDiameterMm: 85 } }
  store.setCountFixtures([cable, changedPipe, backfill])
  expect(store.get(pickup.id)?.text).toContain('13.80 ㎥')
  expect(store.quantityIndex().total(backfill.id).toFixed(2)).toBe('13.80')
  store.undo()
  expect(store.get(pickup.id)?.text).toContain('13.81 ㎥')
  expect(store.getCountFixture(pipe.id)?.attributes?.outerDiameterMm).toBe(82)

  const unknown = { ...pipe, code: 'FEP999', attributes: undefined }
  store.setCountFixtures([cable, unknown, backfill])
  expect(store.quantityIndex().total(backfill.id).toFixed(2)).toBe('13.91')
})

it('keeps route notes visible when codes are hidden and leaves ordinary labels unchanged', () => {
  const points: [number, number][] = [[0, 0], [19.32, 0]]
  const mark = route()
  const ordinary = quantityLabel(points, 1000, mark, 'CV', false)
  const withNote = quantityLabel(
    points, 1000, mark, 'CV', false, id => id, undefined,
    id => id === backfill.id ? '埋戻し −管 0.10 ＝ 13.81 ㎥' : '',
  )
  expect(withNote).toBe(ordinary + '；埋戻し −管 0.10 ＝ 13.81 ㎥')

  const result = calculateBackfillVolume(
    19.32, mark, mark.extra![1], backfill,
    id => [cable, pipe, backfill].find(f => f.id === id),
  )
  expect(result.valueM3.toFixed(2)).toBe('13.81')
})
