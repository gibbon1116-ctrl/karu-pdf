import { describe, expect, it } from 'vitest'
import {
  BREAKDOWN_BOOKS,
  COUNT_UNITS,
  QUANTITY_UNITS,
  breakdownKey,
  fixtureBreakdownError,
  fixtureIdentity,
  parseCountFixtures,
  quantityUnit,
  serializeCountFixtures,
  summaryText,
  type BreakdownPosition,
  type CountFixture,
  type FixturePreset,
} from '../src/core/countFixtures'
import { fixtureFromPreset } from '../src/core/quantityMaster'
import { resolveRouteSet, type RouteSet } from '../src/app/routeSets'

const newKeys = ['unit', 'breakdown', 'summary', 'remark', 'attributes'] as const
const position: BreakdownPosition = {
  book: '電気設備',
  section: '庁舎',
  subject: '電灯設備',
  middle: '照明器具',
  item: 'ダウンライト',
}
const summary = [
  { label: '呼び径', value: 'E25' },
  { label: '施工', value: '露出' },
]
const attributes = {
  massKg: 12,
  widthMm: 300,
  depthMm: 200,
  heightMm: 150,
  outerDiameterMm: 25,
  unitMassKg: 2.5,
  wasteType: '金属くず',
}

function fixture(overrides: Partial<CountFixture> = {}): CountFixture {
  return {
    id: 'fixture-1', name: 'ダウンライト', code: 'DL', category: '照明器具', order: 0,
    style: {
      shape: 'circle', fill: 'none', color: [1, 0, 0],
      size: 10, opacity: 0.8, showCode: true,
    },
    ...overrides,
  }
}

function completeFixture(): CountFixture {
  return fixture({
    unit: '台', breakdown: { ...position },
    summary: summary.map(field => ({ ...field })),
    remark: '既設撤去', attributes: { ...attributes },
  })
}

function readFixture(patch: Record<string, unknown>): CountFixture[] {
  return parseCountFixtures(JSON.stringify({
    version: 1, fixtures: [{ ...completeFixture(), ...patch }],
  }))
}

