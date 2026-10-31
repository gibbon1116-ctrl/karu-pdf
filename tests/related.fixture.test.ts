import { describe, expect, it } from 'vitest'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import type { RelatedSuggestion } from '../src/core/related/suggest'
import type { RelatedCreate } from '../src/core/related/types'
import { createRelatedFixture } from '../src/app/relatedFixture'

const origin: CountFixture = {
  id: 'origin', name: '起点', code: 'A', category: '起点分類', order: 7,
  style: {
    shape: 'circle', fill: 'none', color: [1, 0, 0],
    size: 10, opacity: 1, showCode: true,
  },
}

function suggestion(patch: Partial<RelatedSuggestion> = {}): RelatedSuggestion {
  return {
    key: 'check:test', kind: 'check', ruleIds: ['test'], originFixtureIds: ['origin'],
    book: '建築', priority: '中', targets: [], targetTexts: ['原文'],
    questions: [], notes: [], refs: [], registeredCount: 0, flags: {},
    create: { name: '新規項目', unit: '式' },
    ...patch,
  }
}

describe('related fixture dialog draft', () => {
  it.each(['式', 'か所'] as RelatedCreate['unit'][])(
    '%s は個数の初期値にし、起点分類と次の見た目・順序を使う',
    unit => {
      const before = structuredClone(origin)
      const result = createRelatedFixture(
        suggestion({ create: { name: '確認事項の項目', unit } }), origin, [origin],
      )
      expect(result).toMatchObject({
        name: '確認事項の項目', category: '起点分類',
        code: '', unit, order: 8, style: nextCountStyle([origin]),
      })
      expect(result.kind).toBeUndefined()
      expect(result.method).toBeUndefined()
      expect(result.id).not.toBe(origin.id)
      expect(origin).toEqual(before)
    },
  )

  it.each([
    ['m', 'length', 'polyline'],
    ['㎡', 'area', 'polygon'],
  ] as const)('%s は対応する計測の初期値にする', (unit, kind, method) => {
    const result = createRelatedFixture(
      suggestion({ create: { name: '計測項目', unit } }), origin, [origin],
    )
    expect(result).toMatchObject({ name: '計測項目', kind, method })
    expect(result.unit).toBeUndefined()
  })

  it('未解決 item は提案先名称を使い、単位なしの個数にする', () => {
    const result = createRelatedFixture(suggestion({
      kind: 'item', create: undefined, flags: { unresolved: true },
      targets: [{ category: '提案分類', name: '提案先名称', candidates: [], registeredCount: 0 }],
    }), origin, [origin])
    expect(result).toMatchObject({ name: '提案先名称', category: '起点分類' })
    expect(result.kind).toBeUndefined()
    expect(result.method).toBeUndefined()
    expect(result.unit).toBeUndefined()
  })

  it('提案先名称がない item は原文を使い、初期値の作成だけでは項目を足さない', () => {
    const fixtures = [origin]
    const before = structuredClone(fixtures)
    const result = createRelatedFixture(suggestion({
      kind: 'item', create: undefined,
      targets: [{ category: '提案分類', candidates: [], registeredCount: 0 }],
      targetTexts: ['提案の名称'],
    }), origin, fixtures)
    expect(result.name).toBe('提案の名称')
    expect(fixtures).toEqual(before)
  })
})
