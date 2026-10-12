import { expect, it } from 'vitest'
import {
  parseCountFixtures, serializeCountFixtures,
  quantityUnit, quantityDecimals, quantityOutputKind, type CountFixture,
} from '../src/core/countFixtures'
import {
  computeLinks, fixtureLinkError, readFixtureLink,
  fixtureLinkSourceUnit, fixtureLinkSourceShowsFactor, fixtureLinkBasisNumber,
  type FixtureLink, type LinkSourceEntry,
} from '../src/core/fixtureLink'
import { computeRcMember, rcMemberError, readRcMember, rcBarCountText, type RcMember } from '../src/core/rcMember'
import type { ShapeMetrics, ShapeAnnotation } from '../src/core/shapeMetrics'
import { QuantityIndex } from '../src/core/quantityIndex'
import { rcRebarItemFilter } from '../src/core/fixtureLink'
import { REBAR_GRADES } from '../src/core/breakdown/rcData'

const style: CountFixture['style'] = {
  shape: 'circle', fill: 'none', color: [1, 0, 0],
  size: 10, opacity: .8, showCode: true,
}
function fixture(id: string, options: Partial<CountFixture> = {}): CountFixture {
  return { id, name: id, code: id, category: '例', style, order: 0, ...options }
}
function metric(options: Partial<ShapeMetrics> = {}): ShapeMetrics {
  return {
    itemId: 'A', annotationId: 'a', pageIndex: 2,
    floor: '2階', room: '居室', condition: '例',
    method: 'polygon', count: 1, areaM2: 12, grossAreaM2: 12,
    perimeterM: 14, lengthM: 0,
    polygonM: { outer: [[0, 0], [4, 0], [4, 3], [0, 3]], holes: [] },
    ...options,
  }
}
function slab(options: Partial<RcMember> = {}): RcMember {
  return {
    kind: 'slab', thicknessMm: 150,
    bars: [
      { role: 'x', size: 'D13', spacingMm: 200, layers: 2 },
      { role: 'y', size: 'D13', spacingMm: 200, layers: 2 },
    ],
    ...options,
  }
}
function beam(options: Partial<RcMember> = {}): RcMember {
  return {
    kind: 'beam', widthMm: 400, depthMm: 700, slabDeductMm: 150,
    bars: [
      { role: 'top', size: 'D22', count: 4 },
      { role: 'bottom', size: 'D22', count: 4 },
      { role: 'stirrup', size: 'D10', spacingMm: 200 },
    ],
    ...options,
  }
}
function lineMetric(lengthM = 6, options: Partial<ShapeMetrics> = {}): ShapeMetrics {
  return metric({
    method: 'polyline', areaM2: 0, grossAreaM2: 0,
    polygonM: undefined, lengthM, perimeterM: lengthM, ...options,
  })
}
function markMetric(count: number): ShapeMetrics {
  return metric({
    method: 'click', count, areaM2: 0, grossAreaM2: 0,
    perimeterM: 0, polygonM: undefined,
  })
}
function rcLink(id: string, settings: NonNullable<FixtureLink['rc']>): CountFixture {
  return fixture(id, { link: { kind: 'rc', sources: [{ itemId: 'A' }], rc: settings } })
}
function shapeLink(id: string, settings: NonNullable<FixtureLink['shape']>): CountFixture {
  return fixture(id, {
    kind: settings.output === 'excavation' ? 'volume'
      : settings.output === 'perimeter' ? 'length' : 'area',
    link: { kind: 'shape', sources: [{ itemId: 'A' }], shape: settings },
  })
}

function depthRectangle(
  width: number,
  length: number,
  depthM: number,
  options: Partial<ShapeMetrics> = {},
): ShapeMetrics {
  return metric({
    method: 'polygonDepth',
    areaM2: width * length,
    grossAreaM2: width * length,
    perimeterM: 2 * (width + length),
    depthM,
    polygonM: {
      outer: [[0, 0], [width, 0], [width, length], [0, length]],
      holes: [],
    },
    ...options,
  })
}

function b31RebarItem(
  id: string,
  size?: string,
  grade?: string,
  settings: Partial<NonNullable<FixtureLink['rc']>> = {},
): CountFixture {
  return fixture(id, {
    name: '異形鉄筋',
    summary: [
      ...(grade !== undefined ? [{ label: '規格', value: grade }] : []),
      ...(size !== undefined ? [{ label: '径', value: size }] : []),
    ],
    link: {
      kind: 'rc', sources: [], auto: { rcKinds: [] },
      rc: { output: 'rebar', basis: 'required', ...settings },
    },
  })
}

function b31Foundation(): RcMember {
  const member = slab({ kind: 'foundationSlab' })
  return {
    ...member,
    bars: member.bars.map(bar => ({ ...bar, grade: 'SD295' })),
  }
}

it('B31 counts only the summary diameter from one SD295 foundation slab pickup', () => {
  const member = b31Foundation()
  const source = fixture('A', { kind: 'area', method: 'polygon', rc: member })
  const targets = ['D10', 'D13', 'D19'].map(size =>
    b31RebarItem(size, size, 'SD295'))
  const results = computeLinks(
    [source, ...targets], () => [], id => id === 'A' ? [metric()] : [],
  )
  const expected = computeRcMember(member, metric()).bars
    .reduce((sum, bar) => sum + bar.massKg, 0) / 1000 * 1.04

  expect(expected).toBeGreaterThan(0)
  expect(results.get('D13')!.total).toBeCloseTo(expected, 12)
  expect(results.get('D13')!.sources[0].note).toContain('SD295 D13 x方向')
  expect(results.get('D13')!.sources[0].note).toContain('SD295 D13 y方向')
  expect(results.get('D13')!.sources[0].note).not.toContain('規格の指定なし')
  for (const size of ['D10', 'D19']) {
    const result = results.get(size)!
    expect(result.total).toBe(0)
    expect(result.sources[0]).toMatchObject({ quantity: 0, subtotal: 0 })
    expect(result.entries[0].value).toBe(0)
    expect(result.sources[0].note)
      .toContain(`この部材に ${size} の鉄筋はありません`)
    expect(result.error).toBeUndefined()
    expect(result.warnings).toEqual([])
  }
})

it('B31 excludes a different grade but includes and explains unspecified grades', () => {
  const target = b31RebarItem('R345', 'D13', 'SD345')
  const member = b31Foundation()
  const calculate = (rc: RcMember) => computeLinks([
    fixture('A', { kind: 'area', method: 'polygon', rc }), target,
  ], () => [], () => [metric()]).get(target.id)!

  const mismatch = calculate(member)
  expect(mismatch.total).toBe(0)
  expect(mismatch.sources[0].note)
    .toContain('この部材に SD345 D13 の鉄筋はありません')
  expect(mismatch.warnings).toEqual([])

  const unspecified = slab({ kind: 'foundationSlab' })
  const compatible = calculate(unspecified)
  const expected = computeRcMember(unspecified, metric()).bars
    .reduce((sum, bar) => sum + bar.massKg, 0) / 1000 * 1.04
  expect(compatible.total).toBeCloseTo(expected, 12)
  expect(compatible.sources[0].note).toContain('（規格の指定なし）')

  const mixed = calculate({
    ...member,
    bars: [member.bars[0], unspecified.bars[1]],
  })
  const yOnly = computeRcMember({
    ...unspecified, bars: [unspecified.bars[1]],
  }, metric()).bars[0].massKg / 1000 * 1.04
  expect(mixed.total).toBeCloseTo(yOnly, 12)
  expect(mixed.sources[0].note).toContain('（規格の指定なし）')
  expect(mixed.sources[0].note).not.toContain('x方向')
})

