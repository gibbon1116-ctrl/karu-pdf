import { parseFixtureOpening, quantityOutputKind, quantityUnit, quantityDecimals, type CountFixture } from './countFixtures'
import { computeRcMember, rcBarCountText, type RcMember, type RcResult } from './rcMember'
import { steelMemberError, steelSection } from './steelMember'
import { STEEL_REQUIRED_FACTOR } from './breakdown/steelData'
import { createPageCrossingCounter, type PageCrossingBarrier } from './crossings'
import type { ShapeMetrics } from './shapeMetrics'
import { REBAR_MASS_KG_PER_M, REBAR_REQUIRED_FACTOR } from './breakdown/rcData'
import type { LinkAutoSources } from './breakdown/linkRules'
import {
  CARRY_MIN_MASS_KG, CARRY_HEAVY_DENSITY_KG_PER_M3, CARRY_ALONE_INCREASE,
  CARRY_HEAVY_FACTORS, CARRY_BULKY_FACTORS, CONDUIT_MASS_KG_PER_M, WASTE_DENSITIES,
} from './breakdown/linkData'
import { validCondition, type RoutePart } from './quantity'

export interface FixtureLinkSource {
  itemId: string
  factor?: number
  perM?: number
  conditions?: string[]
  sign?: -1
  factorFrom?: 'openingArea' | 'openingPerimeter' | 'openingWidth'
}

export interface FixtureLink {
  kind: 'factor' | 'mass' | 'carry' | 'rc' | 'shape' | 'crossing' | 'steel'
  crossing?: {
    barrierItemIds?: string[]
    barrierNameIncludes?: string[]
    includeRises?: boolean
    planCrossings?: boolean
  }
  steel?: {
    output: 'mass' | 'paint' | 'fireproof'
    basis?: 'design' | 'required'
    surface?: 'contour' | 'box' | 'boxBeam'
  }
  rc?: {
    output: 'concrete' | 'formwork' | 'rebar' | 'gasJoint' | 'lapJoint'
    sizes?: string[]
    basis?: 'design' | 'required'
  }
  shape?: {
    output: 'area' | 'perimeter' | 'lengthTimesHeight' | 'excavation'
    heightM?: number
    marginM?: number
    clearanceM?: number
    depthM?: number
  }
  sources: FixtureLinkSource[]
  auto?: LinkAutoSources
  /** autoで選ぶ元の係数。標準規則のfactorを保持し、省略時は1。 */
  factor?: number
  carry?: { class: 'heavy' | 'bulky'; alone?: boolean }
  condition?: { mode: 'fixed'; value: string }
  rounding?: 'total' | 'each' | 'none'
  densityTPerM3?: number
  override?: { value: number; note?: string }
}

export interface LinkSourceEntry {
  itemId: string
  annotationId: string
  pageIndex: number
  floor?: string
  room?: string
  value: number
  condition?: string
  part?: RoutePart
}

export interface LinkBasisSource {
  itemId: string
  quantity: number
  factor?: number
  perM?: number
  unitMassKg?: number
  auto?: boolean
  note?: string
  subtotal: number
}

export interface LinkResult {
  entries: LinkSourceEntry[]
  total: number
  computed: number
  sources: LinkBasisSource[]
  densityTPerM3?: number
  error?: string
  warnings: string[]
  overridden: boolean
}

export function fixtureLinkSourceUsesOutputUnit(fixture: CountFixture): boolean {
  return fixture.link !== undefined
    && ['rc', 'shape', 'steel', 'crossing'].includes(fixture.link.kind)
}

export function fixtureLinkSourceUnit(
  fixture: CountFixture,
  original: CountFixture | undefined,
): string {
  return fixtureLinkSourceUsesOutputUnit(fixture)
    ? quantityUnit(fixture) : original ? quantityUnit(original) : ''
}

export function fixtureLinkSourceShowsFactor(
  fixture: CountFixture,
  source: LinkBasisSource,
): boolean {
  if (!fixtureLinkSourceUsesOutputUnit(fixture)) return true
  const settings = fixture.link?.sources.find(entry => entry.itemId === source.itemId)
  return (source.factor ?? 1) !== 1
    || settings?.sign !== undefined || settings?.factorFrom !== undefined
}

export function fixtureLinkBasisNumber(fixture: CountFixture, value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (!fixtureLinkSourceUsesOutputUnit(fixture)) return String(Number(value.toFixed(6)))
  return value.toFixed(quantityUnit(fixture) === 't' ? 3 : quantityDecimals(fixture))
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function positive(value: unknown, maximum: number): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value > 0 && value <= maximum
}

