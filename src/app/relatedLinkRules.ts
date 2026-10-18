import {
  quantityKind,
  quantityMethod,
  type CountFixture,
} from '../core/countFixtures'
import { pipeSizeKeys } from '../core/backfill'
import type { FixtureLink, FixtureLinkSource } from '../core/fixtureLink'
import {
  LINK_RULES,
  linkRuleAuto,
  linkRuleForDetail,
  type LinkAutoSources,
  type LinkRule,
} from '../core/breakdown/linkRules'
import { linkFromRule } from '../core/breakdown/linkFromRule'
import type {
  ProjectMode,
  RelatedOriginMatch,
  RelatedRule,
} from '../core/related/types'
import type { TakeoffRuleScopes } from '../core/takeoff/types'
import type { RelatedAddContext } from './documentModel'

export type ScopePlacement = 'route' | 'component' | 'point'

export type ScopeLinkPlan =
  | { kind: 'none'; reason: string }
  | { kind: 'existing-link' }
  | { kind: 'placement'; placement: ScopePlacement }
  | { kind: 'link'; link: FixtureLink; note: string }

export interface ScopeRuleOptions {
  originMatch?: readonly RelatedOriginMatch[]
  projectMode?: ProjectMode
}

interface RuleSelection {
  ruleId: string | undefined
  classId: string | undefined
}

interface ScopeLinkContext extends ScopeRuleOptions {
  rules: readonly RuleSelection[]
}

/** 追加ダイアログまで持ち回る一時情報。文書には保存しない。 */
export type ScopedRelatedAddContext = RelatedAddContext & {
  scopeLink?: ScopeLinkContext
}

type Part =
  | 'wall'
  | 'floor'
  | 'ceiling'
  | 'roof'
  | 'door'
  | 'route'
  | 'linearMember'

type SourceKinds = NonNullable<LinkAutoSources['kinds']>

/*
 * 原本の元指定に基づく許可・例外。
 * 判定に原本テキストを使わない。テキストとの照合は独立した点検側で行う。
 */

// 子の定義 F_SUBSET m。長さの対象区間だけ。
const BRANCH_ROUTE_IDS = new Set(['M-043', 'M-090', 'M-104'])

// 子の定義 F_EDGE m。床の polygon の外周だけ。
const BRANCH_FLOOR_EDGE_IDS = new Set(['B-170'])

// 仮設/施工計画ごとの工区・範囲。許可する起点は壁だけ。
const WALL_MARK_IDS = new Set([
  'A-ceiling-01',
  'A-wall-01',
  'A-floor-01',
])

// 保温・塗装する対象区間。
const FILTER_ROUTE_IDS = new Set(['E-020', 'M-010', 'M-011'])

// 管内の対象区間、ラック経路、撤去する既存経路。
const ROUTE_IDS = new Set(['E-001', 'E-002', 'E-121'])

// 実際の接続端点。
const ENDPOINT_IDS = new Set(['E-009'])

// 起点1つに対象が1つと確定する現物。
const PER_ORIGIN_IDS = new Set(['E-034', 'E-039', 'M-013', 'B-028'])

// 壁際の幅木施工辺、元部位に対応する幅木施工辺。
const BASEBOARD_IDS = new Set(['B-111', 'A-wall-21', 'A-floor-29'])

// 壁際見切縁・廻り縁、天井廻り縁。天井の polygon の外周だけ。
const CEILING_PERIMETER_IDS = new Set(['B-134', 'A-ceiling-19'])

// 立上りを施工する辺と高さを区間別に指定。
const UPSTAND_IDS = new Set(['A-roof-waterproof-27'])

// 壁床・開口・工法で個別。標準の交差規則を使う。
const FIRE_CROSSING_IDS = new Set(['M-055', 'M-103'])

// 同一開口に複数回路が通っても開口1件。回路ごとの交差計算は禁止。
const UNIQUE_OPENING_IDS = new Set(['E-003', 'E-015', 'E-024'])

