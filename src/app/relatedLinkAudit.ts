import type { CatalogItem } from '../core/catalog'
import {
  quantityKind,
  quantityMethod,
  type CountFixture,
  type QuantityKind,
  type QuantityMethod,
} from '../core/countFixtures'
import {
  fixtureLinkSources,
  type FixtureLink,
} from '../core/fixtureLink'
import {
  LINK_RULES,
  type LinkRule,
} from '../core/breakdown/linkRules'
import { normalizeItemName } from '../core/related/suggest'
import type { RelatedRule } from '../core/related/types'
import type {
  MasterDefinition,
  RuleScope,
  TakeoffMaster,
  TakeoffRuleScopes,
  TextRef,
} from '../core/takeoff/types'

export type AuditVerdict = 'OK' | 'ERROR' | 'REVIEW'

export interface AuditRow {
  ruleId: string
  book: string
  originText: string
  targetText: string
  classId: string
  definitions: string
  excelTarget: string
  excelDifference: string
  excelUnit: string
  originItem: string
  originMethod: string
  targetItem: string
  targetKind: string
  link: string
  sources: string
  verdict: AuditVerdict
  reasons: string[]
}

export interface RelatedLinkAuditInput {
  rules: readonly RelatedRule[]
  scopes: TakeoffRuleScopes
  master: TakeoffMaster
  catalogItems: readonly CatalogItem[]
  toFixture(item: CatalogItem, optionKey?: string): CountFixture
  plan(
    ruleIds: readonly string[],
    origin: CountFixture,
    target: CountFixture,
    projectMode?: string,
  ): {
    kind: string
    link?: FixtureLink
    placement?: 'route' | 'component' | 'point'
    reason?: string
  }
  existingKind(
    origin: CountFixture,
    target: CountFixture,
  ): string | undefined
}

type JsonObject = Readonly<Record<string, unknown>>
type AuditPart = '壁' | '床' | '天井' | '屋根' | '建具' | '経路' | '線材'

interface Candidate {
  fixture: CountFixture
  inCatalog: boolean
}

interface DefinitionEntry {
  id: string
  definition: MasterDefinition | undefined
}

interface Observation {
  label: string
  raw: JsonObject | undefined
}

interface Expectation {
  label: string
  /** 標準規則は独自の元選択を持ち、起点名称による制限の対象外。 */
  standard?: true
  accepts(actual: Observation): boolean
}

interface ExpectedInput {
  rule: RelatedRule
  classId: string
  source: string
  origin: CountFixture
  target: CountFixture
  mode: '改修' | '新築'
}

const FALLBACK_METHODS: readonly QuantityMethod[] = [
  'click',
  'polyline',
  'polygon',
  'lengthHeight',
]

function object(value: unknown): JsonObject | undefined {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    ? value as JsonObject : undefined
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function canonical(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize)
    const record = object(entry)
    if (!record) return entry
    return Object.fromEntries(
      Object.keys(record)
        .filter(key => record[key] !== undefined)
        .sort()
        .map(key => [key, normalize(record[key])]),
    )
  }
  return JSON.stringify(normalize(value)) ?? 'undefined'
}

function resolveText(
  scopes: TakeoffRuleScopes,
  value: TextRef | undefined,
): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return scopes.texts[value] ?? `未解決テキスト#${value}`
}

function originalSource(excelTarget: string): string {
  const marker = /元指定[：:]/u.exec(excelTarget)
  return marker
    ? excelTarget.slice(marker.index + marker[0].length).trim()
    : ''
}

/*
 * 点検専用の期待表。
 * relatedLinkRules・linkFromRule・その定数やヘルパーを使用しない。
 * 標準規則そのものの仕様データだけ LINK_RULES から参照する。
 */
function auditPart(fixture: CountFixture): AuditPart | undefined {
  const value = `${fixture.name} ${fixture.category}`
  if (quantityMethod(fixture) === 'polyline') {
    if (/幅木|巾木|見切|目地|シール/u.test(value)) return '線材'
    if (/管|ケーブル|ダクト|配線|ラック/u.test(value)) return '経路'
  }
  if (/建具|扉|ドア|窓|出入口/u.test(value)) return '建具'
  if (/壁|間仕切/u.test(value)) return '壁'
  if (/床/u.test(value)) return '床'
  if (/天井/u.test(value)) return '天井'
  if (/屋根|屋上/u.test(value)) return '屋根'
  return undefined
}