export function fixtureLinkError(
  f: Pick<CountFixture, 'id' | 'link' | 'convert'>,
): string | undefined {
  if (f.link === undefined) return undefined
  if (f.convert !== undefined) return '連動の項目には数量の換算を設定できません。'
  const link: unknown = f.link
  if (!record(link) || !['factor', 'mass', 'carry', 'rc', 'shape', 'crossing', 'steel'].includes(String(link.kind))) {
    return '連動の種類を係数・質量・機器搬入・RC・形・交差・鉄骨から選んでください。'
  }
  if (link.kind === 'rc') {
    if (!record(link.rc)
      || !['concrete', 'formwork', 'rebar', 'gasJoint', 'lapJoint'].includes(String(link.rc.output))) {
      return 'RC連動の出力はコンクリート・型枠・鉄筋・ガス圧接・重ね継手から選んでください。'
    }
    if (link.rc.basis !== undefined
      && link.rc.basis !== 'design' && link.rc.basis !== 'required') {
      return '鉄筋の数量は設計数量・所要数量から選んでください。'
    }
    if (link.rc.sizes !== undefined && (!Array.isArray(link.rc.sizes)
      || link.rc.sizes.length > Object.keys(REBAR_MASS_KG_PER_M).length
      || !Array.from(link.rc.sizes).every(size =>
        typeof size === 'string' && Object.hasOwn(REBAR_MASS_KG_PER_M, size))
      || new Set(link.rc.sizes).size !== link.rc.sizes.length)) {
      return 'RC連動の径は単位質量表の径を、重複せずに設定してください。'
    }
  } else if (link.rc !== undefined) {
    return 'RCの出力設定はRC連動だけに設定できます。'
  }
  if (link.kind === 'shape') {
    if (!record(link.shape)
      || !['area', 'perimeter', 'lengthTimesHeight', 'excavation'].includes(String(link.shape.output))) {
      return '形の連動の出力は面積・周長・長さ×高さ・根切りから選んでください。'
    }
    for (const [key, maximum] of [
      ['heightM', 100], ['marginM', 5], ['clearanceM', 5], ['depthM', 100],
    ] as const) {
      const value = link.shape[key]
      if (value !== undefined && (typeof value !== 'number'
        || !Number.isFinite(value) || value < 0 || value > maximum)) {
        return '形の連動は余幅・ゆとり0〜5m、高さ・深さ0〜100mで設定してください。'
      }
    }
  } else if (link.shape !== undefined) {
    return '形の出力設定は形の連動だけに設定できます。'
  }
  if (link.kind === 'crossing') {
    if (!record(link.crossing)) return '交差の連動の設定が正しくありません。'
    for (const key of ['includeRises', 'planCrossings'] as const) {
      if (link.crossing[key] !== undefined && typeof link.crossing[key] !== 'boolean') {
        return '交差の平面・立上りの設定は真偽値で指定してください。'
      }
    }
    for (const [key, maximum, length] of [
      ['barrierItemIds', 1000, 80],
      ['barrierNameIncludes', 20, 80],
    ] as const) {
      const values = link.crossing[key]
      if (values !== undefined && (!Array.isArray(values)
        || values.length > maximum
        || !Array.from(values).every(value =>
          typeof value === 'string' && value.length > 0 && value.length <= length
          && value === value.trim() && !/[\r\n\t\u2028\u2029]/.test(value))
        || new Set(values).size !== values.length)) {
        return '交差の区画は重複のない項目IDまたは名称の語で設定してください。'
      }
    }
  } else if (link.crossing !== undefined) {
    return '区画の設定は交差の連動だけに設定できます。'
  }
  if (link.kind === 'steel') {
    if (!record(link.steel)
      || !['mass', 'paint', 'fireproof'].includes(String(link.steel.output))) {
      return '鉄骨の連動の出力は質量・塗装・耐火被覆から選んでください。'
    }
    if (link.steel.basis !== undefined
      && link.steel.basis !== 'design' && link.steel.basis !== 'required') {
      return '鉄骨の数量は設計数量・所要数量から選んでください。'
    }
    if (link.steel.surface !== undefined
      && !['contour', 'box', 'boxBeam'].includes(String(link.steel.surface))) {
      return '鉄骨の表面積は外周・箱張り・梁の箱張りから選んでください。'
    }
  } else if (link.steel !== undefined) {
    return '鉄骨の出力設定は鉄骨の連動だけに設定できます。'
  }
  if (!Array.isArray(link.sources)) return '連動の元を項目の配列で設定してください。'
  if (link.sources.length > 50) return '連動の元は50項目までです。'

  if (link.factor !== undefined && !positive(link.factor, 10000)) {
    return '連動の自動の元の係数は0より大きく10000以下の数で入れてください。'
  }
  if (link.auto !== undefined) {
    if (!record(link.auto)) return '連動の自動の元の設定が正しくありません。'
    for (const key of ['categories', 'nameIncludes'] as const) {
      const values = link.auto[key]
      if (values !== undefined && (!Array.isArray(values) || values.length > 20
        || !Array.from(values).every(value => typeof value === 'string'
          && value.length > 0 && value.length <= 40 && value === value.trim()
          && !/[\r\n\t\u2028\u2029]/.test(value)))) {
        return '連動の自動の元の分類・名称の語は各40字、20件までで設定してください。'
      }
    }
    if (link.auto.condition !== undefined && !validCondition(link.auto.condition)) {
      return '連動の自動の元の施工条件は1〜30文字で、前後の空白や改行を入れずに設定してください。'
    }
    if (link.auto.kinds !== undefined && (!Array.isArray(link.auto.kinds)
      || !Array.from(link.auto.kinds).every(kind =>
        kind === 'count' || kind === 'length' || kind === 'area' || kind === 'volume'))) {
      return '連動の自動の元の種別は個数・長さ・面積・体積から選んでください。'
    }
    if (link.auto.outputKinds !== undefined && (!Array.isArray(link.auto.outputKinds)
      || link.auto.outputKinds.length > 5
      || !Array.from(link.auto.outputKinds).every(kind =>
        kind === 'count' || kind === 'length' || kind === 'area'
        || kind === 'volume' || kind === 'mass'))) {
      return '連動の自動の元の出力の種別は個数・長さ・面積・体積・質量から5件までで選んでください。'
    }
    if (link.auto.rcKinds !== undefined && (!Array.isArray(link.auto.rcKinds)
      || link.auto.rcKinds.length > 7
      || !Array.from(link.auto.rcKinds).every(kind =>
        kind === 'slab' || kind === 'foundationSlab' || kind === 'wall'
        || kind === 'beam' || kind === 'foundationBeam'
        || kind === 'column' || kind === 'footing'))) {
      return '連動の自動の元のRC部材の種類は床板・基礎スラブ・壁・梁・基礎梁・柱・基礎から7件までで選んでください。'
    }
    if (link.auto.minMassKg !== undefined && (typeof link.auto.minMassKg !== 'number'
      || !Number.isFinite(link.auto.minMassKg)
      || link.auto.minMassKg < 0 || link.auto.minMassKg > 1e6)) {
      return '連動の自動の元の最低質量は0以上1000000以下の数で入れてください。'
    }
  }
  if (link.kind === 'carry') {
    if (!record(link.carry)
      || (link.carry.class !== 'heavy' && link.carry.class !== 'bulky')
      || (link.carry.alone !== undefined && typeof link.carry.alone !== 'boolean')) {
      return '機器搬入の連動には重量品・容積品の区分と、必要なら単独搬入を設定してください。'
    }
  } else if (link.carry !== undefined) {
    return '搬入の区分は機器搬入の連動だけに設定できます。'
  }

  const ids = new Set<string>()
  for (const source of Array.from(link.sources)) {
    if (!record(source) || typeof source.itemId !== 'string'
      || !source.itemId.length || source.itemId.length > 80) {
      return '連動の元の項目IDが正しくありません。'
    }
    if (source.itemId === f.id) return '連動の元に自分自身は指定できません。'
    if (ids.has(source.itemId)) return '連動の元に同じ項目を重複して指定できません。'
    ids.add(source.itemId)
    if (source.sign !== undefined && source.sign !== -1) {
      return '連動の元の引き算はsign: -1で設定してください。'
    }
    if (source.factorFrom !== undefined
      && !['openingArea', 'openingPerimeter', 'openingWidth'].includes(String(source.factorFrom))) {
      return '開口からの係数は面積・周長・幅から選んでください。'
    }
    if (source.factor !== undefined && source.perM !== undefined) {
      return '連動の係数と間隔は同時に設定できません。'
    }
    if (source.factor !== undefined && !positive(source.factor, 10000)) {
      return '連動の係数は0より大きく10000以下の数で入れてください。'
    }
    if (source.perM !== undefined && !positive(source.perM, 1000)) {
      return '連動の間隔は0より大きく1000以下の数で入れてください。'
    }
    if (source.conditions !== undefined) {
      if (!Array.isArray(source.conditions) || source.conditions.length > 30) {
        return '連動の元の施工条件は30件までです。'
      }
      if (!Array.from(source.conditions).every(value => value === '' || validCondition(value))) {
        return '連動の元の施工条件は未設定、または1〜30文字で前後の空白や改行のない値にしてください。'
      }
    }
  }

  if (link.condition !== undefined && (!record(link.condition)
    || link.condition.mode !== 'fixed' || !validCondition(link.condition.value))) {
    return '連動の固定する施工条件は1〜30文字で、前後の空白や改行を入れずに設定してください。'
  }
  if (link.rounding !== undefined && !['total', 'each', 'none'].includes(String(link.rounding))) {
    return '連動の切り上げは合計・拾いごと・なしから選んでください。'
  }
  if (link.densityTPerM3 !== undefined
    && (link.kind !== 'mass' || !positive(link.densityTPerM3, 30))) {
    return '連動の密度は質量の連動だけに、0より大きく30以下の数で入れてください。'
  }
  if (link.override !== undefined) {
    if (!record(link.override) || typeof link.override.value !== 'number'
      || !Number.isFinite(link.override.value)
      || link.override.value < 0 || link.override.value > 1e9) {
      return '連動の上書き数量は0以上1000000000以下の数で入れてください。'
    }
    if (link.override.note !== undefined && (typeof link.override.note !== 'string'
      || link.override.note.length > 200 || /[\r\n\u2028\u2029]/.test(link.override.note))) {
      return '連動の上書きの注記は200字までで、改行を入れずに設定してください。'
    }
  }
}

