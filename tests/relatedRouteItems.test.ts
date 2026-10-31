import { describe, expect, it } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import type { RelatedSuggestion } from '../src/core/related/suggest'
import { relatedCountItemsForSuggestions } from '../src/app/relatedRouteItems'

function fixture(
  id: string,
  name: string,
  category: string,
  extra: Partial<CountFixture> = {},
): CountFixture {
  return {
    id, name, category, code: id, order: 0,
    style: {
      shape: 'circle', fill: 'none', color: [1, 0, 0],
      size: 10, opacity: 1, showCode: true,
    },
    ...extra,
  }
}

function suggestion(
  kind: RelatedSuggestion['kind'],
  extra: Partial<RelatedSuggestion> = {},
): RelatedSuggestion {
  return {
    key: kind, kind, ruleIds: [], originFixtureIds: ['origin'],
    book: '電気設備', priority: '中', targets: [], targetTexts: [],
    questions: [], notes: [], refs: [], registeredCount: 0, flags: {},
    ...extra,
  }
}

describe('relatedCountItemsForSuggestions', () => {
  it('item は分類と名称、check は create.name で照合し、提案順に重複を除く', () => {
    const fixtures = [
      fixture('other', 'スイッチ', '配線器具'),
      fixture('support', '支持材', '支持材'),
      fixture('fire', '防火区画貫通処理', '防火区画貫通処理'),
      fixture('length', '支持材', '支持材', {
        kind: 'length', method: 'polyline',
      }),
      fixture('linked', '支持材', '支持材', {
        link: {} as NonNullable<CountFixture['link']>,
      }),
    ]
    const items = relatedCountItemsForSuggestions(fixtures, [
      suggestion('check', {
        create: { name: '防火区画貫通処理', unit: 'か所' },
      }),
      suggestion('item', {
        targets: [{
          category: '支持材', name: '支持材',
          candidates: [], registeredCount: 0,
        }],
      }),
      suggestion('check', {
        create: { name: '防火区画貫通処理', unit: 'か所' },
      }),
    ])
    expect(items.map(item => item.id)).toEqual(['fire', 'support'])
  })

  it('名称のない item は分類内の個数項目を文書順で全部返す', () => {
    const items = relatedCountItemsForSuggestions([
      fixture('b', '支持材B', '支持材'),
      fixture('a', '支持材A', '支持材'),
    ], [
      suggestion('item', {
        targets: [{
          category: '支持材', candidates: [], registeredCount: 0,
        }],
      }),
    ])
    expect(items.map(item => item.id)).toEqual(['b', 'a'])
  })

  it('判断済み・選択済みの項目も候補に含める', () => {
    const items = relatedCountItemsForSuggestions([
      fixture('fire', '防火区画貫通処理', '防火区画貫通処理'),
    ], [
      suggestion('check', {
        create: { name: '防火区画貫通処理', unit: 'か所' },
        decision: '必要',
        flags: { registered: true },
        registeredCount: 1,
      }),
    ])
    expect(items.map(item => item.id)).toEqual(['fire'])
  })

  it('hint・note・create のない check は対象外', () => {
    expect(relatedCountItemsForSuggestions([
      fixture('fire', '防火区画貫通処理', '防火区画貫通処理'),
    ], [
      suggestion('hint'),
      suggestion('note'),
      suggestion('check'),
    ])).toEqual([])
  })
})