function literalExpected(label: string): Expectation {
  return { label, accepts: actual => actual.label === label }
}

function noQuantity(): Expectation {
  return literalExpected('NONE')
}

function linkedSourcesValid(raw: JsonObject, origin: CountFixture): boolean {
  const sources = array(raw.sources)
  const auto = object(raw.auto)

  if (auto) return sources.length === 0
  const source = object(sources[0])
  return sources.length === 1 && source?.itemId === origin.id
}

function expectedFactor(
  origin: CountFixture,
  output: 'area' | 'length' | 'outerCircumference',
): Expectation {
  const label = `factor(${output})`
  return {
    label,
    accepts: actual =>
      actual.label === label
      && actual.raw !== undefined
      && (actual.raw.factor ?? 1) === 1
      && linkedSourcesValid(actual.raw, origin)
      && array(actual.raw.sources).every(value =>
        (object(value)?.factor ?? 1) === 1
        && (object(value)?.sign ?? 1) === 1),
  }
}

function expectedShape(
  origin: CountFixture,
  shape: JsonObject,
  factor = 1,
): Expectation {
  const label = `shape:${String(shape.output)}`
  return {
    label: `${label} ${canonical(shape)} ×${factor}`,
    accepts: actual =>
      actual.label === label
      && actual.raw !== undefined
      && canonical(actual.raw.shape) === canonical(shape)
      && (actual.raw.factor ?? 1) === factor
      && linkedSourcesValid(actual.raw, origin)
      && array(actual.raw.sources).every(value =>
        (object(value)?.factor ?? 1) === factor
        && (object(value)?.sign ?? 1) === 1
        && object(value)?.factorFrom === undefined),
  }
}

function standardExpected(
  id: string | undefined,
  target: CountFixture,
): Expectation {
  const rule = LINK_RULES.find(candidate => candidate.id === id)
  if (!rule) return noQuantity()

  // linkRules の契約: steel の {} は全鉄骨部材。その他の {} は手動選択。
  const automatic = rule.kind === 'steel'
    || Object.values(rule.auto).some(value => value !== undefined)
  if (!automatic) return noQuantity()

  const kind = rule.waste ? 'mass' : rule.kind
  const expected: Record<string, unknown> = {
    kind,
    sources: [],
    auto: structuredClone(rule.auto),
  }

  if (kind === 'factor' && rule.factor !== undefined) {
    expected.factor = rule.factor
  }
  if (kind === 'rc') {
    const output = rule.rc?.output
      ?? (target.name.includes('鉄筋') ? 'rebar'
        : target.name.includes('型枠') ? 'formwork'
          : target.name.includes('圧接') ? 'gasJoint'
            : target.name.includes('重ね継手') ? 'lapJoint' : 'concrete')
    expected.rc = {
      ...rule.rc,
      output,
      ...(output === 'rebar' ? {
        basis: /加工組立|運搬/u.test(target.name)
          ? 'design' : rule.rc?.basis ?? 'required',
      } : {}),
    }
  }
  if (kind === 'shape') {
    expected.shape = { output: 'area', ...rule.shape }
  }
  if (kind === 'crossing') expected.crossing = { ...rule.crossing }
  if (kind === 'steel') {
    expected.steel = { output: 'mass', ...rule.steel }
  }

  return {
    label: `STD(${rule.id}):${quantityLabel(expected, target)}`,
    standard: true,
    accepts: actual => canonical(actual.raw) === canonical(expected),
  }
}

function namedStandardExpected(
  target: CountFixture,
  allowedIds: readonly string[],
): Expectation {
  const rule: LinkRule | undefined = LINK_RULES.find(candidate =>
    allowedIds.includes(candidate.id)
    && candidate.details.includes(target.name))
  return standardExpected(rule?.id, target)
}

function expectedRouteLength(
  origin: CountFixture,
  target: CountFixture,
): Expectation {
  if (auditPart(origin) !== '経路' || quantityKind(target) !== 'length') {
    return noQuantity()
  }
  return quantityMethod(target) === 'polyline'
    ? literalExpected('route')
    : expectedFactor(origin, 'length')
}