// 同一部位・同一面側の範囲、または壁の施工線長×対象高さ。
const SAME_FACE_CLASSES = new Set([
  'FLOOR',
  'CEILING_FINISH',
  'ROOF',
  'AREA',
  'WALL_FINISH',
  'FIRE_ASSEMBLY',
])

// 対象工事独自の施工面、フィルム施工面、建具内ガラスの実寸法。
const INDEPENDENT_FACE_IDS = new Set([
  'B-017',
  'B-096',
  'B-104',
  'B-149',
  'A-interior-units-19',
  'A-interior-units-30',
  'A-roof-waterproof-08',
  'A-exterior-wall-17',
])

const MANUAL_CLASSES = new Set([
  'RECORD',
  'PLAN',
  'PROTECT',
  'PROTECT_ACTUAL',
  'SCAFFOLD',
  'OPEN_REINF',
  'VOLUME',
  'WALL_FRAME',
  'CEILING_FRAME',
  'HANGING',
  'EXIST_FACE',
  'EXIST_POINT',
  'LINE',
  'CRACK',
  'DEFECT_POINT',
  'PATCH',
  'PROPERTY',
])

const manualReason = '原本: 対象の範囲を図面で別に拾う。'

function manual(reason = manualReason): ScopeLinkPlan {
  return { kind: 'none', reason }
}

function partOf(fixture: CountFixture): Part | undefined {
  const text = `${fixture.name} ${fixture.category}`
  const line = quantityMethod(fixture) === 'polyline'

  if (line && /幅木|巾木|見切|目地|シール/u.test(text)) {
    return 'linearMember'
  }
  if (line && /管|ケーブル|ダクト|配線|ラック/u.test(text)) {
    return 'route'
  }
  if (/建具|扉|ドア|窓|出入口/u.test(text)) return 'door'
  if (/壁|間仕切/u.test(text)) return 'wall'
  if (text.includes('床')) return 'floor'
  if (text.includes('天井')) return 'ceiling'
  if (/屋根|屋上/u.test(text)) return 'roof'
  return undefined
}

/** 複数ルール・複数 any 枝を OR のまま保持する。 */
export function relatedOriginMatches(
  ruleIds: readonly string[],
  rules: readonly RelatedRule[],
): RelatedOriginMatch[] {
  const ids = new Set(ruleIds)
  const matches = rules.flatMap(rule => {
    if (!ids.has(rule.id) || !('any' in rule.origin)) return []
    return rule.origin.any.map(match => structuredClone(match))
  })

  return [
    ...new Map(matches.map(match => [JSON.stringify(match), match])).values(),
  ]
}

function validSourceName(value: string): boolean {
  return value.length > 0
    && value.length <= 40
    && value === value.trim()
    && !/[\r\n\t\u2028\u2029]/u.test(value)
}

/**
 * 押した起点の名称だけを自動選択の条件にする。
 * 関連ルールの他の起点品目や分類を混ぜない。
 */
function automaticSources(
  origin: CountFixture,
  kinds: SourceKinds,
  factorFrom?: FixtureLinkSource['factorFrom'],
  sizeMatch?: string,
): LinkAutoSources | undefined {
  if (!validSourceName(origin.name)) return undefined

  return {
    nameIncludes: [origin.name],
    ...(!origin.name.includes('撤去') ? { nameExcludes: ['撤去'] } : {}),
    kinds: [...kinds],
    ...(factorFrom !== undefined ? { factorFrom } : {}),
    ...(sizeMatch !== undefined ? { sizeMatch } : {}),
  }
}