it('B31 gives explicit sizes priority and preserves all-diameter assembly links', () => {
  const member = slab({
    kind: 'foundationSlab',
    bars: [
      { role: 'x', size: 'D10', grade: 'SD295', spacingMm: 200 },
      { role: 'y', size: 'D13', grade: 'SD295', spacingMm: 200 },
      { role: 'x', size: 'D19', grade: 'SD345', spacingMm: 200 },
    ],
  })
  const source = fixture('A', { kind: 'area', method: 'polygon', rc: member })
  const explicit = b31RebarItem('Explicit', 'D10', 'SD295', { sizes: ['D13'] })
  const empty = b31RebarItem('Empty', 'D13', 'SD295', { sizes: [] })
  const assembly = {
    ...b31RebarItem('Assembly', undefined, undefined, { basis: 'design' }),
    name: '鉄筋加工組立',
  }
  const specOnly = {
    ...b31RebarItem('SpecOnly'),
    spec: 'SD295 D10 D13 D999',
  }
  const results = computeLinks(
    [source, explicit, empty, assembly, specOnly], () => [], () => [metric()],
  )
  const rc = computeRcMember(member, metric())
  const d13 = rc.bars.find(bar => bar.size === 'D13')!.massKg / 1000 * 1.04
  const sd295 = rc.bars.filter(bar => bar.grade === 'SD295')
    .reduce((sum, bar) => sum + bar.massKg, 0) / 1000 * 1.04
  const all = rc.bars.reduce((sum, bar) => sum + bar.massKg, 0) / 1000
  expect(results.get('Explicit')!.total).toBeCloseTo(d13, 12)
  expect(results.get('Explicit')!.sources[0].note).not.toContain('D10')
  expect(results.get('Empty')!.total).toBe(0)
  expect(results.get('Empty')!.warnings).toEqual([])
  expect(results.get('Assembly')!.total).toBeCloseTo(all, 12)
  expect(results.get('SpecOnly')!.total).toBeCloseTo(sd295, 12)

  const saved = readFixtureLink(specOnly)!
  expect(saved.rc).not.toHaveProperty('sizes')
  expect(readFixtureLink(explicit)!.rc!.sizes).toEqual(['D13'])
  expect(readFixtureLink(empty)!.rc!.sizes).toEqual([])
})

it('B31 combines summary/spec tokens, ignores unrelated labels and rejects grade prefixes', () => {
  expect(rcRebarItemFilter({
    summary: [
      { label: ' 径 ', value: 'D10・D13・D999・D13' },
      { label: ' 規格 ', value: 'SD295・SD345' },
      { label: '備考', value: 'D19 SD490' },
    ],
    spec: 'SD390 D16',
  })).toEqual({
    sizes: ['D10', 'D13', 'D16'],
    grades: ['SD295', 'SD345', 'SD390'],
  })
  expect(rcRebarItemFilter({
    summary: [{ label: '規格', value: 'SD2950 SD345A XSD390 SD490_' }],
    spec: 'D999',
  })).toEqual({ sizes: [], grades: [] })
})

it('B31 filters both joint outputs before aggregating identical diameters', () => {
  const original = beam({
    bars: [
      { role: 'top', size: 'D22', grade: 'SD295', count: 4 },
      { role: 'bottom', size: 'D22', grade: 'SD345', count: 8 },
      { role: 'stirrup', size: 'D10', grade: 'SD295', spacingMm: 200 },
    ],
  })
  for (const [output, joint] of [
    ['gasJoint', 'gas'], ['lapJoint', 'lap'],
  ] as const) {
    const member = { ...original, joint }
    const before = JSON.stringify(member)
    const target = b31RebarItem('Joint', 'D22', 'SD295', { output })
    const wrongSize = b31RebarItem('WrongSize', 'D19', 'SD295', { output })
    const result = computeLinks([
      fixture('A', { kind: 'length', method: 'polyline', rc: member }),
      target, wrongSize,
    ], () => [], () => [lineMetric()])
    expect(result.get('Joint')!.total).toBe(4)
    expect(result.get('Joint')!.sources[0].note).toContain('SD295 D22 上端筋')
    expect(result.get('Joint')!.sources[0].note).not.toContain('SD345')
    expect(result.get('Joint')!.sources[0].note).not.toContain('D10')
    expect(result.get('WrongSize')!.total).toBe(0)
    expect(result.get('WrongSize')!.sources[0].note)
      .toContain('この部材に D19 の鉄筋はありません')
    expect(result.get('WrongSize')!.warnings).toEqual([])
    expect(JSON.stringify(member)).toBe(before)

    const legacy = {
      ...member,
      bars: member.bars.map(bar => {
        const next = { ...bar }
        delete next.grade
        return next
      }),
    }
    const compatible = computeLinks([
      fixture('A', { kind: 'length', method: 'polyline', rc: legacy }), target,
    ], () => [], () => [lineMetric()]).get('Joint')!
    expect(compatible.total).toBe(12)
    expect(compatible.sources[0].note).toContain('（規格の指定なし）')
  }
})

it('B31 preserves concrete/formwork and unfiltered rebar quantities', () => {
  const member = b31Foundation()
  const reference = computeRcMember(slab({ kind: 'foundationSlab' }), metric())
  const source = fixture('A', { kind: 'area', method: 'polygon', rc: member })
  const targets = [
    b31RebarItem('Concrete', 'D10', 'SD345', {
      output: 'concrete', sizes: ['D19'],
    }),
    b31RebarItem('Formwork', 'D10', 'SD345', {
      output: 'formwork', sizes: ['D19'],
    }),
    b31RebarItem('All'),
  ]
  const results = computeLinks([source, ...targets], () => [], () => [metric()])
  expect(results.get('Concrete')!.total).toBeCloseTo(reference.concreteM3, 12)
  expect(results.get('Formwork')!.total).toBeCloseTo(reference.formworkM2, 12)
  expect(results.get('All')!.total).toBeCloseTo(
    reference.bars.reduce((sum, bar) => sum + bar.massKg, 0) / 1000 * 1.04, 12,
  )
  expect(results.get('All')!.sources[0].note).not.toContain('規格の指定なし')
})

it('B31 validates, imports, computes and round-trips optional grades', () => {
  for (const grade of REBAR_GRADES) {
    const member = slab({
      bars: [{ role: 'x', size: 'D13', grade, spacingMm: 200 }],
    })
    expect(rcMemberError(member)).toBeUndefined()
    expect(readRcMember({
      ...member,
      bars: member.bars.map(bar => ({ ...bar, unwanted: true })),
    })).toEqual(member)
    expect(computeRcMember(member, metric()).bars[0].grade).toBe(grade)
    const source = fixture('A', { kind: 'area', method: 'polygon', rc: member })
    expect(parseCountFixtures(serializeCountFixtures([source]))[0].rc).toEqual(member)
  }
  const legacy = slab()
  expect(readRcMember(legacy)!.bars[0]).not.toHaveProperty('grade')
  expect(computeRcMember(legacy, metric()).bars[0]).not.toHaveProperty('grade')

  const message = '鉄筋の規格は SD295・SD345・SD390・SD490 から選んでください。'
  for (const grade of ['', 'SD500', ' SD295', null, 295]) {
    const invalid = {
      ...legacy, bars: [{ ...legacy.bars[0], grade }],
    }
    expect(rcMemberError(invalid)).toBe(message)
    expect(readRcMember(invalid)).toBeUndefined()
    const source = fixture('A', { kind: 'area', method: 'polygon', memo: '保持' })
    const parsed = parseCountFixtures(JSON.stringify({
      version: 1, fixtures: [{ ...source, rc: invalid }],
    }))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].rc).toBeUndefined()
    expect(parsed[0].memo).toBe('保持')
  }

  const invalidMember = slab({
    bars: [
      { role: 'x', size: 'D13', grade: 'SD295', spacingMm: 200 },
      { role: 'y', size: 'D19', grade: 'SD500', spacingMm: 200 },
    ],
  })
  const rejected = computeLinks([
    fixture('A', { kind: 'area', method: 'polygon', rc: invalidMember }),
    b31RebarItem('R', 'D13', 'SD295'),
  ], () => [], () => [metric()]).get('R')!
  expect(rejected.total).toBe(0)
  expect(rejected.warnings[0]).toContain(message)
})

it('B31 quantity index retains zero links and diameter-specific required totals', () => {
  const source = fixture('A', {
    kind: 'area', method: 'polygon', rc: b31Foundation(),
  })
  const targets = ['D10', 'D13', 'D19'].map(size =>
    b31RebarItem(size, size, 'SD295'))
  const fixtures = parseCountFixtures(serializeCountFixtures([source, ...targets]))
  const annotation: ShapeAnnotation = {
    id: 'b31', pageIndex: 2,
    vertices: [[0, 0], [4, 0], [4, 3], [0, 3]],
    measure: { mmPerPoint: 1000 },
    quantity: {
      version: 1, id: 'b31', itemId: 'A', method: 'polygon',
      floor: '2階', room: '居室',
    },
  }
  const index = QuantityIndex.build([annotation], fixtures)
  expect(index.total('A')).toBe(12)
  expect(index.total('D10').toFixed(2)).toBe('0.00')
  expect(index.total('D13').toFixed(2)).toBe('0.35')
  expect(index.total('D19').toFixed(2)).toBe('0.00')
  expect(index.byPage('D13').get(2)).toBeCloseTo(index.total('D13'), 12)
  expect(index.linkResult('D10')!.sources[0].note)
    .toContain('この部材に D10 の鉄筋はありません')
  expect(index.linkResult('D10')!.warnings).toEqual([])
})

