import type { BreakdownBook } from '../countFixtures'

/**
 * 内訳書の細目と自動で対応しない標準マスタの品目の、代表の内訳書の位置。
 * 同じ名前の細目が無い品目は、いちばん近い細目を想定で選んでいる（利用者が手で直せる）。
 */
export interface RepresentativePositionRow {
  /** 標準マスタの分野・分類（元の鍵）・種類。 */
  master: readonly [field: string, category: string, type: string]
  book: BreakdownBook
  section: string
  subject: string
  middle?: string
  item: string
}

const 電灯 = { book: '電気設備', section: '庁舎', subject: '電灯設備' } as const
const 空調 = { book: '機械設備', section: '庁舎', subject: '空気調和設備' } as const
const 換気 = { book: '機械設備', section: '庁舎', subject: '換気設備' } as const
const 機械 = { book: '機械設備', section: '庁舎' } as const
const 建築 = { book: '建築', section: '庁舎' } as const
const 改修 = { book: '建築', section: '庁舎（改修）' } as const

export const REPRESENTATIVE_POSITION_ROWS: readonly RepresentativePositionRow[] = [
  // 電気設備: 配線器具
  ...['C2', 'C2E', 'CET', 'CWP', 'CF', 'CAC'].map(type => ({
    master: ['電気設備', 'コンセント', type] as const, ...電灯, middle: 'コンセント分岐', item: '配線器具',
  })),
  ...['S', 'S3', 'DM', 'HS'].map(type => ({
    master: ['電気設備', 'スイッチ', type] as const, ...電灯, middle: '電灯分岐', item: '配線器具',
  })),
  // 電気設備: 弱電・防災
  { master: ['電気設備', '弱電・防災', 'LAN'], book: '電気設備', section: '庁舎', subject: '構内情報通信網設備', item: '情報用アウトレット' },
  { master: ['電気設備', '弱電・防災', 'TEL'], book: '電気設備', section: '庁舎', subject: '構内交換設備', item: '電話用アウトレット' },
  { master: ['電気設備', '弱電・防災', 'TV'], book: '電気設備', section: '庁舎', subject: 'テレビ共同受信設備', item: 'テレビ端子' },
  { master: ['電気設備', '弱電・防災', 'IC'], book: '電気設備', section: '庁舎', subject: '誘導支援設備', middle: 'インターホン', item: 'テレビインターホン' },

  // 機械設備: 配管
  ...['SGP-VA', 'SGP-VB', 'SGP-VD', 'SUS', 'HIVP', 'PEX', 'PB'].map(type => ({
    master: ['機械設備', '配管（給水・給湯）', type] as const, ...機械, subject: '給水設備', item: '給水管',
  })),
  ...['SGP-HVA', '銅管', 'HTVP'].map(type => ({
    master: ['機械設備', '配管（給水・給湯）', type] as const, ...機械, subject: '給湯設備', item: '給湯管',
  })),
  { master: ['機械設備', '配管（排水・通気）', 'VP'], ...機械, subject: '排水設備', item: '雑排水管' },
  { master: ['機械設備', '配管（排水・通気）', 'VU'], ...機械, subject: '排水設備', item: '汚水管' },
  { master: ['機械設備', '配管（排水・通気）', '耐火VP'], ...機械, subject: '排水設備', item: '汚水管' },
  { master: ['機械設備', '配管（排水・通気）', 'D-VA'], ...機械, subject: '排水設備', item: '雑排水管' },
  { master: ['機械設備', '配管（消火・冷温水・蒸気）', 'SGP(白)'], ...機械, subject: '消火設備', middle: '屋内消火栓設備', item: '消火管' },
  { master: ['機械設備', '配管（消火・冷温水・蒸気）', 'SGP(黒)'], ...空調, middle: '配管設備', item: '冷温水管' },
  { master: ['機械設備', '配管（消火・冷温水・蒸気）', 'STPG370'], ...空調, middle: '配管設備', item: '蒸気管' },
  { master: ['機械設備', '冷媒管', 'RP'], ...空調, middle: '配管設備', item: '冷媒管' },
  { master: ['機械設備', '冷媒管', 'CU'], ...空調, middle: '配管設備', item: '冷媒管' },
  { master: ['機械設備', 'ドレン管', 'DP'], ...空調, middle: '配管設備', item: 'ドレン管' },

  // 機械設備: ダクト・空調・換気
  { master: ['機械設備', 'ダクト', 'SD'], ...空調, middle: 'ダクト設備', item: '長方形ダクト' },
  { master: ['機械設備', 'ダクト', 'RD'], ...空調, middle: 'ダクト設備', item: 'スパイラルダクト' },
  { master: ['機械設備', 'ダクト', 'RDB'], ...空調, middle: 'ダクト設備', item: '鋼板製ダクト' },
  { master: ['機械設備', 'ダクト', 'FLD'], ...空調, middle: 'ダクト設備', item: 'スパイラルダクト' },
  { master: ['機械設備', '空調', 'AC'], ...空調, middle: '機器設備', item: 'マルチパッケージ形空気調和機（屋内機）' },
  { master: ['機械設備', '空調', 'ACW'], ...空調, middle: '機器設備', item: 'マルチパッケージ形空気調和機（屋内機）' },
  { master: ['機械設備', '空調', 'SA'], ...空調, middle: 'ダクト設備', item: 'シーリングディフューザー' },
  { master: ['機械設備', '空調', 'RA'], ...空調, middle: 'ダクト設備', item: '吸込口' },
  { master: ['機械設備', '換気', 'EF'], ...換気, middle: '機器設備', item: '遠心送風機' },
  { master: ['機械設備', '換気', 'EFW'], ...換気, middle: '機器設備', item: '圧力扇' },
  { master: ['機械設備', '換気', 'OA'], ...換気, middle: 'ダクト設備', item: '吹出口' },
  { master: ['機械設備', '換気', 'EA'], ...換気, middle: 'ダクト設備', item: '吸込口' },

  // 機械設備: 衛生器具・消火・保温・塗装
  { master: ['機械設備', '衛生器具', 'WC'], ...機械, subject: '衛生器具設備', item: '大便器' },
  { master: ['機械設備', '衛生器具', 'UR'], ...機械, subject: '衛生器具設備', item: '小便器' },
  { master: ['機械設備', '衛生器具', 'LV'], ...機械, subject: '衛生器具設備', item: '洗面器' },
  { master: ['機械設備', '衛生器具', 'HW'], ...機械, subject: '衛生器具設備', item: '手洗器' },
  { master: ['機械設備', '衛生器具', 'SK'], ...建築, subject: 'ユニット及びその他', middle: '内部', item: '流し台' },
  { master: ['機械設備', '衛生器具', 'SSK'], ...機械, subject: '衛生器具設備', item: '掃除流し' },
  { master: ['機械設備', '衛生器具', 'WH'], ...機械, subject: '給湯設備', item: '貯湯式電気温水器' },
  { master: ['機械設備', '消火', 'FH'], ...機械, subject: '消火設備', middle: '屋内消火栓設備', item: '屋内消火栓箱' },
  { master: ['機械設備', '消火', 'SPH'], ...機械, subject: '消火設備', middle: 'スプリンクラー設備', item: '消火機器' },
  { master: ['機械設備', '消火', 'FE'], ...機械, subject: '消火設備', middle: 'スプリンクラー設備', item: '消火機器' },
  { master: ['機械設備', '保温', 'GW'], ...空調, middle: '配管設備', item: '保温' },
  { master: ['機械設備', '保温', 'DUCT-GW'], ...空調, middle: 'ダクト設備', item: '保温' },
  { master: ['機械設備', '塗装', 'PIPE-PAINT'], ...空調, middle: '配管設備', item: '塗装' },

  // 建築
  { master: ['建築', '内装（面積）', '床仕上げ'], ...建築, subject: '内外装', middle: '内部', item: 'ビニル床シート張り' },
  { master: ['建築', '内装（面積）', '天井仕上げ'], ...建築, subject: '内外装', middle: '内部', item: '天井ロックウール化粧吸音板張り' },
  { master: ['建築', '内装（面積）', '壁仕上げ'], ...建築, subject: '内外装', middle: '内部', item: '壁せっこうボード張り' },
  { master: ['建築', '内装（面積）', '塗装'], ...建築, subject: '塗装', middle: '内部', item: 'ＥＰ合成樹脂エマルションペイント塗り' },
  { master: ['建築', '外部（面積）', '舗装'], book: '建築', section: '構内舗装', subject: '構内舗装', item: 'アスファルト舗装' },
  { master: ['建築', '外部（面積）', '屋上防水'], ...建築, subject: '防水', middle: '外部', item: 'アスファルト防水' },
  { master: ['建築', 'コンクリート（体積）', '土間コンクリート'], ...建築, subject: 'コンクリート', middle: '躯体', item: '普通コンクリート（土間）' },
  { master: ['建築', '長さ', '巾木'], ...建築, subject: '内外装', middle: '内部', item: 'ビニル幅木' },
  { master: ['建築', '長さ', 'シーリング'], ...建築, subject: '防水', middle: '外部', item: 'シーリング' },
  { master: ['建築', '長さ', '見切り'], ...建築, subject: '金属', middle: '内部', item: '下がり壁見切り縁' },
  { master: ['建築', '建具', 'DS'], ...建築, subject: '建具', middle: '鋼製建具', item: 'ＳＤ［建具番号］' },
  { master: ['建築', '建具', 'DD'], ...建築, subject: '建具', middle: '鋼製建具', item: 'ＳＤ［建具番号］' },
  { master: ['建築', '建具', 'DSL'], ...建築, subject: '建具', middle: '鋼製建具', item: 'ＳＤ［建具番号］' },
  { master: ['建築', '建具', 'WS'], ...建築, subject: '建具', middle: 'アルミニウム製建具', item: 'ＡＷ［建具番号］' },
  { master: ['建築', '建具', 'WF'], ...建築, subject: '建具', middle: 'アルミニウム製建具', item: 'ＡＷ［建具番号］' },
  { master: ['建築', '建具', 'SHT'], ...建築, subject: '建具', middle: 'シャッター', item: 'ＳＳ［建具番号］' },
  { master: ['建築', '内装・備品', 'INS'], ...建築, subject: '金属', middle: '内部', item: '天井点検口' },
  { master: ['建築', '内装・備品', 'HR'], ...建築, subject: '金属', middle: '内部', item: '壁付手すり' },
  { master: ['建築', '内装・備品', 'WB'], ...建築, subject: 'ユニット及びその他', middle: '内部', item: '黒板' },
  { master: ['建築', '内装・備品', 'LK'], ...建築, subject: 'ユニット及びその他', middle: '内部', item: '造付け家具' },
  { master: ['建築', '内装・備品', 'SB'], ...建築, subject: 'ユニット及びその他', middle: '内部', item: '造付け家具' },
  { master: ['建築', '内装・備品', 'SG'], ...建築, subject: 'ユニット及びその他', middle: '内部', item: '案内板' },

  // 仮設・土工
  { master: ['仮設・土工', '仮設', '外部足場'], ...建築, subject: '直接仮設', item: '外部足場' },
  { master: ['仮設・土工', '仮設', '内部足場'], ...建築, subject: '直接仮設', item: '内部仕上足場' },
  { master: ['仮設・土工', '仮設', '養生'], ...建築, subject: '直接仮設', item: '養生' },
  { master: ['仮設・土工', '仮設', '養生シート'], ...建築, subject: '直接仮設', item: '災害防止' },
  { master: ['仮設・土工', '仮設', '仮囲い'], ...建築, subject: '直接仮設', item: '災害防止' },
  { master: ['仮設・土工', '土工', '根切り'], ...建築, subject: '土工', item: '根切り' },
  { master: ['仮設・土工', '土工', '床掘り'], ...建築, subject: '土工', item: '根切り' },
  { master: ['仮設・土工', '土工', '溝掘削'], book: '電気設備', section: '屋外', subject: '構内配電線路', middle: '電力引込み', item: '土工事' },
  { master: ['仮設・土工', '土工', '埋戻し'], ...建築, subject: '土工', item: '埋戻し' },
  { master: ['仮設・土工', '土工', '残土処分'], ...建築, subject: '土工', item: '建設発生土運搬' },
  { master: ['仮設・土工', '土工', '砕石地業'], ...建築, subject: '地業', middle: '地業', item: '砂利地業' },
  { master: ['仮設・土工', '撤去', '床撤去'], ...改修, subject: '内装改修', middle: '撤去', item: 'ビニル床タイル撤去' },
  { master: ['仮設・土工', '撤去', '天井撤去'], ...改修, subject: '内装改修', middle: '撤去', item: '天井合板ボード撤去' },
  { master: ['仮設・土工', '撤去', '壁仕上げの撤去'], ...改修, subject: '内装改修', middle: '撤去', item: '壁ボード撤去' },
  { master: ['仮設・土工', '撤去', '間仕切壁の撤去'], ...改修, subject: '内装改修', middle: '撤去', item: '軽量鉄骨壁下地撤去' },
]