function linkPlan(
  origin: CountFixture,
  _options: ScopeRuleOptions,
  kinds: SourceKinds,
  settings: Pick<FixtureLink, 'kind' | 'shape'>,
  note: string,
  factor = 1,
  factorFrom?: FixtureLinkSource['factorFrom'],
  sizeMatch?: string,
): ScopeLinkPlan {
  const auto = automaticSources(
    origin,
    kinds,
    factorFrom,
    sizeMatch,
  )

  return {
    kind: 'link',
    link: {
      ...settings,
      factor,
      sources: auto ? [] : [{
        itemId: origin.id,
        factor,
        ...(factorFrom !== undefined ? { factorFrom } : {}),
      }],
      ...(auto !== undefined ? { auto } : {}),
    },
    note,
  }
}

function shapePlan(
  origin: CountFixture,
  target: CountFixture,
  options: ScopeRuleOptions,
  shape: NonNullable<FixtureLink['shape']>,
  kinds: SourceKinds,
  note: string,
  factor = 1,
): ScopeLinkPlan {
  const expectedKind =
    shape.output === 'perimeter' || shape.output === 'baseLength'
      ? 'length' : 'area'

  if (quantityKind(target) !== expectedKind) {
    return manual(
      `原本: ${expectedKind === 'length' ? '長さ' : '面積'}の項目で`
      + '対象の範囲を別に拾う。',
    )
  }

  return linkPlan(
    origin,
    options,
    kinds,
    { kind: 'shape', shape },
    note,
    factor,
  )
}

function standardPlan(
  id: string | undefined,
  target: CountFixture,
): ScopeLinkPlan {
  const rule = LINK_RULES.find(candidate => candidate.id === id)
  if (!rule) return manual()

  if (linkRuleAuto(rule) === undefined) {
    return manual(
      '原本: 計算に使う元を別に拾う。'
      + `連動の画面で標準の規則「${rule.label}」を選んでください。`,
    )
  }

  return {
    kind: 'link',
    link: linkFromRule(
      rule, target.name, target.summary ?? [], target.breakdown?.book,
    ),
    note: rule.note,
  }
}

function namedStandardPlan(
  target: CountFixture,
  allowedIds: readonly string[],
): ScopeLinkPlan {
  const rule: LinkRule | undefined = linkRuleForDetail(target.name)
  return rule && allowedIds.includes(rule.id)
    ? standardPlan(rule.id, target)
    : manual()
}

function routeLengthPlan(
  origin: CountFixture,
  target: CountFixture,
  options: ScopeRuleOptions,
): ScopeLinkPlan {
  if (partOf(origin) !== 'route' || quantityKind(target) !== 'length') {
    return manual()
  }

  if (quantityMethod(target) === 'polyline') {
    return { kind: 'placement', placement: 'route' }
  }

  return linkPlan(
    origin,
    options,
    ['length'],
    { kind: 'factor' },
    '原本の対象区間の配管・ケーブル・ダクト・ラックの長さを使います。',
    1,
    undefined,
    pipeSizeKeys(target.code, target.spec ?? '', target.name)[0],
  )
}

function routeSurfacePlan(
  origin: CountFixture,
  target: CountFixture,
  options: ScopeRuleOptions,
): ScopeLinkPlan {
  if (partOf(origin) !== 'route') return manual()

  if (quantityKind(target) === 'length') {
    return routeLengthPlan(origin, target, options)
  }
  if (quantityKind(target) !== 'area') return manual()

  const originText = `${origin.name} ${origin.category}`
  if (originText.includes('ダクト')) {
    return { kind: 'placement', placement: 'route' }
  }
  if (!originText.includes('管')) return manual()

  return linkPlan(
    origin,
    options,
    ['length'],
    { kind: 'factor' },
    '対象区間の配管長 × π × 管の外径(m)で表面積を求めます。'
      + '外径は項目の外径または既存の外径表を使います。',
    1,
    'outerCircumference',
    pipeSizeKeys(target.code, target.spec ?? '', target.name)[0],
  )
}