function expectedRouteSurface(
  origin: CountFixture,
  target: CountFixture,
): Expectation {
  if (auditPart(origin) !== '経路') return noQuantity()
  if (quantityKind(target) === 'length') {
    return expectedRouteLength(origin, target)
  }
  if (quantityKind(target) !== 'area') return noQuantity()

  const description = `${origin.name} ${origin.category}`
  if (/ダクト/u.test(description)) return literalExpected('route')
  return /管/u.test(description)
    ? expectedFactor(origin, 'outerCircumference')
    : noQuantity()
}

function expectedBaseEdge(
  origin: CountFixture,
  target: CountFixture,
  onlyFloor: boolean,
): Expectation {
  if (quantityKind(target) !== 'length') return noQuantity()

  const method = quantityMethod(origin)
  if (!onlyFloor && auditPart(origin) === '壁'
    && (method === 'polygon' || method === 'lengthHeight'
      || method === 'polyline')) {
    return expectedShape(
      origin,
      { output: 'baseLength', deductDoorWidths: true },
      2,
    )
  }
  return auditPart(origin) === '床' && method === 'polygon'
    ? expectedShape(origin, { output: 'perimeter' })
    : noQuantity()
}

/** 原本の分類・ルールの部位の品目群から、同じ面の部位を決める（提案先の名称は使わない）。 */
function auditRulePart(ruleId: string, classId: string): AuditPart | undefined {
  const byClass: Record<string, AuditPart> = {
    FLOOR: '床', CEILING_FINISH: '天井', ROOF: '屋根', WALL_FINISH: '壁', FIRE_ASSEMBLY: '壁',
  }
  if (byClass[classId]) return byClass[classId]
  if (/^A-(?:exterior-)?wall-/u.test(ruleId)) return '壁'
  if (/^A-floor-/u.test(ruleId)) return '床'
  if (/^A-ceiling-/u.test(ruleId)) return '天井'
  if (/^A-roof-/u.test(ruleId)) return '屋根'
  return undefined
}

function expectedSameFace(
  ruleId: string,
  classId: string,
  origin: CountFixture,
  target: CountFixture,
): Expectation {
  const facePart = auditRulePart(ruleId, classId)
  const named = auditPart(origin)
  const originPart = named ?? (quantityMethod(origin) === 'polyline' ? undefined : facePart)
  if (
    facePart === undefined
    || originPart !== facePart
    || quantityKind(target) !== 'area'
  ) {
    return noQuantity()
  }

  const method = quantityMethod(origin)
  if (originPart === '壁' && method === 'polyline') {
    return expectedShape(origin, {
      output: 'lengthTimesHeight',
      lengthBasis: 'baseEdge',
    })
  }

  return (method === 'polygon' || method === 'lengthHeight')
    && quantityKind(origin) === 'area'
    ? expectedFactor(origin, 'area')
    : noQuantity()
}

