// 機械設備の「1式・別紙明細」の標準の明細と、摘要の標準の選択肢（SPEC-B10）。
//
// 書式には別紙明細の中身が無いので、次をもとに Claude が想定して作った（利用者の確認待ちの参考例）。
// - 公共建築設備数量積算基準（令和7年改定）第4編: 配管は直線長さ、弁類は形式・規格・呼び径ごとの個数、支持架台は質量、
//   あと施工アンカーは「配管等の長さ × 0.7 ÷ 支持間隔」の切り上げ、塗装・防錆の区分
// - 公共建築工事標準単価積算基準（令和8年改定）第4編: 管種と接合方法の組合せ（表 M1-1-1〜50）、配管の施工箇所
//   （屋内一般配管・機械室・便所配管・屋外配管（架空・暗渠内・共同溝内）・地中配管）、弁類・保温の区分
// - 公共建築工事標準仕様書（機械設備工事編）: 保温の施工箇所の呼び方
// 選択肢は「よく使うもの」に絞った。無い値は画面で手入力する。配管の施工箇所は単価が変わる区分なので施工条件にする。
import type { DetailTemplate, SummarySlot } from './types'
import { ANEMO_SIZES, DUCT_SIZES, GRILLE_SIZES, LINEAR_SIZES, WASTE_CHOICES, withDetailChoices } from './commonChoices'
import { MECHANICAL_STANDARD_CHOICES, MECHANICAL_STANDARD_DETAIL_CHOICES } from './mechanicalStandardChoices'

const slot = (label: string, choices?: readonly string[]): SummarySlot => (choices ? { label, choices } : { label })
const condition = (label: string, choices: readonly string[]): SummarySlot => ({ label, choices, condition: true })
const list = (text: string) => text.split('、')

/** 配管の施工箇所（標準単価積算基準 第4編の配管の表の区分）。 */
export const PIPE_LOCATIONS = list('屋内一般配管、機械室・便所配管、屋外配管（架空・暗渠内・共同溝内）、地中配管')
/** 保温の施工箇所（標準仕様書の呼び方）。 */
const insulationPlaces = list('屋内露出（一般居室・廊下）、屋内露出（機械室・書庫・倉庫）、隠ぺい（天井内・パイプシャフト内・暗渠内）、屋外露出、多湿箇所（浴室・厨房等）')
const nominal = list('15A、20A、25A、32A、40A、50A、65A、80A、100A、125A、150A、200A、250A、300A')
const processing = condition('処理', list('撤去（廃棄）、取外し（再使用）'))
const paint = slot('塗料', list('錆止めペイント＋調合ペイント、調合ペイント、アルミニウムペイント'))

const steelWhite = '配管用炭素鋼鋼管（白）（SGP）'
const steelBlack = '配管用炭素鋼鋼管（黒）（SGP）'
const stpgWhite = '圧力配管用炭素鋼鋼管（白）（STPG370）'
const stpgBlack = '圧力配管用炭素鋼鋼管（黒）（STPG370）'
const stainless = '一般配管用ステンレス鋼鋼管（SUS）'
const lining = list('水道用硬質塩化ビニルライニング鋼管（SGP-VA）、水道用硬質塩化ビニルライニング鋼管（SGP-VB）、水道用硬質塩化ビニルライニング鋼管（SGP-VD）、水道用ポリエチレン粉体ライニング鋼管（SGP-PA）、水道用ポリエチレン粉体ライニング鋼管（SGP-PB）、水道用ポリエチレン粉体ライニング鋼管（SGP-PD）')
const waterPipes = [...lining, stainless, '水道用耐衝撃性硬質ポリ塩化ビニル管（HIVP）', '水道用硬質ポリ塩化ビニル管（VP）', '銅管（M）']
const drainPipes = [steelWhite, '排水用硬質塩化ビニルライニング鋼管（DVLP）', '排水用ノンタールエポキシ塗装鋼管', '硬質ポリ塩化ビニル管（VP）', 'リサイクル硬質ポリ塩化ビニル発泡三層管（RF-VP）', '耐火二層管（FDVD）']
const firePipes = [steelWhite, stpgWhite, '消火用硬質塩化ビニル外面被覆鋼管（SGP-VS）', '消火用硬質塩化ビニル外面被覆鋼管（STPG370VS）']
const joints = list('ねじ接合（管端防食継手）、ねじ接合、フランジ接合、溶接接合、ハウジング形管継手、MD継手、圧縮・プレス接合、拡管式接合、接着接合、ゴム輪接合、ろう付け接合')
const pipe = (kinds: readonly string[]) => ({ 管種: kinds, 接合方法: joints, 呼び径: nominal, 区分: PIPE_LOCATIONS })