/** PDFから持ち込むフィールドを限定し、空の条件配列を省く。 */
export function readFixtureLink(
  f: Pick<CountFixture, 'id' | 'link' | 'convert'>,
): FixtureLink | undefined {
  if (f.link === undefined || fixtureLinkError(f)) return undefined
  const link = f.link
  return {
    kind: link.kind,
    sources: link.sources.map(source => ({
      itemId: source.itemId,
      ...(source.factor !== undefined ? { factor: source.factor } : {}),
      ...(source.perM !== undefined ? { perM: source.perM } : {}),
      ...(source.conditions?.length ? { conditions: [...source.conditions] } : {}),
      ...(source.sign !== undefined ? { sign: source.sign } : {}),
      ...(source.factorFrom !== undefined ? { factorFrom: source.factorFrom } : {}),
    })),
    ...(link.rc !== undefined ? {
      rc: {
        output: link.rc.output,
        ...(link.rc.sizes !== undefined ? { sizes: [...link.rc.sizes] } : {}),
        ...(link.rc.basis !== undefined ? { basis: link.rc.basis } : {}),
      },
    } : {}),
    ...(link.shape !== undefined ? {
      shape: {
        output: link.shape.output,
        ...(link.shape.heightM !== undefined ? { heightM: link.shape.heightM } : {}),
        ...(link.shape.marginM !== undefined ? { marginM: link.shape.marginM } : {}),
        ...(link.shape.clearanceM !== undefined ? { clearanceM: link.shape.clearanceM } : {}),
        ...(link.shape.depthM !== undefined ? { depthM: link.shape.depthM } : {}),
      },
    } : {}),
    ...(link.crossing !== undefined ? {
      crossing: {
        ...(link.crossing.barrierItemIds !== undefined
          ? { barrierItemIds: [...link.crossing.barrierItemIds] } : {}),
        ...(link.crossing.barrierNameIncludes !== undefined
          ? { barrierNameIncludes: [...link.crossing.barrierNameIncludes] } : {}),
        ...(link.crossing.includeRises !== undefined
          ? { includeRises: link.crossing.includeRises } : {}),
        ...(link.crossing.planCrossings !== undefined
          ? { planCrossings: link.crossing.planCrossings } : {}),
      },
    } : {}),
    ...(link.steel !== undefined ? {
      steel: {
        output: link.steel.output,
        ...(link.steel.basis !== undefined ? { basis: link.steel.basis } : {}),
        ...(link.steel.surface !== undefined ? { surface: link.steel.surface } : {}),
      },
    } : {}),
    ...(link.auto !== undefined ? {
      auto: {
        ...(link.auto.categories !== undefined ? { categories: [...link.auto.categories] } : {}),
        ...(link.auto.nameIncludes !== undefined ? { nameIncludes: [...link.auto.nameIncludes] } : {}),
        ...(link.auto.condition !== undefined ? { condition: link.auto.condition } : {}),
        ...(link.auto.kinds !== undefined ? { kinds: [...link.auto.kinds] } : {}),
        ...(link.auto.outputKinds !== undefined ? { outputKinds: [...link.auto.outputKinds] } : {}),
        ...(link.auto.rcKinds !== undefined ? { rcKinds: [...link.auto.rcKinds] } : {}),
        ...(link.auto.minMassKg !== undefined ? { minMassKg: link.auto.minMassKg } : {}),
      },
    } : {}),
    ...(link.factor !== undefined ? { factor: link.factor } : {}),
    ...(link.carry !== undefined ? {
      carry: {
        class: link.carry.class,
        ...(link.carry.alone !== undefined ? { alone: link.carry.alone } : {}),
      },
    } : {}),
    ...(link.condition !== undefined
      ? { condition: { mode: 'fixed' as const, value: link.condition.value } } : {}),
    ...(link.rounding !== undefined ? { rounding: link.rounding } : {}),
    ...(link.densityTPerM3 !== undefined ? { densityTPerM3: link.densityTPerM3 } : {}),
    ...(link.override !== undefined ? {
      override: {
        value: link.override.value,
        ...(link.override.note !== undefined ? { note: link.override.note } : {}),
      },
    } : {}),
  }
}

/** 計算と出力単位で同じ見かけ比重を使う。搬入には適用しない。 */
export function fixtureLinkDensity(
  f: Pick<CountFixture, 'link' | 'attributes'>,
): number | undefined {
  if (f.link?.kind !== 'mass') return undefined
  return f.link.densityTPerM3
    ?? WASTE_DENSITIES.find(entry => entry.type === f.attributes?.wasteType)?.tPerM3
}

export function fixtureLinkRoundsUp(f: CountFixture): boolean {
  return !!f.link && f.link.kind === 'factor' && ((f.kind ?? 'count') === 'count'
    || f.link.sources.some(source => source.perM !== undefined))
}