it('derives volume beam dimensions and prefers explicit width and depth', () => {
  const member = beam({
    widthMm: undefined, depthMm: undefined, slabDeductMm: undefined,
  })
  const pickup = depthRectangle(.6, 10, .7)
  const result = computeRcMember(member, pickup)
  expect(result.concreteM3).toBeCloseTo(4.2, 12)
  expect(result.formworkM2).toBeCloseTo(20, 12)
  expect(result.bars.map(bar => bar.count)).toEqual([4, 4, 51])
  expect(result.bars[2].lengthM).toBeCloseTo(51 * 2 * (.6 + .7), 12)
  expect(result.shapeDimensionText)
    .toContain('梁 面積 6.00㎡ ÷ 幅 0.60m = 長さ 10.00m、せい 0.70m（拾いの深さ）')
  expect(rcBarCountText(result.bars[2])).toContain(result.shapeDimensionText!)
  expect(rcBarCountText(result.bars[2])).toContain('10.00m÷0.200m→51本')

  const narrower = computeRcMember({ ...member, widthMm: 400 }, pickup)
  expect(narrower.concreteM3).toBeCloseTo(4.2, 12)
  expect(narrower.formworkM2).toBeCloseTo(27, 12)
  expect(narrower.bars[2].count).toBe(76)
  expect(narrower.shapeDimensionText)
    .toContain('梁 面積 6.00㎡ ÷ 幅 0.40m = 長さ 15.00m、せい 0.70m（拾いの深さ）')

  const explicit = computeRcMember({
    ...member, widthMm: 400, depthMm: 800, slabDeductMm: 150,
  }, depthRectangle(.6, 10, NaN))
  expect(explicit.concreteM3).toBeCloseTo(3.9, 12)
  expect(explicit.formworkM2).toBeCloseTo(25.5, 12)
  expect(explicit.shapeDimensionText).toContain('せい 0.80m（入力）')
  expect(explicit.shapeDimensionText).toContain('床板控除 0.15m')

  const foundation = computeRcMember({
    ...member, kind: 'foundationBeam',
  }, pickup)
  expect(foundation.concreteM3).toBeCloseTo(4.2, 12)
  expect(foundation.formworkM2).toBeCloseTo(14, 12)

  const repeated = computeRcMember(member, depthRectangle(.6, 10, .7, { count: 3 }))
  expect(repeated.concreteM3).toBeCloseTo(result.concreteM3 * 3, 12)
  expect(repeated.formworkM2).toBeCloseTo(result.formworkM2 * 3, 12)
  for (const [index, bar] of result.bars.entries()) {
    expect(repeated.bars[index].count).toBe(bar.count * 3)
    expect(repeated.bars[index].lengthM).toBeCloseTo(bar.lengthM * 3, 12)
  }
})

it('derives volume walls from area, thickness and pickup depth', () => {
  const member: RcMember = {
    kind: 'wall',
    bars: [
      { role: 'vertical', size: 'D10', spacingMm: 200, layers: 2 },
      { role: 'horizontal', size: 'D10', spacingMm: 200, layers: 2 },
    ],
  }
  const result = computeRcMember(member, depthRectangle(.2, 5, 3))
  expect(result.concreteM3).toBeCloseTo(3, 12)
  expect(result.formworkM2).toBeCloseTo(30, 12)
  expect(result.bars.map(bar => bar.count)).toEqual([52, 28])
  expect(result.bars[0].spanM).toBeCloseTo(5, 12)
  expect(result.bars[1].spanM).toBeCloseTo(3, 12)
  expect(rcBarCountText(result.bars[1])).toContain('（切り上げ−1）')
  expect(result.shapeDimensionText)
    .toContain('壁 面積 1.00㎡ ÷ 厚さ 0.20m = 長さ 5.00m、高さ 3.00m（拾いの深さ）')

  const existing = computeRcMember({ ...member, thicknessMm: 200 }, metric({
    method: 'lengthHeight', lengthM: 5, heightM: 3,
    areaM2: 15, grossAreaM2: 15, polygonM: undefined,
  }))
  expect(result.lapJoints).toBe(existing.lapJoints)
  expect(result.gasJoints).toEqual(existing.gasJoints)
  expect(result.bars.map(bar => bar.lengthM))
    .toEqual(existing.bars.map(bar => bar.lengthM))

  const explicit = computeRcMember({
    ...member, thicknessMm: 100, heightMm: 2000,
  }, depthRectangle(.2, 5, NaN))
  expect(explicit.concreteM3).toBeCloseTo(2, 12)
  expect(explicit.formworkM2).toBeCloseTo(40, 12)
  expect(explicit.bars[0].spanM).toBeCloseTo(10, 12)
  expect(explicit.bars[1].spanM).toBeCloseTo(2, 12)
  expect(explicit.shapeDimensionText).toContain('高さ 2.00m（入力）')
})

it('uses the volume column footprint and perimeter for concrete, formwork and hoops', () => {
  const member: RcMember = {
    kind: 'column',
    bars: [
      { role: 'main', size: 'D25', count: 12 },
      { role: 'hoop', size: 'D10', spacingMm: 100 },
    ],
  }
  const result = computeRcMember(member, depthRectangle(.6, .6, 3.5))
  expect(result.concreteM3).toBeCloseTo(1.26, 12)
  expect(result.formworkM2).toBeCloseTo(8.4, 12)
  expect(result.bars.map(bar => bar.count)).toEqual([12, 36])
  expect(result.bars[0].lengthM).toBeCloseTo(42, 12)
  expect(result.bars[1].lengthM).toBeCloseTo(36 * 2.4, 12)
  expect(result.gasJoints).toEqual([{ size: 'D25', count: 12 }])
  expect(rcBarCountText(result.bars[1])).toContain('外周 2.40m')
  expect(rcBarCountText(result.bars[1])).toContain('3.50m÷0.100m→36本')

  const explicit = computeRcMember({
    ...member, widthMm: 1000, depthMm: 2000, heightMm: 4000,
  }, depthRectangle(.6, .6, NaN))
  expect(explicit.concreteM3).toBeCloseTo(.36 * 4, 12)
  expect(explicit.formworkM2).toBeCloseTo(2.4 * 4, 12)
  expect(explicit.bars[1].count).toBe(41)
  expect(explicit.bars[1].lengthM).toBeCloseTo(41 * 2.4, 12)

  const repeated = computeRcMember(member, depthRectangle(.6, .6, 3.5, { count: 2 }))
  expect(repeated.concreteM3).toBeCloseTo(2.52, 12)
  expect(repeated.formworkM2).toBeCloseTo(16.8, 12)
  expect(repeated.bars.map(bar => bar.count)).toEqual([24, 72])
})

it('clips volume footing base bars in both directions and preserves pickup multiplicity', () => {
  const member: RcMember = {
    kind: 'footing',
    bars: [{ role: 'base', size: 'D16', spacingMm: 200 }],
  }
  const result = computeRcMember(member, depthRectangle(2, 2, .8))
  expect(result.concreteM3).toBeCloseTo(3.2, 12)
  expect(result.formworkM2).toBeCloseTo(6.4, 12)
  expect(result.bars[0].count).toBe(22)
  expect(result.bars[0].lengthM).toBeCloseTo(44, 12)
  expect(result.bars[0].anchorageM).toBe(0)
  expect(result.bars[0].allocations).toEqual([
    { spanM: 2, perLayerCount: 11, allocationCount: 11 },
    { spanM: 2, perLayerCount: 11, allocationCount: 11 },
  ])
  expect(rcBarCountText(result.bars[0])).toContain('独立基礎 平面の面積 4.00㎡')

  const repeated = computeRcMember(member, depthRectangle(2, 2, .8, { count: 3 }))
  expect(repeated.concreteM3).toBeCloseTo(9.6, 12)
  expect(repeated.formworkM2).toBeCloseTo(19.2, 12)
  expect(repeated.bars[0].count).toBe(66)
  expect(repeated.bars[0].lengthM).toBeCloseTo(132, 12)

  const explicit = computeRcMember({
    ...member, heightMm: 1000,
  }, depthRectangle(2, 2, NaN))
  expect(explicit.concreteM3).toBeCloseTo(4, 12)
  expect(explicit.formworkM2).toBeCloseTo(8, 12)
})

it('uses net area and clips footing bars around holes instead of the bounding rectangle', () => {
  const pickup = metric({
    method: 'polygonDepth', depthM: .8, areaM2: 11,
    polygonM: {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]],
      holes: [[[1, 1], [2, 1], [2, 2], [1, 2]]],
    },
  })
  const result = computeRcMember({
    kind: 'footing', lapD: 0,
    bars: [{ role: 'base', size: 'D13', spacingMm: 1500 }],
  }, pickup)
  const reference = computeRcMember(slab({
    thicknessMm: 800, anchorageD: 0, lapD: 0,
    bars: [
      { role: 'x', size: 'D13', spacingMm: 1500 },
      { role: 'y', size: 'D13', spacingMm: 1500 },
    ],
  }), pickup)
  expect(result.concreteM3).toBeCloseTo(8.8, 12)
  expect(result.formworkM2).toBeCloseTo(11.2, 12)
  expect(result.bars[0].count)
    .toBe(reference.bars.reduce((sum, bar) => sum + bar.count, 0))
  expect(result.bars[0].lengthM)
    .toBeCloseTo(reference.bars.reduce((sum, bar) => sum + bar.lengthM, 0), 12)
  expect(rcBarCountText(result.bars[0])).toContain('形・開口で切り分け→4本')
})

