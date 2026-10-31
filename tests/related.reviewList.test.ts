import { describe, expect, it } from 'vitest'
import type { CountFixture } from '../src/core/countFixtures'
import type { RelatedReviews } from '../src/core/related/reviews'
import type { RelatedSuggestion } from '../src/core/related/suggest'
import { groupRelatedReviews, relatedReviewList } from '../src/app/relatedReviewList'

function suggestion(key = 'check:E-001@f1'): RelatedSuggestion {
  return {
    key, kind: 'check', ruleIds: ['E-001'], originFixtureIds: ['f1'],
    book: '電気設備', priority: '高', targets: [], targetTexts: ['確認事項'],
    questions: [], notes: [], refs: [], registeredCount: 0, flags: {},
  }
}
function reviews(): RelatedReviews {
  return {
    version: 1, works: {}, decisions: {
      'check:E-001@f1': {
        decision: '後で確認', ruleIds: ['E-001'],
        originFixtureIds: ['f1'], rulesVersion: 'old',
        decidedAt: '2026-10-13T00:00:00Z',
      },
    },
  }
}
const fixture: CountFixture = {
  id: 'f1', name: '照明', code: 'A', category: 'その他', order: 0,
  style: {
    shape: 'circle', fill: 'none', color: [1, 0, 0],
    size: 10, opacity: 1, showCode: true,
  },
}