export function ceilLinkQuantity(value: number): number {
  // Normalize -0 for empty totals.
  return Math.ceil(value - 1e-9) || 0
}

function roundEachAnnotation(entries: LinkSourceEntry[]): void {
  const groups = new Map<string, LinkSourceEntry[]>()
  for (const entry of entries) {
    const group = groups.get(entry.annotationId)
    if (group) group.push(entry)
    else groups.set(entry.annotationId, [entry])
  }
  for (const group of groups.values()) {
    const total = group.reduce((sum, entry) => sum + entry.value, 0)
    if (total === 0) continue
    const rounded = ceilLinkQuantity(total)
    if (rounded === total) continue
    const ratio = rounded / total
    for (const entry of group) entry.value *= ratio
    // Keep the group's sum equal to its rounded quantity after floating-point scaling.
    group[group.length - 1].value += rounded
      - group.reduce((sum, entry) => sum + entry.value, 0)
  }
}

/** Calculation and metric collection must select the same automatic sources. */
export function fixtureLinkSources(
  fixtures: readonly CountFixture[],
  fixture: CountFixture,
): Array<FixtureLinkSource & { auto?: boolean }> {
  const link = fixture.link!
  const sources: Array<FixtureLinkSource & { auto?: boolean }> = [...link.sources]
  const auto = link.auto
  if (auto === undefined) return sources
  const manualIds = new Set(link.sources.map(source => source.itemId))
  for (const original of fixtures) {
    if (original.id === fixture.id || original.link !== undefined || manualIds.has(original.id)) continue
    if (link.kind === 'steel' && original.steel === undefined) continue
    if (auto.categories !== undefined && !auto.categories.includes(original.category)) continue
    if (auto.nameIncludes !== undefined
      && !auto.nameIncludes.some(word => original.name.includes(word))) continue
    if (auto.condition !== undefined && !original.conditions?.includes(auto.condition)) continue
    if (auto.kinds !== undefined && !auto.kinds.includes(original.kind ?? 'count')) continue
    if (auto.outputKinds !== undefined
      && !auto.outputKinds.includes(quantityOutputKind(original))) continue
    if (auto.rcKinds !== undefined && (original.rc === undefined
      || (auto.rcKinds.length > 0 && !auto.rcKinds.includes(original.rc.kind)))) continue
    if (auto.minMassKg !== undefined
      && !((original.attributes?.massKg ?? -1) >= auto.minMassKg)) continue
    sources.push({
      itemId: original.id,
      factor: link.factor ?? 1,
      auto: true,
      ...(auto.condition !== undefined ? { conditions: [auto.condition] } : {}),
    })
  }
  return sources
}

/** Use the same barrier selection for metric collection and calculation. */
export function fixtureCrossingBarriers(
  fixtures: readonly CountFixture[],
  fixture: CountFixture,
  sourceIds: ReadonlySet<string> = new Set(
    fixtureLinkSources(fixtures, fixture).map(source => source.itemId),
  ),
): CountFixture[] {
  const settings = fixture.link?.crossing
  if (fixture.link?.kind !== 'crossing' || settings === undefined
    || settings.planCrossings === false) return []
  const ids = new Set(settings.barrierItemIds ?? [])
  const words = settings.barrierNameIncludes ?? []
  if (!ids.size && !words.length) return []
  return fixtures.filter(original => {
    if (original.id === fixture.id || sourceIds.has(original.id)
      || original.link !== undefined) return false
    const method = original.method
      ?? ((original.kind ?? 'count') === 'length' ? 'polyline'
        : original.kind === 'area' ? 'polygon'
          : original.kind === 'volume' ? 'polygonDepth' : 'click')
    if (method !== 'polyline' && method !== 'polygon' && method !== 'polygonDepth') {
      return false
    }
    return ids.has(original.id) || words.some(word => original.name.includes(word))
  })
}

function openingFactorFor(
  source: FixtureLinkSource,
  original: CountFixture,
  result: LinkResult,
): number {
  if (source.factorFrom === undefined) return 1
  const opening = parseFixtureOpening(original.opening)
  if (!opening) {
    result.warnings.push(`${original.name}の開口寸法が未設定です。係数を0にします。`)
    return 0
  }
  switch (source.factorFrom) {
    case 'openingArea': return opening.widthM * opening.heightM
    case 'openingPerimeter': return 2 * (opening.widthM + opening.heightM)
    case 'openingWidth': return opening.widthM
  }
}

function rcOutputValue(rc: RcResult, settings: NonNullable<FixtureLink['rc']>): number {
  const sizes = settings.sizes === undefined ? undefined : new Set(settings.sizes)
  switch (settings.output) {
    case 'concrete': return rc.concreteM3
    case 'formwork': return rc.formworkM2
    case 'rebar':
      return rc.bars.reduce((sum, bar) =>
        sum + (!sizes || sizes.has(bar.size) ? bar.massKg : 0), 0) / 1000
        * (settings.basis === 'required' ? REBAR_REQUIRED_FACTOR : 1)
    case 'gasJoint':
      return rc.gasJoints.reduce((sum, joint) =>
        sum + (!sizes || sizes.has(joint.size) ? joint.count : 0), 0)
    case 'lapJoint': return rc.lapJoints
  }
}

const rcKindLabels: Record<RcMember['kind'], string> = {
  slab: '床板', foundationSlab: '基礎スラブ', wall: '壁',
  beam: '梁', foundationBeam: '基礎梁', column: '柱', footing: '独立基礎',
}
const rcRoleLabels: Record<RcResult['bars'][number]['role'], string> = {
  x: 'x方向', y: 'y方向', vertical: '縦筋', horizontal: '横筋',
  top: '上端筋', bottom: '下端筋', stirrup: 'スタラップ',
  main: '主筋', hoop: 'フープ', base: 'ベース筋',
}

