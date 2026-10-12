import { describe, expect, it } from 'vitest'
import {
  countHex,
  nextCountStyle,
  quantityLine,
  type CountFixture,
  type FixturePreset,
} from '../src/core/countFixtures'
import { appendFixtures } from '../src/app/fixtureAppend'

function fixture(overrides: Partial<CountFixture> = {}): CountFixture {
  return {
    id: 'existing',
    category: '盤類',
    code: 'L-1',
    name: '分電盤',
    order: 7,
    style: nextCountStyle([]),
    ...overrides,
  }
}

describe('appendFixtures', () => {
  it('excludes duplicates across existing fixtures and the batch, but keeps different positions', () => {
    const first: FixturePreset = {
      category: '盤類',
      code: 'L-1',
      name: '分電盤',
      unit: '面',
      breakdown: {
        book: '電気設備',
        section: '庁舎',
        subject: '電灯設備',
        middle: '電灯分岐',
        item: '分電盤',
      },
      summary: [{ label: '盤名称', value: 'L-1' }],
    }
    const existing = fixture(first)
    const different: FixturePreset = {
      ...first,
      breakdown: { ...first.breakdown!, middle: '電灯幹線' },
    }
    const before = structuredClone(existing)
    const next = appendFixtures([existing], [first, different, different])

    expect(next).toHaveLength(2)
    expect(next[0]).toBe(existing)
    expect(existing).toEqual(before)
    expect(next[1].id).not.toBe(existing.id)
    expect(next[1].order).toBe(8)
    expect(next[1].breakdown?.middle).toBe('電灯幹線')
  })

  it('retains conversion, unit, summaries, remarks and attributes without sharing their mutable fields', () => {
    const preset: FixturePreset = {
      category: '塗装工事',
      code: 'E25塗装',
      spec: 'E25',
      name: '配管塗装',
      kind: 'length',
      method: 'polyline',
      unit: '本',
      convert: { factor: Math.PI * 0.0254, unit: '㎡', basis: '外径25.4mm×π' },
      breakdown: {
        book: '電気設備',
        section: '庁舎',
        subject: '電灯設備',
        middle: '電灯幹線',
        item: '塗装工事',
      },
      summary: [{ label: '塗料', value: 'SOP' }],
      remark: '立上りのみ',
      attributes: { outerDiameterMm: 25.4 },
    }

    const [added] = appendFixtures([], [preset])

    expect(added.convert).toEqual(preset.convert)
    expect(added.convert).not.toBe(preset.convert)
    expect(added.unit).toBe('本')
    expect(added.breakdown).toEqual(preset.breakdown)
    expect(added.breakdown).not.toBe(preset.breakdown)
    expect(added.summary).toEqual(preset.summary)
    expect(added.summary?.[0]).not.toBe(preset.summary?.[0])
    expect(added.remark).toBe('立上りのみ')
    expect(added.attributes).toEqual(preset.attributes)
    expect(added.attributes).not.toBe(preset.attributes)
  })

  it('keeps imported appearance and candidate conditions, replacing colliding line appearance', () => {
    const imported = fixture({
      id: 'source',
      category: '電線管',
      code: 'E25',
      name: 'ねじなし電線管',
      kind: 'length',
      method: 'polyline',
      line: { width: 1, dash: 'solid' },
      conditions: ['隠ぺい', '露出'],
      sample: {
        png: 'sample',
        width: 20,
        height: 20,
        pageIndex: 0,
        rect: [1, 2, 21, 22],
      },
    })
    const before = structuredClone(imported)
    const [added] = appendFixtures([], [imported])

    expect(added.id).not.toBe(imported.id)
    expect(added.style).toEqual(imported.style)
    expect(added.style).not.toBe(imported.style)
    expect(added.line).toEqual(imported.line)
    expect(added.conditions).toEqual(['隠ぺい', '露出'])
    expect(added.sample).toEqual({ png: 'sample', width: 20, height: 20, pageIndex: 0 })
    expect(imported).toEqual(before)

    const collision = fixture({
      ...imported,
      id: 'collision',
      code: 'E31',
      order: 0,
    })
    const next = appendFixtures([collision], [imported])
    const appearance = (value: CountFixture) =>
      `${countHex(value.style.color)}:${quantityLine(value).width}:${quantityLine(value).dash}`
    expect(next).toHaveLength(2)
    expect(appearance(next[1])).not.toBe(appearance(collision))
    expect(next[1].conditions).toEqual(['隠ぺい', '露出'])
    expect(collision.style).toEqual(imported.style)
  })

  const position = (item: string): NonNullable<CountFixture['breakdown']> => ({
    book: '電気設備', section: '庁舎', subject: '電灯設備', middle: '電灯分岐', item,
  })
  const rankedFixture = (id: string, order: number, item?: string): CountFixture => fixture({
    id, code: id, name: id, order, breakdown: item ? position(item) : undefined,
  })
  const preset = (name: string, item?: string): FixturePreset => ({
    category: '電気', code: name, name, breakdown: item ? position(item) : undefined,
  })
  const ranks = new Map([['分電盤', 0], ['配線器具', 1], ['設備プレート', 2], ['その他細目', 3]])
  const options = {
    rank: (fixture: CountFixture) => fixture.breakdown ? ranks.get(fixture.breakdown.item) : undefined,
  }

  it('inserts after the last fixture at the same position and renumbers without mutating existing fixtures', () => {
    const existing = [
      rankedFixture('plate', 20, '設備プレート'),
      rankedFixture('switch-late', 3, '配線器具'),
      rankedFixture('switch-early', 1, '配線器具'),
      rankedFixture('missing', 30),
    ]
    const original = structuredClone(existing)
    const next = appendFixtures(existing, [
      preset('switch-added-1', '配線器具'),
      preset('switch-added-2', '配線器具'),
    ], options)
    expect(next.map(fixture => fixture.name)).toEqual([
      'switch-early', 'switch-late', 'switch-added-1', 'switch-added-2', 'plate', 'missing',
    ])
    expect(next.map(fixture => fixture.order)).toEqual([0, 1, 2, 3, 4, 5])
    for (const fixture of existing) {
      expect({ ...next.find(value => value.id === fixture.id)!, order: fixture.order }).toEqual(fixture)
    }
    expect(existing).toEqual(original)
  })

  it('inserts before the first higher-ranked group in its current order instead of sorting existing groups', () => {
    const existing = [
      rankedFixture('plate', 0, '設備プレート'),
      rankedFixture('board', 1, '分電盤'),
      rankedFixture('missing', 2),
    ]
    const next = appendFixtures(existing, [preset('switch-added', '配線器具')], options)
    expect(next.map(fixture => fixture.name)).toEqual(['switch-added', 'plate', 'board', 'missing'])
    expect(next.map(fixture => fixture.order)).toEqual([0, 1, 2, 3])
  })

  it('inserts after all located fixtures when there is no higher-ranked group', () => {
    const existing = [
      rankedFixture('switch', 4, '配線器具'),
      rankedFixture('board', 8, '分電盤'),
      rankedFixture('missing', 12),
    ]
    const next = appendFixtures(existing, [preset('last-located', 'その他細目')], options)
    expect(next.map(fixture => fixture.name)).toEqual(['switch', 'board', 'last-located', 'missing'])
    expect(next.map(fixture => fixture.order)).toEqual([0, 1, 2, 3])
    expect(appendFixtures([rankedFixture('missing', 4)], [preset('board-added', '分電盤')], options)
      .map(fixture => fixture.name)).toEqual(['board-added', 'missing'])
  })

  it('appends undefined-rank and unlocated additions, and retains legacy order slots without rank', () => {
    const existing = [rankedFixture('board', 7, '分電盤'), rankedFixture('missing', 10)]
    const additions = [preset('unknown', '独自細目'), preset('unlocated')]
    const ranked = appendFixtures(existing, additions, options)
    expect(ranked.map(fixture => fixture.name)).toEqual(['board', 'missing', 'unknown', 'unlocated'])
    expect(ranked.map(fixture => fixture.order)).toEqual([0, 1, 2, 3])

    const legacy = appendFixtures(existing, [preset('switch', '配線器具')])
    expect(legacy[0]).toBe(existing[0])
    expect(legacy[1]).toBe(existing[1])
    expect(legacy.map(fixture => fixture.order)).toEqual([7, 10, 11])
  })

  it('does not renumber or reorder when the entire ranked batch is already present', () => {
    const existing = [
      rankedFixture('plate', 20, '設備プレート'),
      rankedFixture('board', 7, '分電盤'),
    ]
    const next = appendFixtures(existing, existing, options)
    expect(next).toEqual(existing)
    expect(next[0]).toBe(existing[0])
    expect(next[1]).toBe(existing[1])
  })
})
