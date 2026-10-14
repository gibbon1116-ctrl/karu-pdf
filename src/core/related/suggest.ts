import type { CountFixture } from '../countFixtures'
import { UNSET_WORK } from './types'
import type {
  AssemblyRole,
  ProjectMode,
  RelatedBook,
  RelatedCreate,
  RelatedOriginMatch,
  RelatedRule,
  RelatedTarget,
  WorkType,
} from './types'

export type RelatedDecision =
  | '必要'
  | '不要'
  | '単価包含'
  | '他工事'
  | '後で確認'
  | '構成要素で拾う'

/** catalog.ts に依存しない、表示・解決に必要な最小の形。 */
export interface RelatedCatalogItem {
  readonly key: string
  readonly field: string
  readonly category: string
  readonly name: string
}

export interface ResolvedRelatedTarget extends RelatedTarget {
  candidates: readonly RelatedCatalogItem[]
  registeredCount: number
}

export interface RelatedSuggestion {
  key: string
  kind: 'item' | 'check' | 'note' | 'hint'
  create?: RelatedCreate
  role?: AssemblyRole
  assembly?: string
  oneOf?: string
  ruleIds: string[]
  originFixtureIds: string[]
  book: RelatedBook
  priority: '高' | '中'
  targets: ResolvedRelatedTarget[]
  targetTexts: string[]
  questions: string[]
  notes: string[]
  refs: string[]
  registeredCount: number
  flags: {
    modeUnknown?: boolean
    registered?: boolean
    unresolved?: boolean
  }
  decision?: RelatedDecision
}

interface BookIndex {
  categories: ReadonlyMap<string, readonly RelatedRule[]>
  names: ReadonlyMap<string, readonly RelatedRule[]>
  subjects: ReadonlyMap<string, readonly RelatedRule[]>
  fallback: readonly RelatedRule[]
}

export interface RelatedIndex {
  books: ReadonlyMap<RelatedBook, BookIndex>
  context: readonly RelatedRule[]
}

export type ResolveRelatedTarget = (
  target: RelatedTarget,
  book: RelatedBook,
) => readonly RelatedCatalogItem[]

export interface RelatedInput {
  index: RelatedIndex
  fixtures: readonly CountFixture[]
  originIds: readonly string[]
  projectMode?: ProjectMode
  works: Readonly<Record<string, WorkType>>
  decisions: Readonly<Record<string, RelatedDecision>>
  resolveTarget: ResolveRelatedTarget
}

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)]

/** 名称の照合だけに使う。表示名・判断の保存キーは変えない。 */
export function normalizeItemName(text: string): string {
  return text.normalize('NFKC')
    .replace(/([\u30A1-\u30FA\u30FC-\u30FF])[-－‐−]/gu, '$1ー')
    .replace(/\s+/gu, '')
}

/** 同じ分野・起点・oneOf に採用済みの候補があるとき、畳む未判断候補のキー。 */
export function collapsedRelatedOneOfKeys(
  suggestions: readonly RelatedSuggestion[],
): ReadonlySet<string> {
  const selectedGroups = new Set<string>()
  const groupKey = (suggestion: RelatedSuggestion, originId: string): string =>
    JSON.stringify([suggestion.book, originId, suggestion.oneOf])

  for (const suggestion of suggestions) {
    if (!suggestion.oneOf
      || suggestion.kind !== 'item' && suggestion.kind !== 'check') continue
    if (!suggestion.flags.registered
      && suggestion.decision !== '必要'
      && suggestion.decision !== '構成要素で拾う') continue
    for (const originId of suggestion.originFixtureIds) {
      selectedGroups.add(groupKey(suggestion, originId))
    }
  }

  const collapsed = new Set<string>()
  for (const suggestion of suggestions) {
    if (!suggestion.oneOf
      || suggestion.kind !== 'item' && suggestion.kind !== 'check'
      || suggestion.decision !== undefined
      || suggestion.flags.registered
      || suggestion.originFixtureIds.length === 0) continue
    // 複数の起点を持つ候補は、すべての起点で採用済みの場合だけ畳む。
    if (suggestion.originFixtureIds.every(originId =>
      selectedGroups.has(groupKey(suggestion, originId)))) {
      collapsed.add(suggestion.key)
    }
  }
  return collapsed
}

function appendIndex(
  map: Map<string, RelatedRule[]>,
  words: readonly string[] | undefined,
  rule: RelatedRule,
): void {
  for (const word of words ?? []) {
    const list = map.get(word)
    if (list) {
      if (!list.includes(rule)) list.push(rule)
    } else map.set(word, [rule])
  }
}

