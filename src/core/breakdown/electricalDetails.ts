// 電気設備の「1式・別紙明細」の標準の明細と、摘要の標準の選択肢（SPEC-B02）。
//
// 書式には別紙明細の中身が無いので、次をもとに Claude が想定して作った（利用者の確認待ちの参考例）。
// - 公共建築設備数量積算基準（令和7年改定）第3編: 測る単位と区分（ボックス・貫通処理・端子接続・塗装・はつり・撤去）
// - 公共建築工事標準仕様書（電気設備工事編）・公共建築設備工事標準図（電気設備工事編）令和7年版: 材料の種類・寸法の呼び方
// - 一般的な製品の区分（感知器の種別、変圧器の容量など）
// 選択肢は「よく使うもの」に絞った。無い値は画面で手入力する。
import type { DetailTemplate, DetailVariant, SummarySlot } from './types'
import { CONDUIT_OUTER_DIAMETERS } from './pipeDiameters'
import { WASTE_CHOICES, mergeChoices, withDetailChoices } from './commonChoices'
import { ELECTRICAL_STANDARD_CHOICES, ELECTRICAL_STANDARD_DETAIL_CHOICES } from './electricalStandardChoices'

const slot = (label: string, choices?: readonly string[]): SummarySlot => (choices ? { label, choices } : { label })
const list = (text: string) => text.split('、')
const paint = slot('塗料', list('錆止め＋SOP、SOP、DP'))
function pipePaintVariants(): DetailVariant[] {
  return Object.entries(CONDUIT_OUTER_DIAMETERS).map(([code, d]) => ({
    code: `${code}塗装`, spec: code, convert: { factor: Math.PI * d / 1000, unit: '㎡', basis: `外径 ${d}mm × π` },
  }))
}
function boxPaintVariants(): DetailVariant[] {
  return list('150×150×100、200×200×100、200×200×150、300×300×150、300×300×200、400×400×200、500×500×200、600×600×300').map(size => {
    const [w, h, d] = size.split('×').map(n => Number(n) / 1000)
    return { code: `PB${size}塗装`, spec: size, convert: { factor: w * h + 2 * w * d + 2 * h * d, unit: '㎡', basis: `${size} 背面を除く5面` } }
  })
}
function polePaintVariants(): DetailVariant[] {
  return ([[89.1, 3], [114.3, 3], [114.3, 4.5], [139.8, 4.5], [139.8, 6], [165.2, 6]] as const).map(([d, h]) => ({
    code: `P${d}×${h}m塗装`, spec: `φ${d}×地上高${h}m`, convert: { factor: Math.PI * d / 1000 * h, unit: '㎡', basis: `外径 ${d}mm × π × 地上高 ${h}m` },
  }))
}
// 施工・処理は施工条件として扱う（拾うときに選ぶ。既存の標準マスタの電線管・配線器具と同じ）。
const placement: SummarySlot = { label: '施工', choices: list('隠ぺい（埋込）、露出'), condition: true }
const processing: SummarySlot = { label: '処理', choices: list('撤去（廃棄）、取外し（再使用）'), condition: true }
const symbol = slot('記号')

