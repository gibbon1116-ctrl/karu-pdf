// 電気設備・機械設備で共通に使う摘要の選択肢（U3）。Claude が作成（2026-10-14）。
// 利用者の依頼: 部位・工法・種別・仕様・型式・寸法・形・仕上 等の欄は、選択肢を用意できるものは可能な限り用意し、自由記載欄も用意する。
// 選択肢は「よく使うもの」に絞った。無い値は画面の「ほかの値」で入れる。記号・盤名称・名称・仕様等（機器の能力）は図面ごとに違うので、
// 選択肢は持たず、その文書ですでに使った値を候補に出す（画面側）。
// 出典: 公共建築工事標準仕様書（電気設備工事編・機械設備工事編）、公共建築設備工事標準図、建設副産物の処理（発生材の区分）。

import type { DetailTemplate } from './types'

const list = (text: string) => text.split('、')

/** 発生材の種類（建設副産物の区分）。 */
export const WASTE_KINDS = list('コンクリート塊、アスファルト・コンクリート塊、金属くず、廃プラスチック類、ガラス・陶磁器くず、建設発生木材、紙くず、混合廃棄物、石綿含有産業廃棄物')

/** 発生材積込・運搬・処分の細目の摘要の選択肢。鍵は「細目名|区分名」。 */
export const WASTE_CHOICES: Readonly<Record<string, readonly string[]>> = {
  '発生材積込|種類': WASTE_KINDS,
  '発生材積込|積込方法': list('人力積込、機械積込'),
  '発生材運搬|種類': WASTE_KINDS,
  '発生材運搬|運搬車の種別': list('2tダンプトラック、4tダンプトラック、10tダンプトラック、2tトラック、4tトラック'),
  '発生材運搬|運搬距離': list('5km以下、10km以下、15km以下、20km以下、30km以下、60km以下'),
  '発生材処分|種類': WASTE_KINDS,
  '発生材処分|処分場所': list('中間処理施設、再資源化施設、最終処分場'),
}

/** 長方形ダクト・ダンパー・ダクト附属品の寸法（幅×高さ mm）。長方形ダクトの規格と同じ並び。 */
export const DUCT_SIZES = list('200×150、200×200、250×150、250×200、300×200、300×250、350×250、400×250、400×300、450×300、500×300、500×400、600×300、600×400、700×400、800×400、800×500、1000×400、1000×500、1200×500')

/** 吹出口・吸込口・給気口・排煙口・ガラリの呼び寸法（幅×高さ mm）。 */
export const GRILLE_SIZES = list('200×100、250×100、250×150、300×150、300×200、400×200、400×250、500×250、500×300、600×300、600×400、800×400')

/** アネモ形（シーリングディフューザー）のネックの呼び番号。 */
export const ANEMO_SIZES = list('#15、#20、#25、#30、#35、#40、#45、#50')

/** 線状吹出口の寸法（スロット数×長さ mm）。 */
export const LINEAR_SIZES = list('1スロット×600、1スロット×1200、2スロット×600、2スロット×1200、3スロット×1200、4スロット×1200')

/** 「細目名|区分名」の選択肢に、足す選択肢を重ねる（既にある値を先に残す）。 */
export function mergeChoices(
  base: Readonly<Record<string, readonly string[]>>,
  extra: Readonly<Record<string, readonly string[]>>,
): Record<string, readonly string[]> {
  const result: Record<string, readonly string[]> = { ...base }
  for (const [key, values] of Object.entries(extra)) result[key] = [...new Set([...(result[key] ?? []), ...values])]
  return result
}

/** 別紙明細の明細の区分に、「明細名|区分名」の選択肢を重ねる（施工条件の区分は変えない）。 */
export function withDetailChoices(
  details: Readonly<Record<string, readonly DetailTemplate[]>>,
  extra: Readonly<Record<string, readonly string[]>>,
): Record<string, readonly DetailTemplate[]> {
  return Object.fromEntries(Object.entries(details).map(([row, templates]) => [row, templates.map(template => {
    if (!template.summary?.some(slot => !slot.condition && extra[`${template.name}|${slot.label}`])) return template
    return {
      ...template,
      summary: template.summary.map(slot => {
        const values = slot.condition ? undefined : extra[`${template.name}|${slot.label}`]
        return values ? { ...slot, choices: [...new Set([...(slot.choices ?? []), ...values])] } : slot
      }),
    }
  })]))
}