it('relaxes only dimension requirements when fromShape is true', () => {
  for (const kind of [
    'slab', 'foundationSlab', 'wall', 'beam', 'foundationBeam', 'column', 'footing',
  ] as const) {
    const member: RcMember = { kind, bars: [] }
    expect(rcMemberError(member, { fromShape: true })).toBeUndefined()
    if (kind !== 'slab' && kind !== 'foundationSlab') {
      expect(rcMemberError(member)).toBeDefined()
      expect(rcMemberError(member, { fromShape: false })).toBeDefined()
    }
    for (const key of ['thicknessMm', 'widthMm', 'depthMm', 'heightMm'] as const) {
      for (const value of [0, -1, NaN, Infinity]) {
        expect(rcMemberError({ ...member, [key]: value }, { fromShape: true }))
          .toBe('RC部材の寸法は0より大きい有限の数で入れてください。')
      }
    }
  }
  expect(rcMemberError({
    kind: 'beam', bars: [], slabDeductMm: 150,
  }, { fromShape: true })).toBeUndefined()
  expect(rcMemberError({
    kind: 'beam', bars: [], depthMm: 700, slabDeductMm: 700,
  }, { fromShape: true })).toBeDefined()
  expect(rcMemberError({
    kind: 'wall', bars: [{ role: 'top', size: 'D22', count: 4 }],
  }, { fromShape: true })).toBeDefined()
})

it('rejects unresolved volume dimensions and validates deduction against inferred depth', () => {
  const message = 'RC部材の寸法を入れるか、深さ（体積）で拾ってください。'
  for (const kind of ['wall', 'beam', 'foundationBeam', 'column', 'footing'] as const) {
    const member: RcMember = { kind, bars: [] }
    for (const depthM of [undefined, 0, -1, NaN, Infinity]) {
      expect(() => computeRcMember(member, depthRectangle(.6, 10, .7, { depthM })))
        .toThrow(message)
    }
    expect(() => computeRcMember(member, depthRectangle(.6, 10, .7, {
      areaM2: 0,
    }))).toThrow(message)
    expect(() => computeRcMember(member, depthRectangle(.6, 10, .7, {
      polygonM: undefined,
    }))).toThrow(message)
    expect(() => computeRcMember(member, depthRectangle(.6, 10, .7, {
      polygonM: { outer: [[0, 0], [1, 0], [2, 0]], holes: [] },
    }))).toThrow(message)
  }
  for (const kind of ['column', 'footing'] as const) {
    expect(() => computeRcMember({ kind, bars: [] }, depthRectangle(.6, .6, 3.5, {
      perimeterM: 0,
    }))).toThrow(message)
  }
  expect(() => computeRcMember({
    kind: 'beam', bars: [], slabDeductMm: 700,
  }, depthRectangle(.6, 10, .7)))
    .toThrow('梁の床板控除は0以上、梁のせい未満で入れてください。')
})

it('imports and round-trips shape-derived RC dimensions without filling stored fields', () => {
  for (const kind of ['wall', 'beam', 'foundationBeam', 'column', 'footing'] as const) {
    const member: RcMember = { kind, bars: [] }
    expect(readRcMember({ ...member, unwanted: '捨てる' })).toEqual(member)
    const original = fixture('A', {
      kind: 'volume', method: 'polygonDepth', rc: member,
    })
    const parsed = parseCountFixtures(serializeCountFixtures([original]))
    expect(parsed[0].rc).toEqual(member)
    for (const key of ['thicknessMm', 'widthMm', 'depthMm', 'heightMm']) {
      expect(parsed[0].rc).not.toHaveProperty(key)
    }
  }
})

it('computes slab geometry, doubled bars, span-based joints and lap additions', () => {
  const result = computeRcMember(slab(), metric())
  expect(result.concreteM3).toBeCloseTo(1.8, 12)
  expect(result.formworkM2).toBe(12)
  expect(result.bars.map(bar => bar.count)).toEqual([32, 42])
  // Structural spans 4m and 3m each have 0.5 slab joints per bar.
  expect(result.lapJoints).toBe(16 + 21)
  expect(result.gasJoints).toEqual([])
  expect(result.bars[0].lengthM).toBeCloseTo(32 * (4 + 2 * .455) + 16 * .52, 10)
  expect(result.bars[1].lengthM).toBeCloseTo(42 * (3 + 2 * .455) + 21 * .52, 10)
  expect(result.bars[0].massKg).toBeCloseTo(result.bars[0].lengthM * .995, 10)
  expect(result.bars[1].massKg).toBeCloseTo(result.bars[1].lengthM * .995, 10)

  const anchorageOnly = computeRcMember(slab({ lapD: 0 }), metric())
  expect(anchorageOnly.bars[0].lengthM).toBeCloseTo(32 * (4 + .91), 10)
  expect(anchorageOnly.bars[1].lengthM).toBeCloseTo(42 * (3 + .91), 10)

  const foundation = computeRcMember(slab({ kind: 'foundationSlab' }), metric())
  expect(foundation.concreteM3).toBeCloseTo(1.8, 12)
  expect(foundation.formworkM2).toBeCloseTo(14 * .15, 12)
})

it('exposes slab allocation, per-bar additions and JIS mass without changing quantities', () => {
  const result = computeRcMember(slab(), metric())
  expect(result.bars[0]).toMatchObject({
    layers: 2, spacingMm: 200, spanM: 3, perLayerCount: 16,
    allocationCount: 16, pickupCount: 1, count: 32, massKgPerM: .995,
  })
  expect(result.bars[1]).toMatchObject({
    layers: 2, spacingMm: 200, spanM: 4, perLayerCount: 21,
    allocationCount: 21, pickupCount: 1, count: 42, massKgPerM: .995,
  })
  for (const bar of result.bars) {
    expect(bar.anchorageM).toBeCloseTo(.91, 12)
    expect(bar.lapM).toBeCloseTo(.26, 12)
  }
  expect(rcBarCountText(result.bars[0]))
    .toBe('3.00m÷0.200m→16本×2段=32本（切り上げ＋1）')
  expect(rcBarCountText(result.bars[1]))
    .toBe('4.00m÷0.200m→21本×2段=42本（切り上げ＋1）')
  const repeated = computeRcMember(slab(), metric({ count: 3 }))
  expect(rcBarCountText(repeated.bars[0]))
    .toBe('3.00m÷0.200m→16本×2段×3（拾いの数）=96本（切り上げ＋1）')
  expect(repeated.bars[0].lengthM).toBeCloseTo(result.bars[0].lengthM * 3, 12)
  expect(repeated.bars[0].anchorageM).toBeCloseTo(.91, 12)
  expect(repeated.bars[0].lapM).toBeCloseTo(.26, 12)
})

it('distinguishes clipped slab segments from allocation lines in the evidence', () => {
  const result = computeRcMember(slab({
    bars: [{ role: 'x', size: 'D13', spacingMm: 1500 }],
  }), metric({
    areaM2: 11,
    polygonM: {
      outer: [[0, 0], [4, 0], [4, 3], [0, 3]],
      holes: [[[1, 1], [2, 1], [2, 2], [1, 2]]],
    },
  }))
  expect(result.bars[0]).toMatchObject({
    allocationCount: 3, perLayerCount: 4, count: 4,
  })
  expect(rcBarCountText(result.bars[0]))
    .toContain('3.00m÷1.500m→3本（形・開口で切り分け→4本）×1段=4本')
})

it('uses each disconnected slab segment for bar counts, anchorage and joints', () => {
  const polygonM: NonNullable<ShapeMetrics['polygonM']> = {
    outer: [[0, 0], [4, 0], [4, 3], [0, 3]],
    holes: [[[1, 1], [2, 1], [2, 2], [1, 2]]],
  }
  const result = computeRcMember(slab({
    bars: [{ role: 'x', size: 'D13', spacingMm: 1500 }],
  }), metric({ areaM2: 11, polygonM }))
  // y=0,1.5,3: 4m; 1m + 2m; 4m => four separate bars.
  expect(result.bars[0].count).toBe(4)
  expect(result.lapJoints).toBe(2)
  expect(result.bars[0].lengthM).toBeCloseTo(11 + 4 * .91 + 2 * .52, 12)
  expect(result.concreteM3).toBeCloseTo(11 * .15, 12)
})

