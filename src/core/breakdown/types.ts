// 内訳書標準書式のマスタのデータの形（SPEC-B02）。データは編ごとのファイルに置き、画面を開いたときだけ読み込む。

/** 細目の1行。summary は摘要の区分名（例: ["形式", "回線数"]）。 */
export interface BreakdownRowData {
  name: string
  summary?: readonly string[]
  /** 書式の単位。個・台・面・基・組・本・枚・灯・か所・m・㎡・㎥・t・式 など */
  unit: string
  /** 「1式・別紙明細」の行。明細は DetailTemplate で作る */
  separate?: true
  /** 書式の ※（改修工事の際に必要となる項目の例） */
  renovation?: true
  /** 書式の摘要・備考の補足（例: 「養生、足場等」「t を併記」） */
  note?: string
}

/** 中科目（省略されることがある）ごとの細目の並び。 */
export interface BreakdownGroupData {
  section: string
  subject: string
  middle?: string
  rows: readonly BreakdownRowData[]
}

/** 摘要の1区分。choices は選ぶだけで入る標準の値（手入力もできる）。 */
export interface SummarySlot {
  label: string
  choices?: readonly string[]
  /** 施工条件として扱う区分（隠ぺい・露出など）。項目を分けず、choices を施工条件の候補にして拾うときに選ぶ */
  condition?: true
}

/** 明細の中の、換算の係数が決まった規格（例: 配管塗装の E25 = 外径 25.4mm × π）。 */
export interface DetailVariant {
  /** 図面の印・札に出す略号（16字まで） */
  code: string
  /** 規格の欄に入れる値（例: E25、200×200×100） */
  spec: string
  /** 規格から摘要に入れる値。この区分は入力値より優先し、組合せを増やさない */
  summary?: Readonly<Record<string, string>>
  /** 拾った数量（長さ m・面積 ㎡・個数）に掛けて unit の数量にする */
  convert: { factor: number; unit: '㎡' | 't'; basis: string }
}

/** 別紙明細の標準の明細（想定して作ったもの）。 */
export interface DetailTemplate {
  name: string
  /** variants があるときの拾い方。unit は換算後の単位（㎡・t） */
  pick?: 'length' | 'area' | 'count'
  variants?: readonly DetailVariant[]
  /** 図面の印・札に出す略号（16字まで） */
  code?: string
  unit: string
  summary?: readonly SummarySlot[]
  /** 既存の標準マスタ（quantityMaster）の規格を明細として使うとき。分類名または種類（略号）で指定する */
  master?: { categories?: readonly string[]; types?: readonly string[] }
  /** 後の段階で連動の計算に使う予定の明細（B05 以降）。画面では「連動で計算予定」と出す */
  linked?: 'paint' | 'carry' | 'waste' | 'install' | 'support' | 'box'
  note?: string
}