/** 細目の名称ごとの、配管の管種の候補（標準単価積算基準 第4編の表の用途）。 */
const PIPE_KINDS: Readonly<Record<string, readonly string[]>> = {
  給水管: waterPipes,
  補給水管: waterPipes,
  冷却水管: [steelWhite, stpgWhite, ...lining.slice(0, 3), stainless],
  冷温水管: [steelWhite, stpgWhite, '水道用耐熱性硬質塩化ビニルライニング鋼管（SGP-HVA）', stainless],
  給湯管: ['水道用耐熱性硬質塩化ビニルライニング鋼管（SGP-HVA）', stainless, '銅管（M）', '被覆銅管'],
  蒸気管: [steelBlack, stpgBlack, stainless],
  油管: [steelBlack],
  ドレン管: [steelWhite, '硬質ポリ塩化ビニル管（VP）'],
  汚水管: drainPipes,
  雑排水管: drainPipes,
  通気管: [steelWhite, '硬質ポリ塩化ビニル管（VP）', 'リサイクル硬質ポリ塩化ビニル発泡三層管（RF-VP）', '耐火二層管（FDVD）'],
  消火管: firePipes,
  送水管: firePipes,
  液化石油ガス管: [steelWhite, 'ガス用ポリエチレン管'],
}

const valve = { 材質: list('青銅、鋳鉄、ダクタイル鋳鉄、ステンレス'), 接合方法: list('ねじ込み、フランジ'), 耐圧: list('5K、10K、16K、20K'), 呼び径: nominal }

