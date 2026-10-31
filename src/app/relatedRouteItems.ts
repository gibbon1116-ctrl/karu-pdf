import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { quantityMethod, type CountFixture } from '../core/countFixtures'
import {
  suggestRelated,
  type RelatedDecision,
  type RelatedSuggestion,
} from '../core/related/suggest'
import type { WorkType } from '../core/related/types'
import type { AnnotationStore } from '../editor/AnnotationStore'
import { loadRelated, type RelatedModel } from './relatedModel'
import { relatedSessionMemory } from './relatedState'

const emptyItems: readonly CountFixture[] = []

/** 提案順・文書内の項目順を保ち、同じ項目は一度だけ返す。 */
export function relatedCountItemsForSuggestions(
  fixtures: readonly CountFixture[],
  suggestions: readonly RelatedSuggestion[],
): CountFixture[] {
  const counts = fixtures.filter(fixture =>
    fixture.link === undefined && quantityMethod(fixture) === 'click')
  const seen = new Set<string>()
  const result: CountFixture[] = []

  for (const suggestion of suggestions) {
    if (suggestion.kind !== 'item' && suggestion.kind !== 'check') continue

    for (const fixture of counts) {
      const matches = suggestion.kind === 'check'
        ? suggestion.create !== undefined
          && fixture.name === suggestion.create.name
        : suggestion.targets.some(target =>
          fixture.category === target.category
          && (target.name === undefined || fixture.name === target.name))

      if (matches && !seen.has(fixture.id)) {
        seen.add(fixture.id)
        result.push(fixture)
      }
    }
  }
  return result
}

/**
 * セッションで開いた／登録した文書、案件区分・判断がある文書だけ有効。
 * 印の選択・数量変更による通知では評価キャッシュを作り直さない。
 */
export function useRelatedCountItems(
  store: AnnotationStore,
  originFixtureId: string | undefined,
): readonly CountFixture[] {
  useSyncExternalStore(store.subscribe, store.getSnapshot)
  const memory = useMemo(() => relatedSessionMemory(store), [store])
  const session = useSyncExternalStore(
    memory.subscribe, memory.getSnapshot, memory.getSnapshot,
  )
  const fixturesRevision = store.getFixturesRevision()
  const reviews = store.getRelatedReviewsSnapshot()
  const projectMode = reviews.projectMode
  const decisionsKey = JSON.stringify(Object.fromEntries(
    Object.entries(reviews.decisions).map(([key, value]) => [key, value.decision]),
  ))
  const worksKey = JSON.stringify(reviews.works)
  const enabled = session.originIds.length > 0
    || projectMode !== undefined
    || Object.keys(reviews.decisions).length > 0

  const fixtures = useMemo(
    () => store.getCountFixturesSnapshot(),
    [store, fixturesRevision],
  )
  const origin = fixtures.find(fixture => fixture.id === originFixtureId)
  const wanted = enabled && store.fixturesReady && store.relatedReviewsReady
    && origin !== undefined && origin.link === undefined
    && quantityMethod(origin) === 'polyline'

  const [model, setModel] = useState<RelatedModel | null>(null)
  useEffect(() => {
    if (!wanted || model) return
    let alive = true
    void loadRelated().then(value => {
      if (alive) setModel(value)
    }).catch(() => {
      // 読み込み失敗時は従来の選択肢を維持する。
      // 関連候補パネル側の再試行後は、再マウント／入力変更で再取得できる。
    })
    return () => { alive = false }
  }, [wanted, model, fixturesRevision, projectMode, decisionsKey, worksKey])

  const works = useMemo(
    () => JSON.parse(worksKey) as Record<string, WorkType>,
    [worksKey],
  )
  const decisions = useMemo(
    () => JSON.parse(decisionsKey) as Record<string, RelatedDecision>,
    [decisionsKey],
  )
  const cache = useMemo(
    () => new Map<string, readonly CountFixture[]>(),
    [store, model, fixturesRevision, projectMode, worksKey, decisionsKey],
  )

  return useMemo(() => {
    if (!wanted || !model || !originFixtureId) return emptyItems
    const previous = cache.get(originFixtureId)
    if (previous !== undefined) return previous

    const suggestions = suggestRelated({
      index: model.index,
      fixtures,
      originIds: [originFixtureId],
      projectMode,
      works,
      decisions,
      resolveTarget: model.resolveTarget,
    })
    const items = relatedCountItemsForSuggestions(fixtures, suggestions)
    cache.set(originFixtureId, items)
    return items
  }, [
    wanted, model, originFixtureId, cache, fixtures,
    projectMode, works, decisions,
  ])
}