it('computes net wall concrete/formwork and vertical/horizontal doubled bars', () => {
  const wall: RcMember = {
    kind: 'wall', thicknessMm: 180,
    bars: [
      { role: 'vertical', size: 'D10', spacingMm: 200, layers: 2 },
      { role: 'horizontal', size: 'D10', spacingMm: 200, layers: 2 },
    ],
  }
  const result = computeRcMember(wall, metric({
    method: 'lengthHeight', lengthM: 5, perimeterM: 5,
    heightM: 3, areaM2: 15, grossAreaM2: 15, polygonM: undefined,
  }))
  expect(result.concreteM3).toBeCloseTo(2.7, 12)
  expect(result.formworkM2).toBe(30)
  expect(result.bars.map(bar => bar.count)).toEqual([52, 28])
  expect(result.lapJoints).toBe(52)
  expect(result.bars[0].lengthM).toBeCloseTo(52 * (3 + .35 + .4), 12)
  expect(result.bars[1].lengthM).toBeCloseTo(28 * (5 + .35), 12)

  const openings = computeRcMember(wall, metric({
    method: 'lengthHeight', lengthM: 5, perimeterM: 5, heightM: 3,
    areaM2: 13, grossAreaM2: 15, polygonM: undefined,
  }))
  expect(openings.concreteM3).toBeCloseTo(13 * .18, 12)
  expect(openings.formworkM2).toBe(26)
})

it('shows the minus-one wall horizontal allocation and counted main bars', () => {
  const wall: RcMember = {
    kind: 'wall', thicknessMm: 180,
    bars: [
      { role: 'vertical', size: 'D10', spacingMm: 200, layers: 2 },
      { role: 'horizontal', size: 'D10', spacingMm: 200, layers: 2 },
    ],
  }
  const result = computeRcMember(wall, metric({
    method: 'lengthHeight', lengthM: 5, heightM: 3,
    areaM2: 15, grossAreaM2: 15, polygonM: undefined,
  }))
  expect(result.bars[0]).toMatchObject({ spanM: 5, perLayerCount: 26 })
  expect(result.bars[1]).toMatchObject({ spanM: 3, perLayerCount: 14 })
  expect(rcBarCountText(result.bars[1]))
    .toBe('3.00m÷0.200m→14本×2段=28本（切り上げ−1）')
  const main = computeRcMember(beam(), lineMetric()).bars[0]
  expect(main).toMatchObject({
    countPerLayer: 4, perLayerCount: 4, layers: 1, massKgPerM: 3.04,
  })
  expect(rcBarCountText(main)).toBe('4本×1段=4本')
})

it('computes beams with slab deduction, gas joints and stirrups', () => {
  const result = computeRcMember(beam(), lineMetric())
  expect(result.concreteM3).toBeCloseTo(1.32, 12)
  expect(result.formworkM2).toBeCloseTo(9, 12)
  expect(result.gasJoints).toEqual([{ size: 'D22', count: 8 }])
  expect(result.lapJoints).toBe(0)
  expect(result.bars.map(bar => bar.count)).toEqual([4, 4, 31])
  expect(result.bars[0].lengthM).toBeCloseTo(4 * (6 + 2 * .77), 12)
  expect(result.bars[2].lengthM).toBeCloseTo(31 * 2 * (.4 + .7), 12)
  expect(result.bars[2].massKg).toBeCloseTo(68.2 * .56, 12)

  const foundation = computeRcMember(beam({ kind: 'foundationBeam' }), lineMetric())
  expect(foundation.formworkM2).toBeCloseTo(6 * 1.1, 12)
  expect(foundation.concreteM3).toBeCloseTo(1.32, 12)

  const repeated = computeRcMember(beam(), lineMetric(6, { count: 3 }))
  expect(repeated.concreteM3).toBeCloseTo(1.32 * 3, 12)
  expect(repeated.gasJoints).toEqual([{ size: 'D22', count: 24 }])
  expect(repeated.bars[0].lengthM).toBeCloseTo(result.bars[0].lengthM * 3, 12)
})

it('supports explicit lap joints and the beam boundary categories', () => {
  const result = computeRcMember(beam({ joint: 'lap', anchorageD: 0, lapD: 40 }), lineMetric())
  expect(result.gasJoints).toEqual([])
  expect(result.lapJoints).toBe(8)
  expect(result.bars[0].lengthM).toBeCloseTo(4 * (6 + .88), 12)

  for (const [length, joints] of [[4, 4], [5, 8], [10, 16]] as const) {
    expect(computeRcMember(beam(), lineMetric(length)).gasJoints)
      .toEqual([{ size: 'D22', count: joints }])
  }
})

it('computes two columns, per-floor main-bar joints and hoop counts', () => {
  const column: RcMember = {
    kind: 'column', widthMm: 600, depthMm: 600, heightMm: 3500,
    bars: [
      { role: 'main', size: 'D25', count: 12 },
      { role: 'hoop', size: 'D13', spacingMm: 100 },
    ],
  }
  const result = computeRcMember(column, markMetric(2))
  expect(result.concreteM3).toBeCloseTo(2 * .6 * .6 * 3.5, 12)
  expect(result.formworkM2).toBeCloseTo(2 * 2.4 * 3.5, 12)
  expect(result.bars.map(bar => bar.count)).toEqual([24, 72])
  expect(result.bars[0].lengthM).toBe(84)
  expect(result.bars[1].lengthM).toBeCloseTo(72 * 2.4, 12)
  expect(result.gasJoints).toEqual([{ size: 'D25', count: 24 }])

  const lap = computeRcMember({ ...column, joint: 'lap' }, markMetric(2))
  expect(lap.lapJoints).toBe(24)
  expect(lap.bars[0].lengthM).toBe(24 * (3.5 + 1))
})

it('computes three footings and both directions from one base-bar setting', () => {
  const footing: RcMember = {
    kind: 'footing', widthMm: 2000, depthMm: 2000, heightMm: 800,
    bars: [{ role: 'base', size: 'D16', spacingMm: 200 }],
  }
  const result = computeRcMember(footing, markMetric(3))
  expect(result.concreteM3).toBeCloseTo(9.6, 12)
  expect(result.formworkM2).toBeCloseTo(19.2, 12)
  expect(result.bars[0].count).toBe(66)
  expect(result.bars[0].lengthM).toBe(132)
  expect(result.bars[0].massKg).toBeCloseTo(132 * 1.56, 12)
  expect(result.lapJoints).toBe(0)
  expect(result.gasJoints).toEqual([])
})

it('validates RC fields, dimensions, roles, layers and the twenty-setting limit', () => {
  expect(rcMemberError(slab())).toBeUndefined()
  expect(rcMemberError(slab({ bars: [] }))).toBeUndefined()
  expect(rcMemberError(slab({ bars: Array(20).fill(slab().bars[0]) }))).toBeUndefined()
  for (const member of [
    null, [], {}, { kind: 'unknown', bars: [] },
    slab({ thicknessMm: 0 }),
    slab({ anchorageD: NaN }),
    slab({ lapD: -1 }),
    slab({ bars: Array(21).fill(slab().bars[0]) }),
    slab({ bars: [{ role: 'x', size: 'D12', spacingMm: 200 }] }),
    slab({ bars: [{ role: 'x', size: 'D13', spacingMm: 0 }] }),
    slab({ bars: [{ role: 'top', size: 'D13', count: 2 }] }),
    beam({ slabDeductMm: 700 }),
    beam({ bars: [{ role: 'top', size: 'D22', count: 1.5 }] }),
  ]) expect(rcMemberError(member)).toBeDefined()
  expect(() => computeRcMember(slab(), lineMetric())).toThrow()
})

it('drops only invalid imported RC data and refuses to save invalid RC data', () => {
  const original = fixture('A', {
    kind: 'area', method: 'polygon', memo: '保持', rc: slab(),
  })
  const raw = serializeCountFixtures([original])
  expect(parseCountFixtures(raw)[0].rc).toEqual(slab())
  const data = JSON.parse(raw)
  data.fixtures[0].rc.bars[0].spacingMm = 0
  const parsed = parseCountFixtures(JSON.stringify(data))
  expect(parsed).toHaveLength(1)
  expect(parsed[0].rc).toBeUndefined()
  expect(parsed[0].memo).toBe('保持')
  expect(() => serializeCountFixtures([{
    ...original, rc: slab({ thicknessMm: -1 }),
  }])).toThrow()

  data.fixtures[0].rc = { ...slab(), unwanted: '捨てる' }
  data.fixtures[0].rc.bars[0].unwanted = '捨てる'
  const cleaned = parseCountFixtures(JSON.stringify(data))[0].rc!
  expect(cleaned).not.toHaveProperty('unwanted')
  expect(cleaned.bars[0]).not.toHaveProperty('unwanted')
})