function choicesFor(): Record<string, readonly string[]> {
  const result: Record<string, readonly string[]> = {}
  for (const [name, kinds] of Object.entries(PIPE_KINDS)) {
    for (const [label, values] of Object.entries(pipe(kinds))) result[`${name}|${label}`] = values
  }
  for (const name of ['仕切弁', 'バタフライ弁', '逆止弁', 'Ｙ形ストレーナ', 'ガス栓・バルブ']) {
    for (const [label, values] of Object.entries(valve)) result[`${name}|${label}`] = values
  }
  for (const name of ['防振継手', 'ﾌﾚｷｼﾌﾞﾙｼﾞｮｲﾝﾄ']) {
    result[`${name}|材質`] = list('合成ゴム、ステンレス')
    result[`${name}|呼び径`] = nominal
  }
  for (const name of ['トラップ装置', '弁装置', '伸縮管継手', '空調用トラップ', '間接排水口', '定水位調整弁', 'ボールタップ', '量水器', 'テスト弁', '選択弁', '水栓', '満水試験継手', '床上掃除口', '排水金物']) {
    result[`${name}|呼び径`] = nominal
  }
  result['伸縮管継手|形式'] = list('単式、複式')
  result['伸縮管継手|種類'] = list('スリーブ形、ベローズ形')
  result['水栓|種類'] = list('横水栓、自在水栓、混合水栓、散水栓、カップリング付水栓')
  result['量水器|方式'] = list('接線流羽根車式、たて形軸流羽根車式、電磁式')
  result['電極棒|極数'] = list('3極、4極、5極、6極')
  result['長方形ダクト|板厚等'] = list('0.5mm、0.6mm、0.8mm、1.0mm、1.2mm')
  result['長方形ダクト|板厚'] = list('0.5mm、0.6mm、0.8mm、1.0mm、1.2mm、1.6mm')
  result['鋼板製ダクト|板厚'] = list('1.6mm、2.3mm、3.2mm')
  result['スパイラルダクト|口径'] = list('100、125、150、175、200、225、250、300、350、400、450、500、550、600')
  result['円形ダクト|口径'] = result['スパイラルダクト|口径']
  result['ベントキャップ|材質'] = list('ステンレス、溶融亜鉛めっき鋼板')
  result['ベントキャップ|形状'] = list('深形、浅形、防火ダンパー付')
  result['温度計|形式'] = list('棒状温度計、隔測温度計')
  result['圧力計|用途'] = list('水用、蒸気用、真空用')
  result['瞬間流量計|形式'] = list('電磁式、超音波式')
  result['送水口|形式'] = list('壁埋込形、壁付形、スタンド形')
  result['散水ヘッド|形式'] = list('開放形、閉鎖形')
  // ── U3（2026-10-14）: 選択肢の無かった区分に、よく使う値を足した。無い値は「ほかの値」で入れる ──
  Object.assign(result, WASTE_CHOICES)
  result['シーリングディフューザー|寸法'] = ANEMO_SIZES
  result['線状吹出口|寸法'] = LINEAR_SIZES
  for (const name of ['吹出口', '吸込口', '給気口', '排煙口', '排気ガラリ']) result[`${name}|寸法`] = GRILLE_SIZES
  for (const name of ['風量調節ダンパー', '防火ダンパー', '防火防煙ダンパー', 'ピストンダンパー', '逆流防止ダンパー']) result[`${name}|寸法`] = DUCT_SIZES
  result['排気フード|材質'] = list('ステンレス鋼板、溶融亜鉛めっき鋼板')
  result['排気フード|形状'] = list('壁付形、島形')
  result['排気フード|寸法'] = list('900×600、1200×600、1200×900、1500×900、1800×900')
  result['グリス除去装置|形状'] = list('グリスフィルター形、ルーバー形')
  result['鏡|寸法'] = list('450×600、600×900、900×900、1200×900')
  result['化粧棚|寸法'] = list('450、600、750、900')
  result['ファンコイルユニット|形式'] = list('床置形、天井吊形、天井隠ぺい形、壁掛形')
  result['カセット形ファンコイルユニット|形式'] = list('1方向吹出し、2方向吹出し、4方向吹出し')
  result['水石けん入れ|形式'] = list('壁付形、カウンター取付形')
  result['圧力計|形式'] = list('ブルドン管圧力計、連成計')
  for (const [label, values] of Object.entries(valve)) result[`弁類|${label}`] = values
  result['地中埋設標|材質'] = list('コンクリート製、樹脂製、金属製')
  result['トラップ装置|用途'] = list('蒸気用、空調ドレン用')
  result['弁装置|用途'] = list('減圧弁装置、温度調節弁装置、電磁弁装置')
  result['伸縮管継手|用途'] = list('蒸気用、温水用、冷温水用、給湯用')
  result['送水口|材質等'] = list('黄銅製、ステンレス製')
  result['放水口|材質等'] = list('黄銅製、ステンレス製')
  result['放水口|呼称'] = list('単口形、双口形')
  result['ベントキャップ|口径等'] = list('100、125、150、175、200、250')
  result['マルチパッケージ形空気調和機|附属品'] = list('リモコン、集中コントローラー、冷媒分岐管')
  result['排水管|管種'] = list('硬質ポリ塩化ビニル管（VP）、硬質ポリ塩化ビニル管（VU）、リブ付硬質ポリ塩化ビニル管、遠心力鉄筋コンクリート管')
  result['排水管|呼び径'] = list('75、100、125、150、200、250、300')
  result['桝類|種類'] = list('汚水桝、雨水桝、インバート桝、ためます、トラップ桝、小口径桝')
  result['桝類|蓋種類'] = list('鋳鉄製防臭蓋、鋳鉄製密閉蓋、コンクリート蓋、格子蓋')
  result['桝類|深さ'] = list('600以下、900以下、1200以下、1500以下')
  result['集合装置|自動切替調整装置'] = list('あり、なし')
  result['集合装置|ボンベ本数'] = list('2本、4本、6本、8本、10本')
  result['フレキシブルダクト|口径'] = list('100、125、150、175、200、250、300')
  result['消火器|仕様'] = list('粉末（ABC）10型、粉末（ABC）20型、強化液 6L、二酸化炭素 5kg')
  result['スプリンクラーヘッド|形式'] = list('閉鎖型（標準型）、閉鎖型（小区画型）、閉鎖型（側壁型）、開放型')
  for (const name of ['パネル形エアフィルター', '全熱交換ユニット']) result[`${name}|予備品`] = list('ろ材 1回分、ろ材 2回分')
  // 標準単価積算基準の細目・摘要の区分（U6）。既にある値は残し、後ろに足す。
  for (const [key, values] of Object.entries(MECHANICAL_STANDARD_CHOICES)) result[key] = [...new Set([...(result[key] ?? []), ...values])]
  return result
}