function expectation(input: ExpectedInput): Expectation {
  const { rule, classId, source, origin, target, mode } = input
  const id = rule.id

  // 保存済みの連動は、none を含むどの追加計画でも削除しない。
  if (target.link !== undefined) {
    return {
      label: `existing-link:${quantityLabel(object(target.link), origin)}`,
      accepts: actual => canonical(actual.raw) === canonical(target.link),
    }
  }
  if (origin.id === target.id || origin.link !== undefined) return noQuantity()

  switch (classId) {
    case 'RECORD':
    case 'PLAN':
    case 'PROTECT':
    case 'PROTECT_ACTUAL':
    case 'SCAFFOLD':
    case 'OPEN_REINF':
    case 'VOLUME':
    case 'WALL_FRAME':
    case 'CEILING_FRAME':
    case 'HANGING':
    case 'EXIST_FACE':
    case 'EXIST_POINT':
    case 'LINE':
      return noQuantity()

    case 'BRANCH':
      if (['M-043', 'M-090', 'M-104'].includes(id)) {
        return expectedRouteLength(origin, target)
      }
      return id === 'B-170'
        ? expectedBaseEdge(origin, target, true)
        : noQuantity()

    case 'DETAIL':
      return id === 'B-043'
        ? standardExpected('formwork-transport', target)
        : noQuantity()

    case 'CONTACT':
      return id === 'B-037'
        ? namedStandardExpected(target, [
          'formwork-foundation',
          'formwork-body',
        ])
        : noQuantity()

    case 'MATERIAL':
      return ['B-038', 'B-044', 'B-045'].includes(id)
        ? namedStandardExpected(target, ['rebar-required', 'rebar-assembly'])
        : noQuantity()

    case 'WASTE':
      return namedStandardExpected(target, ['waste'])

    case 'OPENING':
      return ['M-055', 'M-103'].includes(id)
        ? standardExpected('fire-penetration', target)
        : noQuantity()

    case 'SURFACE':
      if (id === 'B-054') return standardExpected('steel-paint', target)
      if (id === 'B-055') return standardExpected('steel-fireproof', target)
      return noQuantity()

    case 'MARK':
      if (
        !['A-ceiling-01', 'A-wall-01', 'A-floor-01'].includes(id)
        || mode === '新築'
        || auditPart(origin) !== '壁'
        || quantityKind(target) !== 'area'
        || !['polyline', 'lengthHeight', 'polygon']
          .includes(quantityMethod(origin))
      ) {
        return noQuantity()
      }
      return expectedShape(origin, {
        output: 'lengthTimesHeight',
        heightM: 1,
        lengthBasis: 'baseEdge',
      })

    case 'FILTER_ROUTE':
      return ['E-020', 'M-010', 'M-011'].includes(id)
        ? expectedRouteSurface(origin, target)
        : noQuantity()

    case 'ROUTE':
    case 'UNIQUE_ROUTE':
      return ['E-001', 'E-002', 'E-121'].includes(id)
        ? expectedRouteLength(origin, target)
        : noQuantity()

    case 'ENDPOINT':
      return id === 'E-009'
        && auditPart(origin) === '経路'
        && quantityMethod(target) === 'click'
        && quantityKind(target) === 'count'
        ? literalExpected('point') : noQuantity()

    case 'POINT':
      return ['E-034', 'E-039', 'M-013', 'B-028'].includes(id)
        && quantityMethod(origin) === 'click'
        && quantityKind(origin) === 'count'
        && quantityMethod(target) === 'click'
        && quantityKind(target) === 'count'
        ? literalExpected('component') : noQuantity()

    case 'BASEBOARD':
      return ['B-111', 'A-wall-21', 'A-floor-29'].includes(id)
        ? expectedBaseEdge(origin, target, false)
        : noQuantity()

    case 'JOINT':
      return ['B-134', 'A-ceiling-19'].includes(id)
        && auditPart(origin) === '天井'
        && quantityMethod(origin) === 'polygon'
        && quantityKind(target) === 'length'
        ? expectedShape(origin, { output: 'perimeter' })
        : noQuantity()

    case 'CORNER':
    case 'BACKFILL':
      return noQuantity()

    case 'UPSTAND':
      return id === 'A-roof-waterproof-27'
        && (auditPart(origin) === '屋根' || auditPart(origin) === '床')
        && quantityMethod(origin) === 'polygon'
        && quantityKind(target) === 'area'
        ? expectedShape(origin, { output: 'lengthTimesHeight' })
        : noQuantity()
  }

  if (classId === 'AREA' && id === 'B-096') {
    return standardExpected('glass', target)
  }

  const sameFaceClass = [
    'FLOOR',
    'CEILING_FINISH',
    'ROOF',
    'AREA',
    'WALL_FINISH',
  ].includes(classId)
  const sameFaceSource = source.startsWith(
    '元施工面のうち同一部位・同一面側の対象範囲だけ',
  )
  const wallSource = source.startsWith(
    '壁の対象面側ごとに施工線長×対象高さ',
  )

  if (
    (sameFaceClass && sameFaceSource)
    || (classId === 'FLOOR' && id === 'B-118'
      && source.startsWith('表面仕上げ対象面'))
    || ((classId === 'WALL_FINISH' || classId === 'FIRE_ASSEMBLY')
      && wallSource)
  ) {
    return expectedSameFace(id, classId, origin, target)
  }

  return noQuantity()
}