it('links concrete, formwork, size-filtered steel and required steel with original locations', () => {
  const member = beam()
  const source = fixture('A', { kind: 'length', method: 'polyline', rc: member })
  const rc = computeRcMember(member, lineMetric())
  const steelD22 = rc.bars.filter(bar => bar.size === 'D22')
    .reduce((sum, bar) => sum + bar.massKg, 0) / 1000
  const fixtures = [
    source,
    rcLink('C', { output: 'concrete' }),
    rcLink('F', { output: 'formwork' }),
    rcLink('All', { output: 'rebar' }),
    rcLink('D22', { output: 'rebar', sizes: ['D22'] }),
    rcLink('Required', { output: 'rebar', sizes: ['D22'], basis: 'required' }),
    rcLink('Gas', { output: 'gasJoint', sizes: ['D22'] }),
    rcLink('NoGas', { output: 'gasJoint', sizes: ['D10'] }),
  ]
  const results = computeLinks(fixtures, () => [], () => [lineMetric()])
  expect(results.get('C')!.total).toBeCloseTo(1.32, 12)
  expect(results.get('F')!.total).toBeCloseTo(9, 12)
  expect(results.get('All')!.total).toBeCloseTo(
    rc.bars.reduce((sum, bar) => sum + bar.massKg, 0) / 1000, 12,
  )
  expect(results.get('D22')!.total).toBeCloseTo(steelD22, 12)
  expect(results.get('Required')!.total).toBeCloseTo(steelD22 * 1.04, 12)
  expect(results.get('Gas')!.total).toBe(8)
  expect(results.get('NoGas')!.total).toBe(0)
  expect(results.get('C')!.entries[0]).toMatchObject({
    annotationId: 'a', pageIndex: 2, floor: '2階', room: '居室', condition: '例',
  })
  expect(results.get('C')!.sources[0].note)
    .toContain('梁 長さ 6.00m × 幅 0.40m × （せい 0.70m − 床板控除 0.15m） = 1.32㎥')
  expect(results.get('C')!.warnings).toEqual([])
})

it('shows RC output-specific evidence and preserves required rebar totals', () => {
  const member = slab({ thicknessMm: undefined })
  const source = fixture('A', {
    kind: 'volume', method: 'polygonDepth', rc: member,
  })
  const pickup = metric({ method: 'polygonDepth', depthM: .15 })
  const required = rcLink('R', { output: 'rebar', basis: 'required' })
  const result = computeLinks([
    source, required,
    rcLink('C', { output: 'concrete' }),
    rcLink('F', { output: 'formwork' }),
  ], () => [], () => [pickup])
  const rebar = result.get('R')!
  const note = rebar.sources[0].note!
  expect(note).toContain('床板 12.00㎡ 厚さ 0.15m（拾いの深さ）')
  expect(note).toContain('÷0.200m→16本')
  expect(note).toContain('÷0.200m→21本')
  expect(note).toContain('1本 平均5.17m')
  expect(note).toContain('定着・継手を含む')
  expect(note).toContain('× 0.995kg/m')
  expect(note).toContain('× 1.04（所要）')
  const expected = computeRcMember(member, pickup).bars
    .reduce((sum, bar) => sum + bar.massKg, 0) / 1000 * 1.04
  expect(rebar.total).toBeCloseTo(expected, 12)
  expect(result.get('C')!.sources[0].note)
    .toContain('床板 12.00㎡ × 厚さ 0.15m（拾いの深さ） = 1.80㎥')
  expect(result.get('F')!.sources[0].note).toContain('底面 12.00㎡ = 12.00㎡')
  expect(result.get('C')!.sources[0].note).not.toContain('kg/m')
})

it('limits rebar evidence to selected diameters and labels joint roles', () => {
  const source = fixture('A', { kind: 'length', method: 'polyline', rc: beam() })
  const result = computeLinks([
    source,
    rcLink('R', { output: 'rebar', sizes: ['D22'], basis: 'required' }),
    rcLink('G', { output: 'gasJoint', sizes: ['D22'] }),
  ], () => [], () => [lineMetric()])
  const note = result.get('R')!.sources[0].note!
  expect(note).toContain('D22 上端筋 4本×1段=4本')
  expect(note).toContain('× 3.040kg/m')
  expect(note).not.toContain('D10')
  expect(result.get('G')!.sources[0].note).toContain('ガス圧接 4.00か所')
  expect(result.get('G')!.sources[0].note).toContain('合計 8.00か所')
})

it('uses output units and omits only neutral metric source multipliers', () => {
  const original = fixture('A', { kind: 'volume', method: 'polygonDepth' })
  const source = { itemId: 'A', quantity: .35244, subtotal: .35244, factor: 1 }
  for (const item of [
    rcLink('R', { output: 'rebar' }),
    shapeLink('S', { output: 'area' }),
    fixture('T', {
      link: { kind: 'steel', sources: [{ itemId: 'A' }], steel: { output: 'mass' } },
    }),
    fixture('X', {
      link: { kind: 'crossing', sources: [{ itemId: 'A' }], crossing: {} },
    }),
  ]) {
    expect(fixtureLinkSourceUnit(item, original)).toBe(quantityUnit(item))
    expect(fixtureLinkSourceShowsFactor(item, source)).toBe(false)
    expect(fixtureLinkSourceShowsFactor(item, { ...source, factor: 2 })).toBe(true)
    expect(fixtureLinkSourceShowsFactor(item, { ...source, factor: -1 })).toBe(true)
    const openingItem: CountFixture = {
      ...item,
      link: {
        ...item.link!,
        sources: [{ itemId: 'A', factorFrom: 'openingWidth' }],
      },
    }
    expect(fixtureLinkSourceShowsFactor(openingItem, source)).toBe(true)
    const subtractionItem: CountFixture = {
      ...item,
      link: { ...item.link!, sources: [{ itemId: 'A', sign: -1 }] },
    }
    expect(fixtureLinkSourceShowsFactor(subtractionItem, source)).toBe(true)
  }
  const rebar = rcLink('R', { output: 'rebar' })
  expect(fixtureLinkSourceUnit(rebar, original)).toBe('t')
  expect(fixtureLinkBasisNumber(rebar, source.quantity)).toBe('0.352')
  const factor = fixture('L', {
    link: { kind: 'factor', sources: [{ itemId: 'A' }] },
  })
  expect(fixtureLinkSourceUnit(factor, original)).toBe(quantityUnit(original))
  expect(fixtureLinkSourceShowsFactor(factor, source)).toBe(true)
  expect(fixtureLinkBasisNumber(factor, source.quantity)).toBe('0.35244')
})

it('filters lap joint counts by size without changing the result schema', () => {
  const member: RcMember = {
    kind: 'column', widthMm: 600, depthMm: 600, heightMm: 3500,
    joint: 'lap',
    bars: [
      { role: 'main', size: 'D22', count: 4 },
      { role: 'main', size: 'D25', count: 8 },
    ],
  }
  const results = computeLinks([
    fixture('A', { rc: member }),
    rcLink('All', { output: 'lapJoint' }),
    rcLink('D22', { output: 'lapJoint', sizes: ['D22'] }),
    rcLink('None', { output: 'lapJoint', sizes: [] }),
  ], () => [], () => [markMetric(2)])
  expect(results.get('All')!.total).toBe(24)
  expect(results.get('D22')!.total).toBe(8)
  expect(results.get('None')!.total).toBe(0)
})

it('uses RC output units, output kinds and decimal places independently of item kind', () => {
  for (const [output, unit, kind, decimals] of [
    ['concrete', '㎥', 'volume', 2],
    ['formwork', '㎡', 'area', 2],
    ['rebar', 't', 'mass', 2],
    ['gasJoint', 'か所', 'count', 0],
    ['lapJoint', 'か所', 'count', 0],
  ] as const) {
    const item = rcLink('L', { output })
    expect(quantityUnit(item)).toBe(unit)
    expect(quantityOutputKind(item)).toBe(kind)
    expect(quantityDecimals(item)).toBe(decimals)
  }
})