function rcOutputNote(
  member: RcMember,
  metric: ShapeMetrics,
  rc: RcResult,
  settings: NonNullable<FixtureLink['rc']>,
): string {
  const n = (value: number) => value.toFixed(2)
  const mass = (value: number) => value.toFixed(3)
  const label = rcKindLabels[member.kind]
  const thickness = member.thicknessMm !== undefined
    ? member.thicknessMm / 1000 : metric.depthM ?? 0
  const thicknessText = `厚さ ${n(thickness)}m${
    member.thicknessMm === undefined ? '（拾いの深さ）' : ''
  }`
  const width = (member.widthMm ?? 0) / 1000
  const depth = (member.depthMm ?? 0) / 1000
  const height = (member.heightMm ?? 0) / 1000
  const netDepth = depth - (member.slabDeductMm ?? 0) / 1000
  const repeat = metric.count === 1 ? '' : ` × ${n(metric.count)}（拾いの数）`
  const slab = member.kind === 'slab' || member.kind === 'foundationSlab'
  const beam = member.kind === 'beam' || member.kind === 'foundationBeam'
  const dimensions = slab || member.kind === 'wall'
    ? `${label} ${n(metric.areaM2)}㎡ ${thicknessText}${repeat}`
    : beam
      ? `${label} 長さ ${n(metric.lengthM)}m 幅 ${n(width)}m せい ${n(depth)}m${repeat}`
      : `${label} 幅 ${n(width)}m 長さ ${n(depth)}m 高さ ${n(height)}m${repeat}`

  if (settings.output === 'concrete') {
    const expression = slab || member.kind === 'wall'
      ? `${label} ${n(metric.areaM2)}㎡ × ${thicknessText}`
      : beam
        ? `${label} 長さ ${n(metric.lengthM)}m × 幅 ${n(width)}m × ${
          member.slabDeductMm !== undefined
            ? `（せい ${n(depth)}m − 床板控除 ${n(member.slabDeductMm / 1000)}m）`
            : `せい ${n(depth)}m`
        }`
        : `${label} 幅 ${n(width)}m × 長さ ${n(depth)}m × 高さ ${n(height)}m`
    return `${metric.annotationId}: ${expression}${repeat} = ${n(rc.concreteM3)}㎥`
  }

  if (settings.output === 'formwork') {
    const expression = member.kind === 'slab'
      ? `底面 ${n(metric.areaM2)}㎡`
      : member.kind === 'foundationSlab'
        ? `側面 周長 ${n(metric.perimeterM)}m × ${thicknessText}`
        : member.kind === 'wall'
          ? `両面 ${n(metric.areaM2)}㎡ × 2`
          : beam
            ? `長さ ${n(metric.lengthM)}m × （側面 2 × ${
              member.slabDeductMm !== undefined
                ? `（${n(depth)}m − ${n(member.slabDeductMm / 1000)}m）`
                : `${n(netDepth)}m`
            }${member.kind === 'beam' ? ` ＋ 底面 ${n(width)}m` : ''}）`
            : `側面 2 × （${n(width)}m ＋ ${n(depth)}m） × 高さ ${n(height)}m`
    return `${metric.annotationId}: ${label} ${expression}${repeat} = ${n(rc.formworkM2)}㎡`
  }

  const sizes = settings.sizes === undefined ? undefined : new Set(settings.sizes)
  const bars = rc.bars.filter(bar => !sizes || sizes.has(bar.size))
  if (settings.output === 'gasJoint' || settings.output === 'lapJoint') {
    const joint = settings.output === 'gasJoint' ? 'gas' : 'lap'
    const parts = bars.filter(bar => bar.joint === joint).map(bar =>
      `${bar.size} ${rcRoleLabels[bar.role]} ${rcBarCountText(bar)}: ${
        joint === 'gas' ? 'ガス圧接' : '重ね継手'
      } ${n(bar.jointCount ?? 0)}か所`)
    return `${metric.annotationId}: ${dimensions}: ${
      parts.join('、') || `${joint === 'gas' ? 'ガス圧接' : '重ね継手'} 0.00か所`
    }｜合計 ${n(rcOutputValue(rc, settings))}か所`
  }

  const barTexts = bars.map(bar =>
    `${bar.size} ${rcRoleLabels[bar.role]} ${rcBarCountText(bar)} 計${n(bar.lengthM)}m`
      + `（1本 平均${n(bar.count > 0 ? bar.lengthM / bar.count : 0)}m、`
      + `定着・継手を含む：定着 ${n(bar.anchorageM ?? 0)}m、`
      + `重ね継手 ${n(bar.lapM ?? 0)}m）`)
  const bySize = new Map<string, { lengthM: number; massKg: number; massKgPerM: number }>()
  for (const bar of bars) {
    const total = bySize.get(bar.size) ?? {
      lengthM: 0, massKg: 0,
      massKgPerM: bar.massKgPerM ?? REBAR_MASS_KG_PER_M[bar.size],
    }
    total.lengthM += bar.lengthM
    total.massKg += bar.massKg
    bySize.set(bar.size, total)
  }
  const massTexts = [...bySize].map(([size, total]) =>
    `${size} 計${n(total.lengthM)}m × ${mass(total.massKgPerM)}kg/m`
      + ` = ${mass(total.massKg)}kg = ${mass(total.massKg / 1000)}t`
      + (settings.basis === 'required'
        ? ` × ${n(REBAR_REQUIRED_FACTOR)}（所要）= ${
          mass(total.massKg / 1000 * REBAR_REQUIRED_FACTOR)
        }t` : '（設計）'))
  return `${metric.annotationId}: ${dimensions}: ${barTexts.join('、') || '鉄筋 0本'}`
    + `｜${massTexts.join('、') || '質量 0.000t'}`
    + (bySize.size > 1 ? `｜合計 ${mass(rcOutputValue(rc, settings))}t` : '')
}