describe('fixture breakdown persistence', () => {
  it('round-trips position, summary, unit, remark and attributes', () => {
    const original = completeFixture()
    const result = parseCountFixtures(serializeCountFixtures([original]))
    expect(result).toEqual([original])
    expect(result[0].breakdown).not.toBe(original.breakdown)
    expect(result[0].summary).not.toBe(original.summary)
    expect(result[0].summary![0]).not.toBe(original.summary![0])
    expect(result[0].attributes).not.toBe(original.attributes)
  })

  it('omits every new key when no new field is set', () => {
    const original = fixture()
    const raw = serializeCountFixtures([original])
    const saved = JSON.parse(raw).fixtures[0]
    const parsed = parseCountFixtures(raw)[0]
    for (const key of newKeys) {
      expect(Object.hasOwn(saved, key)).toBe(false)
      expect(Object.hasOwn(parsed, key)).toBe(false)
    }
    expect(parsed).toEqual(original)
  })

  it('omits empty attributes on save and read', () => {
    expect(fixtureBreakdownError({ attributes: {} })).toBeUndefined()
    const raw = serializeCountFixtures([fixture({ attributes: {} })])
    expect(Object.hasOwn(JSON.parse(raw).fixtures[0], 'attributes')).toBe(false)
    expect(Object.hasOwn(readFixture({ attributes: {} })[0], 'attributes')).toBe(false)
  })

  const invalidFields: Array<[typeof newKeys[number], unknown]> = [
    ['unit', 'kg'],
    ['breakdown', { ...position, subject: 'あ'.repeat(31) }],
    ['breakdown', null],
    ['breakdown', { ...position, middle: '' }],
    ['summary', Array.from({ length: 9 }, (_, i) => ({ label: `区分${i}`, value: '値' }))],
    ['summary', []],
    ['summary', [{ label: '同じ', value: 'A' }, { label: '同じ', value: 'B' }]],
    ['remark', 'あ'.repeat(41)],
    ['attributes', { massKg: -1 }],
    ['attributes', { massKg: 10, unknown: 1 }],
    ['attributes', null],
  ]
  it.each(invalidFields)('discards only invalid %s on read: %j', (key, value) => {
    const result = readFixture({ [key]: value })
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('fixture-1')
    expect(Object.hasOwn(result[0], key)).toBe(false)
    const original = completeFixture()
    for (const other of newKeys) {
      if (other !== key) expect(result[0][other]).toEqual(original[other])
    }
  })

  it.each(['length', 'area', 'volume'] as const)('discards count units on %s fixtures', kind => {
    const method = kind === 'length' ? 'polyline' : kind === 'area' ? 'polygon' : 'polygonDepth'
    const result = readFixture({ kind, method, unit: '台' })
    expect(result).toHaveLength(1)
    expect(result[0].kind).toBe(kind)
    expect(Object.hasOwn(result[0], 'unit')).toBe(false)
    expect(result[0].breakdown).toEqual(position)
    expect(result[0].attributes).toEqual(attributes)
  })

  it('retains the existing rule that invalid old fields discard the fixture', () => {
    expect(readFixture({ name: '' })).toEqual([])
    expect(readFixture({ defaults: { heightM: 1001 } })).toEqual([])
  })

  const invalidSaves: Array<[Record<string, unknown>, string]> = [
    [{ unit: 'kg' }, '単位は個数の項目だけに'],
    [{ kind: 'length', method: 'polyline', unit: '台' }, '単位は個数の項目だけに'],
    [{ breakdown: { ...position, book: 'その他' } }, '内訳書の位置は'],
    [{ breakdown: { ...position, section: ' 庁舎' } }, '内訳書の位置は'],
    [{ breakdown: { ...position, subject: 'あ'.repeat(31) } }, '内訳書の位置は'],
    [{ summary: [{ label: '形式', value: 'A' }, { label: '形式', value: 'B' }] }, '摘要は8区分まで'],
    [{ summary: [{ label: '形式', value: 'A\nB' }] }, '摘要は8区分まで'],
    [{ summary: [{ label: '形式', value: 'あ'.repeat(60) }, { label: '施工', value: 'い'.repeat(60) }] }, '摘要は8区分まで'],
    [{ remark: '備考\tあり' }, '備考は40字まで'],
    [{ attributes: { massKg: -1 } }, '連動に使う値'],
    [{ attributes: { massKg: Infinity } }, '連動に使う値'],
    [{ attributes: { massKg: NaN } }, '連動に使う値'],
    [{ attributes: { massKg: 1, unknown: 1 } }, '連動に使う値'],
    [{ attributes: { outerDiameterMm: 10001 } }, '連動に使う値'],
  ]
  it('treats an empty summary list as no summary and omits it on save', () => {
    const value = { ...fixture(), summary: [] } as CountFixture
    expect(fixtureBreakdownError(value)).toBeUndefined()
    expect(JSON.parse(serializeCountFixtures([value])).fixtures[0]).not.toHaveProperty('summary')
  })
  it.each(invalidSaves)('rejects invalid new fields on save: %j', (patch, message) => {
    const value = { ...fixture(), ...patch } as CountFixture
    expect(fixtureBreakdownError(value)).toContain(message)
    expect(() => serializeCountFixtures([value])).toThrow(message)
  })
})