function quantityLabel(
  raw: JsonObject | undefined,
  origin: CountFixture,
): string {
  if (!raw) return 'NONE'
  const kind = text(raw.kind)
  if (kind === 'factor') {
    const sources = array(raw.sources)
    const auto = object(raw.auto)
    const values: unknown[] = sources.map(value => object(value)?.factorFrom)
    if (auto) values.push(auto.factorFrom)
    if (values.length === 0) values.push(undefined)

    const labels = [...new Set(values.map(value =>
      value === undefined || value === null
        ? quantityKind(origin) : String(value)))]
    return `factor(${labels.sort().join('+')})`
  }
  if (kind === 'shape') {
    return `shape:${String(object(raw.shape)?.output ?? '不明')}`
  }
  if (kind === 'perimeter') return 'shape:perimeter'
  if (kind === 'rc') return `rc:${String(object(raw.rc)?.output ?? '不明')}`
  if (kind === 'steel') {
    return `steel:${String(object(raw.steel)?.output ?? '不明')}`
  }
  return kind ?? '不明'
}

function observation(
  plan: ReturnType<RelatedLinkAuditInput['plan']>,
  origin: CountFixture,
  target: CountFixture,
  existingKind: RelatedLinkAuditInput['existingKind'],
): Observation {
  // Store は既存の連動を削除・上書きしない。
  if (target.link !== undefined) {
    const raw = object(target.link)
    return { raw, label: quantityLabel(raw, origin) }
  }

  if (plan.kind === 'none') return { label: 'NONE', raw: undefined }
  if (plan.kind === 'placement') {
    return {
      label: plan.placement ?? '不明な配置',
      raw: { kind: plan.placement ?? '不明な配置' },
    }
  }
  if (plan.kind === 'link') {
    if (!plan.link) throw new Error('kind=link ですが link がありません。')
    const raw = object(plan.link)
    return { raw, label: quantityLabel(raw, origin) }
  }
  if (plan.kind === 'existing-link') {
    return { label: '既存連動なしのexisting-link', raw: undefined }
  }
  if (plan.kind === 'existing') {
    // 古いフォールバックを注入した点検でも、配置を数量として検出する。
    const kind = existingKind(origin, target)
    if (!kind) return { label: 'NONE', raw: undefined }
    const raw: JsonObject = kind === 'factor'
      ? { kind, sources: [{ itemId: origin.id, factor: 1 }] }
      : kind === 'perimeter'
        ? {
          kind: 'shape',
          shape: { output: 'perimeter' },
          sources: [{ itemId: origin.id }],
        }
        : { kind }
    return { raw, label: quantityLabel(raw, origin) }
  }
  throw new Error(`未対応の関連連動計画: ${plan.kind}`)
}

function selectedSourceItems(
  plan: ReturnType<RelatedLinkAuditInput['plan']>,
  target: CountFixture,
  origins: readonly CountFixture[],
): readonly CountFixture[] {
  const link = target.link ?? (plan.kind === 'link' ? plan.link : undefined)
  if (!link) return []

  const linkedTarget: CountFixture = { ...target, link }
  const ids = new Set(
    fixtureLinkSources([...origins, linkedTarget], linkedTarget)
      .map(source => source.itemId),
  )
  return origins.filter(origin => ids.has(origin.id))
}

function doubleCountNames(
  origin: CountFixture,
  selected: readonly CountFixture[],
): string[] {
  const removal = origin.name.includes('撤去')
  return [...new Set(selected
    .filter(item =>
      !item.name.includes(origin.name)
      || item.name.includes('撤去') !== removal)
    .map(item => item.name))]
}

function sourceSummary(
  actual: Observation,
  originId: string,
  selected: readonly CountFixture[],
): string {
  if (!actual.raw) return 'なし'
  if (['route', 'component', 'point'].includes(actual.label)) {
    return `配置（${actual.label}）`
  }

  const auto = object(actual.raw.auto)
  const sources = array(actual.raw.sources)
  const condition = auto
    ? `auto（${JSON.stringify(auto)}）`
    : sources.length === 1 && object(sources[0])?.itemId === originId
      ? '押した項目だけ'
      : sources.length ? `指定項目（${sources.length}件）` : 'なし'
  const names = [...new Set(selected.map(item => item.name))]
  const sample = names.slice(0, 5).join('・')
  const remaining = names.length > 5 ? `、ほか${names.length - 5}名称` : ''
  return `${condition}／点検で元になった品目：${sample || 'なし'}${remaining}`
}

