import { describe, expect, it } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import type {
  RelatedReviewDecision,
  RelatedReviews,
} from '../src/core/related/reviews'
import {
  buildRelatedIndex,
  contextChecks,
  suggestRelated,
  type RelatedSuggestion,
} from '../src/core/related/suggest'
import type { RelatedRule } from '../src/core/related/types'
import { loadRelated } from '../src/app/relatedModel'
import { buildRelatedReviewRows } from '../src/app/relatedReviewRows'

const first: CountFixture = {
  id: 'cable-a', name: 'ケーブル A', code: 'A', category: 'ケーブル', order: 0,
  style: {
    shape: 'circle', fill: 'none', color: [1, 0, 0],
    size: 10, opacity: 1, showCode: true,
  },
}
const second: CountFixture = {
  ...first, id: 'cable-b', name: 'ケーブル B', code: 'B', order: 1,
}
const rule = (id: string, patch: Partial<RelatedRule> = {}): RelatedRule => ({
  id, book: '電気設備', group: '試験', originText: 'ケーブル',
  targetText: '保護管', modes: ['新築'], question: '確認',
  kindText: '拾い候補', kind: 'item', priority: '中',
  origin: { any: [{ categories: ['ケーブル'] }] },
  targets: [{ category: '保護管' }], note: '', refs: [],
  ...patch,
})
const index = buildRelatedIndex([
  rule('R7-I1'),
  rule('R7-I2'),
  rule('R7-C1', { kind: 'check', targets: [], targetText: '起点の確認事項' }),
  rule('R7-N1', { kind: 'note', targets: [], targetText: '起点の注意' }),
  rule('R7-context', {
    kind: 'check',
    origin: { context: ['新築'] },
    targets: [],
    targetText: '案件の確認事項',
  }),
])

function evaluate(fixtures: readonly CountFixture[]) {
  return suggestRelated({
    index,
    fixtures,
    originIds: [first.id, second.id],
    projectMode: '新築',
    works: {},
    decisions: {},
    resolveTarget: () => [],
  })
}

function saved(
  suggestion: RelatedSuggestion,
  decision: RelatedReviewDecision['decision'],
): RelatedReviewDecision {
  return {
    decision,
    ruleIds: [...suggestion.ruleIds],
    originFixtureIds: [...suggestion.originFixtureIds],
    rulesVersion: 'r7a-test',
    decidedAt: '2026-10-14T00:00:00Z',
  }
}

describe('R7a の Excel 用の行', () => {
  it('拾い候補・確認事項・注意を起点別の行にし、案件の確認事項は一行にする', async () => {
    const fixtures = [first, second]
    const suggestions = evaluate(fixtures)
    const itemA = suggestions.find(item =>
      item.kind === 'item' && item.originFixtureIds[0] === first.id)!
    const checkA = suggestions.find(item =>
      item.kind === 'check' && item.originFixtureIds[0] === first.id)!
    const reviews: RelatedReviews = {
      version: 1,
      projectMode: '新築',
      works: {},
      decisions: {
        [itemA.key]: saved(itemA, '不要'),
        [checkA.key]: saved(checkA, '後で確認'),
      },
    }
    const contexts = contextChecks({
      index,
      projectMode: '新築',
      decisions: {},
      fixtures,
    })
    const rows = buildRelatedReviewRows(
      suggestions, contexts, reviews, fixtures, await loadRelated(),
    )

    expect(rows).toHaveLength(7)
    const items = rows.filter(row => row.kind === '拾い候補')
    expect(items).toHaveLength(2)
    expect(items.find(row => row.origins === 'A ケーブル A')).toMatchObject({
      status: '不要', target: '保護管', ruleIds: 'R7-I1、R7-I2',
    })
    expect(items.find(row => row.origins === 'B ケーブル B')).toMatchObject({
      status: '未判断', target: '保護管', decidedAt: '',
    })

    const checks = rows.filter(row => row.target === '起点の確認事項')
    expect(checks).toHaveLength(2)
    expect(checks.find(row => row.origins === 'A ケーブル A')?.status)
      .toBe('後で確認')
    expect(checks.find(row => row.origins === 'B ケーブル B')?.status)
      .toBe('未判断')

    const notes = rows.filter(row => row.kind === '注意')
    expect(notes).toHaveLength(2)
    expect(notes.map(row => row.origins).sort()).toEqual([
      'A ケーブル A', 'B ケーブル B',
    ])
    expect(notes.every(row => row.status === '注意')).toBe(true)
    expect(rows.filter(row => row.target === '案件の確認事項')).toEqual([
      expect.objectContaining({ status: '未判断', origins: '起点なし' }),
    ])
  })

  it('未判断の選択済み候補も起点別に書き出し、個別の判断を優先する', async () => {
    const registered: CountFixture = {
      ...first,
      id: 'registered-protection',
      name: '保護管',
      code: 'P',
      category: '保護管',
      order: 2,
    }
    const fixtures = [first, second, registered]
    const suggestions = evaluate(fixtures)
    const empty: RelatedReviews = { version: 1, works: {}, decisions: {} }
    const model = await loadRelated()
    const initial = buildRelatedReviewRows(
      suggestions, [], empty, fixtures, model,
    ).filter(row => row.kind === '拾い候補')
    expect(initial).toHaveLength(2)
    expect(initial.every(row => row.status === '選択済み')).toBe(true)
    expect(initial.map(row => row.origins).sort()).toEqual([
      'A ケーブル A', 'B ケーブル B',
    ])

    const itemB = suggestions.find(item =>
      item.kind === 'item' && item.originFixtureIds[0] === second.id)!
    const reviews: RelatedReviews = {
      ...empty, decisions: { [itemB.key]: saved(itemB, '必要') },
    }
    const rows = buildRelatedReviewRows(
      suggestions, [], reviews, fixtures, model,
    ).filter(row => row.kind === '拾い候補')
    expect(rows.find(row => row.origins === 'A ケーブル A')?.status)
      .toBe('選択済み')
    expect(rows.find(row => row.origins === 'B ケーブル B')?.status)
      .toBe('必要')
  })
})