it('links shape area, perimeter, perimeter-times-height and excavation', () => {
  const fixtures = [
    fixture('A', { kind: 'area', method: 'polygon' }),
    shapeLink('Area', { output: 'area' }),
    shapeLink('Perimeter', { output: 'perimeter' }),
    shapeLink('Height', { output: 'lengthTimesHeight', heightM: 2 }),
    shapeLink('Excavation', { output: 'excavation', marginM: .5, depthM: 2 }),
  ]
  const results = computeLinks(fixtures, () => [], () => [metric()])
  expect(results.get('Area')!.total).toBe(12)
  expect(results.get('Perimeter')!.total).toBe(14)
  expect(results.get('Height')!.total).toBe(28)
  expect(results.get('Excavation')!.total).toBe((12 + 14 * .5 + 4 * .5 ** 2) * 2)

  const pickupDepth = computeLinks(fixtures, () => [], () => [metric({ depthM: .8 })])
  expect(pickupDepth.get('Excavation')!.total)
    .toBeCloseTo((12 + 14 * .5 + 1) * .8, 12)
  const zeroDepth = computeLinks(fixtures, () => [], () => [metric({ depthM: 0 })])
  expect(zeroDepth.get('Excavation')!.total).toBe(0)

  const line = computeLinks([
    fixture('A', { kind: 'length', method: 'polyline' }),
    shapeLink('Height', { output: 'lengthTimesHeight', heightM: 2 }),
  ], () => [], () => [lineMetric(5, { count: 3 })])
  expect(line.get('Height')!.total).toBe(30)
})

it('subtracts foundation volume from excavation through dependent links', () => {
  const fixtures = [
    fixture('A', { kind: 'area', method: 'polygon', rc: slab({ bars: [] }) }),
    shapeLink('Excavation', { output: 'excavation', marginM: 0, depthM: 1 }),
    rcLink('Concrete', { output: 'concrete' }),
    fixture('Backfill', {
      kind: 'volume',
      link: {
        kind: 'factor',
        sources: [{ itemId: 'Excavation' }, { itemId: 'Concrete', sign: -1 }],
        rounding: 'none',
      },
    }),
  ]
  const result = computeLinks([...fixtures].reverse(), () => [], id =>
    id === 'A' ? [metric()] : [])
  expect(result.get('Backfill')!.computed).toBeCloseTo(12 - 1.8, 12)
  expect(result.get('Backfill')!.entries.reduce((sum, entry) => sum + entry.value, 0))
    .toBeCloseTo(10.2, 12)
  expect(result.get('Backfill')!.sources.find(source => source.itemId === 'Concrete')!.subtotal)
    .toBeCloseTo(-1.8, 12)
})

it('clamps subtraction after summing sources, and passes the clamped result downstream', () => {
  const rows: LinkSourceEntry[] = [
    { itemId: 'A', annotationId: 'a', pageIndex: 0, value: 2 },
    { itemId: 'B', annotationId: 'b', pageIndex: 1, value: 5 },
  ]
  const fixtures = [
    fixture('A'), fixture('B'),
    fixture('L', {
      link: {
        kind: 'factor', sources: [{ itemId: 'A' }, { itemId: 'B', sign: -1 }],
        rounding: 'none',
      },
    }),
    fixture('Next', {
      link: { kind: 'factor', sources: [{ itemId: 'L' }], rounding: 'none' },
    }),
  ]
  const result = computeLinks(fixtures, id => rows.filter(row => row.itemId === id))
  expect(result.get('L')!.total).toBe(0)
  expect(result.get('L')!.computed).toBe(0)
  expect(result.get('L')!.entries.every(entry => entry.value === 0)).toBe(true)
  expect(result.get('L')!.sources.map(source => source.subtotal)).toEqual([2, -5])
  expect(result.get('Next')!.total).toBe(0)
})

it('derives opening factors, multiplies manual factors and warns when dimensions are missing', () => {
  const source = fixture('A', { opening: { widthM: 1.8, heightM: 2.1 } })
  const row: LinkSourceEntry = {
    itemId: 'A', annotationId: 'a', pageIndex: 0, value: 3,
  }
  const fixtures = [
    source,
    fixture('Perimeter', {
      kind: 'length',
      link: { kind: 'factor', sources: [{ itemId: 'A', factorFrom: 'openingPerimeter' }] },
    }),
    fixture('Area', {
      kind: 'area',
      link: {
        kind: 'factor',
        sources: [{ itemId: 'A', factorFrom: 'openingArea', factor: 2 }],
      },
    }),
    fixture('Width', {
      kind: 'length',
      link: { kind: 'factor', sources: [{ itemId: 'A', factorFrom: 'openingWidth' }] },
    }),
  ]
  const result = computeLinks(fixtures, () => [row])
  expect(result.get('Perimeter')!.total).toBeCloseTo(23.4, 12)
  expect(result.get('Area')!.total).toBeCloseTo(3 * 1.8 * 2.1 * 2, 12)
  expect(result.get('Width')!.total).toBeCloseTo(5.4, 12)

  const missing = computeLinks([
    { ...source, opening: undefined }, fixtures[1],
  ], () => [row]).get('Perimeter')!
  expect(missing.total).toBe(0)
  expect(missing.warnings).toHaveLength(1)
  expect(missing.warnings[0]).toContain('開口寸法')
})

it('applies opening coefficients and subtraction to mass and carry links', () => {
  const source = fixture('A', {
    opening: { widthM: 2, heightM: 1 },
    attributes: { massKg: 1000, widthMm: 1000, depthMm: 1000, heightMm: 1000 },
  })
  const row: LinkSourceEntry = {
    itemId: 'A', annotationId: 'a', pageIndex: 0, value: 3,
  }
  const base = fixture('CarryBase', {
    link: { kind: 'carry', sources: [{ itemId: 'A' }], carry: { class: 'heavy' } },
  })
  const scaled = fixture('CarryScaled', {
    link: {
      kind: 'carry', carry: { class: 'heavy' },
      sources: [{ itemId: 'A', factorFrom: 'openingWidth', factor: 2 }],
    },
  })
  const mass = fixture('Mass', {
    link: { kind: 'mass', sources: [{ itemId: 'A', factorFrom: 'openingWidth' }] },
  })
  const negative = fixture('Negative', {
    link: { kind: 'mass', sources: [{ itemId: 'A', sign: -1 }] },
  })
  const result = computeLinks([source, base, scaled, mass, negative], () => [row])
  expect(result.get('CarryBase')!.total).toBeGreaterThan(0)
  expect(result.get('CarryScaled')!.total).toBeCloseTo(result.get('CarryBase')!.total * 4, 12)
  expect(result.get('Mass')!.total).toBe(6)
  expect(result.get('Negative')!.total).toBe(0)
})

it('validates inclusive shape bounds and the new source/RC settings', () => {
  const valid: FixtureLink = {
    kind: 'shape',
    sources: [{ itemId: 'A', sign: -1, factorFrom: 'openingWidth' }],
    shape: { output: 'excavation', marginM: 5, heightM: 100, depthM: 100 },
  }
  expect(fixtureLinkError({ id: 'L', link: valid })).toBeUndefined()
  expect(fixtureLinkError({
    id: 'L', link: { ...valid, shape: { output: 'excavation', marginM: 0, depthM: 0 } },
  })).toBeUndefined()
  expect(fixtureLinkError({
    id: 'L',
    link: { kind: 'rc', sources: [], rc: { output: 'rebar', sizes: ['D10', 'D41'], basis: 'required' } },
  })).toBeUndefined()

  for (const link of [
    { kind: 'rc', sources: [] },
    { kind: 'rc', sources: [], rc: { output: 'unknown' } },
    { kind: 'rc', sources: [], rc: { output: 'rebar', sizes: ['D12'] } },
    { kind: 'rc', sources: [], rc: { output: 'rebar', sizes: ['D13', 'D13'] } },
    { kind: 'rc', sources: [], rc: { output: 'rebar', basis: 'unknown' } },
    { ...valid, shape: { output: 'excavation', marginM: 5.01 } },
    { ...valid, shape: { output: 'lengthTimesHeight', heightM: 100.01 } },
    { ...valid, shape: { output: 'excavation', depthM: -1 } },
    { ...valid, shape: { output: 'area', depthM: NaN } },
    { ...valid, sources: [{ itemId: 'A', sign: 1 }] },
    { ...valid, sources: [{ itemId: 'A', factorFrom: 'unknown' }] },
  ]) {
    expect(fixtureLinkError({ id: 'L', link: link as FixtureLink })).toBeDefined()
  }
})

it('round-trips new link fields and copies array settings', () => {
  const link: FixtureLink = {
    kind: 'rc', sources: [{ itemId: 'A', sign: -1, factorFrom: 'openingArea' }],
    rc: { output: 'rebar', sizes: ['D13'], basis: 'required' },
  }
  const copied = readFixtureLink({ id: 'L', link })!
  expect(copied).toEqual(link)
  expect(copied.rc!.sizes).not.toBe(link.rc!.sizes)
  expect(copied.sources[0]).not.toBe(link.sources[0])
  expect(parseCountFixtures(serializeCountFixtures([fixture('L', { link })]))[0].link)
    .toEqual(link)

  const shape: FixtureLink = {
    kind: 'shape', sources: [{ itemId: 'A', sign: -1 }],
    shape: { output: 'excavation', marginM: 0, depthM: 0, heightM: 0 },
  }
  expect(parseCountFixtures(serializeCountFixtures([fixture('S', { link: shape })]))[0].link)
    .toEqual(shape)
})