export const MECHANICAL_CHOICES: Readonly<Record<string, readonly string[]>> = choicesFor()

/** 細目の摘要の区分のうち、施工条件として扱うもの（項目を分けず、拾うときに選ぶ）。キーは `${細目}|${区分}`。 */
export const MECHANICAL_CONDITION_SLOTS: ReadonlySet<string> = new Set(Object.keys(PIPE_KINDS).map(name => `${name}|区分`))

const mechanicalDetailBase: Readonly<Record<string, readonly DetailTemplate[]>> = {
  保温: [
    { name: '配管保温', unit: 'm', summary: [slot('保温材', list('グラスウール保温筒、ロックウール保温筒、ポリスチレンフォーム保温筒')), slot('呼び径', nominal), condition('施工箇所', insulationPlaces)], note: '保温を要する配管の長さ' },
    { name: 'ダクト保温', unit: '㎡', summary: [slot('保温材', list('グラスウール保温板、ロックウール保温板')), condition('施工箇所', insulationPlaces)], note: 'ダクトの表面積' },
    { name: '弁類保温', unit: '個', summary: [slot('保温材', list('グラスウール、ロックウール、ポリスチレンフォーム')), slot('呼び径', nominal)] },
    { name: '機器類保温', unit: '㎡', summary: [slot('保温材', list('グラスウール、ロックウール'))] },
  ],
  塗装: [
    { name: '配管塗装', unit: 'm', summary: [paint, slot('呼び径', nominal)] },
    { name: 'ダクト塗装', unit: '㎡', summary: [paint] },
    { name: '機器類塗装', unit: '㎡', summary: [paint] },
    { name: '支持金物塗装', unit: '㎡', summary: [paint], note: '支持金物・架台の表面積（設備数量積算基準）' },
  ],
  スリーブ: [{ name: 'スリーブ', unit: 'か所', summary: [slot('材質', list('紙製、鋼管製、硬質ポリ塩化ビニル管製、つば付き鋼管製')), slot('口径', nominal), slot('部位', list('壁、床、梁'))] }],
  あと施工アンカー: [{ name: 'あと施工アンカー', unit: '本', summary: [slot('種類', list('金属拡張アンカー（おねじ形）、金属拡張アンカー（めねじ形）、接着系アンカー')), slot('呼び', list('M8、M10、M12、M16'))], linked: 'support', note: '配管等の長さ × 0.7 ÷ 支持間隔 の切り上げ（設備数量積算基準）' }],
  形鋼振れ止め支持: [{ name: '形鋼振れ止め支持', unit: 'か所', summary: [slot('呼び径', nominal)], note: '設計図書に記載がある場合' }],
  架台類: [{ name: '架台', unit: 'kg', summary: [slot('材質', list('鋼製（溶融亜鉛めっき）、鋼製（錆止め塗装）、ステンレス製'))], note: '質量（設備数量積算基準）' }],
  機器用基礎: [{ name: '機器用基礎', unit: '基', summary: [slot('寸法'), slot('種類', list('コンクリート基礎、防振基礎、鋼製架台'))] }],
  '搬入・据付費': [
    { name: '機器搬入', unit: 't', linked: 'carry', summary: [slot('区分', list('重量品、容積品'))] },
    { name: '機器据付', unit: '台', summary: [slot('名称')] },
  ],
  防火区画貫通処理: [{ name: '防火区画貫通処理', unit: 'か所', summary: [slot('工法', list('認定工法、モルタル充填')), slot('口径', nominal), slot('部位', list('壁、床'))] }],
  デッキプレート開口切断: [{ name: 'デッキプレート開口切断', unit: 'か所', summary: [slot('口径', nominal)] }],
  冷媒管: [{ name: '冷媒管', unit: 'm', summary: [slot('管種', list('冷媒用断熱材被覆銅管、冷媒用銅管')), slot('管径', list('6.35×9.52、6.35×12.7、9.52×15.88、9.52×19.05、12.7×25.4、15.88×28.58')), condition('施工箇所', PIPE_LOCATIONS)] }],
  合成樹脂製支持受: [{ name: '合成樹脂製支持受', unit: '個', summary: [slot('呼び径', nominal)] }],
  たわみ継手: [{ name: 'たわみ継手', unit: 'か所', summary: [slot('寸法', DUCT_SIZES)] }],
  消音エルボ: [{ name: '消音エルボ', unit: '個', summary: [slot('寸法', DUCT_SIZES)] }],
  チャンバー類: [{ name: 'チャンバー', unit: '個', summary: [slot('種類', list('消音チャンバー、吹出口用チャンバー')), slot('寸法', DUCT_SIZES)] }],
  制気口ボックス類: [{ name: '制気口ボックス', unit: '個', summary: [slot('寸法', GRILLE_SIZES)] }],
  文字標識等: [{ name: '文字標識', unit: 'か所', summary: [slot('種類', list('配管識別表示、弁札、機器名称板'))] }],
  表示板: [{ name: '表示板', unit: '枚' }],
  標識板: [{ name: '標識板', unit: '枚' }],
  機器類撤去: [{ name: '機器撤去', unit: '台', linked: 'waste', summary: [slot('名称'), processing] }],
  ダクト類撤去: [{ name: 'ダクト撤去', unit: '㎡', linked: 'waste', summary: [slot('種類', list('長方形ダクト、スパイラルダクト')), processing] }],
  配管類撤去: [{ name: '配管撤去', unit: 'm', linked: 'waste', summary: [slot('管種・呼び径'), processing] }],
  土工事: [
    { name: '根切り', unit: '㎥' },
    { name: '埋戻し', unit: '㎥' },
    { name: '建設発生土処理', unit: '㎥', summary: [slot('処理', list('構内敷きならし、構外搬出'))] },
  ],
  はつり補修: [{ name: 'はつり補修', unit: 'か所', summary: [slot('口径', nominal)] }],
  配管分岐・閉塞: [{ name: '配管分岐・閉塞', unit: 'か所', summary: [slot('呼び径', nominal)] }],
  ダクト分岐・閉塞: [{ name: 'ダクト分岐・閉塞', unit: 'か所', summary: [slot('寸法', DUCT_SIZES)] }],
  取外し再取付け: [{ name: '機器取外し再取付け', unit: '台', summary: [slot('名称')] }],
  機器固定用アンカー: [{ name: '機器固定用アンカー', unit: '本', summary: [slot('呼び', list('M10、M12、M16、M20'))] }],
}

