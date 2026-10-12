import { expect, it, vi } from 'vitest'
import {
  steelSection, steelMemberError, readSteelMember, type SteelMember,
} from '../src/core/steelMember'
import {
  parseCountFixtures, serializeCountFixtures, fixtureBreakdownError,
  quantityUnit, quantityDecimals, quantityOutputKind, type CountFixture,
} from '../src/core/countFixtures'
import {
  computeLinks, fixtureLinkError, readFixtureLink, type FixtureLink,
} from '../src/core/fixtureLink'
import { QuantityIndex } from '../src/core/quantityIndex'
import * as shapeMetrics from '../src/core/shapeMetrics'
import type { ShapeMetrics, ShapeAnnotation } from '../src/core/shapeMetrics'

const style: CountFixture['style'] = {
  shape: 'circle', fill: 'none', color: [1, 0, 0],
  size: 10, opacity: .8, showCode: true,
}
const beam: SteelMember = { section: 'H-400×200×8×13' }
function fixture(id: string, options: Partial<CountFixture> = {}): CountFixture {
  return { id, name: id, code: id, category: '例', style, order: 0, ...options }
}
function steelLink(
  id: string, settings: NonNullable<FixtureLink['steel']>,
  options: Partial<FixtureLink> = {},
): CountFixture {
  return fixture(id, {
    link: { kind: 'steel', sources: [{ itemId: 'A' }], steel: settings, ...options },
  })
}
function metric(options: Partial<ShapeMetrics> = {}): ShapeMetrics {
  return {
    itemId: 'A', annotationId: 'a', pageIndex: 2,
    floor: '2階', room: '居室', condition: '露出',
    method: 'polyline', count: 1, areaM2: 0, grossAreaM2: 0,
    perimeterM: 12, lengthM: 12, ...options,
  }
}

it('uses the unchanged H-section table for mass and all surface types', () => {
  const section = steelSection(beam)!
  expect(section.massKgPerM).toBe(65.4)
  expect(section.surfaceM2PerM()).toBeCloseTo(1.584, 12)
  expect(section.surfaceM2PerM('contour')).toBeCloseTo(1.584, 12)
  expect(section.surfaceM2PerM('box')).toBeCloseTo(1.2, 12)
  expect(section.surfaceM2PerM('boxBeam')).toBe(1)
  expect(steelSection({
    ...beam, customMassKgPerM: 1, customSurfaceM2PerM: 1,
  })!.massKgPerM).toBe(65.4)
})

it('links a 12m beam to design/required mass, paint and beam-box fireproofing', () => {
  const results = computeLinks([
    fixture('A', { kind: 'length', method: 'polyline', steel: beam }),
    steelLink('Mass', { output: 'mass' }),
    steelLink('Required', { output: 'mass', basis: 'required' }),
    steelLink('Paint', { output: 'paint' }),
    steelLink('Fireproof', { output: 'fireproof', surface: 'boxBeam' }),
    steelLink('Box', { output: 'fireproof', surface: 'box' }),
  ], () => [], () => [metric()])
  expect(results.get('Mass')!.total).toBeCloseTo(.7848, 12)
  expect(results.get('Required')!.total).toBeCloseTo(.82404, 12)
  expect(results.get('Paint')!.total).toBeCloseTo(19.008, 12)
  expect(results.get('Fireproof')!.total).toBe(12)
  expect(results.get('Box')!.total).toBeCloseTo(14.4, 12)
  expect(results.get('Mass')!.sources[0].note)
    .toContain('H-400×200×8×13 65.4kg/m × 12.0m')
  expect(results.get('Required')!.sources[0].note).toContain('1.05')
  expect(results.get('Mass')!.entries[0]).toMatchObject({
    annotationId: 'a', pageIndex: 2, floor: '2階', room: '居室', condition: '露出',
  })
  expect(results.get('Mass')!.warnings).toEqual([])
})

it('computes two 3.5m columns as 0.651t and multiplies beam route counts', () => {
  const column = computeLinks([
    fixture('A', { steel: { section: 'H-300×300×10×15', lengthMm: 3500 } }),
    steelLink('Mass', { output: 'mass' }),
  ], () => [], () => [metric({
    method: 'click', count: 2, lengthM: 0, perimeterM: 0,
  })]).get('Mass')!
  expect(column.total).toBeCloseTo(.651, 12)

  const repeated = computeLinks([
    fixture('A', { kind: 'length', steel: beam }),
    steelLink('Mass', { output: 'mass' }),
  ], () => [], () => [metric({ count: 3 })]).get('Mass')!
  expect(repeated.total).toBeCloseTo(.7848 * 3, 12)
})

