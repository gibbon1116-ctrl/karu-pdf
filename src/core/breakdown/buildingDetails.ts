// 建築の「1式・別紙明細」の明細と、摘要の標準の選択肢（SPEC-B11）。
//
// 別紙明細: 書式の PDF の別紙明細（新営 59〜62 頁、改修 93〜97 頁）にある直接仮設の明細をそのまま起こした
// （養生・整理清掃後片付け・外部足場・内部躯体足場・内部仕上足場・災害防止・仮設材運搬、改修の墨出し）。
// 書式に中身の無いほかの別紙明細は、細目別内訳の摘要・単位から拾えるもの（ガス圧接 か所 など）はその行で拾う。
// 選択肢: 公共建築工事標準仕様書（建築工事編）でよく使う規格（鉄筋の種類と呼び名、コンクリートの強度・スランプ、
// 鋼材の種類、塗装の種別）。選択肢は「よく使うもの」に絞った。無い値は画面で手入力する。
import type { DetailTemplate, SummarySlot } from './types'
import { BUILDING_ASSEMBLY_CHOICES, BUILDING_ASSEMBLY_DETAIL_CHOICES } from './buildingChoices'
import { BUILDING_STANDARD_CHOICES, BUILDING_STANDARD_DETAIL_CHOICES } from './buildingStandardChoices'
import { BUILDING_ALL_CHOICES, BUILDING_ALL_DETAIL_CHOICES } from './buildingAllChoices'
import { mergeChoices, withDetailChoices } from './commonChoices'

const slot = (label: string, choices?: readonly string[]): SummarySlot => (choices ? { label, choices } : { label })
/** 部位の組（U4）で作った別紙明細の区分の選択肢（buildingChoices.ts）。 */
const detailChoices = (key: string): readonly string[] | undefined => BUILDING_ASSEMBLY_DETAIL_CHOICES[key]
const list = (text: string) => text.split('、')
const renovationKinds = list('防水改修、外壁改修、建具改修、内装改修、耐震（躯体）改修')

const curing: DetailTemplate[] = [
  { name: '養生（延べ面積）', unit: '㎡', note: '延べ面積' },
  { name: '養生（部位）', unit: '㎡', summary: [slot('部位')], note: '延べ面積以外の部位。必要に応じて計上' },
]
const cleaning: DetailTemplate[] = [
  { name: '整理清掃後片付け（延べ面積）', unit: '㎡', note: '延べ面積' },
  { name: '整理清掃後片付け（部位）', unit: '㎡', summary: [slot('部位')], note: '延べ面積以外の部位。必要に応じて計上' },
]
const outsideScaffold: DetailTemplate[] = [
  { name: '枠組本足場', unit: '㎡', summary: [slot('種別', detailChoices('枠組本足場|種別')), slot('枠幅', list('600、900、1200')), slot('高さ', detailChoices('枠組本足場|高さ'))] },
  { name: '安全手すり', unit: 'm', summary: [slot('種別', detailChoices('安全手すり|種別'))] },
  { name: '一側足場', unit: '㎡', summary: [slot('種別')], note: '必要に応じて計上' },
  { name: '登り桟橋', unit: 'm', note: '必要に応じて計上' },
]
const insideFinishScaffold: DetailTemplate[] = [
  { name: '内部仕上足場', unit: '㎡', summary: [slot('足場種類', list('脚立足場、移動式足場、枠組棚足場')), slot('階高')] },
  { name: '枠組棚足場', unit: '㎡', summary: [slot('高さ')], note: '対象面積。必要に応じて計上' },
  { name: '簡易型移動式足場', unit: '㎡', note: '対象面積。必要に応じて計上' },
  { name: '内部階段仕上足場', unit: '㎡', note: '対象面積' },
  { name: 'シャフト内足場', unit: '㎡', note: '対象面積。必要に応じて計上' },
  { name: '高所作業車', unit: '台', note: '必要に応じて計上' },
]
const disaster: DetailTemplate[] = [
  { name: '養生防護棚（直線部）', unit: 'm', note: '必要に応じて計上' },
  { name: '養生防護棚（コーナー部）', unit: 'か所', note: '必要に応じて計上' },
  { name: '垂直ネット張り', unit: '㎡', summary: [slot('種別', detailChoices('垂直ネット張り|種別'))] },
  { name: '小幅ネット', unit: 'm' },
  { name: '水平ネット張り', unit: '㎡', note: '必要に応じて計上' },
]
const transport: DetailTemplate[] = [
  ...list('枠組本足場、一側足場、地足場、垂直ネット、水平ネット、躯体支保工、内部仕上足場、枠組棚足場、簡易型移動式足場、内部階段仕上足場、シャフト内足場')
    .map(name => ({ name: `${name}（運搬）`, unit: '㎡' })),
  ...list('安全手すり、登り桟橋、養生防護棚、小幅ネット').map(name => ({ name: `${name}（運搬）`, unit: 'm' })),
]

