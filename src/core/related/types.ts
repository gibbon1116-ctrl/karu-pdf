// 関連品目の提案のデータの形（SPEC-R1）。Claude が作成。ルールのデータ（rules.ts）との契約。

/** 案件区分（PDF ごと）。混在は区分を問わない。 */
export type ProjectMode = '新築' | '改修' | '撤去' | '解体' | '混在'
/** 品目作業（項目ごと）。 */
export type WorkType = '新設' | '増設' | '更新・交換' | '移設' | '取外し再使用' | '撤去処分' | '解体' | '仮設'
export const PROJECT_MODES: readonly ProjectMode[] = ['新築', '改修', '撤去', '解体', '混在']
export const WORK_TYPES: readonly WorkType[] = ['新設', '増設', '更新・交換', '移設', '取外し再使用', '撤去処分', '解体', '仮設']
/** 起点の照合で「品目作業が未設定」を表す値（R7d）。保存する品目作業には使わない。 */
export const UNSET_WORK = '未設定'
export type WorkMatch = WorkType | typeof UNSET_WORK

export type RelatedBook = '電気設備' | '機械設備' | '建築'

/** 部位の組の役割（R7d）。この順で表示する */
export type AssemblyRole = '仮設' | '撤去' | '下地' | '主仕上げ' | '表面処理' | '附属' | '処理' | '確認'
export const ASSEMBLY_ROLES: readonly AssemblyRole[] = ['仮設', '撤去', '下地', '主仕上げ', '表面処理', '附属', '処理', '確認']

/**
 * 起点の項目の照合。書いた条件はすべて満たす必要がある（AND）。
 * categories = 項目の分類（CountFixture.category）、names = 項目の名称（CountFixture.name、完全一致）、
 * subjects = 内訳書の科目（CountFixture.breakdown.subject）、works = 品目作業、modes = 案件区分。
 */
export interface RelatedOriginMatch {
  categories?: readonly string[]
  names?: readonly string[]
  subjects?: readonly string[]
  works?: readonly WorkMatch[]
  modes?: readonly ProjectMode[]
}

/** context: 案件区分の確認事項（品目の登録では出さない）。any: 起点の照合（どれか1つが当たれば起点）。 */
export type RelatedOrigin =
  | { context: readonly ProjectMode[] }
  | { any: readonly RelatedOriginMatch[] }

/** 提案先。name があればその品目、無ければ分類の中から利用者が選ぶ。照合は品目一覧の分野（book、建築は「仮設・土工」も）の中。 */
export interface RelatedTarget {
  category: string
  name?: string
}

/**
 * 確認事項から項目を作るときの初期値（2026-10-14、Claude が作成）。
 * 単位: 式・か所 = 個数の項目（click）、m = 長さ（polyline）、㎡ = 面積（polygon）。名称・単位は利用者が項目の画面で直せる。
 */
export interface RelatedCreate {
  name: string
  unit: '式' | 'か所' | 'm' | '㎡'
}

export interface RelatedRule {
  /** 元のルールID（E-001 等）。Claude が足したものは B-X01 等 */
  id: string
  book: RelatedBook
  /** 元の分類 */
  group: string
  /** 元の起点品目・関連提案品目（表示用の原文） */
  originText: string
  targetText: string
  /** 元の新築・改修・撤去・解体の● */
  modes: readonly Exclude<ProjectMode, '混在'>[]
  /** 提案条件・確認質問（原文） */
  question: string
  /** 提案の種類（原文） */
  kindText: string
  /**
   * item = 拾い候補（標準マスタの品目を追加）、check = 確認事項（標準マスタに無い。create の初期値で項目を作れる）、
   * note = 注意（計上しない・単価に含む等。判断は不要）
   */
  kind: 'item' | 'check' | 'note'
  priority: '高' | '中'
  origin: RelatedOrigin
  targets: readonly RelatedTarget[]
  /** Claude の精査の要点（表示用） */
  note: string
  /** 根拠記号。資料名は RELATED_REF_DOCUMENTS[book][記号] */
  refs: readonly string[]
  /** kind が check のとき、項目を作る初期値 */
  create?: RelatedCreate
  /** 部位の組（R7d）の役割。表示で役割ごとにまとめる */
  role?: AssemblyRole
  /** 部位の組（R7d）の部位名（天井・壁 等） */
  assembly?: string
  /** 同時にはあり得ない候補の群の名前（R7d）。1つ追加したら残りを畳む */
  oneOf?: string
  addedBy?: 'claude'
}