it('supports custom sections and rejects absent or invalid custom values', () => {
  const custom: SteelMember = {
    section: '角形鋼管', customMassKgPerM: 20, customSurfaceM2PerM: .8,
  }
  const section = steelSection(custom)!
  expect(section.massKgPerM).toBe(20)
  for (const surface of ['contour', 'box', 'boxBeam'] as const) {
    expect(section.surfaceM2PerM(surface)).toBe(.8)
  }
  const results = computeLinks([
    fixture('A', { kind: 'length', steel: custom }),
    steelLink('Mass', { output: 'mass' }),
    steelLink('Paint', { output: 'paint' }),
  ], () => [], () => [metric()])
  expect(results.get('Mass')!.total).toBeCloseTo(.24, 12)
  expect(results.get('Paint')!.total).toBeCloseTo(9.6, 12)

  for (const value of [
    null, [], {}, { section: '角形鋼管' },
    { section: '角形鋼管', customSurfaceM2PerM: .8 },
    { section: '角形鋼管', customMassKgPerM: 20 },
    { ...custom, customMassKgPerM: 0 },
    { ...custom, customSurfaceM2PerM: NaN },
    { ...beam, lengthMm: -1 },
    { ...beam, customMassKgPerM: Infinity },
  ]) {
    expect(steelMemberError(value)).toBeDefined()
  }
  expect(steelSection({ section: '表にない断面' })).toBeUndefined()
})

it('round-trips steel members and drops unknown imported/saved fields', () => {
  const member = {
    section: '角形鋼管', customMassKgPerM: 20,
    customSurfaceM2PerM: .8, lengthMm: 3500,
  }
  const original = fixture('A', { steel: member, memo: '保持' })
  const raw = serializeCountFixtures([original])
  expect(parseCountFixtures(raw)[0].steel).toEqual(member)
  const imported = JSON.parse(raw)
  imported.fixtures[0].steel.unwanted = '捨てる'
  expect(parseCountFixtures(JSON.stringify(imported))[0].steel)
    .not.toHaveProperty('unwanted')
  expect(readSteelMember({ ...member, unwanted: '捨てる' })).toEqual(member)

  const saved = serializeCountFixtures([{
    ...original, steel: { ...member, unwanted: '捨てる' } as SteelMember,
  }])
  expect(JSON.parse(saved).fixtures[0].steel).not.toHaveProperty('unwanted')

  imported.fixtures[0].steel.customMassKgPerM = 0
  const parsed = parseCountFixtures(JSON.stringify(imported))
  expect(parsed).toHaveLength(1)
  expect(parsed[0].steel).toBeUndefined()
  expect(parsed[0].memo).toBe('保持')
  expect(() => serializeCountFixtures([{
    ...original, steel: { ...member, customMassKgPerM: 0 },
  }])).toThrow()
})

it('requires column length and permits steel only on count/length fixtures', () => {
  expect(fixtureBreakdownError(fixture('A', { steel: beam }))).toBeDefined()
  expect(fixtureBreakdownError(fixture('A', {
    kind: 'area', steel: beam,
  }))).toBeDefined()
  expect(fixtureBreakdownError(fixture('A', {
    kind: 'length', steel: beam,
  }))).toBeUndefined()
})

it('uses steel output units and decimal places independently of fixture kind', () => {
  for (const [output, unit, kind] of [
    ['mass', 't', 'mass'],
    ['paint', '㎡', 'area'],
    ['fireproof', '㎡', 'area'],
  ] as const) {
    const item = steelLink('L', { output })
    expect(quantityUnit(item)).toBe(unit)
    expect(quantityDecimals(item)).toBe(2)
    expect(quantityOutputKind(item)).toBe(kind)
  }
})

it('validates and round-trips steel link settings', () => {
  const original = steelLink('L', {
    output: 'fireproof', basis: 'design', surface: 'boxBeam',
  })
  expect(readFixtureLink(original)).toEqual(original.link)
  expect(parseCountFixtures(serializeCountFixtures([original]))[0].link)
    .toEqual(original.link)
  for (const invalid of [
    { kind: 'steel', sources: [] },
    { kind: 'steel', sources: [], steel: { output: 'unknown' } },
    { kind: 'steel', sources: [], steel: { output: 'mass', basis: 'unknown' } },
    { kind: 'steel', sources: [], steel: { output: 'paint', surface: 'unknown' } },
    { kind: 'factor', sources: [], steel: { output: 'mass' } },
  ]) {
    expect(fixtureLinkError({ id: 'L', link: invalid as FixtureLink })).toBeDefined()
  }
})

