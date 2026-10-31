import { expect, it } from 'vitest'
import {
  fixtureIdentity,
  nextCountStyle,
  type CountFixture,
  type FixturePreset,
} from '../src/core/countFixtures'
import type { RelatedSuggestion } from '../src/core/related/suggest'
import type { RelatedModel } from '../src/app/relatedModel'
import {
  relatedCountComponentChoices,
  resolveRelatedCountComponent,
} from '../src/app/relatedCountComponents'

function fixture(id: string, name: string, order = 0): CountFixture {
  return {
    id, name, order, category: 'ボックス', code: id,
    kind: 'count', method: 'click', style: nextCountStyle([]),
  }
}

function suggestion(): RelatedSuggestion {
  return {
    key: 'r5b', kind: 'item', ruleIds: ['E-OTHER'],
    originFixtureIds: ['origin'], book: '電気設備', priority: '中',
    targets: [{
      category: 'ボックス',
      candidates: [
        { key: 'switch', field: '電気', category: 'ボックス', name: 'スイッチボックス' },
        { key: 'outlet', field: '電気', category: 'ボックス', name: 'アウトレットボックス' },
      ],
      registeredCount: 0,
    }],
    targetTexts: ['ボックス'], questions: [], notes: [], refs: [],
    registeredCount: 0, flags: {},
  }
}

function model(presets: Record<string, FixturePreset>): RelatedModel {
  return {
    index: { books: new Map(), context: [] },
    resolveTarget: () => [],
    refDocuments: {},
    countComponentPreset: key => presets[key],
  }
}

it('offers count components for rules other than E-039 and keeps master order', () => {
  const origin = fixture('origin', 'コンセント')
  const related = suggestion()
  const master = model({
    switch: fixture('preset-switch', 'スイッチボックス'),
    outlet: fixture('preset-outlet', 'アウトレットボックス'),
  })
  expect(relatedCountComponentChoices(related, origin, [origin], master)
    .map(choice => choice.name))
    .toEqual(['スイッチボックス', 'アウトレットボックス'])
})

it('accepts matching document count fixtures even without a master preset', () => {
  const origin = fixture('origin', 'コンセント')
  const box = fixture('box', 'スイッチボックス', 1)
  const related = suggestion()
  related.targets[0].name = box.name
  expect(relatedCountComponentChoices(related, origin, [origin, box], model({}))
    .map(choice => choice.name)).toEqual([box.name])
})

it('excludes non-count, linked and non-item origins', () => {
  const origin = fixture('origin', 'コンセント')
  const master = model({ switch: fixture('preset', 'スイッチボックス') })
  expect(relatedCountComponentChoices(suggestion(), {
    ...origin, kind: 'length', method: 'polyline',
  }, [], master)).toEqual([])
  expect(relatedCountComponentChoices(suggestion(), {
    ...origin, link: {} as NonNullable<CountFixture['link']>,
  }, [], master)).toEqual([])
  expect(relatedCountComponentChoices({
    ...suggestion(), kind: 'check',
  }, origin, [], master)).toEqual([])
})

it('excludes non-count, linked and name/category-mismatched document targets', () => {
  const origin = fixture('origin', 'コンセント')
  const related = suggestion()
  related.targets[0].name = 'スイッチボックス'
  const box = fixture('box', 'スイッチボックス')
  const fixtures: CountFixture[] = [
    origin,
    { ...box, id: 'length', kind: 'length', method: 'polyline' },
    { ...box, id: 'linked', link: {} as NonNullable<CountFixture['link']> },
    { ...box, id: 'wrong-category', category: '別分類' },
    { ...box, id: 'wrong-name', name: '別品目' },
  ]
  expect(relatedCountComponentChoices(related, origin, fixtures, model({})))
    .toEqual([])
})

it('deduplicates document/master choices and uses the smallest document order', () => {
  const origin = fixture('origin', 'コンセント')
  const later = fixture('later', 'スイッチボックス', 8)
  const earlier = fixture('earlier', 'スイッチボックス', 2)
  const choices = relatedCountComponentChoices(
    suggestion(), origin, [origin, later, earlier],
    model({ switch: fixture('preset', 'スイッチボックス') }),
  )
  expect(choices).toHaveLength(1)
  expect(resolveRelatedCountComponent(choices[0], [origin, later, earlier]))
    .toEqual({ fixture: earlier, newFixtures: [] })
})

it('creates a fresh trailing fixture from the preset without modifying it', () => {
  const origin = fixture('origin', 'コンセント', 4)
  const preset = fixture('preset', 'スイッチボックス')
  const before = structuredClone(preset)
  const choice = relatedCountComponentChoices(
    suggestion(), origin, [origin], model({ switch: preset }),
  )[0]
  const result = resolveRelatedCountComponent(choice, [origin])

  expect(result.fixture.id).not.toBe(origin.id)
  expect(result.fixture.id).not.toBe(preset.id)
  expect(result.fixture.order).toBe(5)
  expect(result.fixture.style).toEqual(nextCountStyle([origin]))
  expect(result.fixture.line).toBeUndefined()
  expect(fixtureIdentity(result.fixture)).toBe(fixtureIdentity(preset))
  expect(result.newFixtures).toEqual([result.fixture])
  expect(preset).toEqual(before)
})

it('reuses an available fixture with the preset identity', () => {
  const preset = fixture('preset', 'スイッチボックス')
  const existing = { ...preset, id: 'existing', order: 3 }
  const choice = {
    key: 'identity-only',
    category: '照合しない分類',
    name: '照合しない名称',
    preset,
  }
  expect(resolveRelatedCountComponent(choice, [existing]))
    .toEqual({ fixture: existing, newFixtures: [] })
})
