// 連動の標準データ（SPEC-B06）。Claude が一次資料から作成。数値は出典の表のとおり。

/**
 * 発生材の見かけ比重（t/㎥）。体積 ㎥ = 質量 t ÷ 見かけ比重。
 * 出典: 環境省「産業廃棄物の体積から重量への換算係数（参考値）」（平成18年12月27日付の環境省の通知。
 * 自治体の転載資料（福岡市「産業廃棄物の種類と体積から重量への換算係数【参考値】」）で値を確認）。
 * 参考値であり、自社で換算係数を算出できる場合はその値を使う（項目ごとに上書きできる）。
 */
export const WASTE_DENSITIES: ReadonlyArray<{ type: string; tPerM3: number }> = [
  { type: '金属くず', tPerM3: 1.13 },
  { type: '廃プラスチック類', tPerM3: 0.35 },
  { type: 'ガラスくず・コンクリートくず・陶磁器くず', tPerM3: 1.00 },
  { type: 'がれき類（コンクリート破片）', tPerM3: 1.48 },
  { type: 'がれき類（アスファルト・コンクリート破片）', tPerM3: 1.48 },
  { type: '木くず', tPerM3: 0.55 },
  { type: '紙くず', tPerM3: 0.30 },
  { type: '繊維くず', tPerM3: 0.12 },
  { type: 'ゴムくず', tPerM3: 0.52 },
  { type: '廃石膏ボード', tPerM3: 0.30 },
  { type: '廃電気機械器具', tPerM3: 1.00 },
  { type: '建設混合廃棄物', tPerM3: 0.26 },
  { type: '安定型混合廃棄物', tPerM3: 0.26 },
  { type: '管理型混合廃棄物', tPerM3: 0.26 },
]

/**
 * 機器搬入の補正率。出典: 公共建築工事標準単価積算基準（令和8年改定）第4編 機械設備工事 表 M1-1-68「補正率」。
 * 区分は公共建築設備数量積算基準（令和7年改定）第2編第1章第1節: 単体の質量 100kg 以上の機器に適用し、
 * 質量÷容積が 600kg/㎥ 以上を重量品、未満を容積品とする。重量品の質量・容積品の質量は、それぞれ補正率を乗じたもの。
 * 表の備考「単独搬入の場合は、補正率を30％増しする。」
 */
export const CARRY_MIN_MASS_KG = 100
export const CARRY_HEAVY_DENSITY_KG_PER_M3 = 600
export const CARRY_ALONE_INCREASE = 1.3
/** 重量品: 単体の質量（kg）の上限ごとの補正率。15,000kg を超えるものは表に無い（最後の値を使い、警告を出す）。 */
export const CARRY_HEAVY_FACTORS: ReadonlyArray<{ maxKg: number; factor: number }> = [
  { maxKg: 250, factor: 1.30 },
  { maxKg: 500, factor: 1.20 },
  { maxKg: 800, factor: 1.10 },
  { maxKg: 1000, factor: 1.00 },
  { maxKg: 3000, factor: 0.85 },
  { maxKg: 5000, factor: 0.75 },
  { maxKg: 7000, factor: 0.70 },
  { maxKg: 10000, factor: 0.60 },
  { maxKg: 15000, factor: 0.50 },
]
/** 容積品: 容積あたりの質量（kg/㎥）が「未満」の境界ごとの補正率。小さい境界から当てる（100 未満 → 2.50）。 */
export const CARRY_BULKY_FACTORS: ReadonlyArray<{ belowKgPerM3: number; factor: number }> = [
  { belowKgPerM3: 100, factor: 2.50 },
  { belowKgPerM3: 200, factor: 2.00 },
  { belowKgPerM3: 300, factor: 1.70 },
  { belowKgPerM3: 400, factor: 1.40 },
  { belowKgPerM3: 500, factor: 1.20 },
  { belowKgPerM3: 600, factor: 1.00 },
]

/**
 * 電線管の 1m あたりの質量（kg/m）。発生材（配管撤去）の質量の既定値に使う。
 * 出典: JIS C 8305 の寸法による値。ねじなし電線管 E・薄鋼電線管 C・厚鋼電線管 G は
 * パナソニック「鋼製電線管」製品ページ（外径・厚さ・質量 kg/m）で確認。
 * 確認: 鋼管の質量 = π ×（外径 − 厚さ）× 厚さ × 7.85 ÷ 1000（E25: 0.716、G16: 1.06）。
 */
export const CONDUIT_MASS_KG_PER_M: Readonly<Record<string, number>> = {
  E19: 0.530, E25: 0.716, E31: 1.050, E39: 1.270, E51: 1.710, E63: 2.440, E75: 3.300,
  C19: 0.691, C25: 0.939, C31: 1.190, C39: 1.440, C51: 1.940, C63: 3.030, C75: 3.660,
  G16: 1.06, G22: 1.37, G28: 1.90, G36: 2.43, G42: 2.79, G54: 3.92, G70: 5.00, G82: 5.88, G92: 8.39, G104: 9.48,
}