it('warns for missing members and incompatible pickups', () => {
  const missing = computeLinks([
    fixture('A'), steelLink('L', { output: 'mass' }),
  ], () => [], () => [metric()]).get('L')!
  expect(missing.total).toBe(0)
  expect(missing.warnings[0]).toContain('鉄骨部材')

  const incompatible = computeLinks([
    fixture('A', { kind: 'length', steel: beam }),
    steelLink('L', { output: 'mass' }),
  ], () => [], () => [metric({ method: 'polygon' })]).get('L')!
  expect(incompatible.total).toBe(0)
  expect(incompatible.warnings[0]).toContain('拾い方')
})

it('selects only steel members automatically and applies source/fixed conditions', () => {
  const results = computeLinks([
    fixture('A', { kind: 'length', steel: beam }),
    fixture('B', { kind: 'length' }),
    steelLink('L', { output: 'mass' }, {
      sources: [], auto: { kinds: ['length'], condition: '対象' },
      factor: 2, condition: { mode: 'fixed', value: '加工' },
    }),
    // Candidate condition membership is checked before pickup filtering.
  ].map(item => item.id === 'A' || item.id === 'B'
    ? { ...item, conditions: ['対象'] } : item), () => [], id => id === 'A' ? [
    metric({ condition: '対象' }),
    metric({ annotationId: 'excluded', condition: '除外' }),
  ] : [])
  const result = results.get('L')!
  expect(result.total).toBeCloseTo(.7848 * 2, 12)
  expect(result.sources.map(source => source.itemId)).toEqual(['A'])
  expect(result.entries).toHaveLength(1)
  expect(result.entries[0].condition).toBe('加工')
})

it('integrates steel geometry without applying original quantity conversions twice', () => {
  const annotations: ShapeAnnotation[] = [{
    id: 'a', pageIndex: 2, vertices: [[0, 0], [12, 0]],
    measure: { mmPerPoint: 1000 },
    quantity: {
      version: 1, id: 'a', itemId: 'A', method: 'polyline',
      floor: '2階', room: '居室', cond: { plan: '露出' },
    },
  }]
  const index = QuantityIndex.build(annotations, [
    fixture('A', {
      kind: 'length', method: 'polyline', steel: beam,
      convert: { factor: 2, unit: 'm', basis: '例' },
    }),
    steelLink('Mass', { output: 'mass' }),
    steelLink('Paint', { output: 'paint' }),
    fixture('Next', {
      kind: 'length',
      link: { kind: 'factor', sources: [{ itemId: 'Mass', factor: 2 }] },
    }),
  ])
  expect(index.total('A')).toBe(24)
  expect(index.rawTotal('A')).toBe(12)
  expect(index.total('Mass')).toBeCloseTo(.7848, 12)
  expect(index.total('Paint')).toBeCloseTo(19.008, 12)
  expect(index.total('Next')).toBeCloseTo(.7848 * 2, 12)
  expect(index.byPage('Mass').get(2)).toBeCloseTo(.7848, 12)
  expect(index.byFloor('Mass').get('2階')).toBeCloseTo(.7848, 12)
  expect(index.byRoom('Mass').get('居室')).toBeCloseTo(.7848, 12)
})

it('integrates count pickups including extra members for two columns', () => {
  const index = QuantityIndex.build([{
    id: 'a', pageIndex: 0,
    count: {
      version: 2, id: 'a', fixtureId: 'Other', floor: '1階', room: '柱',
      extra: [{ itemId: 'A', count: 2 }],
    },
  }], [
    fixture('Other'),
    fixture('A', { steel: { section: 'H-300×300×10×15', lengthMm: 3500 } }),
    steelLink('Mass', { output: 'mass' }),
  ])
  expect(index.total('A')).toBe(2)
  expect(index.total('Mass')).toBeCloseTo(.651, 12)
})

it('does not collect shape metrics merely because steel members exist', () => {
  const spy = vi.spyOn(shapeMetrics, 'collectShapeMetrics')
  try {
    QuantityIndex.build([], [
      fixture('A', { kind: 'length', steel: beam }),
      fixture('F', {
        kind: 'length', link: { kind: 'factor', sources: [{ itemId: 'A' }] },
      }),
    ])
    expect(spy).not.toHaveBeenCalled()
  } finally {
    spy.mockRestore()
  }
})