function baseEdgePlan(
  origin: CountFixture,
  target: CountFixture,
  options: ScopeRuleOptions,
  floorOnly = false,
): ScopeLinkPlan {
  const part = partOf(origin)
  const method = quantityMethod(origin)

  if (!floorOnly && part === 'wall'
    && (
      method === 'polyline'
      || method === 'lengthHeight'
      || method === 'polygon'
    )) {
    return shapePlan(
      origin,
      target,
      options,
      { output: 'baseLength', deductDoorWidths: true },
      ['area', 'length'],
      '壁の平面長・立面の底辺から、その拾いの扉の幅を引きます。'
        + '既定は両面のため係数2。片面の壁は連動の係数を1にしてください。',
      2,
    )
  }

  if (part === 'floor' && method === 'polygon') {
    const shape = LINK_RULES.find(rule => rule.id === 'baseboard')?.shape
      ?? { output: 'perimeter' as const }

    return shapePlan(
      origin,
      target,
      options,
      structuredClone(shape),
      ['area'],
      '床の周長から長さを求めます（標準規則 baseboard）。'
        + '出入口は建具を元に追加し、「開口の幅」で引き算にしてください。',
    )
  }

  return manual()
}

/**
 * 同じ面の部位は、提案先の名称ではなくルールの分類・部位の品目群から決める
 * （「壁紙張り」は天井のルールにもあり、名称の「壁」で部位を決められない）。
 */
function rulePart(ruleId: string, classId: string): Part | undefined {
  if (classId === 'FLOOR') return 'floor'
  if (classId === 'CEILING_FINISH') return 'ceiling'
  if (classId === 'ROOF') return 'roof'
  if (classId === 'WALL_FINISH' || classId === 'FIRE_ASSEMBLY') return 'wall'
  if (/^A-(?:exterior-)?wall-/u.test(ruleId)) return 'wall'
  if (ruleId.startsWith('A-floor-')) return 'floor'
  if (ruleId.startsWith('A-ceiling-')) return 'ceiling'
  if (ruleId.startsWith('A-roof-')) return 'roof'
  return undefined
}

function sameFacePlan(
  ruleId: string,
  classId: string,
  origin: CountFixture,
  target: CountFixture,
  options: ScopeRuleOptions,
): ScopeLinkPlan {
  const facePart = rulePart(ruleId, classId)
  const originPart = partOf(origin)
  const method = quantityMethod(origin)
  // 起点の部位は、名称で分かればルールの部位と一致すること。分からない面（防水層・地業など）は
  // ルールの起点の品目群に当たっているので、ルールの部位の面とみなす。
  const part = originPart ?? (method === 'polyline' ? undefined : facePart)

  if (
    facePart === undefined
    || part !== facePart
    || quantityKind(target) !== 'area'
  ) {
    return manual()
  }

  const note =
    '同じ部位・同じ面側の対象範囲として数量を使います。'
    + '既定は片面です。両面は連動の係数を2にし、'
    + '仕上高さが異なる場合は連動の高さ・係数を直してください。'

  if (part === 'wall' && method === 'polyline') {
    return shapePlan(
      origin,
      target,
      options,
      { output: 'lengthTimesHeight', lengthBasis: 'baseEdge' },
      ['length'],
      note + '高さ未設定の警告を確認し、対象高さを入力してください。',
    )
  }

  if ((method === 'polygon' || method === 'lengthHeight')
    && quantityKind(origin) === 'area') {
    return linkPlan(
      origin,
      options,
      ['area'],
      { kind: 'factor' },
      note + '控除後の面積を使います。',
    )
  }

  return manual()
}

