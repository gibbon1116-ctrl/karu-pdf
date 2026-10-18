import type { PDFDocument } from 'mupdf'
import type { RGB, Rect } from './annotations'
import { rcMemberError, readRcMember, type RcMember } from './rcMember'
import { steelMemberError, readSteelMember, type SteelMember } from './steelMember'
import { fixtureLinkDensity, fixtureLinkError, readFixtureLink, type FixtureLink } from './fixtureLink'
import { validRouteScope, conditionsFromScope, normalizeRouteConditions, validRouteConditions, parseQuantityMark, serializeQuantityMark, validCondition, validOpeningDimension, type OpeningSize, type RouteConditions } from './quantity'

export const COUNT_SHAPES = ['circle', 'doubleCircle', 'square', 'roundedSquare', 'triangle', 'invertedTriangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star', 'plus', 'cross', 'hourglass'] as const
export const COUNT_FILLS = ['none', 'solid', 'half', 'dot', 'hatch'] as const
export const COUNT_SIZES = [6, 8, 10, 12, 14, 16, 20, 24] as const
export const COUNT_OPACITIES = [1, 0.8, 0.75, 0.5, 0.25] as const
export type CountShape = typeof COUNT_SHAPES[number]
export type CountFill = typeof COUNT_FILLS[number]
export interface CountStyle { shape: CountShape; fill: CountFill; color: RGB; size: number; opacity: number; showCode: boolean }
export interface CountFixtureSample {
  png: string; width: number; height: number; pageIndex: number; rect?: Rect
  lines?: { segments: number[]; widths: number[] }
}
export const COUNT_UNITS = ['個', '台', '面', '基', '組', '本', '枚', '灯', 'か所', '対', '式', '株'] as const
export type CountUnit = typeof COUNT_UNITS[number]
export const CONVERT_UNITS = ['m', '㎡', '㎥', 'kg', 't'] as const
export type ConvertUnit = typeof CONVERT_UNITS[number]
/** 拾った数量（長さ m・面積・体積・個数）× factor を unit の数量として集計する */
export interface FixtureConvert { factor: number; unit: ConvertUnit; basis: string }
export const BREAKDOWN_BOOKS = ['建築', '電気設備', '機械設備', '昇降機設備'] as const
export type BreakdownBook = typeof BREAKDOWN_BOOKS[number]
/** 内訳書の位置。section=種目、subject=科目、middle=中科目（省略可）、item=細目 */
export interface BreakdownPosition { book: BreakdownBook; section: string; subject: string; middle?: string; item: string }
/** 摘要の1区分。label=区分名（例: 形式、呼び径）、value=値 */
export interface SummaryField { label: string; value: string }
/** 連動の計算（B05〜B07）に使う値。どれも任意 */
export interface FixtureAttributes {
  massKg?: number          // 機器の単体質量 kg
  widthMm?: number         // 外形 幅 mm
  depthMm?: number         // 外形 奥行 mm
  heightMm?: number        // 外形 高さ mm
  outerDiameterMm?: number // 管・ポール等の外径 mm
  unitMassKg?: number      // 数量1単位（1m、1個など）あたりの質量 kg
  wasteType?: string       // 発生材の種類（例: 金属くず）
}
export interface FixtureBackfill { deductPipes: true; conditionIncludes: string[] }
export interface CountFixture { backfill?: FixtureBackfill; conditions?: string[]; routeDefaults?: RouteConditions; defaultCondition?: string; spec?: string; aggregation?: 'location' | 'document'; kind?: QuantityKind; method?: QuantityMethod; defaults?: QuantityDefaults; line?: QuantityLineStyle; unit?: CountUnit; convert?: FixtureConvert; link?: FixtureLink; rc?: RcMember; steel?: SteelMember; breakdown?: BreakdownPosition; summary?: SummaryField[]; remark?: string; attributes?: FixtureAttributes; id: string; name: string; code: string; category: string; style: CountStyle; memo?: string; order: number; sample?: CountFixtureSample; opening?: { widthM: number; heightM: number } }
export type QuantityKind = 'count' | 'length' | 'area' | 'volume'
export type QuantityMethod = 'click' | 'polyline' | 'polygon' | 'lengthHeight' | 'polygonDepth' | 'lengthWidthDepth'
export const QUANTITY_METHODS: Record<QuantityKind, readonly QuantityMethod[]> = { count: ['click'], length: ['polyline'], area: ['polygon', 'lengthHeight'], volume: ['polygonDepth', 'lengthWidthDepth'] }
export const QUANTITY_UNITS: Record<QuantityKind, string> = { count: '個', length: 'm', area: 'm²', volume: 'm³' }
export const QUANTITY_LINE_WIDTHS = [0.5, 1, 1.5, 2, 3, 4] as const
export const QUANTITY_DASHES = ['solid', 'dashed', 'dashDot', 'dotted'] as const
export interface QuantityDefaults { slackM?: number; addM?: number; heightM?: number; widthM?: number; depthM?: number }
export interface QuantityLineStyle { width: typeof QUANTITY_LINE_WIDTHS[number]; dash: typeof QUANTITY_DASHES[number] }
export interface QuantityLineAppearance { color: RGB; line: QuantityLineStyle }
export function quantityAggregation(f: CountFixture): 'location' | 'document' { return f.aggregation ?? (quantityKind(f) === 'count' ? 'location' : 'document') }
export function fixtureCode(f: Pick<CountFixture, 'code' | 'spec'>): string { return [f.code, f.spec].filter(Boolean).join(' ') }
// Drawings show the specification only on line pickups, where it is the size (CV 38sq-3C); marks and area labels show the code alone.
export function fixtureDrawingCode(f: Pick<CountFixture, 'code' | 'spec' | 'kind'>): string { return f.kind === 'length' ? fixtureCode(f) : f.code }
/** 長さ・面積・体積の札や経路構成用。個数の印の横の文字には使わない。 */
export function fixtureLabelCode(f: Pick<CountFixture, 'code' | 'spec' | 'kind' | 'name'>): string { return fixtureDrawingCode(f) || f.name }
/** 候補の一覧に出す文字。記号は名称と違うときだけ。detail は規格と摘要（「区分 値」を「・」でつなぐ）。 */
export function fixtureChoiceLabel(f: Pick<CountFixture, 'code' | 'spec' | 'name' | 'summary' | 'kind'>): {
  code: string
  name: string
  detail: string
  text: string
} {
  const normalizeItemName = (value: string) =>
    value.normalize('NFKC').replace(/\s+/g, '')
  const name = f.name
  const trimmedCode = f.code.trim()
  const code = normalizeItemName(trimmedCode) === normalizeItemName(name)
    ? '' : trimmedCode
  const spec = f.spec?.trim() ?? ''
  const parts: string[] = []
  if (spec && !code.includes(spec)) parts.push(`規格 ${spec}`)
  for (const field of f.summary ?? []) {
    const value = field.value.trim()
    if (value) parts.push([field.label.trim(), value].filter(Boolean).join(' '))
  }
  const detail = parts.join('・')
  const text = [code, name, detail ? `（${detail}）` : ''].filter(Boolean).join(' ')
  return { code, name, detail, text }
}
export function quantityKind(f: CountFixture): QuantityKind { return f.kind ?? 'count' }
/** 数量の単位。換算があれば換算後の単位を使う。 */
export function quantityUnit(f: Pick<CountFixture, 'kind' | 'unit' | 'convert' | 'link' | 'attributes'>): string {
  if (f.link?.kind === 'rc') {
    switch (f.link.rc!.output) {
      case 'concrete': return '㎥'
      case 'formwork': return '㎡'
      case 'rebar': return 't'
      case 'gasJoint':
      case 'lapJoint': return 'か所'
    }
  }
  if (f.link?.kind === 'crossing') return 'か所'
  if (f.link?.kind === 'steel') return f.link.steel!.output === 'mass' ? 't' : '㎡'
  if (f.link?.kind === 'carry') return 't'
  if (f.link?.kind === 'mass') return fixtureLinkDensity(f) !== undefined ? '㎥' : 't'
  if (f.convert) return f.convert.unit
  return f.kind === undefined || f.kind === 'count' ? f.unit ?? '個' : QUANTITY_UNITS[f.kind]
}
export function quantityDecimals(f: CountFixture): 0 | 2 {
  if (f.link?.kind === 'rc') {
    return f.link.rc!.output === 'gasJoint' || f.link.rc!.output === 'lapJoint' ? 0 : 2
  }
  if (f.link?.kind === 'crossing') return 0
  if (f.link?.kind === 'steel') return 2
  if (f.link?.kind === 'mass' || f.link?.kind === 'carry') return 2
  return !f.convert && quantityKind(f) === 'count' ? 0 : 2
}
export function quantityOutputKind(f: CountFixture): QuantityKind | 'mass' {
  if (f.link?.kind === 'rc') {
    switch (f.link.rc!.output) {
      case 'concrete': return 'volume'
      case 'formwork': return 'area'
      case 'rebar': return 'mass'
      case 'gasJoint':
      case 'lapJoint': return 'count'
    }
  }
  if (f.link?.kind === 'crossing') return 'count'
  if (f.link?.kind === 'steel') return f.link.steel!.output === 'mass' ? 'mass' : 'area'
  if (f.link?.kind === 'carry') return 'mass'
  if (f.link?.kind === 'mass') return fixtureLinkDensity(f) !== undefined ? 'volume' : 'mass'
  if (!f.convert) return quantityKind(f)
  switch (f.convert.unit) {
    case 'm': return 'length'
    case '㎡': return 'area'
    case '㎥': return 'volume'
    case 'kg':
    case 't': return 'mass'
  }
}
/** 摘要の値を「、」でつないだ文（区分名は含めない）。無ければ '' */
export function summaryText(f: Pick<CountFixture, 'summary'>): string {
  return f.summary?.map(field => field.value).join('、') ?? ''
}
/** 内訳書の位置の同一判定用の文字列。無ければ '' */
export function breakdownKey(f: Pick<CountFixture, 'breakdown'>): string {
  const p = f.breakdown
  return p === undefined ? '' : JSON.stringify([p.book, p.section, p.subject, p.middle ?? '', p.item])
}
/** 同じ項目かの判定。内訳書の位置・摘要の値が違えば別の項目 */
export function fixtureIdentity(f: Pick<CountFixture, 'code' | 'spec' | 'name' | 'breakdown' | 'summary'>): string {
  return JSON.stringify([f.code, f.spec ?? '', f.name, breakdownKey(f), summaryText(f)])
}
function validFixtureText(value: unknown, maxLength: number, trimmed = true): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maxLength
    && (!trimmed || value === value.trim()) && !/[\r\n\t\u2028\u2029]/.test(value)
}
function validFixtureBackfill(value: unknown): value is FixtureBackfill {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const backfill = value as Partial<Record<keyof FixtureBackfill, unknown>>
  return Object.keys(value).every(key => key === 'deductPipes' || key === 'conditionIncludes')
    && backfill.deductPipes === true
    && Array.isArray(backfill.conditionIncludes)
    && backfill.conditionIncludes.length >= 1
    && backfill.conditionIncludes.length <= 5
    && Array.from(backfill.conditionIncludes).every(word => validFixtureText(word, 20))
}