/** 別紙明細の細目名 → 標準の明細。書式の細目名と完全に一致させる。 */
const electricalDetailBase: Readonly<Record<string, readonly DetailTemplate[]>> = {
  電線: [{ name: '電線', unit: 'm', master: { categories: ['電線'] } }],
  ケーブル: [{ name: 'ケーブル', unit: 'm', master: { categories: ['ケーブル（低圧）', 'ケーブル（高圧）', '制御ケーブル', '通信・弱電ケーブル', '耐火・耐熱ケーブル'] } }],
  電線管: [{ name: '電線管', unit: 'm', master: { categories: ['電線管'] } }],
  金属ダクト: [{ name: '金属ダクト', unit: 'm', master: { types: ['MD'] } }],
  ケーブルラック: [{ name: 'ケーブルラック', unit: 'm', master: { types: ['CR', 'CR-AL', 'CR-SUS'] } }],
  // 施工方法は単価の補正（直付が標準、つり下げ ×1.2、埋込み ×1.4。標準単価積算基準 R8 表E1-1-25）なので施工条件にする。4線式は ×1.2 で規格。
  ライティングダクト: [{ name: 'ライティングダクト', code: 'LD', unit: 'm', summary: [slot('種類', list('15A 2線式、20A 2線式、20A 3線式、20A 4線式')), { label: '施工', choices: list('直付、つり下げ、埋込み'), condition: true }] }],
  金属線ぴ: [{ name: '金属線ぴ', code: 'MM', unit: 'm', summary: [slot('種類', list('1種（A形）、1種（B形）、2種（40形）、2種（60形）')), placement] }],
  ボックス類: [
    { name: 'アウトレットボックス', code: 'OB', unit: '個', linked: 'box', summary: [slot('寸法', list('中浅形、中深形、大浅形、大深形')), placement] },
    { name: 'スイッチボックス', code: 'SB', unit: '個', linked: 'box', summary: [slot('寸法', list('1個用、2個用、3個用')), slot('深さ', list('浅形、深形')), placement] },
    { name: 'コンクリートボックス', code: 'CB', unit: '個', summary: [slot('寸法', list('中形 54mm、中形 75mm、大形 54mm、大形 75mm'))] },
    { name: '露出ボックス', code: 'EB', unit: '個', summary: [slot('形状', list('丸形 1方出、丸形 2方出、丸形 3方出、丸形 4方出、露出スイッチボックス 1個用、露出スイッチボックス 2個用'))] },
    { name: 'プルボックス', code: 'PB', unit: '個', summary: [slot('材質', list('鋼板製、ステンレス製、合成樹脂製')), slot('寸法', list('150×150×100、200×200×100、200×200×150、300×300×150、300×300×200、400×400×200、500×500×200、600×600×300')), slot('設置場所', list('屋内、屋外（防水）'))] },
  ],
  支持材: [
    { name: '吊りボルト', code: 'HB', unit: '本', linked: 'support', summary: [slot('呼び', list('W3/8、M10、M12'))] },
    { name: '形鋼振れ止め支持', unit: 'か所', summary: [slot('対象', list('電線管、ケーブルラック、金属ダクト'))] },
    { name: 'チャンネル（ダクター）', unit: 'm', summary: [slot('形状', list('41×41、41×21'))] },
    { name: 'あと施工アンカー', unit: '本', summary: [slot('呼び', list('M8、M10、M12、M16'))] },
  ],
  防火区画貫通処理等: [{ name: '防火区画貫通処理', unit: 'か所', summary: [
    slot('種類', list('電線管貫通、ケーブル貫通、ケーブルラック貫通、バスダクト貫通')),
    slot('寸法', list('呼び径 28 以下、呼び径 54 以下、呼び径 82 以下、呼び径 104 以下、開口 φ100 以下、開口 200×200 以下、開口 300×300 以下、ラック幅 300 以下、ラック幅 600 以下、ラック幅 1000 以下')),
    slot('部位', list('壁、床')),
    slot('工法', list('国土交通大臣認定工法')),
  ] }],
  接地工事: [
    { name: '接地極', unit: '個', summary: [slot('種類', list('銅板 900×900×1.5t、銅板 600×600×1.5t、接地棒 φ14×1500（2本連結）、接地棒 φ10×1500')), slot('種別', list('A種、B種、C種、D種'))] },
    { name: '接地線', unit: 'm', master: { types: ['IV', 'EM-IE'] }, summary: [slot('種別', list('A種、B種、C種、D種'))] },
    { name: '接地極埋設標', unit: '個' },
    { name: '接地抵抗測定', unit: 'か所' },
  ],
  塗装工事: [
    // 拾った長さ × 外径 × π を㎡にする（利用者の決定。数量積算基準の m ではなく㎡で出し、別紙明細に延長を併記する）。
    { name: '配管塗装', unit: '㎡', pick: 'length', variants: pipePaintVariants(), summary: [paint] },
    // 箱の数 × 塗る面の面積（壁付けとして背面を除く5面）。
    { name: 'ボックス塗装', unit: '㎡', pick: 'count', variants: boxPaintVariants(), summary: [paint] },
    // ポールの数 × 外径 × π × 地上高（側面）。
    { name: 'ポール塗装', unit: '㎡', pick: 'count', variants: polePaintVariants(), summary: [paint] },
    { name: '支持金物塗装', unit: '㎡', linked: 'paint', summary: [paint] },
  ],
  施工費: [
    { name: '器具取付', unit: '個', linked: 'install', summary: [symbol] },
    { name: '盤取付', unit: '面', linked: 'install', summary: [slot('盤名称')] },
  ],
  配線器具: [
    { name: 'スイッチ', code: 'S', unit: '個', summary: [slot('種類', list('片切 1P15A、3路 15A、4路 15A、パイロットランプ付 1P15A、調光器、遅延スイッチ、人感センサスイッチ')), slot('連数', list('1個用、2個用、3個用'))] },
    { name: 'コンセント', code: 'C', unit: '個', summary: [slot('種類', list('2P15A×2、2P15A×2 接地極付、2P15A×2 接地端子付、2P20A 接地極付、3P20A 接地極付、防水形 2P15A×2 接地極付、抜止形 2P15A×2 接地極付')), placement] },
  ],
  二重床用配線器具: [{ name: 'フロアコンセント', code: 'FC', unit: '個', summary: [slot('種類', list('2P15A×2 接地極付、2P15A×4 接地極付、OAタップ 4口'))] }],
  設備プレート: [{ name: '設備プレート', unit: '個', summary: [slot('材質', list('新金属プレート、樹脂プレート、ステンレスプレート、防水プレート')), slot('連数', list('1個用、2個用、3個用'))] }],
  情報用アウトレット: [{ name: '情報用アウトレット', code: 'LAN', unit: '個', summary: [slot('種類', list('Cat6 1口、Cat6 2口、Cat6A 1口、Cat6A 2口、光 2心'))] }],
  二重床用情報用アウトレット: [{ name: '二重床用情報用アウトレット', unit: '個', summary: [slot('種類', list('Cat6 2口、Cat6 4口、Cat6A 2口'))] }],
  電話用アウトレット: [{ name: '電話用アウトレット', code: 'TEL', unit: '個', summary: [slot('種類', list('モジュラジャック 6極2心、モジュラジャック 6極4心、8極8心'))] }],
  二重床用電話用アウトレット: [{ name: '二重床用電話用アウトレット', unit: '個', summary: [slot('種類', list('モジュラジャック 6極2心、モジュラジャック 6極4心'))] }],
  テレビ端子: [{ name: 'テレビ端子', code: 'TV', unit: '個', summary: [slot('種類', list('1端子形、2端子形（電源通電形）、直列ユニット 中間用、直列ユニット 端末用'))] }],
  端子接続: [{ name: '端子接続', unit: '個', summary: [slot('対数', list('2P、4P、10P、20P、30P、50P、100P'))] }],
  電動機等接続: [{ name: '電動機接続', unit: '台', summary: [slot('出力', list('0.75kW 以下、1.5kW 以下、3.7kW 以下、7.5kW 以下、15kW 以下、22kW 以下、37kW 以下'))] }],
  連動機器等接続: [{ name: '連動機器接続', unit: 'か所', summary: [slot('機器', list('防火戸、防火シャッター、防火ダンパー、排煙口、空調停止'))] }],
  直接仮設: [
    { name: '養生', unit: '㎡', summary: [slot('対象', list('床、壁、器具・備品'))] },
    { name: '脚立足場', unit: '㎡' },
    { name: '移動式足場', unit: '㎡', summary: [slot('種類', list('ローリングタワー、可搬式作業台'))] },
    { name: '仮設間仕切り', unit: '㎡' },
  ],
  はつり工事: [
    { name: '貫通口はつり', unit: 'か所', summary: [slot('口径', list('φ50、φ75、φ100、φ150、φ200')), slot('コンクリート厚さ', list('150、200、250、300'))] },
    { name: '溝はつり', unit: 'm', summary: [slot('幅×深さ', list('30×30、50×30、50×50、100×50'))] },
    { name: '面はつり', unit: '㎡' },
  ],
  取外し再取付け: [
    { name: '器具取外し再取付け', unit: '個', summary: [symbol] },
    { name: '盤取外し再取付け', unit: '面', summary: [slot('盤名称')] },
  ],
  撤去: [
    { name: '配管撤去', unit: 'm', linked: 'waste', summary: [slot('種類・呼び径'), processing] },
    { name: '配線撤去', unit: 'm', linked: 'waste', summary: [slot('種類・サイズ'), processing] },
    { name: '器具撤去', unit: '個', linked: 'waste', summary: [symbol, processing] },
    { name: '盤撤去', unit: '面', linked: 'waste', summary: [slot('盤名称'), processing] },
    { name: '機器撤去', unit: '台', linked: 'waste', summary: [slot('名称'), processing] },
  ],
  搬入費: [{ name: '機器搬入', unit: 't', linked: 'carry', summary: [slot('区分', list('重量品、容積品'))] }],
  搬出費: [{ name: '機器搬出', unit: 't', linked: 'carry', summary: [slot('区分', list('重量品、容積品'))] }],
  基礎: [{ name: '機器基礎', unit: '基', summary: [slot('寸法'), slot('種類', list('コンクリート基礎、鋼製架台'))] }],
  土工事: [
    { name: '根切り', unit: '㎥' },
    { name: '埋戻し', unit: '㎥' },
    { name: '建設発生土処理', unit: '㎥', summary: [slot('処理', list('構内敷きならし、構外搬出'))] },
  ],
  保護管: [{ name: '保護管', unit: 'm', master: { types: ['G', 'FEP', 'VE'] } }],
  地中線埋設標識: [
    { name: '埋設標識シート', unit: 'm', summary: [slot('種類', list('2倍長、1倍長'))] },
    { name: '埋設標', unit: '個', summary: [slot('種類', list('コンクリート製、鋲（びょう）形'))] },
  ],
  防水鋳鉄管: [{ name: '防水鋳鉄管', unit: '個', summary: [slot('呼び径', list('50、80、100、125、150'))] }],
  装柱材: [{ name: '装柱材', unit: '組', summary: [slot('種類', list('腕金、アームタイ、がいし、引留クランプ'))] }],
  支線: [{ name: '支線', unit: '本', summary: [slot('種類', list('普通支線、水平支線、支柱'))] }],
  メッセンジャワイヤ: [{ name: 'メッセンジャワイヤ', unit: 'm', summary: [slot('サイズ', list('22sq、38sq、55sq'))] }],
  蓄電池: [{ name: '蓄電池', unit: '個', summary: [slot('形式', list('制御弁式据置鉛蓄電池（MSE）、長寿命形制御弁式据置鉛蓄電池、アルカリ蓄電池、リチウムイオン蓄電池')), slot('容量', list('50Ah、100Ah、150Ah、200Ah、300Ah、500Ah'))] }],
  発信機: [{ name: '発信機', unit: '個', summary: [slot('形式', list('P型1級、P型2級')), placement] }],
  警報ベル: [{ name: '地区音響装置（ベル）', unit: '個', summary: [slot('寸法', list('φ100、φ150'))] }],
  表示灯: [{ name: '表示灯', unit: '個', summary: [placement] }],
  移報器: [{ name: '移報器', unit: '個' }],
  非常ベル: [{ name: '非常ベル', unit: '個', summary: [slot('寸法', list('φ100、φ150'))] }],
  起動装置: [{ name: '起動装置', unit: '個', summary: [placement] }],
  電子ブザー: [{ name: '電子ブザー', unit: '個' }],
  ガス漏れ表示灯: [{ name: 'ガス漏れ表示灯', unit: '個' }],
  呼出表示灯: [{ name: '呼出表示灯', unit: '個' }],
  '呼出・復帰ボタン': [{ name: '呼出・復帰ボタン', unit: '個', summary: [slot('種類', list('呼出ボタン、復帰ボタン、呼出・復帰ボタン、ひも付'))] }],
  保安器: [{ name: '保安器', unit: '個', summary: [slot('対数', list('1P、2P、5P、10P'))] }],
  '受雷部（導線）': [{ name: '受雷部（導線）', unit: 'm', summary: [slot('材料', list('銅より線 38sq、銅より線 60sq、アルミ線、ステンレス棒'))] }],
  引下げ導線: [{ name: '引下げ導線', unit: 'm', summary: [slot('材料', list('銅より線 38sq、銅より線 60sq、構造体利用'))] }],
  接続金物: [{ name: '接続金物', unit: '個' }],
  太陽電池: [{ name: '太陽電池モジュール', unit: '枚', summary: [slot('出力', list('200W、250W、300W、350W、400W、450W'))] }],
  架台: [{ name: '太陽電池架台', unit: '基' }],
  接続箱: [{ name: '接続箱', unit: '個', summary: [slot('回路数', list('4回路、6回路、8回路、10回路'))] }],
  変換器箱: [{ name: '変換器箱', unit: '個' }],
  計測機器: [{ name: '計測機器', unit: '個', summary: [slot('種類', list('日射計、気温計'))] }],
  発熱線等: [{ name: '発熱線', unit: 'm', summary: [slot('種類', list('ロードヒーティング用、凍結防止用'))] }],
}