describe('fixture breakdown validation', () => {
  it('accepts each count unit and breakdown book', () => {
    for (const unit of COUNT_UNITS) {
      expect(fixtureBreakdownError({ unit })).toBeUndefined()
      expect(fixtureBreakdownError({ kind: 'count', unit })).toBeUndefined()
    }
    for (const book of BREAKDOWN_BOOKS) {
      expect(fixtureBreakdownError({ breakdown: { ...position, book } })).toBeUndefined()
    }
  })

  it('accepts position limits and an omitted middle', () => {
    expect(fixtureBreakdownError({
      breakdown: {
        book: '建築', section: 'あ'.repeat(20), subject: 'い'.repeat(30),
        middle: 'う'.repeat(30), item: 'え'.repeat(40),
      },
    })).toBeUndefined()
    expect(fixtureBreakdownError({
      breakdown: { book: '建築', section: '庁舎', subject: '内装', item: '床仕上げ' },
    })).toBeUndefined()
  })

  it('accepts eight summary fields and a 120-character joined value', () => {
    expect(fixtureBreakdownError({
      summary: Array.from({ length: 8 }, (_, i) => ({ label: `区分${i + 1}`, value: '値' })),
    })).toBeUndefined()
    expect(fixtureBreakdownError({
      summary: [{ label: '形式', value: 'あ'.repeat(60) }, { label: '施工', value: 'い'.repeat(59) }],
    })).toBeUndefined()
  })

  it('checks every attribute limit and rejects nonpositive values', () => {
    const limits = {
      massKg: 100000, widthMm: 100000, depthMm: 100000, heightMm: 100000,
      outerDiameterMm: 10000, unitMassKg: 100000,
    }
    for (const [key, limit] of Object.entries(limits)) {
      expect(fixtureBreakdownError({ attributes: { [key]: limit } })).toBeUndefined()
      for (const invalid of [0, -1, limit + 1, Infinity, NaN, '1']) {
        const value = fixture({ attributes: { [key]: invalid } as CountFixture['attributes'] })
        expect(fixtureBreakdownError(value)).toContain('連動に使う値')
      }
    }
    expect(fixtureBreakdownError({ attributes: { wasteType: 'あ'.repeat(20) } })).toBeUndefined()
    expect(fixtureBreakdownError({ attributes: { wasteType: '' } })).toContain('連動に使う値')
    expect(fixtureBreakdownError({ attributes: { wasteType: 'あ'.repeat(21) } })).toContain('連動に使う値')
    expect(fixtureBreakdownError({ attributes: { wasteType: '金属\nくず' } })).toContain('連動に使う値')
  })

  it('does not impose a trim rule on remarks or waste types', () => {
    expect(fixtureBreakdownError({ remark: ' 備考 ', attributes: { wasteType: ' 金属くず ' } })).toBeUndefined()
  })
})

describe('fixture breakdown display and identity', () => {
  it('uses custom units only for counts', () => {
    expect(quantityUnit({})).toBe('個')
    expect(quantityUnit({ kind: 'count' })).toBe('個')
    expect(quantityUnit({ unit: '台' })).toBe('台')
    expect(quantityUnit({ kind: 'length' })).toBe('m')
    expect(quantityUnit({ kind: 'area' })).toBe(QUANTITY_UNITS.area)
    expect(quantityUnit({ kind: 'volume' })).toBe(QUANTITY_UNITS.volume)
    expect(quantityUnit({ kind: 'length', unit: '台' })).toBe('m')
  })

  it('joins only summary values', () => {
    expect(summaryText({ summary })).toBe('E25、露出')
    expect(summaryText({})).toBe('')
    expect(summaryText({ summary: [] })).toBe('')
  })

  it('includes the complete position in identity and preserves legacy matching', () => {
    const first = fixture({ breakdown: { ...position } })
    const second = fixture({ breakdown: { ...position, middle: '屋外照明' } })
    expect(fixtureIdentity(first)).not.toBe(fixtureIdentity(second))
    expect(fixtureIdentity(first)).not.toBe(fixtureIdentity(fixture()))
    expect(fixtureIdentity(fixture())).toBe(fixtureIdentity(fixture({ id: 'other', spec: '' })))
    expect(breakdownKey(first)).toBe(JSON.stringify([
      position.book, position.section, position.subject, position.middle, position.item,
    ]))
    expect(breakdownKey({})).toBe('')
    const withoutMiddle: BreakdownPosition = {
      book: '電気設備', section: '庁舎', subject: '電灯設備', item: 'ダウンライト',
    }
    expect(breakdownKey({ breakdown: withoutMiddle })).toBe(JSON.stringify([
      '電気設備', '庁舎', '電灯設備', '', 'ダウンライト',
    ]))
  })
})

describe('fixture summary identity', () => {
  it('treats different summary values as different identities with the same code, name and position', () => {
    const first = fixture({
      breakdown: { ...position },
      summary: [{ label: '盤名称', value: 'L-1' }],
    })
    const second = fixture({
      breakdown: { ...position },
      summary: [{ label: '盤名称', value: 'L-2' }],
    })
    expect(fixtureIdentity(first)).not.toBe(fixtureIdentity(second))
    const copy: CountFixture = { ...first, id: 'another-id', summary: first.summary!.map(field => ({ ...field })) }
    expect(fixtureIdentity(first)).toBe(fixtureIdentity(copy))
  })

  it('preserves B01 equality decisions for fixtures without summaries', () => {
    const values = [
      fixture(),
      fixture({ id: 'other', spec: '' }),
      fixture({ summary: [] }),
      fixture({ code: 'BL' }),
      fixture({ name: 'ベースライト' }),
      fixture({ spec: 'A' }),
      fixture({ breakdown: { ...position } }),
      fixture({ breakdown: { ...position }, summary: [] }),
      fixture({ breakdown: { ...position, middle: '屋外照明' } }),
    ]
    const b01Identity = (value: CountFixture) => JSON.stringify([
      value.code, value.spec ?? '', value.name, breakdownKey(value),
    ])
    for (const first of values) {
      for (const second of values) {
        expect(fixtureIdentity(first) === fixtureIdentity(second))
          .toBe(b01Identity(first) === b01Identity(second))
      }
    }
    expect(fixtureIdentity(fixture())).toBe(JSON.stringify(['DL', '', 'ダウンライト', '', '']))
  })
})

