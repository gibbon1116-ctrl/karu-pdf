// 標準単価積算基準の個別項目の群（U8）のデータの形。Claude が作成（2026-10-14）。データは standardMasterGroups.ts（生成）。
import type { QuantityKind, QuantityMethod } from '../countFixtures'

/** 書式の品目（内訳書の行・別紙明細の明細）。同じ編の、この名称の品目すべて（unit があれば単位も一致）。 */
export type StandardTarget =
  | { row: string; unit?: string }
  | { detailRow: string; detail: string }

/** 名称・単位ごとの群。1つの規格が標準マスタの1つの規格（拾うときの選択肢）になる。 */
export interface StandardGroup {
  field: '建築' | '電気設備' | '機械設備' | '昇降機設備'
  /** CSV の分類（独立の品目の分類に使う） */
  category: string
  /** 名称（整形済み）。吸収先の規格の見出し（formerName）にも使う */
  name: string
  unit: string
  kind: QuantityKind
  method: QuantityMethod
  /** 代表の表番号（例 表M1-2-9） */
  table: string
  /** 新営・改修 */
  modes: readonly string[]
  /** 施工条件の候補 */
  conditions: readonly string[]
  /** [規格, 略号]。規格が '' の群は規格なしの1件 */
  specs: readonly (readonly [spec: string, code: string])[]
  /** 吸収先。無ければ独立の品目 */
  targets?: readonly StandardTarget[]
  /** 吸収先の摘要に入れる固定の値（配管の管種・接合方法） */
  summary?: Readonly<Record<string, string>>
  /** 規格の値を入れる吸収先の摘要の区分 */
  specLabel?: string
  /** specLabel に入れるとき後ろに付ける文字（鋼管の呼び径の「A」） */
  specSuffix?: string
}
