import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { quantityMethod, type CountFixture } from '../core/countFixtures'
import { relatedAdditionKind } from '../editor/AnnotationStore'
import {
  RELATED_REVIEW_ASSIGNEES,
  RELATED_REVIEW_DECISIONS,
  type RelatedReviewAssignee,
} from '../core/related/reviews'
import { groupRelatedReviews, relatedReviewList } from './relatedReviewList'
import {
  collapsedRelatedOneOfKeys,
  contextChecks,
  normalizeItemName,
  suggestRelated,
  withRelatedDecisions,
  type RelatedDecision,
  type RelatedSuggestion,
} from '../core/related/suggest'
import {
  ASSEMBLY_ROLES,
  PROJECT_MODES,
  WORK_TYPES,
  type ProjectMode,
  type WorkType,
  type RelatedRule,
} from '../core/related/types'
import { perfCount, perfTime } from '../perf/counters'
import type { DocumentSession, RelatedAddContext } from './documentModel'
import { loadRelated, type RelatedModel } from './relatedModel'
import type { RelatedSessionState } from './relatedState'
import { createRelatedFixture } from './relatedFixture'
import RuleScopeBlock from './RuleScopeBlock'
import { loadRuleScopes } from './takeoffModel'
import type { TakeoffRuleScopes } from '../core/takeoff/types'
import {
  scopePlanForRules,
  withRelatedScopeContext,
  relatedOriginMatches,
  type ScopeRuleOptions,
} from './relatedLinkRules'
import {
  relatedCountComponentChoices,
  resolveRelatedCountComponent,
  type RelatedCountComponentChoice,
} from './relatedCountComponents'

interface Props {
  store: DocumentSession['annotationStore']
  fixtures: readonly CountFixture[]
  onOpenMaster(query: string, context?: RelatedAddContext): void
  onCreateFixture(initial: CountFixture, context?: RelatedAddContext): void
  onApplyRelated(fixtureIds: string[], context: RelatedAddContext): void
  routeId?: string
  onSelectFixture(id: string): void
  state: RelatedSessionState
  onStateChange(patch: Partial<RelatedSessionState>): void
  selectedFixtureId: string | null | undefined
  canAddFixtures: boolean
  canEditReviews: boolean
  onRetryReviews(): void
}

const noDecisions: Readonly<Record<string, RelatedDecision>> = {}
const emptySuggestions: RelatedSuggestion[] = []

function targetQuery(suggestion: RelatedSuggestion): string | undefined {
  const target = suggestion.targets[0]
  return target ? target.name ?? target.category : undefined
}

function registeredRelatedFixtures(
  suggestion: RelatedSuggestion,
  origin: CountFixture | undefined,
  fixtures: readonly CountFixture[],
  store: DocumentSession['annotationStore'],
  routeId?: string,
  scopes?: TakeoffRuleScopes,
  scopeOptions: ScopeRuleOptions = {},
): CountFixture[] {
  if (!suggestion.flags.registered || suggestion.decision !== undefined
    || !origin || origin.link !== undefined
    || suggestion.kind !== 'item' && suggestion.kind !== 'check') return []

  return fixtures.filter(fixture => {
    const plan = scopePlanForRules(
      suggestion.ruleIds, scopes, origin, fixture, scopeOptions,
    )
    if (plan.kind === 'none') return false

    if (plan.kind === 'link') {
      if (fixture.id === origin.id || fixture.link !== undefined
        || store.fixtureMarkCount(fixture.id) !== 0) return false
    } else {
      const kind = relatedAdditionKind(origin, fixture, routeId)
      if (!kind) return false
      if ((kind === 'factor' || kind === 'perimeter')
        && (store.fixtureMarkCount(fixture.id) !== 0
          || fixture.link !== undefined && fixture.link.kind !== 'factor')) return false
    }

    if (suggestion.kind === 'check') {
      return !!suggestion.create?.name
        && normalizeItemName(fixture.name) === normalizeItemName(suggestion.create.name)
    }
    return suggestion.targets.some(target =>
      (!!target.category || !!target.name)
      && (!target.category || fixture.category === target.category)
      && (!target.name
        || normalizeItemName(fixture.name) === normalizeItemName(target.name)))
  })
}



