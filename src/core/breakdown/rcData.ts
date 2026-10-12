// 建築の鉄筋コンクリートの連動のデータ（SPEC-B07）。Claude が作成。根拠は docs/調査/内訳書標準書式対応_計画.md §7.1・連動B07_計画.md。

/** 異形棒鋼の単位質量（kg/m）。JIS G 3112（鉄筋コンクリート用棒鋼）。 */
export const REBAR_MASS_KG_PER_M: Readonly<Record<string, number>> = {
  D10: 0.560, D13: 0.995, D16: 1.56, D19: 2.25, D22: 3.04, D25: 3.98, D29: 5.04, D32: 6.23, D35: 7.51, D38: 8.95, D41: 10.5,
}
/** 鉄筋の規格（種類の記号）。JIS G 3112。内訳書の「異形鉄筋|規格」の候補と同じ。 */
export const REBAR_GRADES = ['SD295', 'SD345', 'SD390', 'SD490'] as const
/** 呼び名の公称直径 d（mm）。定着・重ね継手の長さ（d の倍数）に使う。呼び名の数字を d とする（D13 → 13mm）。 */
export function rebarDiameterMm(name: string): number | undefined {
  const m = /^D(\d+)$/.exec(name)
  return m && Object.hasOwn(REBAR_MASS_KG_PER_M, name) ? Number(m[1]) : undefined
}

/** 所要数量の割増（公共建築数量積算基準 第4編第3章: 設計数量 × 1.04）。 */
export const REBAR_REQUIRED_FACTOR = 1.04

/**
 * 定着・重ね継手の長さの既定値（d の倍数）。項目ごとに直せる。
 * 利用者の決定（2026-10-11）: 「JASS 5 の表を既定にし、設計図書の指定があれば項目ごとに上書き」。
 * 値は SD345・Fc21〜27・フックなしでよく使われる 定着 35d、重ね継手 40d。
 * **一次資料（JASS 5／公共建築工事標準仕様書 表 5.3.x）で未確認**。確認するまで画面に「既定値（要確認）」と出す。
 */
export const DEFAULT_ANCHORAGE_D = 35
export const DEFAULT_LAP_D = 40
export const ANCHORAGE_LAP_VERIFIED = false

/** 径 13 以下はフックなし（公共建築数量積算基準）。径 16 以上はガス圧接にできる。 */
export const MAX_DIAMETER_WITHOUT_HOOK = 13
export const MIN_DIAMETER_GAS_PRESSURE = 16

/**
 * 継手の数（公共建築数量積算基準 第4編第3章）。
 * - 別に定めがなければ、径 13 以下は 6.0m ごと、径 16 以上は 7.0m ごとに 1 か所（第4編第3章 1 通則 4））。
 * - 定着・重ね継手の長さは、設計図書に無ければ JASS 5 を準用し、小数点以下第2位までにする（同 6））。
 * - 連続する梁・基礎梁の主筋: 長さ 5m 未満 0.5、5〜10m 1、10m 以上 2 か所。
 * - 連続する床板: 4.5m 未満 0.5、4.5〜9m 1、9〜13.5m 1.5 か所（以後 4.5m ごとに 0.5 か所を足す）。
 * - 柱の主筋・壁の縦筋: 各階 1 か所。
 */
export function rebarJoints(lengthM: number, diameterMm: number, rule: 'general' | 'beam' | 'slab' | 'perFloor'): number {
  if (lengthM <= 0) return 0
  switch (rule) {
    case 'beam': return lengthM < 5 ? 0.5 : lengthM < 10 ? 1 : 2
    case 'slab': return 0.5 * (Math.floor(lengthM / 4.5) + 1)
    case 'perFloor': return 1
    default: {
      const step = diameterMm <= MAX_DIAMETER_WITHOUT_HOOK ? 6 : 7
      // 「6.0m ごとに継手があるものとして」: 12m の筋の継手は 1 か所（端の 12m は継手ではない）
      return Math.floor((lengthM - 1e-9) / step)
    }
  }
}

/**
 * 割付本数の切り上げで無視する長さの誤差（m）。図面の拾いは 1mm 未満の誤差を持つため、
 * 4.0002m ÷ 0.2m のような値で 1 本増えないようにする。
 */
export const BAR_COUNT_TOLERANCE_M = 0.001

/** 割付本数（公共建築数量積算基準）: 長さ ÷ 間隔 を切り上げ ＋1。壁式の横筋は 壁高さ ÷ 間隔 の切り上げ −1。 */
export function barCount(lengthM: number, spacingM: number, wallHorizontal = false): number {
  if (lengthM <= 0 || spacingM <= 0) return 0
  const n = Math.max(1, Math.ceil((lengthM - BAR_COUNT_TOLERANCE_M) / spacingM))
  return wallHorizontal ? Math.max(0, n - 1) : n + 1
}

/** 型枠: 1.0㎡ 以下の接続部、0.5㎡ 以下の開口は差し引かない。コンクリート: 0.5㎡ 以下の開口は欠除しない。 */
export const SMALL_OPENING_M2 = 0.5