/** 数量で計上する細目の摘要の標準の選択肢。鍵は「細目名|区分名」。記号・盤名称・名称は図面の文字を入れるので持たない。 */
const electricalChoiceBase: Readonly<Record<string, readonly string[]>> = {
  '引込み計器箱|形式': list('屋外壁掛形、屋外自立形、屋内壁掛形'),
  '引込み計器箱|仕様': list('電灯用、動力用、電灯動力共用'),
  '変圧器|方式': list('油入式（単相）、油入式（三相）、モールド式（単相）、モールド式（三相）'),
  '変圧器|容量': list('20kVA、30kVA、50kVA、75kVA、100kVA、150kVA、200kVA、300kVA、500kVA、750kVA、1000kVA'),
  '高圧進相コンデンサ|方式': list('油入式、乾式'),
  '高圧進相コンデンサ|容量': list('10kvar、15kvar、20kvar、25kvar、30kvar、50kvar、75kvar、100kvar'),
  '直列リアクトル|方式': list('油入式、乾式'),
  '直列リアクトル|容量': list('6%、13%'),
  '高圧引込用負荷開閉器|仕様': list('気中負荷開閉器（PAS）SOG 付、地中線用負荷開閉器（UGS）SOG 付'),
  'バスダクト|形式': list('屋内用、屋外用、耐火形'),
  'バスダクト|仕様': list('400A、600A、800A、1000A、1200A、1500A、2000A、3000A'),
  '電気自動車用充電装置|形式': list('普通充電（壁掛形）、普通充電（スタンド形）、急速充電'),
  '電気自動車用充電装置|仕様': list('3kW、6kW、20kW、50kW'),
  '警報盤|形式': list('壁掛形、自立形'),
  '警報盤|窓数': list('10窓、20窓、30窓、40窓'),
  'ＵＰＳ装置|仕様': list('常時インバータ給電方式、ラインインタラクティブ方式'),
  'ＵＰＳ装置|容量': list('1kVA、3kVA、5kVA、10kVA、20kVA、30kVA、50kVA、100kVA'),
  '整流装置|仕様': list('サイリスタ式、スイッチング式'),
  '電力平準化用蓄電装置|仕様': list('リチウムイオン蓄電池、鉛蓄電池'),
  '電力平準化用蓄電装置|容量': list('10kWh、20kWh、50kWh、100kWh'),
  '発電装置|定格': list('50kVA、100kVA、150kVA、200kVA、300kVA、500kVA、750kVA、1000kVA'),
  '発電装置|電気方式': list('三相3線 200V、三相3線 400V、三相3線 6.6kV'),
  '燃料電池発電装置|定格': list('0.7kW、5kW、100kW'),
  '燃料電池発電装置|電気方式': list('単相3線 200V、三相3線 200V'),
  '始動装置|方式': list('セルモータ式、空気始動式'),
  '給油ボックス|形式': list('壁埋込形、壁掛形、自立形'),
  '消音器|仕様': list('一般形、高性能形'),
  '消音器|dB': list('25dB、35dB'),
  '燃料ポンプ|定格出力': list('0.4kW、0.75kW、1.5kW'),
  'パワーコンディショナ|形式': list('単相、三相'),
  'パワーコンディショナ|容量': list('5.5kW、10kW、20kW、50kW'),
  '表示装置|表示方式': list('液晶、LED'),
  '表示装置|サイズ': list('32型、43型、55型'),
  '風車発電装置|形式': list('水平軸、垂直軸'),
  '風車発電装置|出力': list('1kW、3kW、10kW'),
  '幹線用スイッチ|仕様': list('L3 スイッチ 24ポート、L3 スイッチ 48ポート'),
  '支線用スイッチ|仕様': list('L2 スイッチ 24ポート、L2 スイッチ 48ポート'),
  'フロア用スイッチ|仕様': list('L2 スイッチ 8ポート、L2 スイッチ 24ポート、L2 スイッチ 24ポート PoE、L2 スイッチ 48ポート'),
  'ルータ|仕様': list('ブロードバンドルータ、拠点間 VPN 対応'),
  'メディアコンバータ|仕様': list('1000BASE-SX、1000BASE-LX、10GBASE-SR'),
  'ファイヤーウォール|仕様': list('UTM、ファイヤーウォール専用機'),
  '無線アクセスポイント|仕様': list('IEEE802.11ax 天井取付形、IEEE802.11ax 壁取付形、IEEE802.11ac 天井取付形'),
  '機器収納架|仕様': list('19インチラック 自立形 42U、19インチラック 自立形 24U、19インチラック 壁掛形 12U'),
  'ＡＶ機器収納架|仕様': list('19インチラック 自立形 42U、19インチラック 自立形 24U'),
  '監視カメラ装置架|仕様': list('19インチラック 自立形 42U、19インチラック 自立形 24U'),
  '交換装置|方式': list('IP-PBX、デジタル式'),
  '交換装置|局線数': list('4、8、16、32'),
  '交換装置|内線数': list('16、32、64、128、256'),
  '局線中継台|形式': list('卓上形、パソコン形'),
  '本配線盤|形式': list('壁掛形、自立形'),
  '本配線盤|実装数': list('100P、200P、400P、800P'),
  '局線表示盤|形式': list('壁掛形'),
  '局線表示盤|窓数': list('4窓、8窓、16窓'),
  '一般電話機|仕様': list('卓上形、壁掛形'),
  '多機能電話機|仕様': list('12ボタン、24ボタン'),
  'デジタルコードレス電話機|仕様': list('単独形、充電台付'),
  '情報表示盤|画面サイズ': list('32型、43型、55型、65型'),
  'カラーモニタ|形式': list('壁掛形、スタンド形、天吊形'),
  'カラーモニタ|表示方式': list('液晶'),
  'カラーモニタ|画面サイズ': list('32型、43型、55型、65型、75型'),
  'モニタ装置|形式': list('壁掛形、卓上形'),
  'モニタ装置|表示方式': list('液晶'),
  'モニタ装置|画面サイズ': list('24型、32型、43型、55型'),
  '録画装置|種別': list('ネットワークビデオレコーダ、デジタルビデオレコーダ'),
  '録画装置|容量': list('2TB、4TB、8TB、16TB'),
  'カメラ|形式': list('ドーム形、ボックス形、バレット形、PTZ 形'),
  '屋外カメラ|形式': list('ドーム形、ボックス形、バレット形、PTZ 形'),
  '屋外カメラ|ハウジング': list('屋外用ハウジング、屋外用ハウジング（ヒーター付）'),
  'カメラ操作器|形式': list('卓上形'),
  '書画カメラ|形式': list('据置形'),
  'マイクロホン|形式': list('ダイナミック形、コンデンサ形、ワイヤレス形'),
  '集合形スピーカ|形式': list('壁掛形、自立形'),
  'ワイヤレスアンテナ|形式': list('天井埋込形、壁掛形'),
  '一般･非常業務放送架|形式': list('自立形、卓上形'),
  '一般･非常業務放送架|出力': list('120W、240W、360W、480W、720W'),
  'リモコンマイク|出力制御数': list('5局、10局、20局'),
  'ラジオ用アンテナ|形式': list('AM、FM、AM・FM 共用'),
  'テレビインターホン|方式': list('親子式、相互式'),
  'テレビインターホン|仕様': list('親機、子機（屋外形）、子機（屋内形）'),
  '外部受付用インターホン|仕様': list('カメラ付 屋外形、音声のみ 屋外形'),
  '呼出表示器|形式': list('壁掛形'),
  '呼出表示器|窓数': list('4窓、8窓、12窓、16窓'),
  'アンテナマスト|形式': list('屋上自立形、壁面取付形、ルーフタワー形'),
  '電波受信アンテナ|形式': list('GPS、標準電波（JJY）'),
  '電柱|仕様': list('コンクリート柱、鋼管柱'),
  '電柱|寸法': list('8m、10m、12m、14m、16m'),
  '取付ポール|仕様': list('鋼管ポール（溶融亜鉛めっき）、鋼管ポール（溶融亜鉛めっき＋塗装）、ステンレスポール'),
  '取付ポール|寸法': list('地上高 3m、地上高 4.5m、地上高 6m'),
  '受信機|形式': list('P型1級、P型2級、R型、GR型'),
  '受信機|回線数': list('5回線、10回線、15回線、20回線、30回線、40回線、50回線'),
  '副受信機|形式': list('P型1級、R型表示機'),
  '副受信機|回線数': list('5回線、10回線、20回線、30回線'),
  '熱感知器|形式': list('差動式スポット型2種、定温式スポット型特種、定温式スポット型1種、定温式スポット型1種防水型、補償式スポット型2種、差動式分布型'),
  '煙感知器|形式': list('光電式スポット型2種、光電式スポット型3種、光電式スポット型1種、光電式分離型'),
  '炎感知器|形式': list('赤外線式スポット型（屋内型）、赤外線式スポット型（屋外型）、紫外線式スポット型'),
  '複合式感知器|形式': list('熱煙複合式スポット型'),
  '回路試験器|形式': list('埋込形、露出形'),
  '機器収容箱|形式': list('埋込形、露出形、屋外形'),
  '連動制御盤|形式': list('壁掛形、自立形'),
  '連動制御盤|回線数': list('5回線、10回線、20回線、30回線'),
  '自動閉鎖装置|種別': list('防火戸用（電磁式レリーズ）、防火シャッター用、防火ダンパー用、排煙口用'),
  '操作装置|形式': list('壁掛形、埋込形、テンキー式、カード式'),
  '操作装置|回線数': list('5回線、10回線、20回線'),
  '複合装置|形式': list('埋込形、露出形'),
  'ガス漏れ検知器|ガス種別': list('都市ガス（空気より軽い）、LP ガス（空気より重い）'),
  'ガス漏れ検知器|電圧': list('AC100V、DC24V'),
  'ガス漏れ受信機|形式': list('G型、GP型1級、GR型'),
  'ガス漏れ受信機|回線数': list('5回線、10回線、20回線'),
  'ガス漏れ副受信機|形式': list('G型、GP型1級'),
  'ガス漏れ副受信機|回線数': list('5回線、10回線'),
  'ガス漏れ中継器|形式': list('アナログ式、オンオフ式'),
  'ガス漏れ中継器|回線数': list('1回線、2回線、4回線'),
  '管制盤|形式': list('壁掛形、自立形'),
  '発券機|形式': list('磁気券、QR コード券'),
  'カードリーダ|形式': list('非接触 IC カード、磁気カード、テンキー併用'),
  '警報制御装置|形式': list('壁掛形、自立形'),
  'マグネットセンサ|形式': list('埋込形、露出形、屋外形'),
  '赤外線センサ|形式': list('屋内用 2段、屋外用 2段、屋外用 4段'),
  'パッシブセンサ|形式': list('天井取付形、壁取付形、屋外形'),
  '画像センサ|形式': list('屋内形、屋外形'),
  'ガラスセンサ|形式': list('振動式、音響式'),
  '端末装置|形式': list('壁掛形、卓上形'),
  '鍵管理装置|形式': list('10本用、20本用、50本用'),
  '電気錠制御盤|形式': list('壁掛形'),
  'セキュリティーゲート|形式': list('フラッパー式、アーム式、スライド式'),
  'ゲート制御装置|形式': list('壁掛形'),
  'バイオメトリックス照合装置|形式': list('顔認証、指静脈認証、指紋認証'),
  '監視操作装置|形式': list('パソコン形、卓上形'),
  'グラフィックパネル|形式': list('液晶、モザイク'),
  '信号処理装置|形式': list('自立形、壁掛形'),
  '温度センサ|仕様': list('路面埋込形、外気温用'),
  '降雪センサ|仕様': list('屋外ポール取付形'),
  '水分センサ|仕様': list('路面埋込形'),
  // ── U3（2026-10-14）: 選択肢の無かった区分に、よく使う値を足した。無い値は「ほかの値」で入れる ──
  ...WASTE_CHOICES,
  '制御装置|形式': list('壁掛形、自立形、ラック収容形、卓上形'),
  '電源装置|形式': list('壁掛形、自立形、ラック収容形'),
  '電源装置|仕様': list('AC100V 出力、DC24V 出力、DC48V 出力'),
  '電源装置|容量': list('500VA、1kVA、1.5kVA、2kVA、3kVA、5kVA'),
  '料金課金装置|形式': list('自立形、壁掛形'),
  '操作制御装置|形式': list('卓上形、壁掛形、自立形'),
  '配線接続盤|形式': list('壁掛形、自立形'),
  '検出装置|形式': list('ループコイル式、超音波式、光電式、画像式'),
  '記録装置|形式': list('ラック収容形、卓上形、壁掛形'),
  '屋外時計|形式': list('片面形、両面形'),
  '屋外スピーカ|形式': list('ホーン形、コラム形、ボックス形'),
  '支持構造物|仕様': list('鋼製（溶融亜鉛めっき）、鋼製（錆止め塗装）、ステンレス製'),
  'ＡＶ操作卓|仕様': list('卓上形、据置形'),
  'カットリレー盤|仕様': list('壁掛形、自立形'),
  'ブレーカボックス|仕様': list('屋内用、屋外用'),
  '電源供給器|仕様': list('AC100V 入力 DC15V 出力、AC100V 入力 AC24V 出力'),
  '電源挿入器|仕様': list('屋内用、屋外用'),
}

// 標準単価積算基準の細目・摘要の区分（U6、electricalStandardChoices.ts）を、行の区分と別紙明細の明細の区分に重ねる。
export const ELECTRICAL_DETAILS: Readonly<Record<string, readonly DetailTemplate[]>> = withDetailChoices(electricalDetailBase, ELECTRICAL_STANDARD_DETAIL_CHOICES)
/** 数量で計上する細目の摘要の標準の選択肢。鍵は「細目名|区分名」。 */
export const ELECTRICAL_CHOICES: Readonly<Record<string, readonly string[]>> = mergeChoices(electricalChoiceBase, ELECTRICAL_STANDARD_CHOICES)
