// 既存の標準マスタ（quantityMaster）の品目を、内訳書標準書式の品目に吸収する対応表（U1）。Claude が作成（2026-10-14）。
//
// 利用者の決定（2026-10-14、非公開の調査資料 §7）:
// - 既存の標準マスタの品目（記号と規格を持つ。ダウンライト DL・大便器 WC・VA 管 等）は内訳書の品目にまとめ、
//   記号・規格はその品目の選択肢にする。既存の品目は一覧から消し、「規格から選ぶ」「内訳書から選ぶ」の品目を同じにする。
// - 品目名は書式どおり（ダウンライト → ＬＥＤ照明器具・記号 DL、VA → 給水管・管種 VA）。既に PDF にある項目の名称は変えない。
// - 書式に行がない品目は、建築と同じく標準マスタの追加行として残す（mechanicalGroups.ts の SUPPLEMENT_ROW_NOTE の行）。
// 対象は電気設備・機械設備（調査済みの範囲）。電線・ケーブル・電線管・ラック等は、別紙明細の明細として既に共通なので対象外。
// 建築・仮設・土工の既存の品目は、建築の調査の後に同じ形で足す。

/**
 * 吸収先の内訳書の品目。row は細目名（数量で計上する行）。同じ名称で単位の違う行があるときは unit で絞る。
 * 別紙明細の明細は detailRow（細目名）と detail（明細名）で指す。
 */
export type MasterAbsorptionTarget =
  | { row: string; unit?: string }
  | { detailRow: string; detail: string }

export interface MasterAbsorption {
  /** 既存の標準マスタの分野・分類・種類（catalog.ts の masterKey と同じ並び）。 */
  master: readonly [field: '電気設備' | '機械設備', category: string, type: string]
  /** 同じ編の、この名称の品目すべてに規格を足す。 */
  targets: readonly MasterAbsorptionTarget[]
  /**
   * 'merge'（既定）: 既存の規格を吸収先の規格として足す（名称は吸収先の名称、記号・規格はそのまま）。
   * 'drop': 吸収先に同じ記号の規格がすでにあるので、規格は足さずに既存の品目だけ一覧から消す。
   */
  mode?: 'merge' | 'drop'
  /** 規格から摘要に入れる値（入力より優先し、組合せを増やさない。CatalogOption.summary と同じ扱い）。 */
  summary?: Readonly<Record<string, string>>
  /** 既存の記号（DL・WC 等）を入れる摘要の区分。 */
  codeLabel?: string
  /** 既存の規格の値（15A・φ100 等）を入れる摘要の区分。 */
  specLabel?: string
  /** specLabel に入れるときの書き換え。'stripPhi' は先頭の φ を取る（φ100 → 100）。 */
  specValue?: 'stripPhi'
}

const row = (name: string): MasterAbsorptionTarget => ({ row: name })
const rows = (...names: string[]): MasterAbsorptionTarget[] => names.map(row)

// 機械設備の管種の値は mechanicalDetails.ts の PIPE_KINDS の書き方にそろえる（無いものは同じ書き方で足した）。
const steelWhite = '配管用炭素鋼鋼管（白）（SGP）'
const steelBlack = '配管用炭素鋼鋼管（黒）（SGP）'
const stainless = '一般配管用ステンレス鋼鋼管（SUS）'
const pipe = (
  type: string,
  kind: string,
  targets: readonly string[],
  category = '配管（給水・給湯）',
): MasterAbsorption => ({
  master: ['機械設備', category, type],
  targets: rows(...targets),
  summary: { 管種: kind },
  specLabel: '呼び径',
})