export function fixtureBackfillError(
  f: Pick<CountFixture, 'kind' | 'method' | 'backfill'>,
): string | undefined {
  if (f.backfill === undefined) return undefined
  const method = f.method ?? QUANTITY_METHODS[f.kind ?? 'count'][0]
  if (method !== 'lengthWidthDepth' || !validFixtureBackfill(f.backfill)) {
    return '埋戻しの控除は長さ×幅×深さの項目だけに設定できます。施工条件に含む語は1〜5語、各20字以内で入れてください。'
  }
}

export function validFixtureBreakdown(value: unknown): value is BreakdownPosition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const p = value as Partial<Record<keyof BreakdownPosition, unknown>>
  return BREAKDOWN_BOOKS.some(book => book === p.book)
    && validFixtureText(p.section, 20) && validFixtureText(p.subject, 30)
    && (p.middle === undefined || validFixtureText(p.middle, 30)) && validFixtureText(p.item, 40)
}
function validFixtureSummary(value: unknown): value is SummaryField[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8
    || !Array.from(value).every(field => field && typeof field === 'object' && !Array.isArray(field)
      && validFixtureText(field.label, 20) && validFixtureText(field.value, 60))) return false
  return new Set(value.map(field => field.label)).size === value.length && summaryText({ summary: value }).length <= 120
}
const fixtureAttributeLimits = {
  massKg: 100000, widthMm: 100000, depthMm: 100000, heightMm: 100000,
  outerDiameterMm: 10000, unitMassKg: 100000,
} as const
function validFixtureAttributes(value: unknown): value is FixtureAttributes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.entries(value).every(([key, entry]) => key === 'wasteType'
    ? validFixtureText(entry, 20, false)
    : Object.hasOwn(fixtureAttributeLimits, key) && typeof entry === 'number' && Number.isFinite(entry)
      && entry > 0 && entry <= fixtureAttributeLimits[key as keyof typeof fixtureAttributeLimits])
}
function validFixtureConvert(value: unknown): value is FixtureConvert {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const convert = value as Partial<Record<keyof FixtureConvert, unknown>>
  return typeof convert.factor === 'number' && Number.isFinite(convert.factor)
    && convert.factor > 0 && convert.factor <= 1000000
    && CONVERT_UNITS.some(unit => unit === convert.unit)
    && typeof convert.basis === 'string' && convert.basis.length <= 60
    && !/[\r\n\t\u2028\u2029]/.test(convert.basis)
}
export function fixtureConvertError(f: Pick<CountFixture, 'convert'>): string | undefined {
  if (f.convert !== undefined && !validFixtureConvert(f.convert)) {
    return '数量の換算は、係数を0より大きい数で、単位を候補から入れてください。'
  }
}
function fixtureSteelError(
  f: Pick<CountFixture, 'kind' | 'steel'>,
): string | undefined {
  if (f.steel === undefined) return undefined
  const error = steelMemberError(f.steel)
  if (error) return error
  if (f.kind !== undefined && f.kind !== 'count' && f.kind !== 'length') {
    return '鉄骨部材は線または個数で拾ってください。'
  }
  if ((f.kind ?? 'count') === 'count' && f.steel.lengthMm === undefined) {
    return '個数で拾う鉄骨部材には1本の長さを設定してください。'
  }
}

