// 機器ごとに別の項目として計上する構成要素（R8a・R8b）。Claude が作成（2026-10-14）。
// 利用者の指示: ボイラーと冷却塔に構成要素で「機器据付」を入れると 2 台にまとまるが、据付は機器の重量・容積で単価が違うため
// 「機器据付（冷却塔）」のように機器ごとに分けて計上する。配管等（JIS の規格で決まるもの）はまとめてよい。
// 機械設備だけでなく、電気設備・建築でも該当するものは同様にする（利用者の追加の指示）。
// 出典: 公共建築工事内訳書標準書式（設備工事編）の別紙明細は、機器ごとに単価が違う作業の摘要に機器を特定する区分を持つ
//   機械設備: 搬入・据付費「機器据付」・機器類撤去「機器撤去」・取外し再取付け「機器取外し再取付け」は「名称」（mechanicalDetails.ts）
//   電気設備: 施工費「器具取付」・取外し再取付け・撤去は器具の「記号」、盤は「盤名称」、「機器撤去」は「名称」（electricalDetails.ts）
//   基礎（機械「機器用基礎」・電気「機器基礎」）は機器ごとに寸法が違う。
// 建築（buildingGroups.ts）: 建具・点検口・ルーフドレンの撤去は摘要に「寸法」（ドレンは「種別」「径」）を持ち、親の建具等ごとに違う。
//   親の項目の同じ区分の値を写す。
// 対象外: 機器搬入（t。重量でまとめる）、配管・ダクト・ケーブル・ボックス等（規格でまとめてよい）。

/**
 * 構成要素にするとき、親の項目ごとに「名称（親の名称）」の項目に分ける品目。
 * - label: 親を特定する値を入れる摘要の区分（区分があれば値を置き換え、無ければ先頭に足す）。
 * - value: その値。'name' は親の項目の名称、'code' は親の記号（空なら名称）。
 * - copy: 親の項目の摘要から、同じ区分の値を写す区分（親に値があるときだけ）。
 */
export interface PerEquipmentComponent {
  name: string
  label?: string
  value?: 'name' | 'code'
  copy?: readonly string[]
}

const byName = (name: string): PerEquipmentComponent => ({ name, label: '名称', value: 'name' })
const bySymbol = (name: string): PerEquipmentComponent => ({ name, label: '記号', value: 'code' })
const byPanel = (name: string): PerEquipmentComponent => ({ name, label: '盤名称', value: 'name' })
const bySize = (name: string): PerEquipmentComponent => ({ name, copy: ['寸法'] })

export const PER_EQUIPMENT_COMPONENTS: readonly PerEquipmentComponent[] = [
  // 機械設備
  byName('機器据付'),
  byName('機器用基礎'),
  byName('機器取外し再取付け'),
  byName('機器撤去'), // 電気設備にも同じ名称の行がある
  // 電気設備
  byName('機器基礎'),
  bySymbol('器具取付'),
  bySymbol('器具取外し再取付け'),
  bySymbol('器具撤去'),
  byPanel('盤取付'),
  byPanel('盤取外し再取付け'),
  byPanel('盤撤去'),
  // 建築
  bySize('アルミニウム製建具撤去'),
  bySize('樹脂製建具撤去'),
  bySize('鋼製建具撤去'),
  bySize('鋼製軽量建具撤去'),
  bySize('ステンレス製建具撤去'),
  bySize('木製建具撤去'),
  bySize('シャッター撤去'),
  bySize('オーバーヘッドドア撤去'),
  bySize('天井点検口撤去'),
  { name: 'ルーフドレン撤去', copy: ['種別', '径'] },
]

/** 構成要素にするとき、親の機器ごとに「名称（親の名称）」の項目に分ける品目の名称（R8a）。 */
export const PER_EQUIPMENT_COMPONENT_NAMES: readonly string[] = PER_EQUIPMENT_COMPONENTS.map(item => item.name)

/** 分けた項目の摘要で、親の機器の名称を入れる区分名（R8a。機械設備の行の区分）。 */
export const PER_EQUIPMENT_SUMMARY_LABEL = '名称'