export const MASTER_ABSORPTIONS: readonly MasterAbsorption[] = [
  // ── 電気設備: 照明器具（今までの ELECTRICAL_ROW_MASTERS の重ね合わせを置き換える） ──
  ...['DL', 'BL', 'BE', 'BR', 'PD', 'SP', 'OL'].map((type): MasterAbsorption => ({
    master: ['電気設備', '照明器具', type], targets: [row('ＬＥＤ照明器具')], codeLabel: '記号',
  })),
  { master: ['電気設備', '照明器具', '非常用照明'], targets: [row('非常用照明器具')], codeLabel: '記号' },
  { master: ['電気設備', '照明器具', '誘導灯（避難口）'], targets: [row('誘導灯')], codeLabel: '記号' },
  { master: ['電気設備', '照明器具', '誘導灯（通路）'], targets: [row('誘導灯')], codeLabel: '記号' },

  // ── 電気設備: 配線器具（別紙明細「配線器具」の「コンセント」「スイッチ」の種類） ──
  // 既存の標準マスタの分類は「コンセント」「スイッチ」（catalog.ts の CATEGORY_ALIASES で「配線器具」に見せている）。
  { master: ['電気設備', 'コンセント', 'C2'], targets: [{ detailRow: '配線器具', detail: 'コンセント' }], summary: { 種類: '2P15A×2' } },
  { master: ['電気設備', 'コンセント', 'C2E'], targets: [{ detailRow: '配線器具', detail: 'コンセント' }], summary: { 種類: '2P15A×2 接地極付' } },
  { master: ['電気設備', 'コンセント', 'CET'], targets: [{ detailRow: '配線器具', detail: 'コンセント' }], summary: { 種類: '2P15A×2 接地端子付' } },
  { master: ['電気設備', 'コンセント', 'CWP'], targets: [{ detailRow: '配線器具', detail: 'コンセント' }], summary: { 種類: '防水形 2P15A×2 接地極付' } },
  { master: ['電気設備', 'コンセント', 'CAC'], targets: [{ detailRow: '配線器具', detail: 'コンセント' }], summary: { 種類: '2P20A 接地極付' } },
  { master: ['電気設備', 'コンセント', 'CF'], targets: [{ detailRow: '二重床用配線器具', detail: 'フロアコンセント' }], summary: { 種類: '2P15A×2 接地極付' } },
  { master: ['電気設備', 'スイッチ', 'S'], targets: [{ detailRow: '配線器具', detail: 'スイッチ' }], summary: { 種類: '片切 1P15A' } },
  { master: ['電気設備', 'スイッチ', 'S3'], targets: [{ detailRow: '配線器具', detail: 'スイッチ' }], summary: { 種類: '3路 15A' } },
  { master: ['電気設備', 'スイッチ', 'DM'], targets: [{ detailRow: '配線器具', detail: 'スイッチ' }], summary: { 種類: '調光器' } },
  { master: ['電気設備', 'スイッチ', 'HS'], targets: [{ detailRow: '配線器具', detail: 'スイッチ' }], summary: { 種類: '人感センサスイッチ' } },

  // ── 電気設備: 弱電・防災 ──
  // 別紙明細に同じ記号の明細がある（情報用アウトレット LAN・電話用アウトレット TEL・テレビ端子 TV）。
  { master: ['電気設備', '弱電・防災', 'LAN'], targets: [{ detailRow: '情報用アウトレット', detail: '情報用アウトレット' }], mode: 'drop' },
  { master: ['電気設備', '弱電・防災', 'TEL'], targets: [{ detailRow: '電話用アウトレット', detail: '電話用アウトレット' }], mode: 'drop' },
  { master: ['電気設備', '弱電・防災', 'TV'], targets: [{ detailRow: 'テレビ端子', detail: 'テレビ端子' }], mode: 'drop' },
  { master: ['電気設備', '弱電・防災', 'SD'], targets: [row('煙感知器')] },
  { master: ['電気設備', '弱電・防災', 'HD'], targets: [row('熱感知器')] },
  { master: ['電気設備', '弱電・防災', 'SPK'], targets: rows('スピーカ', '天井形スピーカ'), codeLabel: '記号' },
  { master: ['電気設備', '弱電・防災', 'IC'], targets: [row('テレビインターホン')] },
  { master: ['電気設備', '弱電・防災', 'CAM'], targets: [row('カメラ')] },

  // ── 機械設備: 配管（用途の細目に、材料を管種として足す） ──
  pipe('SGP-VA', '水道用硬質塩化ビニルライニング鋼管（SGP-VA）', ['給水管', '補給水管', '冷却水管']),
  pipe('SGP-VB', '水道用硬質塩化ビニルライニング鋼管（SGP-VB）', ['給水管', '補給水管', '冷却水管']),
  pipe('SGP-VD', '水道用硬質塩化ビニルライニング鋼管（SGP-VD）', ['給水管', '補給水管', '冷却水管']),
  pipe('SGP-HVA', '水道用耐熱性硬質塩化ビニルライニング鋼管（SGP-HVA）', ['冷温水管', '給湯管']),
  pipe('SUS', stainless, ['給水管', '補給水管', '冷却水管', '冷温水管', '給湯管', '蒸気管']),
  pipe('銅管', '銅管（Lタイプ）', ['給水管', '給湯管']),
  pipe('HIVP', '水道用耐衝撃性硬質ポリ塩化ビニル管（HIVP）', ['給水管', '補給水管']),
  pipe('HTVP', '耐熱性硬質ポリ塩化ビニル管（HTVP）', ['給湯管']),
  pipe('PEX', '架橋ポリエチレン管（PEX）', ['給水管', '給湯管']),
  pipe('PB', 'ポリブテン管（PB）', ['給水管', '給湯管']),
  pipe('VP', '硬質ポリ塩化ビニル管（VP）', ['汚水管', '雑排水管', '通気管'], '配管（排水・通気）'),
  pipe('VU', '硬質ポリ塩化ビニル管（VU）', ['汚水管', '雑排水管', '通気管'], '配管（排水・通気）'),
  pipe('耐火VP', '耐火二層管（FDVD）', ['汚水管', '雑排水管', '通気管'], '配管（排水・通気）'),
  pipe('D-VA', '排水用硬質塩化ビニルライニング鋼管（DVLP）', ['汚水管', '雑排水管'], '配管（排水・通気）'),
  pipe('SGP(白)', steelWhite, ['冷却水管', '冷温水管', 'ドレン管', '汚水管', '雑排水管', '通気管', '消火管', '送水管', '液化石油ガス管'], '配管（消火・冷温水・蒸気）'),
  pipe('SGP(黒)', steelBlack, ['蒸気管', '油管'], '配管（消火・冷温水・蒸気）'),
  pipe('STPG370', '圧力配管用炭素鋼鋼管（STPG370）', ['冷却水管', '冷温水管', '蒸気管', '消火管', '送水管'], '配管（消火・冷温水・蒸気）'),
  pipe('DP', '硬質ポリ塩化ビニル管（VP）', ['ドレン管'], 'ドレン管'),
  { master: ['機械設備', '冷媒管', 'RP'], targets: [{ detailRow: '冷媒管', detail: '冷媒管' }], summary: { 管種: '冷媒用断熱材被覆銅管' }, specLabel: '管径' },
  { master: ['機械設備', '冷媒管', 'CU'], targets: [{ detailRow: '冷媒管', detail: '冷媒管' }], summary: { 管種: '冷媒用銅管' }, specLabel: '管径' },

  // ── 機械設備: ダクト ──
  // 長方形ダクトは細目に同じ寸法の規格（記号 SD＋寸法、周長で㎡に換算）があるので既存の品目を消すだけ。
  { master: ['機械設備', 'ダクト', 'SD'], targets: [row('長方形ダクト')], mode: 'drop' },
  { master: ['機械設備', 'ダクト', 'RD'], targets: [row('スパイラルダクト')], specLabel: '口径', specValue: 'stripPhi' },
  { master: ['機械設備', 'ダクト', 'RDB'], targets: [row('円形ダクト')], specLabel: '口径', specValue: 'stripPhi' },
  { master: ['機械設備', 'ダクト', 'FLD'], targets: [row('フレキシブルダクト')], specLabel: '口径', specValue: 'stripPhi' },

  // ── 機械設備: 空調・換気の機器と制気口 ──
  { master: ['機械設備', '空調', 'AC'], targets: [row('マルチパッケージ形空気調和機（屋内機）')], codeLabel: '記号', summary: { 仕様等: '天井カセット形' } },
  { master: ['機械設備', '空調', 'ACW'], targets: [row('マルチパッケージ形空気調和機（屋内機）')], codeLabel: '記号', summary: { 仕様等: '壁掛形' } },
  { master: ['機械設備', '空調', 'SA'], targets: [row('吹出口')], codeLabel: '記号' },
  { master: ['機械設備', '空調', 'RA'], targets: [row('吸込口')], codeLabel: '記号' },
  { master: ['機械設備', '換気', 'OA'], targets: [row('給気口')] },
  { master: ['機械設備', '換気', 'EF'], targets: [row('天井換気扇')], codeLabel: '記号' },
  { master: ['機械設備', '換気', 'EFW'], targets: [row('壁付換気扇')], codeLabel: '記号' },
  { master: ['機械設備', '換気', 'EA'], targets: [row('排気ガラリ')], codeLabel: '記号' },

  // ── 機械設備: 衛生器具・給湯・消火 ──
  { master: ['機械設備', '衛生器具', 'WC'], targets: [row('大便器')], codeLabel: '記号等' },
  { master: ['機械設備', '衛生器具', 'UR'], targets: [row('小便器')], codeLabel: '記号等' },
  { master: ['機械設備', '衛生器具', 'LV'], targets: [row('洗面器')], codeLabel: '記号等' },
  { master: ['機械設備', '衛生器具', 'HW'], targets: [row('手洗器')], codeLabel: '記号等' },
  { master: ['機械設備', '衛生器具', 'SSK'], targets: [row('掃除流し')], codeLabel: '記号等' },
  { master: ['機械設備', '衛生器具', 'SK'], targets: [{ row: '流し', unit: '組' }], codeLabel: '記号等' }, // 厨房機器設備の「流し」（台）は別物
  { master: ['機械設備', '衛生器具', 'WH'], targets: [row('給湯器')], codeLabel: '記号' },
  { master: ['機械設備', '消火', 'FH'], targets: [row('屋内消火栓箱')], codeLabel: '記号' },
  { master: ['機械設備', '消火', 'SPH'], targets: [row('スプリンクラーヘッド')] },
  { master: ['機械設備', '消火', 'FE'], targets: [row('消火器')] },

  // ── 機械設備: 保温・塗装（別紙明細） ──
  { master: ['機械設備', '保温', 'GW'], targets: [{ detailRow: '保温', detail: '配管保温' }], summary: { 保温材: 'グラスウール保温筒' }, specLabel: '呼び径' },
  { master: ['機械設備', '保温', 'DUCT-GW'], targets: [{ detailRow: '保温', detail: 'ダクト保温' }], summary: { 保温材: 'グラスウール保温板' } },
  { master: ['機械設備', '塗装', 'PIPE-PAINT'], targets: [{ detailRow: '塗装', detail: '配管塗装' }], specLabel: '呼び径' },
]