export function buildRelatedIndex(rules: readonly RelatedRule[]): RelatedIndex {
  const books = new Map<RelatedBook, {
    categories: Map<string, RelatedRule[]>
    names: Map<string, RelatedRule[]>
    subjects: Map<string, RelatedRule[]>
    fallback: RelatedRule[]
  }>()
  const context: RelatedRule[] = []

  for (const rule of rules) {
    if ('context' in rule.origin) {
      context.push(rule)
      continue
    }
    let book = books.get(rule.book)
    if (!book) {
      book = {
        categories: new Map(),
        names: new Map(),
        subjects: new Map(),
        fallback: [],
      }
      books.set(rule.book, book)
    }
    for (const match of rule.origin.any) {
      appendIndex(book.categories, match.categories, rule)
      appendIndex(book.names, match.names?.map(normalizeItemName), rule)
      appendIndex(book.subjects, match.subjects, rule)
      if (match.categories === undefined
        && match.names === undefined
        && match.subjects === undefined
        && !book.fallback.includes(rule)) {
        book.fallback.push(rule)
      }
    }
  }
  return { books, context }
}

function modeMatches(
  modes: readonly ProjectMode[] | undefined,
  projectMode: ProjectMode | undefined,
): boolean {
  return modes === undefined
    || projectMode === undefined
    || projectMode === '混在'
    || modes.includes(projectMode)
}

function originMatches(
  match: RelatedOriginMatch,
  fixture: CountFixture,
  projectMode: ProjectMode | undefined,
  work: WorkType | undefined,
): boolean {
  return (match.categories === undefined || match.categories.includes(fixture.category))
    && (match.names === undefined || match.names.some(name =>
      normalizeItemName(name) === normalizeItemName(fixture.name)))
    && (match.subjects === undefined
      || (fixture.breakdown !== undefined
        && match.subjects.includes(fixture.breakdown.subject)))
    && (match.works === undefined
      || match.works.includes(work === undefined ? UNSET_WORK : work))
    && modeMatches(match.modes, projectMode)
}

function candidatesFor(index: RelatedIndex, fixture: CountFixture): RelatedRule[] {
  const result = new Set<RelatedRule>()
  for (const [name, book] of index.books) {
    if (fixture.breakdown && fixture.breakdown.book !== name) continue
    for (const rule of book.categories.get(fixture.category) ?? []) result.add(rule)
    for (const rule of book.names.get(normalizeItemName(fixture.name)) ?? []) {
      result.add(rule)
    }
    for (const rule of book.subjects.get(fixture.breakdown?.subject ?? '') ?? []) {
      result.add(rule)
    }
    for (const rule of book.fallback) result.add(rule)
  }
  return [...result]
}

function targetKey(target: RelatedTarget): string {
  return JSON.stringify([target.category, target.name ?? ''])
}

function canonicalTargets(targets: readonly RelatedTarget[]): RelatedTarget[] {
  const byKey = new Map(targets.map(target => [targetKey(target), target]))
  return [...byKey].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([, target]) => target)
}

function emptySuggestion(rule: RelatedRule, key: string): RelatedSuggestion {
  return {
    key,
    kind: rule.kind,
    role: rule.role,
    assembly: rule.assembly,
    oneOf: rule.oneOf,
    ruleIds: [rule.id],
    originFixtureIds: [],
    book: rule.book,
    priority: rule.priority,
    targets: [],
    targetTexts: rule.targetText ? [rule.targetText] : [],
    questions: rule.question ? [rule.question] : [],
    notes: rule.note ? [rule.note] : [],
    refs: unique(rule.refs),
    ...(rule.kind === 'check' && rule.create ? { create: { ...rule.create } } : {}),
    registeredCount: 0,
    flags: {},
  }
}

function registerCheck(
  suggestion: RelatedSuggestion,
  fixtures: readonly CountFixture[],
): RelatedSuggestion {
  if (suggestion.kind !== 'check' || !suggestion.create) return suggestion
  const name = normalizeItemName(suggestion.create.name)
  suggestion.registeredCount = fixtures.filter(fixture =>
    normalizeItemName(fixture.name) === name).length
  if (suggestion.registeredCount > 0) suggestion.flags.registered = true
  return suggestion
}

function mergeRule(
  suggestion: RelatedSuggestion,
  rule: RelatedRule,
  fixtureId: string,
): void {
  suggestion.ruleIds = unique([...suggestion.ruleIds, rule.id]).sort()
  suggestion.originFixtureIds = unique([...suggestion.originFixtureIds, fixtureId])
  suggestion.targetTexts = unique([
    ...suggestion.targetTexts,
    ...(rule.targetText ? [rule.targetText] : []),
  ])
  suggestion.questions = unique([
    ...suggestion.questions,
    ...(rule.question ? [rule.question] : []),
  ])
  suggestion.notes = unique([
    ...suggestion.notes,
    ...(rule.note ? [rule.note] : []),
  ])
  suggestion.refs = unique([...suggestion.refs, ...rule.refs])
  suggestion.role ??= rule.role
  suggestion.assembly ??= rule.assembly
  suggestion.oneOf ??= rule.oneOf
  if (rule.priority === '高') suggestion.priority = '高'
}