describe('fixtureFromPreset', () => {
  it('inherits and independently clones each new field', () => {
    const preset: FixturePreset = {
      category: '照明器具', code: 'DL', name: 'ダウンライト', conditions: [],
      unit: '台', breakdown: { ...position }, summary: summary.map(field => ({ ...field })),
      remark: '既設撤去', attributes: { ...attributes },
    }
    const result = fixtureFromPreset(preset, [])
    for (const key of newKeys) expect(result[key]).toEqual(preset[key])
    expect(result.breakdown).not.toBe(preset.breakdown)
    expect(result.summary).not.toBe(preset.summary)
    expect(result.summary![0]).not.toBe(preset.summary![0])
    expect(result.attributes).not.toBe(preset.attributes)
    result.breakdown!.subject = '動力設備'
    result.summary![0].value = 'E31'
    result.attributes!.massKg = 20
    expect(preset.breakdown!.subject).toBe('電灯設備')
    expect(preset.summary![0].value).toBe('E25')
    expect(preset.attributes!.massKg).toBe(12)
  })

  it('does not create absent new keys', () => {
    const result = fixtureFromPreset({ category: 'その他', code: 'X', name: '項目', conditions: [] }, [])
    for (const key of newKeys) expect(Object.hasOwn(result, key)).toBe(false)
  })
})

describe('route set summary identity', () => {
  const linePosition: BreakdownPosition = {
    book: '電気設備', section: '庁舎', subject: '電灯設備',
    middle: '電灯幹線', item: '電線管',
  }
  const makeSet = (): RouteSet => ({
    id: 'summary-set',
    name: '摘要付き電線管',
    items: [{
      code: 'E25', name: 'ねじなし電線管', category: '電線管', count: 1,
      breakdown: { ...linePosition },
      summary: [{ label: '施工', value: '露出' }],
    }],
  })
  const line = (id: string, value?: string): CountFixture => fixture({
    id, code: 'E25', name: 'ねじなし電線管', category: '電線管',
    kind: 'length', method: 'polyline', breakdown: { ...linePosition },
    ...(value !== undefined ? { summary: [{ label: '施工', value }] } : {}),
  })

  it('resolves the matching summary instead of another summary or an absent summary', () => {
    const result = resolveRouteSet(makeSet(), [
      line('concealed', '隠ぺい'), line('legacy'), line('exposed', '露出'),
    ])
    expect(result.items[0].itemId).toBe('exposed')
    expect(result.newFixtures).toEqual([])
  })

  it('creates and independently clones a summary when no identity matches', () => {
    const set = makeSet()
    const result = resolveRouteSet(set, [line('concealed', '隠ぺい')])
    expect(result.newFixtures).toHaveLength(1)
    const created = result.newFixtures[0]
    expect(created.summary).toEqual(set.items[0].summary)
    expect(created.summary).not.toBe(set.items[0].summary)
    expect(created.summary![0]).not.toBe(set.items[0].summary![0])
    created.summary![0].value = '変更'
    expect(set.items[0].summary![0].value).toBe('露出')
  })

  it('allows otherwise identical members with different summary values', () => {
    const set = makeSet()
    set.items.push({
      ...set.items[0],
      summary: [{ label: '施工', value: '隠ぺい' }],
    })
    const result = resolveRouteSet(set, [line('exposed', '露出'), line('concealed', '隠ぺい')])
    expect(result.items.map(item => item.itemId)).toEqual(['exposed', 'concealed'])
  })

  it('matches a summary-free set only to a summary-free fixture', () => {
    const set = makeSet()
    delete set.items[0].summary
    const result = resolveRouteSet(set, [line('exposed', '露出'), line('legacy')])
    expect(result.items[0].itemId).toBe('legacy')
    expect(result.newFixtures).toEqual([])
    const created = resolveRouteSet(set, [line('exposed', '露出')]).newFixtures[0]
    expect(Object.hasOwn(created, 'summary')).toBe(false)
  })

  it('rejects invalid summaries and duplicate summary identities', () => {
    const invalid = makeSet()
    invalid.items[0].summary = [{ label: '施工', value: 'あ'.repeat(61) }]
    expect(() => resolveRouteSet(invalid, [])).toThrow('構成の内容が正しくありません。')

    const duplicate = makeSet()
    duplicate.items.push({
      ...duplicate.items[0],
      summary: duplicate.items[0].summary!.map(field => ({ ...field })),
    })
    expect(() => resolveRouteSet(duplicate, [])).toThrow('構成の内容が正しくありません。')
  })
})

