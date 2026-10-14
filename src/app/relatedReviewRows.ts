import type { CountFixture } from '../core/countFixtures'
import type { RelatedReviews } from '../core/related/reviews'
import {
  contextChecks,
  suggestRelated,
  type RelatedSuggestion,
} from '../core/related/suggest'
import { perfTime } from '../perf/counters'
import { loadRelated, type RelatedModel } from './relatedModel'
import { relatedReviewList } from './relatedReviewList'
import { relatedReviewStatusOrder, type RelatedReviewRow } from './relatedXlsx'

/** R2 の一覧を、数量や集計条件に触れず Excel 用の行に変換する。 */
export function buildRelatedReviewRows(
  suggestions: readonly RelatedSuggestion[],
  contexts: readonly RelatedSuggestion[],
  reviews: RelatedReviews,
  fixtures: readonly CountFixture[],
  model: RelatedModel,
): RelatedReviewRow[] {
  const fixtureById = new Map(fixtures.map(fixture => [fixture.id, fixture]))
  const notes = new Map<string, RelatedSuggestion>()
  for (const suggestion of [...suggestions, ...contexts]) {
    if (suggestion.kind !== 'note') continue
    const previous = notes.get(suggestion.key)
    notes.set(suggestion.key, {
      ...suggestion,
      originFixtureIds: [...new Set([
        ...(previous?.originFixtureIds ?? []), ...suggestion.originFixtureIds,
      ])],
      ruleIds: [...new Set([
        ...(previous?.ruleIds ?? []), ...suggestion.ruleIds,
      ])].sort(),
    })
  }
  const items = [
    ...relatedReviewList(suggestions, contexts, reviews, true),
    ...notes.values(),
  ]
  const rows: RelatedReviewRow[] = items.map(suggestion => {
    const saved = suggestion.kind !== 'note' && Object.hasOwn(reviews.decisions, suggestion.key)
      ? reviews.decisions[suggestion.key] : undefined
    const origins = suggestion.originFixtureIds.map(id => {
      const fixture = fixtureById.get(id)
      return fixture
        ? [fixture.code, fixture.name].filter(Boolean).join(' ')
        : '起点なし'
    })
    const decision = suggestion.kind === 'note' ? undefined : suggestion.decision
    const status: RelatedReviewRow['status'] = suggestion.kind === 'note'
      ? '注意'
      : decision === undefined
        ? suggestion.flags.registered ? '選択済み' : '未判断'
      : suggestion.kind === 'check' && decision === '必要'
        ? '確認した'
        : decision
    return {
      status,
      origins: [...new Set(origins)].join('、') || '起点なし',
      target: [...new Set(suggestion.targetTexts)].join('、'),
      kind: suggestion.kind === 'note' ? '注意'
        : suggestion.kind === 'item' ? '拾い候補' : '確認事項',
      question: suggestion.questions.join('\n'),
      assignee: decision === '他工事' ? saved?.assignee ?? '' : '',
      reason: saved?.reason ?? '',
      ruleIds: [...new Set([
        ...suggestion.ruleIds, ...(saved?.ruleIds ?? []),
      ])].sort().join('、'),
      refs: [...new Set(suggestion.refs)].map(ref =>
        `${ref}：${model.refDocuments[suggestion.book]?.[ref] ?? '資料名未登録'}`)
        .join(' ／ '),
      decidedAt: saved?.decidedAt ?? '',
    }
  })
  return rows.map((row, index) => ({ row, index }))
    .sort((a, b) =>
      relatedReviewStatusOrder(a.row.status) - relatedReviewStatusOrder(b.row.status)
      || a.index - b.index)
    .map(({ row }) => row)
}

/** 呼出側が利用条件を確認した場合だけルールを読み込む。 */
export async function evaluateRelatedReviewRows(
  fixtures: readonly CountFixture[],
  reviews: RelatedReviews,
  isCurrent: () => boolean = () => true,
): Promise<RelatedReviewRow[] | undefined> {
  if (!isCurrent()) return undefined
  const model = await loadRelated()
  if (!isCurrent()) return undefined
  const originIds = fixtures.map(fixture => fixture.id)
  const suggestions = originIds.length
    ? perfTime('related.suggest.document.quantity', () => suggestRelated({
      index: model.index,
      fixtures,
      originIds,
      projectMode: reviews.projectMode,
      works: reviews.works,
      decisions: {},
      resolveTarget: model.resolveTarget,
    }))
    : []
  const contexts = contextChecks({
    index: model.index,
    projectMode: reviews.projectMode,
    decisions: {},
    fixtures,
  })
  if (!isCurrent()) return undefined
  return buildRelatedReviewRows(suggestions, contexts, reviews, fixtures, model)
}