/**
 * 細目の行（別紙明細でない）のうち、線で拾って換算する規格（SPEC-B10-3）。
 * 長方形ダクトは書式の単位が ㎡（設備数量積算基準: ダクトの数量は表面積）なので、図面では中心線の長さを拾い、
 * 寸法（幅×高さ）から 周長 2×(幅＋高さ) を掛けて ㎡ にする。寸法は既存の標準マスタの角ダクト（SD）の規格と同じ。
 */
const ductSizes = list('200×150、200×200、250×150、250×200、300×200、300×250、350×250、400×250、400×300、450×300、500×300、500×400、600×300、600×400、700×400、800×400、800×500、1000×400、1000×500、1200×500')
export const MECHANICAL_ROW_VARIANTS: Readonly<Record<string, { pick: 'length'; variants: readonly { code: string; spec: string; convert: { factor: number; unit: '㎡'; basis: string } }[] }>> = {
  長方形ダクト: {
    pick: 'length',
    variants: ductSizes.map(size => {
      const [w, h] = size.split('×').map(Number)
      return { code: `SD${size}`, spec: size, convert: { factor: 2 * (w + h) / 1000, unit: '㎡' as const, basis: `周長 2×(${w}＋${h})mm` } }
    }),
  },
}

// 別紙明細の明細の区分に、Claude が作った選択肢（U6、mechanicalStandardChoices.ts）を重ねる。
export const MECHANICAL_DETAILS: Readonly<Record<string, readonly DetailTemplate[]>> = withDetailChoices(mechanicalDetailBase, MECHANICAL_STANDARD_DETAIL_CHOICES)