it('uses source condition filters and fixed conditions for metric links', () => {
  const result = computeLinks([
    fixture('A', { kind: 'area', rc: slab({ bars: [] }) }),
    fixture('L', {
      link: {
        kind: 'rc', rc: { output: 'concrete' },
        sources: [{ itemId: 'A', conditions: ['対象'], factor: 2 }],
        condition: { mode: 'fixed', value: '出力条件' },
      },
    }),
  ], () => [], () => [
    metric({ annotationId: 'selected', condition: '対象' }),
    metric({ annotationId: 'excluded', condition: '除外' }),
  ]).get('L')!
  expect(result.total).toBeCloseTo(3.6, 12)
  expect(result.entries).toHaveLength(1)
  expect(result.entries[0]).toMatchObject({
    annotationId: 'selected', condition: '出力条件', floor: '2階', room: '居室',
  })
})

it('warns for missing metric providers, missing RC members and incompatible pickups', () => {
  const missingMetrics = computeLinks([
    fixture('A', { rc: slab() }), rcLink('L', { output: 'concrete' }),
  ], () => []).get('L')!
  expect(missingMetrics.total).toBe(0)
  expect(missingMetrics.warnings[0]).toContain('形の計量')

  const missingMember = computeLinks([
    fixture('A'), rcLink('L', { output: 'concrete' }),
  ], () => [], () => [metric()]).get('L')!
  expect(missingMember.warnings[0]).toContain('RC部材')

  const incompatible = computeLinks([
    fixture('A', { rc: slab() }), rcLink('L', { output: 'concrete' }),
  ], () => [], () => [lineMetric()]).get('L')!
  expect(incompatible.total).toBe(0)
  expect(incompatible.warnings[0]).toContain('拾い方')
})

it('integrates RC links without changing the original pickup area or conversions', () => {
  const annotation: ShapeAnnotation = {
    id: 'a', pageIndex: 2,
    vertices: [[0, 0], [4, 0], [4, 3], [0, 3]],
    measure: { mmPerPoint: 1000 },
    quantity: {
      version: 1, id: 'a', itemId: 'A', method: 'polygon',
      floor: '2階', room: '居室', condition: '例',
    },
  }
  const source = fixture('A', {
    kind: 'area', method: 'polygon', rc: slab({ bars: [] }),
    convert: { factor: 2, unit: '㎡', basis: '例' },
  })
  const index = QuantityIndex.build([annotation], [
    source, rcLink('C', { output: 'concrete' }), rcLink('F', { output: 'formwork' }),
  ])
  expect(index.total('A')).toBe(24)
  expect(index.rawTotal('A')).toBe(12)
  expect(index.total('C')).toBeCloseTo(1.8, 12)
  expect(index.total('F')).toBe(12)
  expect(index.byPage('C').get(2)).toBeCloseTo(1.8, 12)
  expect(index.byFloor('C').get('2階')).toBeCloseTo(1.8, 12)
  expect(index.byRoom('C').get('居室')).toBeCloseTo(1.8, 12)
  expect(index.byCondition('C').get('例')!.total).toBeCloseTo(1.8, 12)
})

it('uses polygon pickup depth for slabs without an explicit thickness', () => {
  for (const kind of ['slab', 'foundationSlab'] as const) {
    const member = slab({ kind, thicknessMm: undefined })
    expect(rcMemberError(member)).toBeUndefined()

    const result = computeRcMember(member, metric({
      method: 'polygonDepth', depthM: .15,
    }))
    const explicit = computeRcMember(slab({ kind }), metric())
    expect(result).toEqual(explicit)
    expect(result.concreteM3).toBeCloseTo(1.8, 12)
    expect(result.formworkM2).toBeCloseTo(kind === 'slab' ? 12 : 2.1, 12)
    expect(result.bars.map(bar => bar.count)).toEqual([32, 42])
    expect(result.bars[0].lengthM).toBeCloseTo(32 * (4 + .91) + 16 * .52, 10)
    expect(result.bars[1].lengthM).toBeCloseTo(42 * (3 + .91) + 21 * .52, 10)
    expect(result.bars[0].massKg).toBeCloseTo(result.bars[0].lengthM * .995, 10)
    expect(result.bars[1].massKg).toBeCloseTo(result.bars[1].lengthM * .995, 10)
    expect(result.lapJoints).toBe(37)
  }
})

it('prefers explicit slab thickness over pickup depth', () => {
  for (const kind of ['slab', 'foundationSlab'] as const) {
    const member = slab({ kind, thicknessMm: 200 })
    const result = computeRcMember(member, metric({
      method: 'polygonDepth', depthM: .15,
    }))
    expect(result).toEqual(computeRcMember(member, metric()))
    expect(result.concreteM3).toBeCloseTo(2.4, 12)
    expect(result.formworkM2).toBeCloseTo(kind === 'slab' ? 12 : 2.8, 12)

    // An unused pickup depth does not override or invalidate explicit thickness.
    expect(computeRcMember(member, metric({
      method: 'polygonDepth', depthM: NaN,
    }))).toEqual(result)
  }
})

it('requires a positive usable thickness when computing slabs', () => {
  const message = 'RC部材の厚さを入れるか、深さ（体積）で拾ってください。'
  for (const kind of ['slab', 'foundationSlab'] as const) {
    const member = slab({ kind, thicknessMm: undefined })
    expect(() => computeRcMember(member, metric())).toThrow(message)
    // Depth is a fallback only for a polygonDepth pickup.
    expect(() => computeRcMember(member, metric({ depthM: .15 }))).toThrow(message)
    for (const depthM of [undefined, 0, -1, NaN, Infinity]) {
      expect(() => computeRcMember(member, metric({
        method: 'polygonDepth', depthM,
      }))).toThrow(message)
    }
    for (const thicknessMm of [0, -1, NaN, Infinity]) {
      const invalid = slab({ kind, thicknessMm })
      expect(rcMemberError(invalid))
        .toBe('RC部材の寸法は0より大きい有限の数で入れてください。')
      expect(() => computeRcMember(invalid, metric({
        method: 'polygonDepth', depthM: .15,
      }))).toThrow('RC部材の寸法は0より大きい有限の数で入れてください。')
    }
  }
})

it('continues to require explicit wall thickness', () => {
  const wall: RcMember = { kind: 'wall', bars: [] }
  expect(rcMemberError(wall)).toBe('RC部材の厚さを入れてください。')
  expect(() => computeRcMember(wall, metric({
    method: 'lengthHeight', lengthM: 4, heightM: 3,
    depthM: .15, polygonM: undefined,
  }))).toThrow('RC部材の厚さを入れてください。')
})

it('round-trips omitted slab thickness and links required rebar from volume pickups', () => {
  const member = slab()
  delete member.thicknessMm
  const source = fixture('A', {
    name: '普通コンクリート（軸部）', category: 'コンクリート',
    kind: 'volume', method: 'polygonDepth', rc: member,
  })
  const required = fixture('R', {
    name: '異形鉄筋',
    link: {
      kind: 'rc', sources: [], auto: { rcKinds: [] },
      rc: { output: 'rebar', basis: 'required' },
    },
  })
  const parsed = parseCountFixtures(serializeCountFixtures([source, required]))
  expect(parsed[0].rc).toEqual(member)
  expect(parsed[0].rc).not.toHaveProperty('thicknessMm')

  const annotation: ShapeAnnotation = {
    id: 'volume', pageIndex: 2,
    vertices: [[0, 0], [4, 0], [4, 3], [0, 3]],
    measure: { mmPerPoint: 1000 },
    quantity: {
      version: 1, id: 'volume', itemId: 'A', method: 'polygonDepth',
      depthM: .15, floor: '2階', room: '居室', condition: '例',
    },
  }
  const index = QuantityIndex.build([annotation], parsed)
  const expectedSteel = computeRcMember(slab(), metric()).bars
    .reduce((sum, bar) => sum + bar.massKg, 0) * 1.04 / 1000
  expect(index.total('A')).toBeCloseTo(1.8, 12)
  expect(index.rawTotal('A')).toBeCloseTo(1.8, 12)
  expect(index.total('R')).toBeCloseTo(expectedSteel, 12)
  expect(index.total('R').toFixed(2)).toBe('0.35')
  expect(index.byPage('R').get(2)).toBeCloseTo(expectedSteel, 12)
  expect(index.linkResult('R')!.warnings).toEqual([])
})