export default function RelatedSuggestions({
  store,
  fixtures,
  onOpenMaster,
  onCreateFixture,
  onApplyRelated,
  routeId,
  onSelectFixture,
  state: uiState,
  onStateChange,
  selectedFixtureId,
  canAddFixtures,
  canEditReviews,
  onRetryReviews,
}: Props) {
  perfCount('related.panel.render')
  useSyncExternalStore(store.subscribe, store.getSnapshot)
  const reviewsRevision = store.getRelatedReviewsRevision()
  const fixturesRevision = store.getFixturesRevision()
  const reviews = store.getRelatedReviewsSnapshot()
  // 判断だけの変更では、同じ内容の品目作業の参照と照合キャッシュを維持する。
  const worksRef = useRef(reviews.works)
  const works = useMemo(() => {
    const previous = worksRef.current
    const next = reviews.works
    if (previous === next) return previous
    const keys = Object.keys(next)
    if (keys.length === Object.keys(previous).length
      && keys.every(key => Object.hasOwn(previous, key) && previous[key] === next[key])) {
      return previous
    }
    worksRef.current = next
    return next
  }, [reviews])
  const decisions = useMemo(() => Object.fromEntries(
    Object.entries(reviews.decisions).map(([key, value]) => [key, value.decision]),
  ) as Record<string, RelatedDecision>, [reviews.decisions])
  const state = useMemo(() => ({
    ...uiState, projectMode: reviews.projectMode, works, decisions,
  }), [uiState, reviews.projectMode, works, decisions])
  const canReview = store.relatedReviewsReady && canEditReviews
  const [rulesVersion, setRulesVersion] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [documentListOpen, setDocumentListOpen] = useState(false)
  const [model, setModel] = useState<RelatedModel | null>(null)
  const [ruleScopes, setRuleScopes] = useState<TakeoffRuleScopes>()
  const [relatedRules, setRelatedRules] = useState<readonly RelatedRule[]>([])

  const ruleContextFor = (suggestion: RelatedSuggestion): ScopeRuleOptions => ({
    originMatch: relatedOriginMatches(suggestion.ruleIds, relatedRules),
    projectMode: store.getRelatedReviewsSnapshot().projectMode,
  })
  const [loadError, setLoadError] = useState('')
  const [retry, setRetry] = useState(0)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [componentStatus, setComponentStatus] = useState('')
  const [routeChoices, setRouteChoices] = useState<Record<string, string>>({})
  const [componentChoice, setComponentChoice] = useState<{
    key: string
    originId: string
    value: string
  } | null>(null)

  useEffect(() => {
    setComponentChoice(null)
    setComponentStatus('')
    setRouteChoices({})
  }, [selectedFixtureId])

  const [assigneeChoice, setAssigneeChoice] = useState<{
    key: string
    value: RelatedReviewAssignee
  } | null>(null)

  const hasSavedDecisions = useMemo(
    () => Object.keys(reviews.decisions).length > 0,
    [reviews],
  )
  const suggestionsOpen = !state.closed && (
    state.originIds.length > 0 || state.projectMode !== undefined || hasSavedDecisions
  )
  const evaluateOrigins = suggestionsOpen && !!selectedFixtureId
  const active = suggestionsOpen || documentListOpen
  const wanted = active && store.fixturesReady && store.relatedReviewsReady
  useEffect(() => {
    if (!wanted || model) return
    let alive = true
    setLoadError('')
    void Promise.all([
      loadRelated(),
      import('../core/related/rules').then(module => ({
        version: module.RELATED_RULES_VERSION,
        rules: module.RELATED_RULES,
      })),
      loadRuleScopes(),
    ]).then(([value, loaded, scopes]) => {
      const { version, rules } = loaded
      if (typeof version !== 'string' || !version.trim()) {
        throw new Error('関連ルールの版が不正です。')
      }
      if (alive) {
        setRuleScopes(scopes)
        setRelatedRules(rules)
        setModel(value)
        setRulesVersion(version)
      }
    }).catch(reason => {
      if (alive) setLoadError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { alive = false }
  }, [wanted, model, retry])

  const originKey = JSON.stringify(selectedFixtureId ? [selectedFixtureId] : [])
  const activeOriginIds = useMemo(
    () => JSON.parse(originKey) as string[],
    [originKey],
  )
  const selected = fixtures.find(fixture => fixture.id === selectedFixtureId)

  // 印・数量・スクロール・判断の変更ではキャッシュを作り直さない。
  // 同じ項目を選び直す場合も、その項目の評価を再利用する。
  const cache = useMemo(() => ({
    items: new Map<string, RelatedSuggestion[]>(),
  }), [model, fixtures, state.projectMode, state.works])
  const [evaluation, setEvaluation] = useState<{
    cache: typeof cache
    key: string
    items: RelatedSuggestion[]
  } | null>(null)

  // 評価は描画本体から外し、登録起点・選択起点・表示条件の変更時だけ行う。
  useEffect(() => {
    if (!evaluateOrigins || state.closed || !model || !store.fixturesReady
      || !store.relatedReviewsReady) return
    let items = cache.items.get(originKey)
    if (items === undefined) {
      items = activeOriginIds.length
        ? perfTime('related.suggest', () => suggestRelated({
          index: model.index,
          fixtures,
          originIds: activeOriginIds,
          projectMode: state.projectMode,
          works: state.works,
          decisions: noDecisions,
          resolveTarget: model.resolveTarget,
        }))
        : []
      cache.items.set(originKey, items)
    }
    setEvaluation({ cache, key: originKey, items })
  }, [
    evaluateOrigins, state.closed, model, store, store.fixturesReady,
    store.relatedReviewsReady, cache, originKey,
    activeOriginIds, fixtures, state.projectMode, state.works,
  ])

  const documentOriginIds = useMemo(
    () => documentListOpen ? fixtures.map(fixture => fixture.id) : [],
    [documentListOpen, fixtures],
  )
  const documentOriginKey = useMemo(
    () => JSON.stringify(documentOriginIds),
    [documentOriginIds],
  )
  const documentGeneration = useRef(0)
  const [documentEvaluation, setDocumentEvaluation] = useState<{
    cache: typeof cache
    key: string
    items: RelatedSuggestion[]
  } | null>(null)
  useEffect(() => {
    const generation = ++documentGeneration.current
    if (!documentListOpen || !model || !store.fixturesReady || !store.relatedReviewsReady) return
    const current = () => generation === documentGeneration.current
      && fixturesRevision === store.getFixturesRevision()
      && reviewsRevision === store.getRelatedReviewsRevision()
    // 描画の後に評価する。変更・終了で古くなった世代は採用しない。
    const timer = setTimeout(() => {
      if (!current()) return
      let items = cache.items.get(documentOriginKey)
    if (items === undefined) {
        items = documentOriginIds.length ? perfTime('related.suggest.document', () => suggestRelated({
          index: model.index,
          fixtures,
          originIds: documentOriginIds,
          projectMode: state.projectMode,
          works: state.works,
          decisions: noDecisions,
          resolveTarget: model.resolveTarget,
        })) : []
        if (!current()) return
        cache.items.set(documentOriginKey, items)
      }
      if (!current()) return
      setDocumentEvaluation({ cache, key: documentOriginKey, items })
    }, 0)
    return () => {
      clearTimeout(timer)
      if (documentGeneration.current === generation) documentGeneration.current++
    }
  }, [
    documentListOpen, model, store, store.fixturesReady, store.relatedReviewsReady, cache,
    documentOriginKey, documentOriginIds, fixtures, fixturesRevision, reviewsRevision,
    state.projectMode, state.works,
  ])

  const evaluatedItems = evaluateOrigins && !state.closed
    && evaluation?.cache === cache && evaluation.key === originKey
    ? evaluation.items : emptySuggestions
  const suggestions = useMemo(() =>
    withRelatedDecisions(evaluatedItems, state.decisions),
  [evaluatedItems, state.decisions])
  const contexts = useMemo(() => active && model ? contextChecks({
    index: model.index,
    projectMode: state.projectMode,
    decisions: state.decisions,
    fixtures,
  }) : emptySuggestions, [active, model, state.projectMode, state.decisions, fixtures])

  const pending = suggestions.filter(suggestion =>
    suggestion.kind !== 'note' && suggestion.decision === undefined)
  const ordinary = pending.filter(suggestion =>
    (suggestion.kind === 'item' || suggestion.kind === 'check')
    && !suggestion.flags.registered)
  const registered = pending.filter(suggestion =>
    (suggestion.kind === 'item' || suggestion.kind === 'check')
    && suggestion.flags.registered)
  const collapsedKeys = useMemo(
    () => collapsedRelatedOneOfKeys(suggestions),
    [suggestions],
  )
  const visibleOrdinary = ordinary.filter(item => !collapsedKeys.has(item.key))
  const ungroupedOrdinary = visibleOrdinary.filter(item => item.role === undefined)
  const ungroupedRegistered = registered.filter(item => item.role === undefined)
  const ungroupedAlternatives = ordinary.filter(item =>
    item.role === undefined && collapsedKeys.has(item.key))
  const roleGroups = ASSEMBLY_ROLES.map(role => ({
    role,
    items: [...ordinary, ...registered].filter(item => item.role === role),
  })).filter(group => group.items.length > 0)
  const hints = pending.filter(suggestion => suggestion.kind === 'hint')
  const decided = suggestions.filter(suggestion =>
    suggestion.kind !== 'note' && suggestion.kind !== 'hint'
    && suggestion.decision !== undefined)
  const contextItems = contexts.filter(suggestion =>
    suggestion.kind === 'item' || suggestion.kind === 'check')
  const contextPending = contextItems.filter(suggestion =>
    suggestion.decision === undefined && !suggestion.flags.registered)
  const contextRegistered = contextItems.filter(suggestion =>
    suggestion.decision === undefined && suggestion.flags.registered)
  const contextDecided = contextItems.filter(suggestion => suggestion.decision !== undefined)
  const notices = [...new Map([...suggestions, ...contexts]
    .filter(suggestion => suggestion.kind === 'note')
    .map(suggestion => [suggestion.key, suggestion])).values()]
  const all = expandedKey === originKey

  const documentItems = documentListOpen && documentEvaluation?.cache === cache
    && documentEvaluation.key === documentOriginKey
    ? documentEvaluation.items : emptySuggestions
  const documentReviews = useMemo(
    () => active ? relatedReviewList(documentItems, contexts, reviews) : emptySuggestions,
    [active, documentItems, contexts, reviews],
  )
  const documentPending = documentReviews.filter(item => item.decision === undefined)
  const documentLater = documentReviews.filter(item => item.decision === '後で確認')
  const documentDecided = documentReviews.filter(item =>
    item.decision !== undefined && item.decision !== '後で確認')
  const pendingGroups = useMemo(
    () => groupRelatedReviews([...documentPending, ...documentLater], fixtures),
    [documentReviews, fixtures],
  )
  const decidedGroups = useMemo(
    () => groupRelatedReviews(documentDecided, fixtures),
    [documentReviews, fixtures],
  )
  const documentReady = documentListOpen && store.fixturesReady && store.relatedReviewsReady
    && !!model && documentEvaluation?.cache === cache
    && documentEvaluation.key === documentOriginKey

  const changeReview = (change: () => void): boolean => {
    if (!canReview) return false
    try { change(); setReviewError(''); return true }
    catch (reason) {
      setReviewError(reason instanceof Error ? reason.message : String(reason))
      return false
    }
  }
  const decide = (
    suggestion: RelatedSuggestion,
    decision: RelatedDecision | undefined,
    assignee?: RelatedReviewAssignee,
  ): boolean => {
    if (!canReview || !rulesVersion
      || suggestion.kind === 'hint' || suggestion.kind === 'note') return false
    const saved = reviews.decisions[suggestion.key]
    if (decision === '他工事' && assignee === undefined) {
      setAssigneeChoice({
        key: suggestion.key,
        value: saved?.assignee ?? 'その他',
      })
      return false
    }
    const finish = (changed: boolean): boolean => {
      if (changed && assigneeChoice?.key === suggestion.key) setAssigneeChoice(null)
      if (changed && componentChoice?.key === suggestion.key) setComponentChoice(null)
      return changed
    }
    if (decision === undefined) return finish(changeReview(() =>
      store.setRelatedDecision(suggestion.key, undefined)))
    if (saved?.decision === decision
      && (decision !== '他工事' || saved.assignee === assignee)) return finish(true)
    return finish(changeReview(() => store.setRelatedDecision(suggestion.key, {
      decision,
      ...(decision === '他工事' && assignee !== undefined ? { assignee } : {}),
      ruleIds: [...new Set(suggestion.ruleIds)].sort().slice(0, 20),
      originFixtureIds: [...new Set([
        ...suggestion.originFixtureIds, ...(saved?.originFixtureIds ?? []),
      ])].sort().slice(0, 50),
      ...(saved?.reason !== undefined ? { reason: saved.reason } : {}),
      rulesVersion,
      decidedAt: new Date().toISOString(),
    })))
  }

  const componentChoicesFor = (
    suggestion: RelatedSuggestion,
    origin: CountFixture | undefined,
    all: readonly CountFixture[],
  ): RelatedCountComponentChoice[] => {
    if (!origin || !ruleScopes) return []
    return relatedCountComponentChoices(suggestion, origin, all, model)
      .filter(choice => {
        try {
          const { fixture } = resolveRelatedCountComponent(choice, all)
          const plan = scopePlanForRules(
            suggestion.ruleIds, ruleScopes, origin, fixture,
            ruleContextFor(suggestion),
          )
          return plan.kind === 'placement' && plan.placement === 'component'
        } catch {
          return false
        }
      })
  }

  const addRelatedComponent = (
    suggestion: RelatedSuggestion,
    originId: string,
    choice: RelatedCountComponentChoice,
  ) => {
    if (!canReview || !canAddFixtures || !rulesVersion
      || originId !== selectedFixtureId) return
    setComponentStatus('')
    try {
      const all = store.getCountFixtures()
      const origin = all.find(fixture => fixture.id === originId)
      const choices = componentChoicesFor(suggestion, origin, all)
      const currentChoice = choices.find(value => value.key === choice.key)
      if (!currentChoice) {
        setReviewError('構成要素にする候補が変わりました。もう一度選んでください。')
        return
      }
      const { fixture, newFixtures } = resolveRelatedCountComponent(currentChoice, all)
      if (fixture.id === originId) {
        setReviewError('同じ項目を構成要素にはできません。')
        return
      }

      // 判断を先に記録し、構成要素の一括更新を直近の履歴にする。
      const previousDecision = store.getRelatedReviewsSnapshot()
        .decisions[suggestion.key]?.decision
      if (!decide(suggestion, '構成要素で拾う')) return
      const result = store.addComponentToFixture(originId, fixture.id, newFixtures)
      if (result.error) {
        // ストアの検査エラーでは構成要素の履歴は作られていない。
        if (previousDecision !== '構成要素で拾う') store.undo()
        setReviewError(result.error)
        return
      }

      setComponentChoice(null)
      setReviewError('')
      setComponentStatus(
        `${fixture.name}を構成要素に設定しました`
        + `（印 ${result.changed} 個を更新`
        + (result.skipped ? `、10件の上限で ${result.skipped} 個を見送り` : '')
        + '。これからの印も10件まで。Ctrl+Z で戻せます）',
      )
    } catch (reason) {
      setReviewError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const requestDecision = (
    suggestion: RelatedSuggestion,
    decision: RelatedDecision,
    origin: CountFixture | undefined,
  ) => {
    if (decision !== '構成要素で拾う') {
      decide(suggestion, decision)
      return
    }
    if (!canReview || !canAddFixtures || !rulesVersion || !origin) return
    const choices = componentChoicesFor(
      suggestion, origin, store.getCountFixtures(),
    )
    if (!choices.length) {
      setReviewError('構成要素にできる個数の項目がありません。')
      return
    }
    setAssigneeChoice(null)
    setComponentStatus('')
    if (choices.length === 1) {
      addRelatedComponent(suggestion, origin.id, choices[0])
    } else {
      setComponentChoice({
        key: suggestion.key,
        originId: origin.id,
        value: choices[0].key,
      })
    }
  }

  const renderSuggestion = (suggestion: RelatedSuggestion, showOrigins = false) => {
    const query = targetQuery(suggestion)
    const title = [...new Set(suggestion.targetTexts)].join('、')
    const masterNames = [...new Set(suggestion.targets.flatMap(target =>
      target.candidates.map(candidate => candidate.name)))]
    const saved = reviews.decisions[suggestion.key]
    const displayOriginIds = [...new Set([
      ...suggestion.originFixtureIds, ...(saved?.originFixtureIds ?? []),
    ])]
    const missingOrigin = displayOriginIds.length > 0
      && displayOriginIds.every(id => !fixtures.some(fixture => fixture.id === id))
    if (suggestion.kind === 'note') return <article key={suggestion.key}
      className="related-card related-note"
      data-testid="related-suggestion"
      data-related-kind="note"
      data-rule-ids={suggestion.ruleIds.join(' ')}
      data-related-key={suggestion.key}
      data-decision={undefined}>
      <p><strong>{title}</strong>{suggestion.questions[0] && `：${suggestion.questions[0]}`}</p>
    </article>
    const registeredOnly = suggestion.flags.registered && suggestion.decision === undefined
    const createOrigin = showOrigins
      ? fixtures.find(fixture => suggestion.originFixtureIds.includes(fixture.id)) ?? selected
      : selected
    const canCreate = !!createOrigin && (suggestion.kind === 'item'
      || suggestion.kind === 'check' && !!suggestion.create)
    const addSuggestion = () => {
      if (!canAddFixtures || !canCreate || !createOrigin || !ruleScopes) return
      const context = withRelatedScopeContext({
        originFixtureId: createOrigin.id,
        ...(routeId && createOrigin.id === selectedFixtureId ? { routeId } : {}),
      }, suggestion.ruleIds, ruleScopes, ruleContextFor(suggestion))
      if (suggestion.kind === 'item' && !suggestion.flags.unresolved && query) {
        if (decide(suggestion, '必要')) onOpenMaster(query, context)
        return
      }
      try {
        const initial = createRelatedFixture(
          suggestion, createOrigin, fixtures, ruleScopes,
        )
        if (decide(suggestion, '必要')) onCreateFixture(initial, context)
      } catch (reason) {
        setReviewError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    const componentOrigin = showOrigins
      && !suggestion.originFixtureIds.includes(selected?.id ?? '')
      ? undefined : selected
    const componentChoices = componentChoicesFor(
      suggestion, componentOrigin, fixtures,
    )
    const choosingComponent = componentChoice?.key === suggestion.key
      && componentChoice.originId === componentOrigin?.id
    const applyOrigin = createOrigin
    const applyRouteId = applyOrigin?.id === selectedFixtureId ? routeId : undefined
    const routeFixtures = registeredRelatedFixtures(
      suggestion, applyOrigin, fixtures, store, applyRouteId, ruleScopes,
      ruleContextFor(suggestion),
    )
    const routeChoiceKey = JSON.stringify([applyOrigin?.id, suggestion.key])
    const routeFixture = routeFixtures.find(fixture =>
      fixture.id === routeChoices[routeChoiceKey]) ?? routeFixtures[0]
    const routeFixtureId = routeFixture?.id
    const applyPlan = applyOrigin && routeFixture
      ? scopePlanForRules(
        suggestion.ruleIds, ruleScopes, applyOrigin, routeFixture,
        ruleContextFor(suggestion),
      ) : undefined
    const applyLabel = applyPlan?.kind === 'link' ? '連動にする'
      : applyOrigin && quantityMethod(applyOrigin) === 'polyline'
        ? '経路に入れる'
        : applyOrigin && routeFixture
          && relatedAdditionKind(applyOrigin, routeFixture, applyRouteId) === 'component'
          ? '構成要素に入れる' : '連動にする'
    return <article key={suggestion.key}
      className={`related-card${registeredOnly ? ' related-registered' : ''}`}
      data-registered={suggestion.flags.registered ? 'true' : undefined}
      data-testid="related-suggestion"
      data-related-kind={suggestion.kind}
      data-rule-ids={suggestion.ruleIds.join(' ')}
      data-master-query={query}
      data-related-role={suggestion.role}
      data-related-assembly={suggestion.assembly}
      data-one-of={suggestion.oneOf}
      data-create-unit={suggestion.create?.unit}
      data-related-key={suggestion.key}
      data-origin-missing={missingOrigin || undefined}
      data-related-assignee={suggestion.decision === '他工事' ? saved?.assignee : undefined}
      data-decision={suggestion.decision}>
      <h4>{title}{suggestion.flags.modeUnknown &&
        <span className="related-flag">工事区分が未設定</span>}{suggestion.flags.registered &&
        <span className="related-flag">選択済み（{suggestion.registeredCount}項目）</span>}{suggestion.flags.unresolved &&
        <span className="related-flag">標準マスタの提案先を解決できませんでした</span>}</h4>
      <small>
        {suggestion.kind === 'item' ? '拾い候補' : suggestion.kind === 'check' ? '確認事項' : '案内'}
        {suggestion.kind !== 'hint' && ` ／ 優先度：${suggestion.priority}`}
        {suggestion.ruleIds.length > 0 && ` ／ ${suggestion.ruleIds.join('、')}`}
      </small>
      {missingOrigin && <p className="related-flag">起点なし</p>}
      {suggestion.questions[0] && <p>{suggestion.questions[0]}</p>}
      {masterNames.length > 0 && <p className="related-master">
        標準マスタ：{masterNames.slice(0, 3).join('、')}
        {masterNames.length > 3 && `、ほか ${masterNames.length - 3}件`}
      </p>}
      <RuleScopeBlock ruleIds={suggestion.ruleIds} />
      {(suggestion.questions.length > 1 || suggestion.notes.length > 0 ||
        suggestion.refs.length > 0 || displayOriginIds.length > 0) && <details>
        <summary>詳しく</summary>
        {suggestion.questions.slice(1).map(question => <p key={question}>{question}</p>)}
        {suggestion.notes.length > 0 && <>
          <p><strong>精査の要点</strong></p>
          {suggestion.notes.map(note => <p key={note}>{note}</p>)}
        </>}
        {suggestion.refs.length > 0 && <p><small>
          根拠：{suggestion.refs.map(ref =>
            `${ref}：${model?.refDocuments[suggestion.book]?.[ref] ?? '資料名未登録'}`)
            .join(' ／ ')}
        </small></p>}
        {showOrigins && displayOriginIds.length > 0 && <p><small>起点：
          {displayOriginIds.map(id => {
            const fixture = fixtures.find(item => item.id === id)
            return fixture ? <button type="button" key={id}
              aria-label={`起点の項目「${fixture.name}」を選ぶ`}
              onClick={() => onSelectFixture(id)}>{fixture.name}</button>
              : <span key={id}>起点なし（{id}） </span>
          })}
        </small></p>}
      </details>}
      {routeFixtures.length > 0 && <div className="related-actions">
        {routeFixtures.length > 1 && <label>項目<select
          aria-label={`${applyLabel}項目`}
          disabled={!canReview || !rulesVersion}
          value={routeFixtureId}
          onChange={event => {
            const value = event.currentTarget.value
            setRouteChoices(previous => ({ ...previous, [routeChoiceKey]: value }))
          }}>
          {routeFixtures.map(fixture =>
            <option key={fixture.id} value={fixture.id}>{fixture.name}</option>)}
        </select></label>}
        <button type="button"
          aria-label={applyLabel}
          disabled={!canReview || !rulesVersion}
          onClick={() => {
            if (!canReview || !rulesVersion || !applyOrigin || !ruleScopes) return
            try {
              const current = store.getCountFixtures()
              const origin = current.find(fixture => fixture.id === applyOrigin.id)
              const match = registeredRelatedFixtures(
                suggestion, origin, current, store, applyRouteId, ruleScopes,
                ruleContextFor(suggestion),
              ).find(fixture => fixture.id === routeFixtureId)
              if (!origin || !match) {
                setReviewError('反映する候補が変わりました。もう一度選んでください。')
                return
              }
              const context = withRelatedScopeContext({
                originFixtureId: origin.id,
                ...(applyRouteId ? { routeId: applyRouteId } : {}),
              }, suggestion.ruleIds, ruleScopes, ruleContextFor(suggestion))
              if (decide(suggestion, '必要')) {
                onApplyRelated([match.id], context)
              }
            } catch (reason) {
              setReviewError(reason instanceof Error ? reason.message : String(reason))
            }
          }}>{applyLabel}</button>
      </div>}
      {suggestion.kind !== 'hint'
        && <fieldset disabled={!canReview || !rulesVersion}>
        <legend>判断</legend>
        {suggestion.decision ? <>
          <p>判断：{suggestion.decision}
            {suggestion.decision === '他工事' && ` ／ 担当：${saved?.assignee ?? '未設定'}`}
          </p>
          <label>判断を変更<select aria-label="関連候補の判断を変更"
            value={suggestion.decision}
            onChange={event => {
              const value = event.currentTarget.value as RelatedDecision
              if (value === '必要' && suggestion.decision !== '必要'
                && !suggestion.flags.registered && canAddFixtures && canCreate) {
                addSuggestion()
              } else {
                requestDecision(suggestion, value, componentOrigin)
              }
            }}>
            {RELATED_REVIEW_DECISIONS.filter(value =>
              value !== '構成要素で拾う'
              || componentChoices.length > 0
              || suggestion.decision === value).map(value =>
              <option key={value} value={value}>{value}</option>)}
          </select></label>
          <button type="button" onClick={() => decide(suggestion, undefined)}>判断を取消</button>
          {suggestion.decision === '必要' && !suggestion.flags.registered && canCreate
            && <button type="button"
              disabled={!canAddFixtures}
              onClick={addSuggestion}>追加する</button>}
          {suggestion.decision === '他工事' && <label>担当を変更<select
            aria-label="他工事の担当を変更"
            value={saved?.assignee ?? ''}
            onChange={event => decide(
              suggestion, '他工事', event.currentTarget.value as RelatedReviewAssignee,
            )}>
            <option value="" disabled>未設定</option>
            {RELATED_REVIEW_ASSIGNEES.map(value =>
              <option key={value} value={value}>{value}</option>)}
          </select></label>}
          {saved?.reason && <p>理由：{saved.reason}</p>}
        </> : <>
          <div className="related-actions">
            <button type="button"
              disabled={!canAddFixtures || !canCreate}
              onClick={addSuggestion}>追加する</button>
            <button type="button" onClick={() => decide(suggestion, '不要')}>不要</button>
            <button type="button" onClick={() => decide(suggestion, '後で確認')}>後で確認</button>
          </div>
          <select aria-label="ほかの判断" value="" onChange={event => {
            const value = event.currentTarget.value
            if (value) requestDecision(suggestion, value as RelatedDecision, componentOrigin)
          }}>
            <option value="">ほかの判断…</option>
            {suggestion.kind === 'check' && <option value="必要">確認した</option>}
            <option value="単価包含">単価包含</option>
            <option value="他工事">他工事</option>
            {componentChoices.length > 0
              && <option value="構成要素で拾う"
                disabled={!canAddFixtures}>構成要素で拾う</option>}
          </select>
        </>}
        {choosingComponent && componentChoice && <div
          role="group" aria-label="構成要素にする品目の選択">
          <label>品目<select aria-label="構成要素にする品目"
            value={componentChoice.value}
            onChange={event => {
              setComponentChoice({
                ...componentChoice,
                value: event.currentTarget.value,
              })
            }}>
            {componentChoices.map(choice =>
              <option key={choice.key} value={choice.key}>{choice.name}</option>)}
          </select></label>
          <button type="button"
            disabled={!canAddFixtures}
            onClick={() => {
              const choice = componentChoices.find(value =>
                value.key === componentChoice.value)
              if (choice) addRelatedComponent(
                suggestion, componentChoice.originId, choice,
              )
            }}>構成要素に入れる</button>
          <button type="button"
            onClick={() => setComponentChoice(null)}>やめる</button>
        </div>}
        {assigneeChoice?.key === suggestion.key && <div
          role="group" aria-label="他工事の担当の選択">
          <label>担当<select aria-label="他工事の担当"
            value={assigneeChoice.value}
            onChange={event => {
              const value = event.currentTarget.value as RelatedReviewAssignee
              setAssigneeChoice({ key: suggestion.key, value })
            }}>
            {RELATED_REVIEW_ASSIGNEES.map(value =>
              <option key={value} value={value}>{value}</option>)}
          </select></label>
          <button type="button" onClick={() =>
            decide(suggestion, '他工事', assigneeChoice.value)}>担当を記録</button>
          <button type="button" onClick={() =>
            setAssigneeChoice(null)}>担当の選択を取消</button>
        </div>}
      </fieldset>}
    </article>
  }

  const renderAlternatives = (items: readonly RelatedSuggestion[]) => {
    const groups = new Map<string, RelatedSuggestion[]>()
    for (const item of items) {
      if (!item.oneOf || !collapsedKeys.has(item.key)) continue
      const key = JSON.stringify([
        item.book, [...item.originFixtureIds].sort(), item.oneOf,
      ])
      const group = groups.get(key)
      if (group) group.push(item)
      else groups.set(key, [item])
    }
    return [...groups].map(([key, alternatives]) => <details key={key}
      className="related-oneof-alternatives"
      data-testid="related-oneof-alternatives"
      data-one-of={alternatives[0].oneOf}>
      <summary>ほかの候補 {alternatives.length}件</summary>
      <div className="related-list">
        {alternatives.map(item => renderSuggestion(item))}
      </div>
    </details>)
  }

  const settings = <>
    <div className="related-settings">
    <label>案件区分<select aria-label="関連提案の案件区分"
      disabled={!canReview}
      value={state.projectMode ?? ''}
      onChange={event => {
        const mode = (event.currentTarget.value || undefined) as ProjectMode | undefined
        changeReview(() => store.setRelatedProjectMode(mode))
      }}>
      <option value="">未設定</option>
      {PROJECT_MODES.map(mode => <option key={mode} value={mode}>{mode}</option>)}
    </select></label>
    {selected && <label>選択中の項目の品目作業<select
      aria-label="関連提案の品目作業"
      disabled={!canReview}
      value={state.works[selected.id] ?? ''}
      onChange={event => {
        const work = (event.currentTarget.value || undefined) as WorkType | undefined
        changeReview(() => store.setRelatedWork(selected.id, work))
      }}>
      <option value="">未設定</option>
      {WORK_TYPES.map(work => <option key={work} value={work}>{work}</option>)}
    </select></label>}
    </div>
    {!store.relatedReviewsReady && <p role="status">
      関連候補の判断を読み込んでいます…
      <button type="button" onClick={onRetryReviews}>もう一度読み込む</button>
    </p>}
    {reviewError && <p role="alert">{reviewError}</p>}
    {componentStatus && <p role="status">{componentStatus}</p>}
  </>
  const documentList = <details data-testid="related-review-document-list" open={documentListOpen}
      onToggle={event => setDocumentListOpen(event.currentTarget.open)}>
      <summary data-testid="related-review-summary">
        {documentReady
          ? `未判断一覧（未判断 ${documentPending.length}件・後で確認 ${documentLater.length}件）`
          : documentListOpen
            ? '未判断一覧（読み込んでいます…）'
            : '未判断一覧（開くと確認します）'}
      </summary>
      {wanted && !model && !loadError && <p role="status">文書全体の関連候補を読み込んでいます…</p>}
      {documentListOpen && documentReady && <>
        {pendingGroups.length === 0 && <p>未判断・後で確認の候補はありません。</p>}
        {pendingGroups.map(group => <section key={group.id ?? 'context'}
          data-related-origin={group.id ?? ''}
          data-origin-missing={group.missing || undefined}>
          <h3>{group.name}</h3>
          {group.id !== null && !group.missing && <button type="button"
            onClick={() => onSelectFixture(group.id!)}>起点の項目を選ぶ</button>}
          <div className="related-list">{group.suggestions.map(item =>
            renderSuggestion(item, true))}</div>
        </section>)}
        {decidedGroups.length > 0 && <details>
          <summary>判断済み {documentDecided.length}件</summary>
          {decidedGroups.map(group => <section key={group.id ?? 'context'}
            data-related-origin={group.id ?? ''}
            data-origin-missing={group.missing || undefined}>
            <h3>{group.name}</h3>
            <div className="related-list">{group.suggestions.map(item =>
              renderSuggestion(item, true))}</div>
          </section>)}
        </details>}
      </>}
    </details>
  return <section className="related-suggestions" aria-label="関連品目の提案"
    data-testid="related-suggestions">
    <details data-testid="related-origin-list" open={suggestionsOpen} onToggle={event => {
      const open = event.currentTarget.open
      if (open === suggestionsOpen) return
      if (!open) setDocumentListOpen(false)
      onStateChange(open
        ? { originIds: selectedFixtureId ? [selectedFixtureId] : [], closed: false }
        : { closed: true })
    }}>
      <summary>{suggestionsOpen
        ? `関連の候補 ${visibleOrdinary.length}件`
        : '関連の候補（開くと確認します）'}</summary>
      {settings}
      <button type="button" onClick={() => {
        setDocumentListOpen(false)
        onStateChange({ closed: true })
      }}>閉じる</button>
      {wanted && !model && !loadError && <p role="status">関連の候補を読み込んでいます…</p>}
      {loadError && <>
        <p role="alert">関連の候補を読み込めませんでした：{loadError}</p>
        <button type="button" onClick={() => setRetry(value => value + 1)}>もう一度読み込む</button>
      </>}
      <div className="related-list">
        {hints.map(item => renderSuggestion(item))}
        {roleGroups.map(group => <section key={group.role}
          className="related-role-section">
          <h4 className="related-role-heading"
            data-testid="related-role-group"
            data-role={group.role}>{group.role} {group.items.length}件</h4>
          <div className="related-list">
            {group.items.filter(item => !collapsedKeys.has(item.key))
              .map(item => renderSuggestion(item))}
            {renderAlternatives(group.items)}
          </div>
        </section>)}
        {(all ? ungroupedOrdinary : ungroupedOrdinary.slice(0, 5))
          .map(item => renderSuggestion(item))}
        {!all && ungroupedOrdinary.length > 5 && <button type="button"
          onClick={() => setExpandedKey(originKey)}>すべて見る</button>}
        {ungroupedRegistered.map(item => renderSuggestion(item))}
        {renderAlternatives(ungroupedAlternatives)}
        {decided.length > 0 && <details>
          <summary>判断済み {decided.length}件</summary>
          {decided.map(item => renderSuggestion(item))}
        </details>}
      </div>
      {notices.length > 0 && <details>
        <summary>注意 {notices.length}件</summary>
        <div className="related-list">{notices.map(item => renderSuggestion(item))}</div>
      </details>}
    {state.projectMode !== undefined && <details>
      <summary>案件の確認事項 {contextItems.length}件</summary>
      <div className="related-list">
        {contextPending.map(item => renderSuggestion(item))}
        {contextRegistered.map(item => renderSuggestion(item))}
        {contextDecided.length > 0 && <details>
          <summary>判断済み {contextDecided.length}件</summary>
          {contextDecided.map(item => renderSuggestion(item))}
        </details>}
      </div>
    </details>}
    {documentList}
    <small>提案は拾い漏れの確認用です。別途計上の根拠ではありません</small>
    </details>
  </section>
}