export function fixtureBreakdownError(f: Pick<CountFixture, 'kind' | 'steel' | 'unit' | 'convert' | 'breakdown' | 'summary' | 'remark' | 'attributes'>): string | undefined {
  const convertError = fixtureConvertError(f)
  if (convertError) return convertError
  if (f.unit !== undefined && ((f.kind !== undefined && f.kind !== 'count') || !COUNT_UNITS.some(unit => unit === f.unit))) {
    return '単位は個数の項目だけに、候補の中から設定できます。'
  }
  if (f.breakdown !== undefined && !validFixtureBreakdown(f.breakdown)) {
    return '内訳書の位置は、編・種目・科目・細目を入れてください（中科目は省略できます）。種目は20字、科目・中科目は30字、細目は40字までです。'
  }
  // An empty list means no summary; serializeCountFixtures omits it.
  if (f.summary !== undefined && !(Array.isArray(f.summary) && f.summary.length === 0) && !validFixtureSummary(f.summary)) {
    return '摘要は8区分まで、区分名は20字、値は60字、合わせて120字までです。同じ区分名は使えません。'
  }
  if (f.remark !== undefined && !validFixtureText(f.remark, 40, false)) return '備考は40字までです。'
  if (f.attributes !== undefined && !validFixtureAttributes(f.attributes)) {
    return '連動に使う値（質量・寸法・外径・単位質量・発生材の種類）が正しくありません。'
  }
  return fixtureSteelError(f)
}
function readFixtureBreakdownFields(f: Pick<CountFixture, 'id' | 'link' | 'rc' | 'steel' | 'kind' | 'method' | 'backfill' | 'unit' | 'convert' | 'breakdown' | 'summary' | 'remark' | 'attributes'>): Pick<CountFixture, 'link' | 'rc' | 'steel' | 'backfill' | 'unit' | 'convert' | 'breakdown' | 'summary' | 'remark' | 'attributes'> {
  const link = readFixtureLink(f)
  const rc = f.rc === undefined ? undefined : readRcMember(f.rc)
  const steel = f.steel === undefined || fixtureSteelError(f)
    ? undefined : readSteelMember(f.steel)
  return {
    ...(link ? { link } : {}),
    ...(rc ? { rc } : {}),
    ...(steel ? { steel } : {}),
    ...(f.backfill !== undefined && !fixtureBackfillError(f) ? {
      backfill: {
        deductPipes: true as const,
        conditionIncludes: [...f.backfill.conditionIncludes],
      },
    } : {}),
    ...(f.unit !== undefined && !fixtureBreakdownError({ kind: f.kind, unit: f.unit }) ? { unit: f.unit } : {}),
    ...(validFixtureConvert(f.convert) ? { convert: { factor: f.convert.factor, unit: f.convert.unit, basis: f.convert.basis } } : {}),
    ...(validFixtureBreakdown(f.breakdown) ? { breakdown: { ...f.breakdown } } : {}),
    ...(validFixtureSummary(f.summary) ? { summary: f.summary.map(field => ({ label: field.label, value: field.value })) } : {}),
    ...(validFixtureText(f.remark, 40, false) ? { remark: f.remark } : {}),
    ...(validFixtureAttributes(f.attributes) && Object.keys(f.attributes).length ? { attributes: { ...f.attributes } } : {}),
  }
}
export function parseFixtureOpening(value: unknown): CountFixture['opening'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const opening = value as { widthM?: unknown; heightM?: unknown }
  return validOpeningDimension(opening.widthM) && validOpeningDimension(opening.heightM)
    ? { widthM: opening.widthM, heightM: opening.heightM } : undefined
}
export function fixtureOpeningSize(fixtures: readonly CountFixture[]): OpeningSize {
  const sizes = new Map<string, NonNullable<CountFixture['opening']>>()
  for (const fixture of fixtures) {
    const opening = quantityKind(fixture) === 'count' ? parseFixtureOpening(fixture.opening) : undefined
    if (opening) sizes.set(fixture.id, opening)
  }
  return itemId => sizes.get(itemId)
}
export function quantityMethod(f: CountFixture): QuantityMethod { return f.method ?? QUANTITY_METHODS[quantityKind(f)][0] }
export function quantityLine(f: CountFixture): QuantityLineStyle { return f.line ?? { width: 1.5, dash: 'solid' } }
export function sameFixtureAppearance(a: CountFixture, b: CountFixture): boolean {
  if (quantityKind(a) !== quantityKind(b)) return false
  return quantityKind(a) === 'count' ? sameCountAppearance(a.style, b.style) : quantityMethod(a) === quantityMethod(b) && countHex(a.style.color) === countHex(b.style.color) && quantityLine(a).width === quantityLine(b).width && quantityLine(a).dash === quantityLine(b).dash
}
export const MAX_COUNT_FIXTURES = 1000
export const MAX_COUNT_FIXTURE_BYTES = 4 * 1024 * 1024
export const MAX_COUNT_SAMPLE_BASE64 = 48 * 1024
export function parseCountFixtureSample(value: unknown): CountFixtureSample | undefined {
  if (!value || typeof value !== 'object') return undefined
  const s = value as CountFixtureSample
  if (typeof s.png !== 'string' || s.png.length > MAX_COUNT_SAMPLE_BASE64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s.png)
    || !Number.isInteger(s.width) || s.width < 16 || s.width > 160 || !Number.isInteger(s.height) || s.height < 16 || s.height > 160
    || !Number.isSafeInteger(s.pageIndex) || s.pageIndex < 0) return undefined
  try {
    const bytes = atob(s.png)
    if (bytes.length < 33 || btoa(bytes) !== s.png || ![137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes.charCodeAt(i) === b)) return undefined
    const uint32 = (offset: number) => Array.from({ length: 4 }, (_, i) => bytes.charCodeAt(offset + i)).reduce((n, b) => n * 256 + b, 0)
    if (uint32(8) !== 13 || bytes.slice(12, 16) !== 'IHDR' || uint32(16) !== s.width || uint32(20) !== s.height) return undefined
    const rect = Array.isArray(s.rect) && s.rect.length === 4
      && s.rect.every(v => typeof v === 'number' && Number.isFinite(v))
      && s.rect[2] > s.rect[0] && s.rect[3] > s.rect[1]
      ? [...s.rect] as Rect : undefined
    const lines = rect && s.lines && Array.isArray(s.lines.segments) && Array.isArray(s.lines.widths)
      && s.lines.segments.length % 4 === 0
      && s.lines.segments.length >= 8 && s.lines.segments.length <= 256 * 4
      && s.lines.widths.length === s.lines.segments.length / 4
      && s.lines.segments.every(v => typeof v === 'number' && Number.isFinite(v))
      && s.lines.widths.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0)
      ? { segments: [...s.lines.segments], widths: [...s.lines.widths] } : undefined
    return {
      png: s.png, width: s.width, height: s.height, pageIndex: s.pageIndex,
      ...(rect ? { rect } : {}), ...(lines ? { lines } : {}),
    }
  } catch { return undefined }
}
export const COUNT_COLORS = ['#E60012', '#FF7F00', '#FFD400', '#8FD400', '#00A040', '#00B8A9', '#00B7EB', '#0068B7', '#1D2088', '#7B2CBF', '#E4007F', '#FF66B2', '#A0522D', '#808000', '#606060', '#000000', '#FF4D4D', '#FFB347', '#FFF04D', '#66E066', '#66D9FF', '#6699FF', '#B388FF', '#FF99CC'] as const
export function countRgb(hex: string): RGB { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB }
export function countHex(rgb: RGB): string { return '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase() }
export function sameCountAppearance(a: CountStyle, b: CountStyle): boolean { return a.shape === b.shape && a.fill === b.fill && countHex(a.color) === countHex(b.color) }
type CountCandidate = { shape: CountShape; fill: CountFill; hex: string; key: string }
function cachedCandidates<T>(build: () => T[]): () => readonly T[] {
  let candidates: T[] | undefined
  return () => candidates ??= build()
}
function usageCounts<T>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}
function appearanceKeys<T>(used: readonly T[], excluded: readonly T[], key: (value: T) => string): Set<string> {
  return new Set([...used.map(key), ...excluded.map(key)])
}
function leastUsedCandidate<T extends { key: string }>(candidates: readonly T[], used: ReadonlySet<string>, score: (candidate: T) => number): T | undefined {
  let best: T | undefined, bestScore = Infinity
  for (const candidate of candidates) {
    if (used.has(candidate.key)) continue
    const candidateScore = score(candidate)
    if (candidateScore < bestScore) { best = candidate; bestScore = candidateScore; if (candidateScore === 0) break }
  }
  return best
}
// Every combination once, in the tie-break order. Built on first use and reused.
const allCountCandidates = cachedCandidates<CountCandidate>(() => {
  const list: CountCandidate[] = [], seen = new Set<string>()
  const add = (shape: CountShape, fill: CountFill, hex: string) => {
    const key = `${shape}:${fill}:${hex}`
    if (!seen.has(key)) { seen.add(key); list.push({ shape, fill, hex, key }) }
  }
  for (let i = 0; i < 840; i++) add(COUNT_SHAPES[i % 14], COUNT_FILLS[Math.floor(i / 14) % 5], COUNT_COLORS[(i * 7) % 24])
  // The prescribed sequence covers 840 combinations (shape/color parity is linked).
  // Continue with the remaining combinations so all 1,000 fixture slots are usable.
  for (const fill of COUNT_FILLS) for (const shape of COUNT_SHAPES) for (const hex of COUNT_COLORS) add(shape, fill, hex)
  return list
})
export function nextCountStyle(fixtures: readonly CountFixture[], excluded: readonly CountStyle[] = []): CountStyle {
  const key = (s: CountStyle) => `${s.shape}:${s.fill}:${countHex(s.color)}`
  const used = appearanceKeys(fixtures.map(f => f.style), excluded, key)
  const shapes = usageCounts(fixtures.map(f => f.style.shape)), colors = usageCounts(fixtures.map(f => countHex(f.style.color))), fills = usageCounts(fixtures.map(f => f.style.fill))
  const best = leastUsedCandidate(allCountCandidates(), used, candidate => (shapes.get(candidate.shape) ?? 0) + (colors.get(candidate.hex) ?? 0) + (fills.get(candidate.fill) ?? 0))
  if (!best) throw new Error('印の組合せを割り当てられません。')
  return { shape: best.shape, fill: best.fill, color: countRgb(best.hex), size: 10, opacity: .8, showCode: true }
}
type LineCandidate = { hex: string; line: QuantityLineStyle; tier: number; key: string }
const lineAppearanceKey = (appearance: QuantityLineAppearance) => `${countHex(appearance.color)}:${appearance.line.dash}:${appearance.line.width}`
const allLineCandidates = cachedCandidates<LineCandidate>(() => {
  const list: LineCandidate[] = []
  const widths = [1.5, 3, ...QUANTITY_LINE_WIDTHS.filter(width => width !== 1.5 && width !== 3)] as const
  for (const [widthIndex, width] of widths.entries()) for (const [dashIndex, dash] of QUANTITY_DASHES.entries()) for (let i = 0; i < COUNT_COLORS.length; i++) {
    const hex = COUNT_COLORS[(i * 7) % COUNT_COLORS.length], line = { width, dash }
    list.push({ hex, line, tier: widthIndex * QUANTITY_DASHES.length + dashIndex, key: `${hex}:${dash}:${width}` })
  }
  return list
})
export function nextQuantityLineStyle(fixtures: readonly CountFixture[], excluded: readonly QuantityLineAppearance[] = []): QuantityLineAppearance {
  const appearances = fixtures.filter(f => quantityKind(f) !== 'count').map(f => ({ color: f.style.color, line: quantityLine(f) }))
  const used = appearanceKeys(appearances, excluded, lineAppearanceKey)
  const colors = usageCounts(appearances.map(a => countHex(a.color))), dashes = usageCounts(appearances.map(a => a.line.dash)), widths = usageCounts(appearances.map(a => a.line.width))
  const candidates = allLineCandidates(), tier = candidates.find(candidate => !used.has(candidate.key))?.tier
  // Exhaust colors before changing dash, and dashes before changing width.
  // Adaptive weights ensure even N secondary uses cannot outweigh one color use.
  const dashWeight = 1 / (appearances.length + 1), widthWeight = dashWeight ** 2
  const best = leastUsedCandidate(candidates.filter(candidate => candidate.tier === tier), used, candidate => (colors.get(candidate.hex) ?? 0) + (dashes.get(candidate.line.dash) ?? 0) * dashWeight + (widths.get(candidate.line.width) ?? 0) * widthWeight)
  if (!best) throw new Error('線の組合せを割り当てられません。')
  return { color: countRgb(best.hex), line: { ...best.line } }
}
// Rename intent belongs to an edit, never to PDF data. Keep it separate from reorder/deletion.
const conditionEdits = new WeakMap<CountFixture, ReadonlyMap<string, string>>()
export function setFixtureConditionRenames(f: CountFixture, renames: ReadonlyMap<string, string>): void { conditionEdits.set(f, new Map(renames)) }
export function fixtureConditionRenames(f: CountFixture): ReadonlyMap<string, string> { return conditionEdits.get(f) ?? new Map() }
// 寸法の反映指定も編集時だけの情報。PDF・複製・Undoの項目データには残さない。
const dimensionEdits = new WeakSet<CountFixture>()
export function setFixtureDimensionUpdate(f: CountFixture, enabled: boolean): void {
  if (enabled) dimensionEdits.add(f)
  else dimensionEdits.delete(f)
}
export function fixtureDimensionUpdateEnabled(f: CountFixture): boolean {
  return dimensionEdits.has(f)
}
export function fixtureConditionsError(f: Pick<CountFixture, 'conditions' | 'routeDefaults' | 'defaultCondition' | 'kind'>): string | undefined {
  const candidates = f.conditions === undefined ? [] : f.conditions
  if (!Array.isArray(candidates) || candidates.length > 30) return '施工条件の候補は30件までです。'
  if (!Array.from(candidates).every(validCondition)) return '施工条件は1〜30文字で、前後の空白や改行を入れずに入力してください。'
  if (new Set(candidates).size !== candidates.length) return '同じ施工条件が重複しています。'
  if (f.routeDefaults !== undefined) {
    const c = f.routeDefaults
    if (f.kind !== 'length' || !validRouteConditions(c) || Object.keys(c).some(k => !['plan', 'rise', 'slack'].includes(k))
      || [c.plan, ...(Array.isArray(c.rise) ? c.rise : [c.rise]), c.slack].some(v => v !== undefined && v !== null && (typeof v !== 'string' || !candidates.includes(v)))) return '部分ごとの既定は長さの項目だけに設定でき、未設定・候補・数えないから選んでください。'
  }
  if (f.defaultCondition !== undefined && (f.kind === 'length' || !validCondition(f.defaultCondition) || !candidates.includes(f.defaultCondition))) return '既定の施工条件は候補の中から選んでください（長さは部分ごとに設定します）。'
}
// Reuse SPEC-07a's riseUnset encoding so explicit unset slots survive JSON.
function readFixtureRouteDefaults(value: unknown): RouteConditions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['plan', 'rise', 'slack', 'riseUnset'].includes(k))) return null
  return parseQuantityMark(JSON.stringify({ version: 1, id: 'defaults', itemId: 'defaults', method: 'polyline', cond: value }))?.cond ?? null
}
function wireFixtureRouteDefaults(cond: RouteConditions): object {
  return JSON.parse(serializeQuantityMark({ version: 1, id: 'defaults', itemId: 'defaults', method: 'polyline', cond })).cond ?? {}
}
export function parseCountFixtures(raw: string | null): CountFixture[] {
  try {
    if (!raw || new TextEncoder().encode(raw).length > MAX_COUNT_FIXTURE_BYTES) return []
    const data = JSON.parse(raw)
    if (data?.version !== 1 || !Array.isArray(data.fixtures) || data.fixtures.length > MAX_COUNT_FIXTURES) return []
    const ids = new Set<string>(), result: CountFixture[] = []
    for (const f of data.fixtures) {
      const s = f?.style
      if (!f || typeof f.id !== 'string' || !f.id || f.id.length > 80 || ids.has(f.id)
        || typeof f.name !== 'string' || !f.name.trim() || f.name.length > 80
        || typeof f.code !== 'string' || f.code.length > 16 || typeof f.category !== 'string' || !f.category.trim() || f.category.length > 40
        || (f.spec !== undefined && (typeof f.spec !== 'string' || f.spec.length > 40))
        || (f.aggregation !== undefined && !['location', 'document'].includes(f.aggregation))
        || (f.memo !== undefined && (typeof f.memo !== 'string' || f.memo.length > 200))
        || !Number.isSafeInteger(f.order) || f.order < 0 || !s || !COUNT_SHAPES.includes(s.shape) || !COUNT_FILLS.includes(s.fill)
        || !COUNT_SIZES.includes(s.size) || !COUNT_OPACITIES.includes(s.opacity) || typeof s.showCode !== 'boolean'
        || !Array.isArray(s.color) || s.color.length !== 3 || !s.color.every((v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) continue
      const kind = f.kind === undefined ? 'count' : f.kind
      if ((f.routeScope !== undefined && (kind !== 'length' || !validRouteScope(f.routeScope))) || (f.defaults?.slackM !== undefined && kind !== 'length') || !Object.hasOwn(QUANTITY_METHODS, kind) || (f.method !== undefined && !QUANTITY_METHODS[kind as QuantityKind].includes(f.method))
        || (f.defaults !== undefined && (!f.defaults || typeof f.defaults !== 'object' || Array.isArray(f.defaults) || Object.entries(f.defaults).some(([k, v]) => !['addM', 'slackM', 'heightM', 'widthM', 'depthM'].includes(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000)))
        || (f.line !== undefined && (!f.line || !QUANTITY_LINE_WIDTHS.includes(f.line.width) || !QUANTITY_DASHES.includes(f.line.dash)))) continue
      const routeDefaults = f.routeDefaults !== undefined ? readFixtureRouteDefaults(f.routeDefaults) : f.routeScope && f.routeScope !== 'all' ? conditionsFromScope(f.routeScope) : undefined
      if (routeDefaults === null || fixtureConditionsError({ ...f, routeDefaults })) continue
      ids.add(f.id)
      const sample = parseCountFixtureSample(f.sample)
      const opening = kind === 'count' ? parseFixtureOpening(f.opening) : undefined
      result.push({ ...(f.conditions !== undefined ? { conditions: [...f.conditions] } : {}), ...(routeDefaults !== undefined ? { routeDefaults } : {}), ...(f.defaultCondition !== undefined ? { defaultCondition: f.defaultCondition } : {}), ...(f.spec?.trim() ? { spec: f.spec.trim() } : {}), ...(f.aggregation !== undefined ? { aggregation: f.aggregation } : {}), ...(f.kind !== undefined ? { kind: f.kind } : {}), ...(f.method !== undefined ? { method: f.method } : {}), ...(f.defaults !== undefined ? { defaults: { ...f.defaults } } : {}), ...(f.line !== undefined ? { line: { ...f.line } } : {}), id: f.id, name: f.name.trim(), code: f.code, category: f.category.trim(), memo: f.memo, order: f.order, ...(sample ? { sample } : {}), ...(opening ? { opening } : {}), ...readFixtureBreakdownFields(f), style: { shape: s.shape, fill: s.fill, color: [...s.color] as RGB, size: s.size, opacity: s.opacity, showCode: s.showCode } })
    }
    return result.sort((a, b) => a.order - b.order)
  } catch { return [] }
}
export function serializeCountFixtures(fixtures: readonly CountFixture[]): string {
  const normalized: CountFixture[] = []
  for (const f of fixtures) {
    const error = fixtureConditionsError(f) ?? fixtureBreakdownError(f) ?? fixtureBackfillError(f) ?? fixtureLinkError(f)
      ?? (f.rc === undefined ? undefined : rcMemberError(f.rc, {
        fromShape: quantityMethod(f) === 'polygonDepth',
        fromLine: quantityMethod(f) === 'polyline',
        fromSection: quantityMethod(f) === 'lengthWidthDepth',
      }))
    if (error) throw new Error(error)
    normalized.push(f.link === undefined && f.rc === undefined && f.steel === undefined ? f : {
      ...f,
      ...(f.link !== undefined ? { link: readFixtureLink(f) } : {}),
      ...(f.rc !== undefined ? { rc: readRcMember(f.rc) } : {}),
      ...(f.steel !== undefined ? { steel: readSteelMember(f.steel) } : {}),
    })
  }
  fixtures = normalized
  const raw = JSON.stringify({ version: 1, fixtures: fixtures.map(f => ({ ...f, unit: f.unit, breakdown: f.breakdown, summary: f.summary?.length ? f.summary : undefined, remark: f.remark, attributes: f.attributes && Object.keys(f.attributes).length ? f.attributes : undefined, opening: quantityKind(f) === 'count' ? parseFixtureOpening(f.opening) : undefined, routeDefaults: f.routeDefaults === undefined ? undefined : wireFixtureRouteDefaults(f.routeDefaults), routeScope: f.routeDefaults?.plan === null && f.routeDefaults?.slack === null ? 'rise' : f.routeDefaults?.slack === null ? 'noSlack' : undefined, defaults: f.defaults ? { ...f.defaults, slackM: f.defaults.slackM === 0 ? undefined : f.defaults.slackM } : undefined, spec: f.spec?.trim() || undefined })).map(f => f.kind === 'count' && f.method === undefined && f.defaults === undefined && f.line === undefined ? { ...f, kind: undefined } : f) })
  if (fixtures.some(f => f.spec !== undefined && (typeof f.spec !== 'string' || f.spec.length > 40)) || fixtures.length > MAX_COUNT_FIXTURES || fixtures.some(f => f.sample !== undefined && !parseCountFixtureSample(f.sample)) || new TextEncoder().encode(raw).length > MAX_COUNT_FIXTURE_BYTES || parseCountFixtures(raw).length !== fixtures.length) throw new Error('数量拾いの値・件数・容量が上限を超えています。')
  return raw
}
export function readCountFixtures(doc: PDFDocument): CountFixture[] {
  const root = doc.getTrailer().get('Root'), value = root.get('KaruCountFixtures')
  try { return value.isString() ? parseCountFixtures(value.asString()) : [] } finally { value.destroy(); root.destroy() }
}
export function writeCountFixtures(doc: PDFDocument, fixtures: readonly CountFixture[]): void {
  const raw = serializeCountFixtures(fixtures), root = doc.getTrailer().get('Root'), value = doc.newString(raw)
  try { root.put('KaruCountFixtures', value) } finally { value.destroy(); root.destroy() }
}
export interface FixturePreset { conditions?: string[]; spec?: string; aggregation?: 'location' | 'document'; category: string; code: string; name: string; kind?: QuantityKind; method?: QuantityMethod; defaults?: QuantityDefaults; unit?: CountUnit; convert?: FixtureConvert; breakdown?: BreakdownPosition; summary?: SummaryField[]; remark?: string; attributes?: FixtureAttributes }
export const FIXTURE_PRESETS: Record<string, FixturePreset[]> = {}
const presets: Record<string, Record<string, string[]>> = {
  電気設備: {
    照明器具: ['DL ダウンライト', 'BL ベースライト（直付）', 'BE ベースライト（埋込）', 'BR ブラケット', 'PD ペンダント', 'SP スポットライト', 'EM 非常用照明', 'GA 誘導灯（避難口）', 'GB 誘導灯（通路）', 'OL 外灯'],
    コンセント: ['C2 コンセント（2口）', 'C2E コンセント（2口・接地極付）', 'CET コンセント（接地端子付）', 'CWP 防水コンセント', 'CF 床コンセント', 'CAC エアコン用コンセント'],
    スイッチ: ['S 片切スイッチ', 'S3 3路スイッチ', 'DM 調光器', 'HS 人感センサー'],
    '弱電・防災': ['LAN 情報コンセント', 'TEL 電話', 'TV テレビ端子', 'SD 煙感知器', 'HD 熱感知器', 'SPK 非常放送スピーカー', 'IC インターホン', 'CAM 防犯カメラ'],
  },
  機械設備: { 空調: ['AC 天井カセット形室内機', 'ACW 壁掛形室内機', 'SA 吹出口', 'RA 吸込口'], 換気: ['EF 天井換気扇', 'EFW 壁付換気扇', 'OA 給気口', 'EA 排気ガラリ'], 衛生器具: ['WC 大便器', 'UR 小便器', 'LV 洗面器', 'HW 手洗器', 'SK 流し', 'SSK 掃除流し', 'WH 給湯器'], 消火: ['FH 屋内消火栓', 'SPH スプリンクラーヘッド', 'FE 消火器'] },
  建築: { 建具: ['DS 片開き戸', 'DD 両開き戸', 'DSL 引戸', 'WS 引違い窓', 'WF FIX窓', 'SHT シャッター'], '内装・備品': ['INS 点検口', 'HR 手すり', 'WB ホワイトボード', 'LK ロッカー', 'SB 下足箱', 'SG サイン'] },
}
for (const [field, categories] of Object.entries(presets)) FIXTURE_PRESETS[field] = Object.entries(categories).flatMap(([category, items]) => items.map(item => ({ category, code: item.slice(0, item.indexOf(' ')), name: item.slice(item.indexOf(' ') + 1) })))

const lengthPresets: Record<string, Record<string, string[]>> = {
  電気設備: { '電線・ケーブル': ['CV ケーブル（CV）', 'CVT ケーブル（CVT）', 'EM-CE ケーブル（EM-CE）', 'EM-EEF ケーブル（EM-EEF）', 'VVF ケーブル（VVF）', 'IV 電線（IV）'], 電線管: ['E 薄鋼電線管（E）', 'G 厚鋼電線管（G）', 'PF 合成樹脂製可とう電線管（PF）', 'CD 合成樹脂製可とう電線管（CD）', 'VE 硬質ビニル電線管（VE）', 'FEP 波付硬質合成樹脂管（FEP）'], ケーブルラック: ['CR ケーブルラック'] },
  機械設備: { ダクト: ['SD 角ダクト', 'RD 丸ダクト（スパイラル）'], 配管: ['SGP 配管用炭素鋼鋼管', 'VP 硬質ポリ塩化ビニル管', 'RP 冷媒管', 'DP ドレン管'] },
}
for (const [field, categories] of Object.entries(lengthPresets)) FIXTURE_PRESETS[field].push(...Object.entries(categories).flatMap(([category, items]) => items.map(item => ({ category, code: item.slice(0, item.indexOf(' ')), name: item.slice(item.indexOf(' ') + 1), kind: 'length' as const, method: 'polyline' as const }))))

const areaVolumePresets: Record<string, FixturePreset[]> = {
  '仮設・土工': [
    { category: '仮設', code: '外部足場', name: '外部足場（長さ×高さ）', kind: 'area', method: 'lengthHeight' },
    { category: '仮設', code: '内部足場', name: '内部足場（囲む）', kind: 'area', method: 'polygon' },
    { category: '仮設', code: '養生', name: '養生（囲む）', kind: 'area', method: 'polygon' },
    { category: '土工', code: '根切り', name: '根切り（囲む×深さ）', kind: 'volume', method: 'polygonDepth' },
    { category: '土工', code: '床掘り', name: '床掘り（囲む×深さ）', kind: 'volume', method: 'polygonDepth' },
    { category: '土工', code: '溝掘削', name: 'ケーブル・配管の溝掘削（長さ×幅×深さ）', kind: 'volume', method: 'lengthWidthDepth', defaults: { widthM: .6, depthM: .8 } },
    { category: '撤去', code: '床撤去', name: '床仕上げの撤去（囲む）', kind: 'area', method: 'polygon' },
    { category: '撤去', code: '天井撤去', name: '天井の撤去（囲む）', kind: 'area', method: 'polygon' },
  ],
}
for (const [field, items] of Object.entries(areaVolumePresets)) FIXTURE_PRESETS[field] = [...(FIXTURE_PRESETS[field] ?? []), ...items]

for (const items of Object.values(FIXTURE_PRESETS)) for (const item of items) item.aggregation = item.kind && item.kind !== 'count' ? 'document' : 'location'