describe('document related review list', () => {
  it('excludes unchosen oneOf candidates only for the same origin and group', () => {
    const chosen = {
      ...suggestion('item:chosen@f1'),
      kind: 'item' as const,
      oneOf: 'ceiling-board',
      registeredCount: 1,
      flags: { registered: true },
    }
    const alternative = {
      ...suggestion('item:alternative@f1'),
      kind: 'item' as const,
      oneOf: 'ceiling-board',
    }
    const otherOrigin = {
      ...alternative,
      key: 'item:alternative@f2',
      originFixtureIds: ['f2'],
    }
    const otherGroup = {
      ...alternative,
      key: 'item:surface@f1',
      oneOf: 'ceiling-surface',
    }
    const empty: RelatedReviews = { version: 1, works: {}, decisions: {} }
    const input = [chosen, alternative, otherOrigin, otherGroup]
    const before = structuredClone(input)

    expect(relatedReviewList(input, [], empty).map(item => item.key).sort())
      .toEqual([otherOrigin.key, otherGroup.key].sort())
    expect(relatedReviewList(input, [], empty, true).map(item => item.key).sort())
      .toEqual([chosen.key, otherOrigin.key, otherGroup.key].sort())
    expect(input).toEqual(before)
  })

  it.each(['必要', '構成要素で拾う'] as const)(
    'excludes alternatives when a candidate is decided as %s',
    decision => {
      const chosen = { ...suggestion('item:chosen@f1'), oneOf: 'ceiling-board' }
      const alternative = {
        ...suggestion('item:alternative@f1'), oneOf: 'ceiling-board',
      }
      const saved: RelatedReviews = {
        version: 1,
        works: {},
        decisions: {
          [chosen.key]: {
            decision,
            ruleIds: chosen.ruleIds,
            originFixtureIds: ['f1'],
            rulesVersion: 'test',
            decidedAt: '2026-10-14T00:00:00Z',
          },
        },
      }
      expect(relatedReviewList([chosen, alternative], [], saved))
        .toMatchObject([{ key: chosen.key, decision }])
      expect(relatedReviewList([chosen, alternative], [], saved)
        .filter(item => item.decision === undefined)).toHaveLength(0)
    },
  )

  it('retains explicit decisions on alternatives and restores pending rows after cancellation', () => {
    const chosen = { ...suggestion('item:chosen@f1'), oneOf: 'ceiling-board' }
    const later = { ...suggestion('item:later@f1'), oneOf: 'ceiling-board' }
    const alternative = {
      ...suggestion('item:alternative@f1'), oneOf: 'ceiling-board',
    }
    const saved: RelatedReviews = {
      version: 1,
      works: {},
      decisions: {
        [chosen.key]: {
          decision: '必要',
          ruleIds: chosen.ruleIds,
          originFixtureIds: ['f1'],
          rulesVersion: 'test',
          decidedAt: '2026-10-14T00:00:00Z',
        },
        [later.key]: {
          decision: '後で確認',
          ruleIds: later.ruleIds,
          originFixtureIds: ['f1'],
          rulesVersion: 'test',
          decidedAt: '2026-10-14T00:00:00Z',
        },
      },
    }
    const input = [chosen, later, alternative]
    expect(relatedReviewList(input, [], saved).map(item => item.key).sort())
      .toEqual([chosen.key, later.key].sort())

    delete saved.decisions[chosen.key]
    expect(relatedReviewList(input, [], saved)
      .filter(item => item.decision === undefined).map(item => item.key).sort())
      .toEqual([chosen.key, alternative.key].sort())
  })

  it.each(['不要', '単価包含', '他工事', '後で確認'] as const)(
    'does not collapse alternatives for the decision %s',
    decision => {
      const chosen = { ...suggestion('item:chosen@f1'), oneOf: 'ceiling-board' }
      const alternative = {
        ...suggestion('item:alternative@f1'), oneOf: 'ceiling-board',
      }
      const saved: RelatedReviews = {
        version: 1,
        works: {},
        decisions: {
          [chosen.key]: {
            decision,
            ...(decision === '他工事' ? { assignee: 'その他' as const } : {}),
            ruleIds: chosen.ruleIds,
            originFixtureIds: ['f1'],
            rulesVersion: 'test',
            decidedAt: '2026-10-14T00:00:00Z',
          },
        },
      }
      expect(relatedReviewList([chosen, alternative], [], saved)
        .filter(item => item.decision === undefined).map(item => item.key))
        .toEqual([alternative.key])
    },
  )

  it('excludes notes and undecided registered candidates, including context checks', () => {
    const registered = {
      ...suggestion('check:registered'),
      registeredCount: 1, flags: { registered: true },
    }
    const note = { ...suggestion('note:notice'), kind: 'note' as const }
    const empty: RelatedReviews = { version: 1, works: {}, decisions: {} }
    expect(relatedReviewList(
      [note, registered, suggestion('check:pending')],
      [{ ...note, originFixtureIds: [] },
        { ...registered, key: 'check:context', originFixtureIds: [] }],
      empty,
    ).map(item => item.key)).toEqual(['check:pending'])
    expect(relatedReviewList([registered], [], empty, true))
      .toHaveLength(1)
  })

  it('retains later and decided registered candidates', () => {
    const saved = reviews()
    const registered = {
      ...suggestion(), registeredCount: 1, flags: { registered: true },
    }
    expect(relatedReviewList([registered], [], saved)[0].decision).toBe('後で確認')
    saved.decisions['check:E-001@f1'].decision = '不要'
    expect(relatedReviewList([registered], [], saved)[0].decision).toBe('不要')
  })
  it('deduplicates repeated suggestions within the same origin', () => {
    const list = relatedReviewList(
      [suggestion(), suggestion()],
      [],
      reviews(),
    )
    expect(list).toHaveLength(1)
    expect(list[0].originFixtureIds).toEqual(['f1'])
    expect(list.filter(item => item.decision === '後で確認')).toHaveLength(1)
    const groups = groupRelatedReviews(list, [fixture])
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('f1')
  })

  it('keeps each origin as a separate row and keeps context checks separate', () => {
    const second = {
      ...suggestion('check:E-001@f2'), originFixtureIds: ['f2'],
    }
    const context = {
      ...suggestion('check:E-001'), originFixtureIds: [],
    }
    const list = relatedReviewList(
      [suggestion(), second],
      [context],
      reviews(),
    )
    expect(list).toHaveLength(3)
    expect(list.find(item => item.key === 'check:E-001@f1')?.decision)
      .toBe('後で確認')
    expect(list.find(item => item.key === 'check:E-001@f2')?.decision)
      .toBeUndefined()
    expect(list.find(item => item.key === 'check:E-001')?.decision)
      .toBeUndefined()
    expect(list.filter(item => item.decision === undefined)).toHaveLength(2)

    const groups = groupRelatedReviews(list, [fixture])
    expect(groups).toHaveLength(3)
    expect(groups.find(group => group.id === 'f1')?.suggestions)
      .toHaveLength(1)
    expect(groups.find(group => group.id === 'f2')).toMatchObject({
      missing: true, name: '起点なし（f2）',
    })
    expect(groups.find(group => group.id === null)?.suggestions[0].key)
      .toBe('check:E-001')
  })

  it('keeps a saved scoped decision after its origin is deleted', () => {
    const saved = reviews()
    saved.decisions['check:E-001@f2'] = {
      ...saved.decisions['check:E-001@f1'],
      decision: '不要',
      originFixtureIds: ['f2'],
    }
    const list = relatedReviewList([suggestion()], [], saved)
    expect(list).toHaveLength(2)
    expect(list.find(item => item.key === 'check:E-001@f2'))
      .toMatchObject({ decision: '不要', originFixtureIds: ['f2'] })
    const groups = groupRelatedReviews(list, [fixture])
    expect(groups.find(group => group.id === 'f1')?.suggestions[0].decision)
      .toBe('後で確認')
    expect(groups.find(group => group.id === 'f2')?.missing).toBe(true)
  })

  it('retains saved decisions after deletion and restores origin display when the fixture returns', () => {
    const saved = reviews()
    const before = structuredClone(saved)
    const list = relatedReviewList([], [], saved)
    expect(list).toHaveLength(1)
    expect(list[0].decision).toBe('後で確認')
    expect(groupRelatedReviews(list, []).every(group => group.missing)).toBe(true)
    expect(groupRelatedReviews(list, [fixture]).find(group => group.id === 'f1')?.name)
      .toBe('照明')
    expect(saved).toEqual(before)
  })

  it('excludes hints and groups context checks separately', () => {
    const list = relatedReviewList(
      [{ ...suggestion('hint:work'), kind: 'hint', ruleIds: [] }],
      [{ ...suggestion('check:context'), originFixtureIds: [] }],
      { version: 1, works: {}, decisions: {} },
    )
    expect(list).toHaveLength(1)
    expect(list[0].decision).toBeUndefined()
    expect(groupRelatedReviews(list, [fixture])[0]).toMatchObject({
      id: null, name: '案件の確認事項', missing: false,
    })
  })
})
