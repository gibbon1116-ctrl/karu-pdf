import { nextCountStyle, type CountFixture } from '../core/countFixtures'
import type { RelatedSuggestion } from '../core/related/suggest'
import type { TakeoffRuleScopes } from '../core/takeoff/types'

/** ダイアログ用の初期値だけを作る。文書や数量は変更しない。 */
export function createRelatedFixture(
  suggestion: RelatedSuggestion,
  origin: CountFixture,
  fixtures: readonly CountFixture[],
  scopes?: TakeoffRuleScopes,
): CountFixture {
  const name = suggestion.create?.name
    ?? suggestion.targets[0]?.name ?? suggestion.targetTexts[0] ?? ''
  const classIds = [...new Set(suggestion.ruleIds.map(id => scopes?.rules[id]?.classId))]
  const mark = classIds.length === 1 && classIds[0] === 'MARK'
  const unit = mark ? '㎡'
    : suggestion.kind === 'check' ? suggestion.create?.unit : undefined
  return {
    id: crypto.randomUUID(),
    name,
    code: '',
    category: origin.category,
    order: fixtures.reduce((order, fixture) => Math.max(order, fixture.order + 1), 0),
    style: nextCountStyle(fixtures),
    ...(unit === 'm' ? { kind: 'length' as const, method: 'polyline' as const }
      : unit === '㎡' ? { kind: 'area' as const, method: 'polygon' as const }
        : unit !== undefined ? { unit } : {}),
  }
}