describe('resolveRouteSet', () => {
  const firstPosition: BreakdownPosition = {
    book: '電気設備', section: '庁舎', subject: '電灯設備', middle: '屋内', item: '電線管',
  }
  const secondPosition: BreakdownPosition = { ...firstPosition, middle: '屋外' }
  const lineFixture = (id: string, breakdown?: BreakdownPosition): CountFixture => fixture({
    id, code: 'E25', name: 'ねじなし電線管', category: '電線管',
    kind: 'length', method: 'polyline', ...(breakdown ? { breakdown } : {}),
  })
  const routeSet = (breakdown?: BreakdownPosition): RouteSet => ({
    id: 'set-1', name: '電線管',
    items: [{
      code: 'E25', name: 'ねじなし電線管', category: '電線管', count: 1,
      ...(breakdown ? { breakdown } : {}),
    }],
  })

  it('chooses the matching position among otherwise identical fixtures', () => {
    const first = lineFixture('first', firstPosition), second = lineFixture('second', secondPosition)
    expect(resolveRouteSet(routeSet(secondPosition), [first, second]).items[0].itemId).toBe('second')
    expect(resolveRouteSet(routeSet(firstPosition), [second, first]).items[0].itemId).toBe('first')
  })

  it('matches a legacy set only to a fixture without a position', () => {
    const legacy = lineFixture('legacy')
    const result = resolveRouteSet(routeSet(), [
      lineFixture('first', firstPosition), lineFixture('second', secondPosition), legacy,
    ])
    expect(result.items[0].itemId).toBe('legacy')
    expect(result.newFixtures).toEqual([])
  })

  it('creates a separate fixture and clones the requested position', () => {
    const set = routeSet(secondPosition)
    const result = resolveRouteSet(set, [lineFixture('first', firstPosition)])
    expect(result.newFixtures).toHaveLength(1)
    expect(result.newFixtures[0].breakdown).toEqual(secondPosition)
    expect(result.newFixtures[0].breakdown).not.toBe(set.items[0].breakdown)
    expect(result.items[0].itemId).toBe(result.newFixtures[0].id)
  })

  it('creates a position-free fixture for a legacy set when only positioned fixtures exist', () => {
    const result = resolveRouteSet(routeSet(), [lineFixture('first', firstPosition)])
    expect(result.newFixtures).toHaveLength(1)
    expect(Object.hasOwn(result.newFixtures[0], 'breakdown')).toBe(false)
  })

  it('allows two otherwise identical set members at different positions', () => {
    const set = routeSet(firstPosition)
    set.items.push({ ...set.items[0], breakdown: secondPosition })
    const result = resolveRouteSet(set, [
      lineFixture('first', firstPosition), lineFixture('second', secondPosition),
    ])
    expect(result.items.map(item => item.itemId)).toEqual(['first', 'second'])
  })

  it('rejects invalid positions and duplicate identities', () => {
    expect(() => resolveRouteSet(routeSet({ ...firstPosition, subject: 'あ'.repeat(31) }), []))
      .toThrow('構成の内容が正しくありません。')
    const set = routeSet(firstPosition)
    set.items.push({ ...set.items[0], breakdown: { ...firstPosition } })
    expect(() => resolveRouteSet(set, [])).toThrow('構成の内容が正しくありません。')
  })
})
