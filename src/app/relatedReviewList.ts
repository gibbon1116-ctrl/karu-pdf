import type { CountFixture } from '../core/countFixtures'
import type { RelatedReviews } from '../core/related/reviews'
import {
  collapsedRelatedOneOfKeys,
  withRelatedDecisions,
  type RelatedSuggestion,
} from '../core/related/suggest'

/** 現在の候補に、条件変更・起点削除で候補から外れた保存済み判断を加える。 */
export function relatedReviewList(
  suggestions: readonly RelatedSuggestion[],
  contexts: readonly RelatedSuggestion[],
  reviews: RelatedReviews,
  includeRegistered = false,
): RelatedSuggestion[] {
  const byKey = new Map<string, RelatedSuggestion>()
  for (const suggestion of [...suggestions, ...contexts]) {
    if (suggestion.kind === 'hint' || suggestion.kind === 'note') continue
    const previous = byKey.get(suggestion.key)
    byKey.set(suggestion.key, {
      ...suggestion,
      role: previous?.role ?? suggestion.role,
      assembly: previous?.assembly ?? suggestion.assembly,
      oneOf: previous?.oneOf ?? suggestion.oneOf,
      ruleIds: [...new Set([...(previous?.ruleIds ?? []), ...suggestion.ruleIds])].sort(),
      originFixtureIds: [...new Set([
        ...(previous?.originFixtureIds ?? []), ...suggestion.originFixtureIds,
      ])],
    })
  }
  for (const [key, saved] of Object.entries(reviews.decisions)) {
    if (key.startsWith('note:')) continue
    const current = byKey.get(key)
    if (current) {
      byKey.set(key, {
        ...current,
        originFixtureIds: [...new Set([
          ...current.originFixtureIds, ...saved.originFixtureIds,
        ])],
      })
    } else {
      byKey.set(key, {
        key,
        kind: key.startsWith('item:') ? 'item' : 'check',
        ruleIds: [...saved.ruleIds],
        originFixtureIds: [...saved.originFixtureIds],
        book: '建築',
        priority: '中',
        targets: [],
        targetTexts: [`保存済みの判断（${saved.ruleIds.join('、')}）`],
        questions: ['現在の表示条件では候補に出ていません。保存済みの判断を変更・取消できます。'],
        notes: [],
        refs: [],
        registeredCount: 0,
        flags: {},
      })
    }
  }
  const decisions = Object.fromEntries(Object.entries(reviews.decisions)
    .map(([key, saved]) => [key, saved.decision]))
  const items = withRelatedDecisions([...byKey.values()], decisions)
  // 選択済みの候補を除外する前に、同じ起点の採用済み候補を確認する。
  const collapsedKeys = collapsedRelatedOneOfKeys(items)
  return items.filter(suggestion =>
    !collapsedKeys.has(suggestion.key)
    && (includeRegistered
      || suggestion.decision !== undefined
      || !suggestion.flags.registered))
}

export interface RelatedReviewGroup {
  id: string | null
  name: string
  missing: boolean
  suggestions: RelatedSuggestion[]
}

export function groupRelatedReviews(
  suggestions: readonly RelatedSuggestion[],
  fixtures: readonly CountFixture[],
): RelatedReviewGroup[] {
  const fixtureById = new Map(fixtures.map(fixture => [fixture.id, fixture]))
  const groups = new Map<string | null, RelatedReviewGroup>()
  for (const suggestion of suggestions) {
    const origins: Array<string | null> = suggestion.originFixtureIds.length
      ? [...new Set(suggestion.originFixtureIds)] : [null]
    for (const id of origins) {
      let group = groups.get(id)
      if (!group) {
        const fixture = id === null ? undefined : fixtureById.get(id)
        group = {
          id,
          name: id === null ? '案件の確認事項'
            : fixture?.name ?? `起点なし（${id}）`,
          missing: id !== null && fixture === undefined,
          suggestions: [],
        }
        groups.set(id, group)
      }
      group.suggestions.push(suggestion)
    }
  }
  return [...groups.values()]
}