export function scopeLinkPlan(input: {
  ruleId?: string
  classId: string | undefined
  /** 既存呼出側との型互換用。ルールIDの許可を広げる指定には使わない。 */
  optionId?: string
  origin: CountFixture
  target: CountFixture
} & ScopeRuleOptions): ScopeLinkPlan {
  const { ruleId, classId, origin, target } = input

  if (origin.id === target.id) {
    return manual('同じ項目を連動の元にはできません。')
  }
  if (origin.link !== undefined) {
    return manual('起点が連動の項目のため、自動では連動・配置しません。')
  }
  if (target.link !== undefined) return { kind: 'existing-link' }

  if (!ruleId || !classId) return manual()
  if (MANUAL_CLASSES.has(classId)) return manual()

  switch (classId) {
    case 'BRANCH':
      if (BRANCH_ROUTE_IDS.has(ruleId)) {
        return routeLengthPlan(origin, target, input)
      }
      if (BRANCH_FLOOR_EDGE_IDS.has(ruleId)) {
        return baseEdgePlan(origin, target, input, true)
      }
      return manual()

    case 'DETAIL':
      return ruleId === 'B-043'
        ? standardPlan('formwork-transport', target)
        : manual()

    case 'CONTACT':
      return ruleId === 'B-037'
        ? namedStandardPlan(target, [
          'formwork-foundation',
          'formwork-body',
        ])
        : manual()

    case 'MATERIAL':
      return ['B-038', 'B-044', 'B-045'].includes(ruleId)
        ? namedStandardPlan(target, ['rebar-required', 'rebar-assembly'])
        : manual()

    case 'WASTE':
      return namedStandardPlan(target, ['waste'])

    case 'OPENING':
      if (UNIQUE_OPENING_IDS.has(ruleId)) {
        return manual(
          '原本: 貫通口ごとに点で別に拾う。'
          + '標準の「区画の線との交差」は回路ごとに数えるため使いません。',
        )
      }
      return FIRE_CROSSING_IDS.has(ruleId)
        ? standardPlan('fire-penetration', target)
        : manual()

    case 'SURFACE':
      if (ruleId === 'B-054') return standardPlan('steel-paint', target)
      if (ruleId === 'B-055') return standardPlan('steel-fireproof', target)
      return manual()

    case 'MARK':
      if (!WALL_MARK_IDS.has(ruleId)) return manual()
      if (input.projectMode === '新築') {
        return manual(
          '新築の墨出しは延べ面積（各階の床を囲んだ項目）を元にします。'
          + '連動の画面で標準の規則「延べ面積」を選んでください。',
        )
      }
      if (partOf(origin) !== 'wall'
        || !['polyline', 'lengthHeight', 'polygon']
          .includes(quantityMethod(origin))) {
        return manual()
      }
      return shapePlan(
        origin,
        target,
        input,
        { output: 'lengthTimesHeight', heightM: 1, lengthBasis: 'baseEdge' },
        ['area', 'length'],
        '壁の平面長・立面の底辺 × 帯幅1m'
          + '（国交省 数量基準 第7編 PDF49頁）。既定は片側1面。'
          + '両側に墨を出す場合は連動の係数を2にしてください。',
      )

    case 'FILTER_ROUTE':
      return FILTER_ROUTE_IDS.has(ruleId)
        ? routeSurfacePlan(origin, target, input)
        : manual()

    case 'ROUTE':
    case 'UNIQUE_ROUTE':
      return ROUTE_IDS.has(ruleId)
        ? routeLengthPlan(origin, target, input)
        : manual()

    case 'ENDPOINT':
      return ENDPOINT_IDS.has(ruleId)
        && partOf(origin) === 'route'
        && quantityMethod(target) === 'click'
        && quantityKind(target) === 'count'
        ? { kind: 'placement', placement: 'point' }
        : manual()

    case 'POINT':
      return PER_ORIGIN_IDS.has(ruleId)
        && quantityMethod(origin) === 'click'
        && quantityKind(origin) === 'count'
        && quantityMethod(target) === 'click'
        && quantityKind(target) === 'count'
        ? { kind: 'placement', placement: 'component' }
        : manual()

    case 'BASEBOARD':
      return BASEBOARD_IDS.has(ruleId)
        ? baseEdgePlan(origin, target, input)
        : manual()

    case 'JOINT':
      return CEILING_PERIMETER_IDS.has(ruleId)
        && partOf(origin) === 'ceiling'
        && quantityMethod(origin) === 'polygon'
        ? shapePlan(
          origin,
          target,
          input,
          { output: 'perimeter' },
          ['area'],
          '天井の面の外周から廻り縁の施工長さを求めます。',
        )
        : manual()

    case 'CORNER':
      return manual()

    case 'UPSTAND':
      return UPSTAND_IDS.has(ruleId)
        && (partOf(origin) === 'roof' || partOf(origin) === 'floor')
        && quantityMethod(origin) === 'polygon'
        ? shapePlan(
          origin,
          target,
          input,
          { output: 'lengthTimesHeight' },
          ['area'],
          '屋根・床の外周 × 高さで防水立上りの面積を求めます。'
            + '高さ未設定時は連動の警告を確認し、高さを入力してください。',
        )
        : manual()

    case 'BACKFILL':
      return manual(
        '原本: 同じ掘削体の控除対象を別に拾う。'
        + '標準の規則「埋戻し」で根切りを＋、基礎等を−の元にしてください。',
      )
  }

  if (classId === 'AREA' && ruleId === 'B-096') {
    return standardPlan('glass', target)
  }

  return SAME_FACE_CLASSES.has(classId)
    && !INDEPENDENT_FACE_IDS.has(ruleId)
    ? sameFacePlan(ruleId, classId, origin, target, input)
    : manual()
}

