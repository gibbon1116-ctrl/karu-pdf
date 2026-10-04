import type { PDFDocument } from 'mupdf'
import type { RGB } from './annotations'

export const COUNT_SHAPES = ['circle', 'doubleCircle', 'square', 'roundedSquare', 'triangle', 'invertedTriangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star', 'plus', 'cross', 'hourglass'] as const
export const COUNT_FILLS = ['none', 'solid', 'half', 'dot', 'hatch'] as const
export const COUNT_SIZES = [6, 8, 10, 12, 14, 16, 20, 24] as const
export const COUNT_OPACITIES = [1, 0.8, 0.75, 0.5, 0.25] as const
export type CountShape = typeof COUNT_SHAPES[number]
export type CountFill = typeof COUNT_FILLS[number]
export interface CountStyle { shape: CountShape; fill: CountFill; color: RGB; size: number; opacity: number; showCode: boolean }
export interface CountFixture { id: string; name: string; code: string; category: string; style: CountStyle; memo?: string; order: number }
export const MAX_COUNT_FIXTURES = 1000
export const MAX_COUNT_FIXTURE_BYTES = 1024 * 1024
export const COUNT_COLORS = ['#E60012', '#FF7F00', '#FFD400', '#8FD400', '#00A040', '#00B8A9', '#00B7EB', '#0068B7', '#1D2088', '#7B2CBF', '#E4007F', '#FF66B2', '#A0522D', '#808000', '#606060', '#000000', '#FF4D4D', '#FFB347', '#FFF04D', '#66E066', '#66D9FF', '#6699FF', '#B388FF', '#FF99CC'] as const
export function countRgb(hex: string): RGB { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB }
export function countHex(rgb: RGB): string { return '#' + rgb.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase() }
export function sameCountAppearance(a: CountStyle, b: CountStyle): boolean { return a.shape === b.shape && a.fill === b.fill && countHex(a.color) === countHex(b.color) }
export function nextCountStyle(fixtures: readonly CountFixture[]): CountStyle {
  const key = (s: CountStyle) => `${s.shape}:${s.fill}:${countHex(s.color)}`
  const used = new Set(fixtures.map(f => key(f.style)))
  for (let i = 0; i < 840; i++) {
    const style: CountStyle = { shape: COUNT_SHAPES[i % 14], color: countRgb(COUNT_COLORS[(i * 7) % 24]), fill: COUNT_FILLS[Math.floor(i / 14) % 5], size: 10, opacity: .8, showCode: true }
    if (!used.has(key(style))) return style
  }
  // The prescribed sequence covers 840 combinations (shape/color parity is linked).
  // Continue with the remaining combinations so all 1,000 fixture slots are usable.
  const previous = fixtures.at(-1)?.style
  for (const fill of COUNT_FILLS) for (const shape of COUNT_SHAPES) for (const hex of COUNT_COLORS) {
    const style: CountStyle = { shape, fill, color: countRgb(hex), size: 10, opacity: .8, showCode: true }
    if (!used.has(key(style)) && (!previous || previous.shape !== shape && countHex(previous.color) !== hex)) return style
  }
  for (const fill of COUNT_FILLS) for (const shape of COUNT_SHAPES) for (const hex of COUNT_COLORS) {
    const style: CountStyle = { shape, fill, color: countRgb(hex), size: 10, opacity: .8, showCode: true }
    if (!used.has(key(style))) return style
  }
  throw new Error('印の組合せを割り当てられません。')
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
      ids.add(f.id)
      result.push({ id: f.id, name: f.name.trim(), code: f.code, category: f.category.trim(), memo: f.memo, order: f.order, style: { shape: s.shape, fill: s.fill, color: [...s.color] as RGB, size: s.size, opacity: s.opacity, showCode: s.showCode } })
    }
    return result.sort((a, b) => a.order - b.order)
  } catch { return [] }
}
export function serializeCountFixtures(fixtures: readonly CountFixture[]): string {
  const raw = JSON.stringify({ version: 1, fixtures })
  if (fixtures.length > MAX_COUNT_FIXTURES || new TextEncoder().encode(raw).length > MAX_COUNT_FIXTURE_BYTES || parseCountFixtures(raw).length !== fixtures.length) throw new Error('器具リストの値・件数・容量が上限を超えています。')
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
export const FIXTURE_PRESETS: Record<string, Array<{ category: string; code: string; name: string }>> = {}
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
