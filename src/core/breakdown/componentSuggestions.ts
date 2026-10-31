// 個数の印の構成要素（SPEC-B03f）でよく組み合わせる品目。Claude が作成。
//
// 利用者の要望（2026-10-11）: 数量拾いのとき、スイッチに対してスイッチボックスを構成要素として追加したい。
// 他の器具も同様に、経路の「線要素を追加」のように構成要素を足したい。
//
// ここは「足すときに上に出す候補」だけを決める。候補に無い品目も検索して足せる。
// 規則は上から順に見て、最初に当たった規則の候補を使う。components は品目一覧（catalog）の品目の名称。

export interface ComponentRule {
  /** 主の項目の分類（CountFixture.category） */
  categories?: readonly string[]
  /** 主の項目の名称に含まれる語（どれか1つ） */
  nameIncludes?: readonly string[]
  /** 主の項目の名称に含まれていたら、この規則に当てない語 */
  nameExcludes?: readonly string[]
  components: readonly string[]
}

const wiringBoxes = ['スイッチボックス', 'アウトレットボックス', '設備プレート']
const outletBox = ['アウトレットボックス']

export const COMPONENT_RULES: readonly ComponentRule[] = [
  // ボックス・プレートそのものには候補を出さない
  { categories: ['ボックス類', '設備プレート'], components: [] },
  { nameIncludes: ['ボックス', 'プレート'], components: [] },
  // 配線器具（スイッチ・コンセント）、情報・電話・テレビの端子
  { categories: ['スイッチ', 'コンセント', '配線器具', '情報用アウトレット', '電話用アウトレット', 'テレビ端子'], components: wiringBoxes },
  {
    nameIncludes: ['スイッチ', 'コンセント', 'アウトレット', '端子'],
    // ネットワークの機器（幹線用スイッチなど）は配線器具ではない
    nameExcludes: ['幹線用', '支線用', 'フロア用', '端子盤', '端子箱'],
    components: wiringBoxes,
  },
  // 照明器具
  { categories: ['照明器具'], components: outletBox },
  // 天井・壁の小さな機器
  { nameIncludes: ['感知器', 'スピーカ', 'カメラ', '時計', 'センサ', 'アクセスポイント'], components: outletBox },
  // 押しボタン・表示灯の類
  { categories: ['発信機', '表示灯', '警報ベル', '非常ベル', '起動装置', '電子ブザー', '呼出表示灯', '呼出・復帰ボタン', 'ガス漏れ表示灯'], components: ['スイッチボックス', 'アウトレットボックス'] },
]

export function componentSuggestions(f: { category: string; name: string }): readonly string[] {
  for (const rule of COMPONENT_RULES) {
    const byCategory = rule.categories?.includes(f.category) ?? false
    const byName = (rule.nameIncludes?.some(word => f.name.includes(word)) ?? false) && !(rule.nameExcludes?.some(word => f.name.includes(word)) ?? false)
    if (byCategory || byName) return rule.components
  }
  return []
}