function itemOptionKeys(item: CatalogItem): readonly (string | undefined)[] {
  const options = object(item)?.options
  const keys: Array<string | undefined> = [undefined]
  if (Array.isArray(options)) {
    options.forEach((value: unknown, index: number) => {
      const entry = object(value)
      keys.push(
        text(entry?.key)
        ?? text(entry?.id)
        ?? text(entry?.value)
        ?? (typeof value === 'string' ? value : String(index)),
      )
    })
  } else {
    const entries = object(options)
    if (entries) keys.push(...Object.keys(entries))
  }
  return [...new Set(keys)]
}

function inBook(item: CatalogItem, book: RelatedRule['book']): boolean {
  return item.field === book
    || (book === '建築' && item.field === '仮設・土工')
}

function sameName(left: string, right: string): boolean {
  return normalizeItemName(left) === normalizeItemName(right)
}

function kindForMethod(method: QuantityMethod): QuantityKind {
  switch (method) {
    case 'click': return 'count'
    case 'polyline': return 'length'
    case 'polygon':
    case 'lengthHeight': return 'area'
    case 'polygonDepth':
    case 'lengthWidthDepth': return 'volume'
  }
}

function kindForUnit(unit: string): QuantityKind | undefined {
  const value = unit.trim()
  if (/^(?:㎡|m²|m2)(?:$|[\s（(])/u.test(value)) return 'area'
  if (/^(?:㎥|m³|m3)(?:$|[\s（(])/u.test(value)) return 'volume'
  if (/^m(?:$|[\s（(])/u.test(value)) return 'length'
  if (/^(?:式|か所|箇所|個|台|本|組)(?:$|[\s（(])/u.test(value)) {
    return 'count'
  }
  return undefined
}

function defaultMethod(kind: QuantityKind): QuantityMethod {
  switch (kind) {
    case 'count': return 'click'
    case 'length': return 'polyline'
    case 'area': return 'polygon'
    case 'volume': return 'polygonDepth'
  }
}

function syntheticFixture(
  name: string,
  category: string,
  method: QuantityMethod,
  unit?: string,
): CountFixture {
  return {
    id: 'audit-synthetic',
    name,
    code: '',
    category,
    style: {} as CountFixture['style'],
    order: 0,
    kind: kindForMethod(method),
    method,
    ...(unit === undefined ? {} : { unit: unit as CountFixture['unit'] }),
  }
}

function targetFallbackKind(
  scope: RuleScope | undefined,
  scopes: TakeoffRuleScopes,
  definitions: readonly DefinitionEntry[],
): QuantityKind {
  const scopeKind = kindForUnit(resolveText(scopes, scope?.unit))
  if (scopeKind) return scopeKind
  const kinds = [...new Set(definitions
    .map(entry => entry.definition && kindForUnit(entry.definition.unit))
    .filter((kind): kind is QuantityKind => kind !== undefined))]
  return kinds.length === 1 ? kinds[0]! : 'count'
}

export function auditRelatedLinks(input: RelatedLinkAuditInput): AuditRow[] {
  const rows: AuditRow[] = []
  const definitionIndex = new Map(
    input.master.definitions.map(definition => [definition.id, definition]),
  )
  const cache = new Map<CatalogItem, readonly Candidate[]>()

  const variants = (item: CatalogItem): readonly Candidate[] => {
    const cached = cache.get(item)
    if (cached) return cached
    const byMethod = new Map<QuantityMethod, Candidate>()
    for (const key of itemOptionKeys(item)) {
      const fixture = input.toFixture(item, key)
      const method = quantityMethod(fixture)
      if (!byMethod.has(method)) {
        byMethod.set(method, { fixture, inCatalog: true })
      }
    }
    const result = [...byMethod.values()]
    cache.set(item, result)
    return result
  }

  const originsFor = (rule: RelatedRule): readonly Candidate[] => {
    const result = new Map<string, Candidate>()
    const catalog = input.catalogItems.filter(item => inBook(item, rule.book))
    const addMissing = (name: string, category: string): void => {
      for (const method of FALLBACK_METHODS) {
        result.set(`missing:${normalizeItemName(name)}:${category}:${method}`, {
          fixture: syntheticFixture(name, category, method),
          inCatalog: false,
        })
      }
    }

    if ('context' in rule.origin) {
      addMissing(rule.originText, '')
      return [...result.values()]
    }

    for (const match of rule.origin.any) {
      const matching = catalog.filter(item =>
        (match.categories === undefined
          || match.categories.includes(item.category))
        && (match.names === undefined
          || match.names.some(name => sameName(item.name, name))))
      const representatives = new Set<string>()

      for (const item of matching) {
        for (const candidate of variants(item)) {
          if (match.subjects !== undefined
            && !match.subjects.includes(candidate.fixture.breakdown?.subject ?? '')) {
            continue
          }
          const method = quantityMethod(candidate.fixture)
          const key = match.names === undefined
            ? `${item.category}:${method}`
            : `${normalizeItemName(item.name)}:${method}`
          if (representatives.has(key)) continue
          representatives.add(key)
          result.set(`${input.catalogItems.indexOf(item)}:${method}`, candidate)
        }
      }

      if (match.names !== undefined) {
        for (const name of match.names) {
          const found = matching.some(item =>
            sameName(item.name, name)
            && variants(item).some(candidate =>
              match.subjects === undefined
              || match.subjects.includes(candidate.fixture.breakdown?.subject ?? '')))
          if (!found) addMissing(name, match.categories?.join('・') ?? '')
        }
      } else if (matching.length === 0) {
        for (const category of match.categories?.length ? match.categories : ['']) {
          addMissing(rule.originText || category, category)
        }
      }
    }

    if (result.size === 0) addMissing(rule.originText, '')
    return [...result.values()]
  }

  const targetsFor = (
    rule: RelatedRule,
    scope: RuleScope | undefined,
    definitions: readonly DefinitionEntry[],
  ): readonly Candidate[] => {
    if (rule.kind === 'check' && rule.create) {
      return [{
        fixture: syntheticFixture(
          rule.create.name,
          '',
          defaultMethod(kindForUnit(rule.create.unit) ?? 'count'),
          rule.create.unit,
        ),
        inCatalog: false,
      }]
    }

    const result = new Map<string, Candidate>()
    for (const target of rule.targets) {
      const matching = input.catalogItems.filter(item =>
        inBook(item, rule.book)
        && item.category === target.category
        && (target.name === undefined || sameName(item.name, target.name)))
      const representatives = new Set<QuantityMethod>()
      for (const item of matching) {
        for (const candidate of variants(item)) {
          const method = quantityMethod(candidate.fixture)
          if (representatives.has(method)) continue
          representatives.add(method)
          result.set(`${input.catalogItems.indexOf(item)}:${method}`, candidate)
        }
      }
      if (matching.length === 0) {
        const kind = targetFallbackKind(scope, input.scopes, definitions)
        const name = target.name ?? target.category
        result.set(`missing:${target.category}:${name}:${kind}`, {
          fixture: syntheticFixture(name, target.category, defaultMethod(kind)),
          inCatalog: false,
        })
      }
    }
    if (result.size === 0) {
      const kind = targetFallbackKind(scope, input.scopes, definitions)
      result.set('missing-target', {
        fixture: syntheticFixture(
          rule.targetText || '提案先未登録',
          '',
          defaultMethod(kind),
        ),
        inCatalog: false,
      })
    }
    return [...result.values()]
  }

  for (const rule of input.rules) {
    if (rule.kind !== 'item'
      && !(rule.kind === 'check' && rule.create !== undefined)) {
      continue
    }

    const scope = input.scopes.rules[rule.id]
    const classId = scope?.classId ?? ''
    const definitions: readonly DefinitionEntry[] =
      [...new Set(scope?.definitions ?? [])].map(id => ({
        id,
        definition: definitionIndex.get(id),
      }))
    const excelTarget = resolveText(input.scopes, scope?.target)
    const excelDifference = resolveText(input.scopes, scope?.difference)
    const excelUnit = resolveText(input.scopes, scope?.unit)
    const source = originalSource(excelTarget)
    const origins = originsFor(rule)
    const targets = targetsFor(rule, scope, definitions)
    const originFixtures: readonly CountFixture[] = origins.map(
      (candidate, index) => ({
        ...candidate.fixture,
        id: `audit:${rule.id}:origin:${index}`,
      }),
    )

    for (const [originIndex, originCandidate] of origins.entries()) {
      for (const [targetIndex, targetCandidate] of targets.entries()) {
        for (const mode of ['改修', '新築'] as const) {
          const origin = originFixtures[originIndex]!
          const target: CountFixture = {
            ...targetCandidate.fixture,
            id: `audit:${rule.id}:target:${targetIndex}`,
          }
          const plan = input.plan([rule.id], origin, target, mode)
          const actual = observation(plan, origin, target, input.existingKind)
          const expected = expectation({
            rule, classId, source, origin, target, mode,
          })
          const matches = expected.accepts(actual)
          const selected = selectedSourceItems(plan, target, originFixtures)
          // 標準規則の独自条件と既存連動の保持は従来の期待表で検証する。
          // 新しく作る通常の連動は、実際に選ばれる全起点を別途検証する。
          const duplicateNames = plan.kind === 'link'
            && target.link === undefined
            && expected.standard !== true
            ? doubleCountNames(origin, selected)
            : []
          const details = [
            `原本分類=${classId || '分類なし'}`,
            `元指定=${source || '記載なし'}`,
            `期待=${expected.label}`,
            `実際=${actual.label}`,
            `起点=${quantityMethod(origin)}`,
            `提案先=${quantityKind(target)}`,
            `案件区分=${mode}`,
          ].join('、')
          const reasons: string[] = []
          if (!matches || duplicateNames.length === 0) {
            reasons.push(
              `${matches ? 'OK' : 'E12'}: `
              + `${matches ? '原本の期待と一致' : '原本の期待と不一致'}`
              + `（${details}）`
              + (plan.reason ? `。計画理由: ${plan.reason}` : ''),
            )
          }
          if (duplicateNames.length > 0) {
            reasons.push(
              'E9: 同じ部位の別の項目'
              + `（${duplicateNames.join('・')}）も元になり二重に数える`
              + `（起点=${origin.name}、${details}）`,
            )
          }

          rows.push({
            ruleId: rule.id,
            book: rule.book,
            originText: rule.originText,
            targetText: rule.targetText,
            classId,
            definitions: definitions.map(entry =>
              entry.definition
                ? `${entry.id}:${entry.definition.formula}:${entry.definition.unit}`
                : `${entry.id}:未登録:—`).join(';'),
            excelTarget,
            excelDifference,
            excelUnit,
            originItem: origin.name
              + (originCandidate.inCatalog ? '' : '（品目一覧に無い）')
              + `（${quantityMethod(origin)}）／${mode}`,
            originMethod: quantityMethod(origin),
            targetItem: target.name
              + (targetCandidate.inCatalog ? '' : '（品目一覧に無い）')
              + `（${quantityKind(target)}）`,
            targetKind: quantityKind(target),
            link: actual.label,
            sources: sourceSummary(actual, origin.id, selected),
            verdict: matches && duplicateNames.length === 0 ? 'OK' : 'ERROR',
            reasons,
          })
        }
      }
    }
  }

  return rows
}

const CSV_COLUMNS: readonly (keyof AuditRow)[] = [
  'ruleId',
  'book',
  'originText',
  'targetText',
  'classId',
  'definitions',
  'excelTarget',
  'excelDifference',
  'excelUnit',
  'originItem',
  'originMethod',
  'targetItem',
  'targetKind',
  'link',
  'sources',
  'verdict',
  'reasons',
]

function csvCell(value: string): string {
  const normalized = value.replace(/\r\n|\r|\n/gu, '\r\n')
  return `"${normalized.replace(/"/gu, '""')}"`
}

export function auditToCsv(rows: readonly AuditRow[]): string {
  return '\uFEFF' + [
    CSV_COLUMNS.map(csvCell).join(','),
    ...rows.map(row => CSV_COLUMNS.map(column => {
      const value = row[column]
      return csvCell(Array.isArray(value) ? value.join(' | ') : value)
    }).join(',')),
  ].join('\r\n') + '\r\n'
}

export function auditSummary(
  rows: readonly AuditRow[],
): Record<AuditVerdict, number> & { byReason: Record<string, number> } {
  const summary: Record<AuditVerdict, number> & {
    byReason: Record<string, number>
  } = { OK: 0, ERROR: 0, REVIEW: 0, byReason: {} }

  for (const row of rows) {
    summary[row.verdict] += 1
    const codes = new Set(row.reasons.map(reason =>
      /^((?:E|W)\d+|OK):/u.exec(reason)?.[1] ?? reason))
    for (const code of codes) {
      summary.byReason[code] = (summary.byReason[code] ?? 0) + 1
    }
  }
  return summary
}