function rulesFor(
  ruleIds: readonly string[],
  scopes: TakeoffRuleScopes,
): readonly RuleSelection[] {
  const ids = [...new Set(ruleIds)]
  return ids.length
    ? ids.map(ruleId => ({
      ruleId,
      classId: scopes.rules[ruleId]?.classId,
    }))
    : [{ ruleId: undefined, classId: undefined }]
}

function planForRules(
  rules: readonly RuleSelection[],
  origin: CountFixture,
  target: CountFixture,
  options: ScopeRuleOptions,
): ScopeLinkPlan {
  const plans = rules.map(rule =>
    scopeLinkPlan({ ...options, ...rule, origin, target }))
  const first = plans[0]

  if (!first) return manual()
  return plans.every(plan => JSON.stringify(plan) === JSON.stringify(first))
    ? first
    : manual(
      '複数の関連ルールで数量・配置の求め方が異なるため、'
      + '原本の対象範囲を図面で別に拾う。',
    )
}

export function scopePlanForRules(
  ruleIds: readonly string[],
  scopes: TakeoffRuleScopes | undefined,
  origin: CountFixture,
  target: CountFixture,
  options: ScopeRuleOptions = {},
): ScopeLinkPlan {
  if (!scopes) {
    if (origin.id === target.id || origin.link !== undefined) {
      return manual('起点が同じ項目または連動の項目のため、自動では反映しません。')
    }
    if (target.link !== undefined) return { kind: 'existing-link' }
    return manual(
      '拾う対象の情報を読み込んでから、もう一度追加してください。',
    )
  }

  return planForRules(rulesFor(ruleIds, scopes), origin, target, options)
}

export function withRelatedScopeContext(
  context: RelatedAddContext,
  ruleIds: readonly string[],
  scopes: TakeoffRuleScopes,
  options: ScopeRuleOptions = {},
): ScopedRelatedAddContext {
  return {
    ...context,
    scopeLink: {
      rules: rulesFor(ruleIds, scopes),
      ...(options.originMatch !== undefined
        ? { originMatch: structuredClone(options.originMatch) } : {}),
      ...(options.projectMode !== undefined
        ? { projectMode: options.projectMode } : {}),
    },
  }
}

export function scopePlanForContext(
  context: RelatedAddContext | undefined,
): ((origin: CountFixture, target: CountFixture) => ScopeLinkPlan) | undefined {
  const scoped = context as ScopedRelatedAddContext | undefined
  const scope = scoped?.scopeLink
  if (!scope) return undefined

  return (origin, target) =>
    planForRules(scope.rules, origin, target, scope)
}