function appendMetricSource(
  fixture: CountFixture,
  original: CountFixture,
  source: FixtureLinkSource & { auto?: boolean },
  metricsOf: ((itemId: string) => readonly ShapeMetrics[]) | undefined,
  openingFactor: number,
  result: LinkResult,
): void {
  const link = fixture.link!
  const conditions = source.conditions?.length ? new Set(source.conditions) : undefined
  const factor = (source.factor ?? 1) * openingFactor * (source.sign ?? 1)
  const emptyBasis = (note: string): void => {
    result.sources.push({
      itemId: original.id, quantity: 0, subtotal: 0,
      factor,
      ...(source.perM !== undefined ? { perM: source.perM } : {}),
      ...(source.auto ? { auto: true } : {}),
      note,
    })
  }
  if (metricsOf === undefined) {
    result.warnings.push(`${original.name}の形の計量が渡されていません。`)
    emptyBasis('形の計量未取得')
    return
  }
  if (link.kind === 'rc' && original.rc === undefined) {
    result.warnings.push(`${original.name}にRC部材が設定されていません。`)
    emptyBasis('RC部材未設定')
    return
  }

  if (link.kind === 'steel') {
    const error = original.steel === undefined
      ? '鉄骨部材が設定されていません。'
      : steelMemberError(original.steel)
    if (error) {
      result.warnings.push(`${original.name}: ${error}`)
      emptyBasis(error)
      return
    }
  }

  let used = false
  for (const metric of metricsOf(original.id)) {
    if (metric.crossingOnly) continue
    if (conditions && !conditions.has(metric.condition ?? '')) continue
    used = true
    let quantity: number
    let note: string | undefined
    try {
      if (link.kind === 'rc') {
        const settings = link.rc!
        // RcResult exposes a total lap count. Filtering bars before calculating
        // this output preserves size-specific lap counts without changing RcResult.
        const member = settings.output === 'lapJoint' && settings.sizes !== undefined
          ? {
            ...original.rc!,
            bars: original.rc!.bars.filter(bar => settings.sizes!.includes(bar.size)),
          }
          : original.rc!
        const rc = computeRcMember(member, metric)
        quantity = rcOutputValue(rc, settings)
        note = rcOutputNote(member, metric, rc, settings)
      } else if (link.kind === 'steel') {
        const member = original.steel!
        const section = steelSection(member)!
        const settings = link.steel!
        if (original.link !== undefined
          || (metric.method !== 'polyline' && metric.method !== 'click')
          || !Number.isFinite(metric.count) || metric.count < 0
          || !Number.isFinite(metric.lengthM) || metric.lengthM < 0
          || (metric.method === 'click' && member.lengthMm === undefined)) {
          throw new Error('鉄骨部材の拾い方・長さ・個数が正しくありません。')
        }
        const lengthM = (metric.method === 'click'
          ? member.lengthMm! / 1000 : metric.lengthM) * metric.count
        const lengthText = Number.isInteger(lengthM)
          ? lengthM.toFixed(1) : String(Number(lengthM.toFixed(6)))
        if (settings.output === 'mass') {
          const required = settings.basis === 'required' ? STEEL_REQUIRED_FACTOR.section : 1
          quantity = lengthM * section.massKgPerM / 1000 * required
          note = `${member.section} ${section.massKgPerM}kg/m × ${lengthText}m / 1000`
            + (required !== 1 ? ` × ${required}（所要数量）` : '')
        } else {
          const surface = settings.surface ?? 'contour'
          const surfaceM2PerM = section.surfaceM2PerM(surface)
          quantity = lengthM * surfaceM2PerM
          note = `${member.section} ${surfaceM2PerM}㎡/m × ${lengthText}m（${surface}）`
        }
      } else {
        const settings = link.shape!
        switch (settings.output) {
          case 'area':
            quantity = metric.areaM2 * metric.count
            break
          case 'perimeter':
            quantity = metric.perimeterM * metric.count
            break
          case 'lengthTimesHeight': {
            const height = settings.heightM ?? metric.heightM
            if (height === undefined) {
              result.warnings.push(`${original.name}の連動に使う高さが未設定です。`)
            }
            const length = metric.method === 'polygon' || metric.method === 'polygonDepth'
              ? metric.perimeterM : metric.lengthM
            quantity = length * (height ?? 0) * metric.count
            break
          }
          case 'excavation': {
            const depth = metric.depthM ?? settings.depthM
            if (depth === undefined) {
              result.warnings.push(`${original.name}の連動に使う深さが未設定です。`)
            }
            const effectiveDepth = depth ?? 0
            const clearance = settings.clearanceM ?? 0.5
            const slope = effectiveDepth < 1.5 ? 0 : effectiveDepth < 5 ? 0.3 : 0.6
            const margin = settings.marginM ?? (clearance + slope * effectiveDepth / 2)
            quantity = (metric.areaM2 + metric.perimeterM * margin + 4 * margin ** 2)
              * effectiveDepth * metric.count
            note = `${metric.annotationId}: 余幅 ${margin}m`
              + (settings.marginM !== undefined
                ? '（指定）'
                : `（ゆとり ${clearance}、法 ${slope}）`)
            break
          }
        }
      }
      if (!Number.isFinite(quantity) || quantity < 0) {
        throw new Error('連動の計算結果が有限の数量を超えています。')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '部材・形の計算に失敗しました。'
      result.warnings.push(`${original.name}（${metric.annotationId}）: ${message}`)
      emptyBasis(`${metric.annotationId}: ${message}`)
      continue
    }

    const value = (source.perM !== undefined ? quantity / source.perM : quantity * (source.factor ?? 1))
      * openingFactor * (source.sign ?? 1)
    if (!Number.isFinite(value)) {
      result.warnings.push(`${original.name}（${metric.annotationId}）の係数計算が有限の数量を超えています。`)
      emptyBasis('係数計算の上限超過')
      continue
    }
    result.sources.push({
      itemId: original.id,
      quantity,
      factor,
      subtotal: value,
      ...(source.perM !== undefined ? { perM: source.perM } : {}),
      ...(source.auto ? { auto: true } : {}),
      ...(note !== undefined ? { note } : {}),
    })
    result.entries.push({
      itemId: fixture.id,
      annotationId: metric.annotationId,
      pageIndex: metric.pageIndex,
      value,
      ...(metric.floor !== undefined ? { floor: metric.floor } : {}),
      ...(metric.room !== undefined ? { room: metric.room } : {}),
      ...(link.condition !== undefined
        ? { condition: link.condition.value }
        : metric.condition !== undefined ? { condition: metric.condition } : {}),
    })
  }
  if (!used) emptyBasis('対象の拾いなし')
}

function appendCrossingSource(
  fixture: CountFixture,
  original: CountFixture,
  source: FixtureLinkSource & { auto?: boolean },
  metricsOf: ((itemId: string) => readonly ShapeMetrics[]) | undefined,
  crossingsOf: ((path: ReadonlyArray<[number, number]>, pageIndex: number) => number) | undefined,
  openingFactor: number,
  result: LinkResult,
): void {
  const settings = fixture.link!.crossing!
  const conditions = source.conditions?.length ? new Set(source.conditions) : undefined
  const factor = (source.factor ?? 1) * openingFactor * (source.sign ?? 1)
  const emptyBasis = (note: string): void => {
    result.sources.push({
      itemId: original.id, quantity: 0, subtotal: 0, factor, note,
      ...(source.perM !== undefined ? { perM: source.perM } : {}),
      ...(source.auto ? { auto: true } : {}),
    })
  }
  if (metricsOf === undefined) {
    result.warnings.push(`${original.name}の形の計量が渡されていません。`)
    emptyBasis('形の計量未取得')
    return
  }
  const seen = new Set<string>()
  let used = false
  for (const metric of metricsOf(original.id)) {
    if (metric.method !== 'polyline') continue
    const key = `${metric.pageIndex}\u0000${metric.annotationId}`
    if (seen.has(key)) continue
    seen.add(key)
    const parts = metric.crossingParts ?? [{
      ...(metric.condition !== undefined ? { condition: metric.condition } : {}),
      plan: true,
      riseCount: metric.riseCount ?? 0,
    }]
    let planCount: number | undefined
    for (const part of parts) {
      if (conditions && !conditions.has(part.condition ?? '')) continue
      const countPlan = settings.planCrossings !== false && part.plan
      const riseCount = settings.includeRises ? part.riseCount : 0
      if (!countPlan && !settings.includeRises) continue
      used = true
      if (countPlan && planCount === undefined) {
        if (metric.pathPoints === undefined) {
          result.warnings.push(`${original.name}（${metric.annotationId}）の点列が未取得です。`)
          planCount = 0
        } else {
          planCount = crossingsOf?.(metric.pathPoints, metric.pageIndex) ?? 0
        }
      }
      const quantity = (countPlan ? planCount ?? 0 : 0) + riseCount
      const value = (source.perM !== undefined
        ? quantity / source.perM : quantity * (source.factor ?? 1))
        * openingFactor * (source.sign ?? 1)
      if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(value)) {
        result.warnings.push(`${original.name}（${metric.annotationId}）の交差数量が正しくありません。`)
        emptyBasis(`${metric.annotationId}: 交差数量不正`)
        continue
      }
      result.sources.push({
        itemId: original.id, quantity, subtotal: value, factor,
        note: `${metric.annotationId}: 平面交差 ${countPlan ? planCount ?? 0 : 0}か所`
          + `、立上り・立下り ${riseCount}か所（条数は掛けない）`,
        ...(source.perM !== undefined ? { perM: source.perM } : {}),
        ...(source.auto ? { auto: true } : {}),
      })
      result.entries.push({
        itemId: fixture.id,
        annotationId: metric.annotationId,
        pageIndex: metric.pageIndex,
        value,
        ...(metric.floor !== undefined ? { floor: metric.floor } : {}),
        ...(metric.room !== undefined ? { room: metric.room } : {}),
        ...(part.condition !== undefined ? { condition: part.condition } : {}),
      })
    }
  }
  if (!used) emptyBasis('対象の経路なし')
}