/** 新営の別紙明細（細目の名称 → 明細）。 */
const buildingDetailBase: Readonly<Record<string, readonly DetailTemplate[]>> = {
  養生: curing,
  整理清掃後片付け: cleaning,
  外部足場: outsideScaffold,
  内部躯体足場: [
    { name: '鉄筋・型枠足場', unit: '㎡' },
    { name: '躯体支保工', unit: '㎡', summary: [slot('高さ')], note: '鉄筋、型枠足場共。必要に応じて計上' },
  ],
  内部仕上足場: insideFinishScaffold,
  災害防止: disaster,
  仮設材運搬: transport,
  // 土工（書式に別紙明細の中身が無いので、細目別内訳の摘要と公共建築数量積算基準 第3編から想定して作った。SPEC-B09）
  すきとり: [{ name: 'すきとり', unit: '㎥', summary: [slot('工法', list('機械、人力'))] }],
  根切り: [{ name: '根切り', unit: '㎥', summary: [slot('工法', list('機械、人力')), slot('形式', list('つぼ掘り、布掘り、総掘り'))], note: '計画数量。(底面 ＋ 余幅) × 深さ' }],
  床付け: [{ name: '床付け', unit: '㎡', note: '砂利地業の面積' }],
  埋戻し: [{ name: '埋戻し', unit: '㎥', summary: [slot('土', list('構内堆積土、構外土'))], note: '根切り − 基礎・地下構築物・砂利地業・捨コンクリート' }],
  盛土: [{ name: '盛土', unit: '㎥', summary: [slot('土', list('構内堆積土、構外土'))] }],
  構内敷きならし: [{ name: '構内敷きならし', unit: '㎥', summary: [slot('工法', list('機械、人力'))] }],
}

/** 改修（種目「庁舎（改修）」）の別紙明細。 */
const buildingRenovationDetailBase: Readonly<Record<string, readonly DetailTemplate[]>> = {
  墨出し: [{ name: '墨出し', unit: '㎡', summary: [slot('改修の種類', renovationKinds)] }],
  養生: [{ name: '養生', unit: '㎡', summary: [slot('改修の種類', [...renovationKinds, '搬出入路部分'])] }],
  整理清掃後片付け: [{ name: '整理清掃後片付け', unit: '㎡', summary: [slot('改修の種類', [...renovationKinds, '搬出入路部分'])] }],
  外部足場: [
    ...outsideScaffold,
    { name: '仮設ゴンドラ', unit: '台', note: '必要に応じて計上' },
    { name: '高所作業車', unit: '台', note: '必要に応じて計上' },
  ],
  内部足場: [
    { name: '躯体支保工', unit: '㎡', summary: [slot('高さ')], note: '必要に応じて計上' },
    ...insideFinishScaffold,
  ],
  災害防止: disaster,
  仮設材運搬: transport,
}

const rebarSizes = list('D10、D13、D16、D19、D22、D25、D29、D32、D35、D38、D41')
const strength = list('18、21、24、27、30、33、36')
const slump = list('15、18、21')
const paintKinds = list('A種、B種')
const paintBase = list('木部、鉄鋼面、亜鉛めっき鋼面、コンクリート面、モルタル面、せっこうボード面')

function choicesFor(): Record<string, readonly string[]> {
  const result: Record<string, readonly string[]> = {
    '異形鉄筋|規格': list('SD295、SD345、SD390、SD490'),
    '異形鉄筋|径': rebarSizes,
    'スパイラル筋|径': rebarSizes,
    'ガス圧接|径': list('D16、D19、D22、D25、D29、D32、D35、D38、D41'),
    '切板鋼板|規格': list('SS400、SN400B、SN490B、SM490A'),
    '形鋼|規格': list('SS400、SN400B、SN490B、SM490A'),
    '形鋼|形状': list('H形鋼、山形鋼、溝形鋼、I形鋼'),
    '角形鋼管|規格': list('BCR295、BCP235、BCP325、STKR400'),
    '平鋼|規格': list('SS400、SN400B'),
    '丸鋼|規格': list('SS400、SR235'),
    '高力ボルト類|規格': list('S10T（トルシア形）、F10T'),
    '高力ボルト類締付け|規格': list('S10T（トルシア形）、F10T'),
    '耐火被覆|種類': list('吹付けロックウール、耐火材巻付け、耐火塗料、けい酸カルシウム板張り'),
    '耐火被覆|性能': list('1時間、2時間、3時間'),
  }
  for (const name of ['普通コンクリート（基礎部）', '普通コンクリート（軸部）', '普通コンクリート（土間）', '普通コンクリート', '無筋コンクリート']) {
    result[`${name}|強度`] = strength
    result[`${name}|スランプ`] = slump
  }
  for (const name of ['ＳＯＰ合成樹脂調合ペイント塗り', 'ＤＰ耐候性塗料塗り', 'ＥＰ合成樹脂エマルションペイント塗り', 'ＥＰ－Ｇつや有合成樹脂エマルションペイント塗り']) {
    result[`${name}|種別`] = paintKinds
    result[`${name}|下地区分`] = paintBase
  }
  return result
}

// 部位の組（R7）の品目の選択肢（U4）は buildingChoices.ts。既にある鍵は変えない。
export const BUILDING_CHOICES: Readonly<Record<string, readonly string[]>> = mergeChoices(mergeChoices({ ...BUILDING_ASSEMBLY_CHOICES, ...choicesFor() }, BUILDING_STANDARD_CHOICES), BUILDING_ALL_CHOICES)

// 標準単価積算基準の細目・摘要（U6、buildingStandardChoices.ts）を別紙明細の明細の区分に重ねる。
/** 新営の別紙明細（細目の名称 → 明細）。 */
export const BUILDING_DETAILS: Readonly<Record<string, readonly DetailTemplate[]>> = withDetailChoices(buildingDetailBase, mergeChoices(BUILDING_STANDARD_DETAIL_CHOICES, BUILDING_ALL_DETAIL_CHOICES))
/** 改修（種目「庁舎（改修）」）の別紙明細。 */
export const BUILDING_RENOVATION_DETAILS: Readonly<Record<string, readonly DetailTemplate[]>> = withDetailChoices(buildingRenovationDetailBase, mergeChoices(BUILDING_STANDARD_DETAIL_CHOICES, BUILDING_ALL_DETAIL_CHOICES))