export function withRelatedDecisions(
  suggestions: readonly RelatedSuggestion[],
  decisions: Readonly<Record<string, RelatedDecision>>,
): RelatedSuggestion[] {
  return suggestions.map(suggestion => ({
    ...suggestion,
    decision: decisions[suggestion.key],
  })).sort((a, b) => {
    const decision = Number(a.decision !== undefined) - Number(b.decision !== undefined)
    if (decision) return decision
    const priority = Number(a.priority === '中') - Number(b.priority === '中')
    if (priority) return priority
    const rank = { item: 0, check: 1, note: 2, hint: 3 }
    const kind = rank[a.kind] - rank[b.kind]
    if (kind) return kind
    const left = a.ruleIds[0] ?? a.key, right = b.ruleIds[0] ?? b.key
    return left < right ? -1 : left > right ? 1 : 0
  })
}

export function suggestRelated(input: RelatedInput): RelatedSuggestion[] {
  const {
    index, fixtures, originIds, projectMode, works, decisions, resolveTarget,
  } = input
  const fixtureById = new Map(fixtures.map(fixture => [fixture.id, fixture]))
  const origins = unique(originIds)
    .map(id => fixtureById.get(id))
    .filter((fixture): fixture is CountFixture => fixture !== undefined)
  const suggestions = new Map<string, RelatedSuggestion>()
  const resolved = new Map<string, readonly RelatedCatalogItem[]>()

  for (const fixture of origins) {
    const work = works[fixture.id]
    for (const rule of candidatesFor(index, fixture)) {
      if (!('any' in rule.origin)
        || !modeMatches(rule.modes, projectMode)
        || !rule.origin.any.some(match =>
          originMatches(match, fixture, projectMode, work))) continue

      const targets = canonicalTargets(rule.targets)
      // 分野・品目作業・起点を含め、同じ起点の候補だけを集約する。
      const baseKey = rule.kind === 'item'
        ? `item:${JSON.stringify([
          rule.book,
          targets.map(target => [target.category, target.name ?? '']),
          work ?? '',
        ])}`
        : `${rule.kind}:${rule.id}`
      const key = `${baseKey}@${fixture.id}`
      const existing = suggestions.get(key)
      if (existing) {
        mergeRule(existing, rule, fixture.id)
        continue
      }

      const suggestion = emptySuggestion(rule, key)
      suggestion.originFixtureIds = [fixture.id]
      if (projectMode === undefined) suggestion.flags.modeUnknown = true
      if (rule.kind === 'item') {
      const registeredIds = new Set<string>()
      suggestion.targets = targets.map(target => {
        const resolutionKey = JSON.stringify([rule.book, targetKey(target)])
        let candidates = resolved.get(resolutionKey)
        if (candidates === undefined) {
          candidates = [...resolveTarget(target, rule.book)]
          resolved.set(resolutionKey, candidates)
        }
        if (!candidates.length) suggestion.flags.unresolved = true
        const targetName = target.name === undefined
          ? undefined : normalizeItemName(target.name)
        const matches = fixtures.filter(registered =>
          registered.category === target.category
          && (targetName === undefined
            || normalizeItemName(registered.name) === targetName))
        matches.forEach(registered => registeredIds.add(registered.id))
        return {
          ...target,
          candidates,
          registeredCount: matches.length,
        }
      })
      suggestion.registeredCount = registeredIds.size
      if (registeredIds.size) suggestion.flags.registered = true
      } else registerCheck(suggestion, fixtures)
      suggestions.set(key, suggestion)
    }
  }

  const needsWork = projectMode !== undefined
    && ['改修', '撤去', '解体', '混在'].includes(projectMode)
    ? origins.filter(fixture => works[fixture.id] === undefined)
    : []
  if (needsWork.length) {
    const book = needsWork[0].breakdown?.book
    suggestions.set('hint:work', {
      key: 'hint:work',
      kind: 'hint',
      ruleIds: [],
      originFixtureIds: needsWork.map(fixture => fixture.id),
      book: book === '電気設備' || book === '機械設備' ? book : '建築',
      priority: '中',
      targets: [],
      targetTexts: ['品目作業を選ぶと関連の候補が増えます'],
      questions: [],
      notes: [],
      refs: [],
      registeredCount: 0,
      flags: {},
    })
  }

  return withRelatedDecisions([...suggestions.values()], decisions)
}

export function contextChecks({
  index,
  projectMode,
  decisions,
  fixtures = [],
}: {
  index: RelatedIndex
  projectMode?: ProjectMode
  decisions: Readonly<Record<string, RelatedDecision>>
  fixtures?: readonly CountFixture[]
}): RelatedSuggestion[] {
  if (projectMode === undefined) return []
  const suggestions = index.context.filter(rule =>
    'context' in rule.origin
    && (projectMode === '混在' || rule.origin.context.includes(projectMode))
    && modeMatches(rule.modes, projectMode))
    .map(rule => {
      // 案件区分の確認事項は、拾い候補のルールも確認事項として扱う（キーは R1 以来の check:）。
      const kind = rule.kind === 'note' ? 'note' as const : 'check' as const
      return registerCheck({ ...emptySuggestion(rule, `${kind}:${rule.id}`), kind }, fixtures)
    })
  return withRelatedDecisions(suggestions, decisions)
}