export function computeLinks(
  fixtures: readonly CountFixture[],
  entriesOf: (itemId: string) => readonly LinkSourceEntry[],
  metricsOf?: (itemId: string) => readonly ShapeMetrics[],
): Map<string, LinkResult> {
  const results = new Map<string, LinkResult>()
  const linked = fixtures.filter(f => f.link !== undefined)
  if (!linked.length) return results

  const byId = new Map(fixtures.map(f => [f.id, f]))
  const cyclic = new Set<string>()
  const ordered: CountFixture[] = []
  const dependencies = (fixture: CountFixture): CountFixture[] => {
    const sources: unknown = fixture.link?.sources
    if (!Array.isArray(sources)) return []
    return sources.flatMap(source => {
      if (!record(source) || typeof source.itemId !== 'string') return []
      const dependency = byId.get(source.itemId)
      return dependency?.link !== undefined ? [dependency] : []
    })
  }

  // Strongly connected components (Tarjan): every member of a cycle is marked, wherever the search
  // starts. Components finish after the components they depend on, so this is also the calculation order.
  const indexOf = new Map<string, number>(), lowOf = new Map<string, number>(), onStack = new Set<string>()
  const stack: CountFixture[] = []
  let counter = 0
  const connect = (fixture: CountFixture): void => {
    indexOf.set(fixture.id, counter); lowOf.set(fixture.id, counter); counter++
    stack.push(fixture); onStack.add(fixture.id)
    for (const dependency of dependencies(fixture)) {
      if (!indexOf.has(dependency.id)) {
        connect(dependency)
        lowOf.set(fixture.id, Math.min(lowOf.get(fixture.id)!, lowOf.get(dependency.id)!))
      } else if (onStack.has(dependency.id)) {
        lowOf.set(fixture.id, Math.min(lowOf.get(fixture.id)!, indexOf.get(dependency.id)!))
      }
    }
    if (lowOf.get(fixture.id) !== indexOf.get(fixture.id)) return
    const component: CountFixture[] = []
    let member: CountFixture
    do { member = stack.pop()!; onStack.delete(member.id); component.push(member) } while (member.id !== fixture.id)
    if (component.length > 1 || dependencies(fixture).some(dependency => dependency.id === fixture.id)) {
      for (const item of component) cyclic.add(item.id)
    }
    ordered.push(...component)
  }
  for (const fixture of linked) if (!indexOf.has(fixture.id)) connect(fixture)

  const ordinaryEntries = new Map<string, readonly LinkSourceEntry[]>()
  for (const fixture of ordered) {
    const result: LinkResult = {
      entries: [], total: 0, computed: 0, sources: [], warnings: [], overridden: false,
    }
    results.set(fixture.id, result)
    if (cyclic.has(fixture.id)) {
      result.error = '連動の元が循環しています。'
      continue
    }
    const configurationError = fixtureLinkError(fixture)
    if (configurationError) {
      result.error = configurationError
      continue
    }
    const link = fixture.link!
    const densityTPerM3 = fixtureLinkDensity(fixture)
    if (densityTPerM3 !== undefined) result.densityTPerM3 = densityTPerM3

    const sources = fixtureLinkSources(fixtures, fixture)
    let crossingsOf: ReturnType<typeof createPageCrossingCounter> | undefined
    if (link.kind === 'crossing' && link.crossing!.planCrossings !== false
      && metricsOf !== undefined) {
      const barriers = fixtureCrossingBarriers(
        fixtures, fixture, new Set(sources.map(source => source.itemId)),
      )
      if (barriers.length) {
        const paths: PageCrossingBarrier[] = []
        for (const barrier of barriers) {
          const seen = new Set<string>()
          for (const metric of metricsOf(barrier.id)) {
            if (!metric.pathPoints) continue
            const key = `${metric.pageIndex}\u0000${metric.annotationId}`
            if (seen.has(key)) continue
            seen.add(key)
            paths.push({ pageIndex: metric.pageIndex, path: metric.pathPoints })
          }
        }
        if (paths.length) crossingsOf = createPageCrossingCounter(paths)
      }
    }
    for (const source of sources) {
      const original = byId.get(source.itemId)
      if (!original) {
        result.error = '連動の元の項目が見つかりません。'
        continue
      }
      const openingFactor = openingFactorFor(source, original, result)
      if (link.kind === 'crossing') {
        appendCrossingSource(
          fixture, original, source, metricsOf, crossingsOf, openingFactor, result,
        )
        continue
      }
      if (link.kind === 'rc' || link.kind === 'shape' || link.kind === 'steel') {
        appendMetricSource(fixture, original, source, metricsOf, openingFactor, result)
        continue
      }
      let rows: readonly LinkSourceEntry[]
      if (original.link !== undefined) {
        rows = results.get(original.id)?.entries ?? []
      } else {
        let cached = ordinaryEntries.get(original.id)
        if (cached === undefined) {
          cached = entriesOf(original.id)
          ordinaryEntries.set(original.id, cached)
        }
        rows = cached
      }

      const conditions = source.conditions?.length ? new Set(source.conditions) : undefined
      let unitMassKg = link.kind === 'mass'
        ? original.attributes?.unitMassKg
          ?? ((original.kind ?? 'count') === 'count' ? original.attributes?.massKg : undefined)
        : undefined
      let note: string | undefined
      let carryFactor: number | undefined
      let skipSource = false

      if (link.kind === 'mass') {
        if (unitMassKg === undefined && original.attributes?.massKg === undefined) {
          const keys = [
            `${original.code}${original.spec ?? ''}`.replace(/\s/g, ''),
            original.code.replace(/\s/g, ''),
          ]
          const key = keys.find(value => Object.hasOwn(CONDUIT_MASS_KG_PER_M, value))
          if (key !== undefined) {
            unitMassKg = CONDUIT_MASS_KG_PER_M[key]
            note = 'JIS C 8305 の質量'
          }
        }
        if (unitMassKg === undefined) {
          result.warnings.push(`${original.name}の質量が未設定です。`)
        }
      } else if (link.kind === 'carry') {
        if ((original.kind ?? 'count') !== 'count') {
          result.warnings.push(`${original.name}は個数の項目ではないため、搬入の元から除外します。`)
          note = '個数以外'
          skipSource = true
        } else {
          const attributes = original.attributes
          const massKg = attributes?.massKg
          unitMassKg = massKg ?? 0
          if (massKg === undefined) {
            result.warnings.push(`${original.name}の質量が未設定です。`)
            note = '質量未設定'
            skipSource = true
          } else if (massKg < CARRY_MIN_MASS_KG) {
            note = '100kg未満'
            skipSource = true
          } else {
            const widthMm = attributes?.widthMm
            const depthMm = attributes?.depthMm
            const heightMm = attributes?.heightMm
            if (widthMm === undefined || depthMm === undefined || heightMm === undefined
              || widthMm <= 0 || depthMm <= 0 || heightMm <= 0) {
              result.warnings.push(`${original.name}の外形（幅・奥行・高さ）が未設定です。`)
              note = '外形未設定'
              skipSource = true
            } else {
              const volumeM3 = widthMm * depthMm * heightMm / 1e9
              const densityKgPerM3 = massKg / volumeM3
              const carryClass = densityKgPerM3 >= CARRY_HEAVY_DENSITY_KG_PER_M3
                ? 'heavy' : 'bulky'
              if (carryClass !== link.carry!.class) {
                note = carryClass === 'heavy' ? '重量品' : '容積品'
                skipSource = true
              } else {
                if (carryClass === 'heavy') {
                  const last = CARRY_HEAVY_FACTORS[CARRY_HEAVY_FACTORS.length - 1]
                  carryFactor = (CARRY_HEAVY_FACTORS.find(entry => massKg <= entry.maxKg)
                    ?? last).factor
                  if (massKg > last.maxKg) {
                    result.warnings.push(`${original.name}は補正率の表（15,000kg）を超えます。`)
                  }
                } else {
                  carryFactor = CARRY_BULKY_FACTORS.find(entry =>
                    densityKgPerM3 < entry.belowKgPerM3)?.factor ?? 1
                }
                carryFactor *= link.carry!.alone ? CARRY_ALONE_INCREASE : 1
              }
            }
          }
        }
      }
      const basis: LinkBasisSource = {
        itemId: original.id, quantity: 0, subtotal: 0,
        ...(link.kind === 'carry'
          ? carryFactor !== undefined ? { factor: carryFactor } : {}
          : source.factor !== undefined ? { factor: source.factor } : {}),
        ...(link.kind !== 'carry' && source.perM !== undefined ? { perM: source.perM } : {}),
        ...(unitMassKg !== undefined ? { unitMassKg } : {}),
        ...(source.auto ? { auto: true } : {}),
        ...(note !== undefined ? { note } : {}),
      }
      if (source.factorFrom !== undefined || source.sign !== undefined) {
        if (link.kind !== 'carry' && source.perM === undefined) {
          basis.factor = (source.factor ?? 1) * openingFactor * (source.sign ?? 1)
        }
        const openingNote = source.factorFrom !== undefined
          ? `${source.factorFrom}=${openingFactor}` : undefined
        basis.note = [basis.note, openingNote, source.sign === -1 ? '引き算' : undefined]
          .filter(Boolean).join('、') || undefined
      }
      for (const row of rows) {
        if (conditions && !conditions.has(row.condition ?? '')) continue
        basis.quantity += row.value
        if (skipSource) continue
        let value = link.kind === 'carry'
          ? row.value * (unitMassKg ?? 0) / 1000 * (carryFactor ?? 0)
          : source.perM !== undefined
            ? row.value / source.perM : row.value * (source.factor ?? 1)
        if (link.kind === 'mass') {
          value *= (unitMassKg ?? 0) / 1000
          if (densityTPerM3 !== undefined) value /= densityTPerM3
        }
        value *= openingFactor * (source.sign ?? 1)
        // Preserve legacy carry coefficients; opening-based coefficients also
        // apply the explicitly supplied source factor.
        if (link.kind === 'carry' && source.factorFrom !== undefined) value *= source.factor ?? 1
        basis.subtotal += value
        result.entries.push({
          itemId: fixture.id,
          annotationId: row.annotationId,
          pageIndex: row.pageIndex,
          value,
          ...(row.floor !== undefined ? { floor: row.floor } : {}),
          ...(row.room !== undefined ? { room: row.room } : {}),
          ...(row.part !== undefined ? { part: row.part } : {}),
          ...(link.condition !== undefined
            ? { condition: link.condition.value }
            : row.condition !== undefined ? { condition: row.condition } : {}),
        })
      }
      result.sources.push(basis)
    }

    const rounding = link.rounding ?? 'total'
    const roundsUp = fixtureLinkRoundsUp(fixture)
    if (roundsUp && rounding === 'each') roundEachAnnotation(result.entries)
    let sum = result.entries.reduce((total, entry) => total + entry.value, 0)
    if (sources.some(source => source.sign === -1) && sum < 0) {
      // Clamp only after aggregation. Keep signed source subtotals as evidence,
      // and zero indexed rows so downstream links/pages agree with the total.
      sum = 0
      for (const entry of result.entries) entry.value = 0
    }
    result.computed = roundsUp && rounding === 'total' ? ceilLinkQuantity(sum) : sum
    result.total = result.computed
    if (link.override !== undefined) {
      result.total = link.override.value
      result.overridden = true
      result.entries = []
    }
  }
  return results
}
