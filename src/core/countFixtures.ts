import type { PDFDocument } from 'mupdf'
import type { RGB } from './annotations'

export const COUNT_SHAPES = ['circle', 'doubleCircle', 'square', 'roundedSquare', 'triangle', 'invertedTriangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star', 'plus', 'cross', 'hourglass'] as const
export const COUNT_FILLS = ['none', 'solid', 'half', 'dot', 'hatch'] as const
export const COUNT_SIZES = [6, 8, 10, 12, 14, 16, 20, 24] as const
export const COUNT_OPACITIES = [1, 0.8, 0.75, 0.5, 0.25] as const
export type CountShape = typeof COUNT_SHAPES[number]
export type CountFill = typeof COUNT_FILLS[number]
export interface CountStyle { shape: CountShape; fill: CountFill; color: RGB; size: number; opacity: number; showCode: boolean }
export interface CountFixtureSample { png: string; width: number; height: number; pageIndex: number }
export interface CountFixture { kind?: QuantityKind; method?: QuantityMethod; defaults?: QuantityDefaults; line?: QuantityLineStyle; id: string; name: string; code: string; category: string; style: CountStyle; memo?: string; order: number; sample?: CountFixtureSample }
export type QuantityKind = 'count' | 'length' | 'area' | 'volume'
export type QuantityMethod = 'click' | 'polyline' | 'polygon' | 'lengthHeight' | 'polygonDepth' | 'lengthWidthDepth'
export const QUANTITY_METHODS: Record<QuantityKind, readonly QuantityMethod[]> = { count: ['click'], length: ['polyline'], area: ['polygon', 'lengthHeight'], volume: ['polygonDepth', 'lengthWidthDepth'] }
export const QUANTITY_UNITS: Record<QuantityKind, string> = { count: '個', length: 'm', area: 'm²', volume: 'm³' }
export const QUANTITY_LINE_WIDTHS = [0.5, 1, 1.5, 2, 3, 4] as const
export const QUANTITY_DASHES = ['solid', 'dashed', 'dashDot', 'dotted'] as const
export interface QuantityDefaults { addM?: number; heightM?: number; widthM?: number; depthM?: number }
export interface QuantityLineStyle { width: typeof QUANTITY_LINE_WIDTHS[number]; dash: typeof QUANTITY_DASHES[number] }
export function quantityKind(f: CountFixture): QuantityKind { return f.kind ?? 'count' }
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
    return { png: s.png, width: s.width, height: s.height, pageIndex: s.pageIndex }
  } catch { return undefined }
}
export const COUNT_COLORS = ['#E60012', '#FF7F00', '#FFD400', '#8FD400', '#00A040', '#00B8A9', '#00B7EB', '#0068B7', '#1D2088', '#7B2CBF', '#E4007F', '#FF66B2', '#A0522D', '#808000', '#606060', '#000000', '#FF4D4D', '#FFB347', '#FFF04D', '#66E066', '#66D9FF', '#6699FF', '#B388FF', '#FF99CC'] as const
export function countRgb(hex: string): RGB { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB }
export function countHex(rgb: RGB): string { return '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase() }
export function sameCountAppearance(a: CountStyle, b: CountStyle): boolean { return a.shape === b.shape && a.fill === b.fill && countHex(a.color) === countHex(b.color) }
type CountCandidate = { shape: CountShape; fill: CountFill; hex: string; key: string }
let countCandidates: CountCandidate[] | undefined
// Every combination once, in the tie-break order. Built on first use and reused.
function allCountCandidates(): CountCandidate[] {
  if (countCandidates) return countCandidates
  const list: CountCandidate[] = [], seen = new Set<string>()
  const add = (shape: CountShape, fill: CountFill, hex: string) => {
    const key = `${shape}:${fill}:${hex}`
    if (!seen.has(key)) { seen.add(key); list.push({ shape, fill, hex, key }) }
  }
  for (let i = 0; i < 840; i++) add(COUNT_SHAPES[i % 14], COUNT_FILLS[Math.floor(i / 14) % 5], COUNT_COLORS[(i * 7) % 24])
  // The prescribed sequence covers 840 combinations (shape/color parity is linked).
  // Continue with the remaining combinations so all 1,000 fixture slots are usable.
  for (const fill of COUNT_FILLS) for (const shape of COUNT_SHAPES) for (const hex of COUNT_COLORS) add(shape, fill, hex)
  return countCandidates = list
}
export function nextCountStyle(fixtures: readonly CountFixture[], excluded: readonly CountStyle[] = []): CountStyle {
  const key = (s: CountStyle) => `${s.shape}:${s.fill}:${countHex(s.color)}`
  const used = new Set([...fixtures.map(f => key(f.style)), ...excluded.map(key)])
  const shapes = new Map<string, number>(), colors = new Map<string, number>(), fills = new Map<string, number>()
  for (const { style } of fixtures) {
    shapes.set(style.shape, (shapes.get(style.shape) ?? 0) + 1)
    const hex = countHex(style.color)
    colors.set(hex, (colors.get(hex) ?? 0) + 1)
    fills.set(style.fill, (fills.get(style.fill) ?? 0) + 1)
  }
  let best: CountCandidate | undefined, bestScore = Infinity
  for (const candidate of allCountCandidates()) {
    if (used.has(candidate.key)) continue
    const score = (shapes.get(candidate.shape) ?? 0) + (colors.get(candidate.hex) ?? 0) + (fills.get(candidate.fill) ?? 0)
    if (score < bestScore) { best = candidate; bestScore = score; if (score === 0) break }
  }
  if (!best) throw new Error('印の組合せを割り当てられません。')
  return { shape: best.shape, fill: best.fill, color: countRgb(best.hex), size: 10, opacity: .8, showCode: true }
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
        || (f.memo !== undefined && (typeof f.memo !== 'string' || f.memo.length > 200))
        || !Number.isSafeInteger(f.order) || f.order < 0 || !s || !COUNT_SHAPES.includes(s.shape) || !COUNT_FILLS.includes(s.fill)
        || !COUNT_SIZES.includes(s.size) || !COUNT_OPACITIES.includes(s.opacity) || typeof s.showCode !== 'boolean'
        || !Array.isArray(s.color) || s.color.length !== 3 || !s.color.every((v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) continue
      const kind = f.kind === undefined ? 'count' : f.kind
      if (!Object.hasOwn(QUANTITY_METHODS, kind) || (f.method !== undefined && !QUANTITY_METHODS[kind as QuantityKind].includes(f.method))
        || (f.defaults !== undefined && (!f.defaults || typeof f.defaults !== 'object' || Array.isArray(f.defaults) || Object.entries(f.defaults).some(([k, v]) => !['addM', 'heightM', 'widthM', 'depthM'].includes(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000)))
        || (f.line !== undefined && (!f.line || !QUANTITY_LINE_WIDTHS.includes(f.line.width) || !QUANTITY_DASHES.includes(f.line.dash)))) continue
      ids.add(f.id)
      const sample = parseCountFixtureSample(f.sample)
      result.push({ ...(f.kind !== undefined ? { kind: f.kind } : {}), ...(f.method !== undefined ? { method: f.method } : {}), ...(f.defaults !== undefined ? { defaults: { ...f.defaults } } : {}), ...(f.line !== undefined ? { line: { ...f.line } } : {}), id: f.id, name: f.name.trim(), code: f.code, category: f.category.trim(), memo: f.memo, order: f.order, ...(sample ? { sample } : {}), style: { shape: s.shape, fill: s.fill, color: [...s.color] as RGB, size: s.size, opacity: s.opacity, showCode: s.showCode } })
    }
    return result.sort((a, b) => a.order - b.order)
  } catch { return [] }
}
export function serializeCountFixtures(fixtures: readonly CountFixture[]): string {
  const raw = JSON.stringify({ version: 1, fixtures: fixtures.map(f => f.kind === 'count' && f.method === undefined && f.defaults === undefined && f.line === undefined ? { ...f, kind: undefined } : f) })
  if (fixtures.length > MAX_COUNT_FIXTURES || fixtures.some(f => f.sample !== undefined && !parseCountFixtureSample(f.sample)) || new TextEncoder().encode(raw).length > MAX_COUNT_FIXTURE_BYTES || parseCountFixtures(raw).length !== fixtures.length) throw new Error('数量拾いの値・件数・容量が上限を超えています。')
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
export interface FixturePreset { category: string; code: string; name: string; kind?: QuantityKind; method?: QuantityMethod; defaults?: QuantityDefaults }
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
