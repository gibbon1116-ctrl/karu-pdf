// 標準の連動の規則（SPEC-B06）。Claude が作成。根拠は 非公開の調査資料。
//
// 規則は「この明細を追加したら、どの項目を元に、どう計算するか」の既定値。項目ごとに直せる。
// 元の選び方（auto）は計算のたびに今の項目一覧から選び直すので、あとから器具を足しても元に入る。

import type { BreakdownBook } from '../countFixtures'
import type { FixtureLink, FixtureLinkSource } from '../fixtureLink'

export interface LinkAutoSources {
  /** 内訳書の編。位置のある項目だけを絞り、位置の無い項目は除外しない。1〜4件。 */
  books?: readonly BreakdownBook[]
  /** 関連ルールの any。枝どうしはOR、同じ枝の名称・分類はAND。 */
  originAny?: ReadonlyArray<{
    categories?: readonly string[]
    nameIncludes?: readonly string[]
  }>
  /** 自動選択した元にも、手動の元と同じ動的係数を付ける。 */
  factorFrom?: FixtureLinkSource['factorFrom']
  /** 呼び径。元の略号・規格の正規化したトークンと比較する。 */
  sizeMatch?: string
  /** 元にする項目の分類（CountFixture.category）。どれか */
  categories?: readonly string[]
  /** 元にする項目の名称に含まれる語。どれか */
  nameIncludes?: readonly string[]
  /** 名称にいずれかの語を含む項目を自動の元から除く。各40字、1〜20件。 */
  nameExcludes?: readonly string[]
  /** 元にする項目の施工条件の候補にこの条件があること。あれば、元の施工条件をこの条件だけに絞る */
  condition?: string
  /** 元にする項目の種別 */
  kinds?: ReadonlyArray<'count' | 'length' | 'area' | 'volume'>
  /** 個数の項目の単体質量（attributes.massKg）がこの値以上 */
  minMassKg?: number
  /** 元にする項目の出力の種類（換算後。quantityOutputKind）。㎡ に換算した長方形ダクトだけを選ぶときなど（SPEC-B10-3） */
  outputKinds?: ReadonlyArray<'count' | 'length' | 'area' | 'volume' | 'mass'>
  /** RC 部材の項目（`rc` を持つ）のうち、この部材の種類（SPEC-B07-2）。空なら RC 部材の項目すべて */
  rcKinds?: ReadonlyArray<'slab' | 'foundationSlab' | 'wall' | 'beam' | 'foundationBeam' | 'column' | 'footing'>
}

export interface LinkRule {
  id: string
  /** 画面の選択肢の名前 */
  label: string
  /** この規則を既定にする明細（細目の明細の名称、または内訳書の細目の名称） */
  details: readonly string[]
  kind: 'factor' | 'mass' | 'carry' | 'rc' | 'shape' | 'crossing' | 'steel'
  factor?: number
  auto: LinkAutoSources
  /** 搬入・搬出: 摘要の「区分」を反映する。未選択なら元ごとに区分を判定する。 */
  carry?: true
  /** 発生材: 見かけ比重は項目の発生材の種類（attributes.wasteType）から決める */
  waste?: true
  /** RC の出力（kind 'rc'） */
  rc?: { output: 'concrete' | 'formwork' | 'rebar' | 'gasJoint' | 'lapJoint'; basis?: 'design' | 'required' }
  /** 形の出力（kind 'shape'） */
  shape?: NonNullable<FixtureLink['shape']>
  crossing?: {
    barrierItemIds?: string[]
    barrierNameIncludes?: string[]
    includeRises?: boolean
    planCrossings?: boolean
  }
  steel?: {
    output: 'mass' | 'paint' | 'fireproof'
    basis?: 'design' | 'required'
    surface?: 'contour' | 'box' | 'boxBeam'
  }
  note: string
}

export const LINK_RULES: readonly LinkRule[] = [
  {
    id: 'install-fixtures', label: '器具取付（照明器具の数）', details: ['器具取付'], kind: 'factor', factor: 1,
    auto: { categories: ['照明器具'], kinds: ['count'] },
    note: '器具の取付の数量は器具の個数（案）。分類「照明器具」の個数の項目を元にする。',
  },
  {
    id: 'install-panels', label: '盤取付（盤の数）', details: ['盤取付'], kind: 'factor', factor: 1,
    auto: { categories: ['盤類'], kinds: ['count'] },
    note: '盤の取付は盤の面数。分類「盤類」の個数の項目を元にする。',
  },
  {
    id: 'switch-box', label: 'スイッチボックス（配線器具の数）', details: [], kind: 'factor', factor: 1,
    auto: { categories: ['配線器具', 'スイッチ', 'コンセント'], kinds: ['count'] },
    note: '配線器具 1 個に 1 個。印ごとに付けるときは構成要素を使う。',
  },
  {
    id: 'outlet-box', label: 'アウトレットボックス（照明器具の数）', details: [], kind: 'factor', factor: 1,
    auto: { categories: ['照明器具'], kinds: ['count'] },
    note: '照明器具 1 個に 1 個。印ごとに付けるときは構成要素を使う。',
  },
  {
    id: 'pipe-insulation', label: '配管保温（配管の長さ）', details: ['配管保温'], kind: 'factor', factor: 1,
    auto: { categories: ['配管（給水・給湯）', '配管（消火・冷温水・蒸気）', 'ドレン管', '冷媒管'], kinds: ['length'] },
    note: '保温を要する配管の長さ。保温しない配管は元から外す。施工箇所は保温の区分（屋内露出・隠ぺい など）に直す。',
  },
  {
    id: 'pipe-paint', label: '配管塗装（配管の長さ）', details: [], kind: 'factor', factor: 1,
    // 電気の「配管塗装」（外径の換算）と名前が同じなので、標準マスタから追加するときに自動では付けない（規則の選択からは使える）
    auto: { categories: ['配管（給水・給湯）', '配管（消火・冷温水・蒸気）', '配管（排水・通気）'], kinds: ['length'] },
    note: '塗装する配管の長さ（露出部など）。塗装しない配管は元から外すか、施工条件で絞る。',
  },
  {
    id: 'duct-insulation', label: 'ダクト保温（ダクトの表面積）', details: ['ダクト保温'], kind: 'factor', factor: 1,
    auto: { categories: ['ダクト'], outputKinds: ['area'] },
    note: '㎡ のダクト（長方形ダクト）の表面積を元にする。スパイラルダクト（m）は別に計算する。',
  },
  {
    id: 'duct-paint', label: 'ダクト塗装（ダクトの表面積）', details: ['ダクト塗装'], kind: 'factor', factor: 1,
    auto: { categories: ['ダクト'], outputKinds: ['area'] },
    note: '塗装するダクトの表面積（㎡）。',
  },
  // ── 建築（SPEC-B07-2・B09）。元は RC 部材の項目、または形の連動の元を手で選ぶ ──
  { id: 'rebar-required', label: '異形鉄筋（RC 部材の鉄筋・所要数量）', details: ['異形鉄筋'], kind: 'rc', rc: { output: 'rebar', basis: 'required' }, auto: { rcKinds: [] },
    note: '公共建築数量積算基準: 鉄筋の所要数量は設計数量の 4% 増し。径ごとに分けるときは項目を径ごとに作り、径で絞る。' },
  { id: 'rebar-assembly', label: '鉄筋加工組立（設計数量）', details: ['鉄筋加工組立', '鉄筋運搬'], kind: 'rc', rc: { output: 'rebar', basis: 'design' }, auto: { rcKinds: [] },
    note: '書式の備考: 設計数量。' },
  { id: 'gas-pressure', label: 'ガス圧接（か所）', details: ['ガス圧接'], kind: 'rc', rc: { output: 'gasJoint' }, auto: { rcKinds: [] },
    note: '径 16 以上の継手をガス圧接として数える（部材の設定で重ね継手にもできる）。' },
  { id: 'concrete-foundation', label: 'コンクリート（基礎部）', details: ['普通コンクリート（基礎部）'], kind: 'rc', rc: { output: 'concrete' }, auto: { rcKinds: ['foundationSlab', 'foundationBeam', 'footing'] }, note: '基礎・基礎スラブ・基礎梁の RC 部材。' },
  { id: 'concrete-body', label: 'コンクリート（軸部）', details: ['普通コンクリート（軸部）'], kind: 'rc', rc: { output: 'concrete' }, auto: { rcKinds: ['slab', 'wall', 'beam', 'column'] }, note: '柱・梁・壁・床板の RC 部材。' },
  { id: 'formwork-foundation', label: '型枠（基礎部）', details: ['普通合板型枠（基礎部）'], kind: 'rc', rc: { output: 'formwork' }, auto: { rcKinds: ['foundationSlab', 'foundationBeam', 'footing'] }, note: '基礎・基礎スラブ・基礎梁の側面。' },
  { id: 'formwork-body', label: '型枠（地上軸部）', details: ['普通合板型枠（地上軸部）'], kind: 'rc', rc: { output: 'formwork' }, auto: { rcKinds: ['slab', 'wall', 'beam', 'column'] }, note: '柱・梁・壁・床板。' },
  { id: 'formwork-transport', label: '型枠運搬（型枠の面積）', details: ['型枠運搬'], kind: 'rc', rc: { output: 'formwork' }, auto: { rcKinds: [] }, note: '型枠の面積と同じ。' },
  { id: 'excavation', label: '根切り（底面 ＋ 余幅）× 深さ', details: ['根切り'], kind: 'shape', shape: { output: 'excavation', clearanceM: 0.5 }, auto: {},
    note: '公共建築数量積算基準 第3編: 余幅 = 作業上のゆとり幅 0.5m（土間・犬走りは 0.1m）＋ 法幅の 1/2（法の係数 深さ 1.5m 未満 0、1.5〜5m 0.3、5m 以上 0.6）。元は基礎の底面を囲んだ項目（深さつき）を選ぶ。' },
  { id: 'bed-surface', label: '床付け（地業の面積）', details: ['床付け'], kind: 'shape', shape: { output: 'area' }, auto: {},
    note: '積算チェックリスト: 基礎・基礎梁下・耐圧盤下等の地業面積（盛土部分を除く）。地業の底面を囲んだ項目を元にする。' },
  { id: 'backfill', label: '埋戻し（根切り − 基礎等の体積）', details: ['埋戻し'], kind: 'factor', auto: {},
    note: '積算チェックリスト: 埋戻し = 根切り −（現状 GL 以下の基礎・地下構築物（ピットを含む）の体積 ＋ 砂利地業 ＋ 捨てコンクリート）。元に根切り（＋）と、それぞれの体積の項目（引き算）を選ぶ。' },
  { id: 'surplus-soil', label: '建設発生土（根切り ＋ すきとり − 埋戻し − 盛土）', details: ['建設発生土運搬', '建設発生土処分'], kind: 'factor', auto: {},
    note: '積算チェックリスト: 建設発生土 = 根切り ＋ すきとり −（埋戻し ＋ 盛土）。元に根切り・すきとり（＋）と埋戻し・盛土（引き算）を選ぶ。' },
  { id: 'floor-area', label: '延べ面積（墨出し・養生・整理清掃後片付け）', details: ['墨出し', '養生（延べ面積）', '整理清掃後片付け（延べ面積）'], kind: 'shape', shape: { output: 'area' }, auto: {},
    note: '書式の別紙明細・積算チェックリスト: 延べ面積（各階の床面積の合計）。各階の床を囲んだ項目を元にする。ドライエリア・ベランダ等は項目を分ける。' },
  { id: 'inner-finish-scaffold', label: '内部仕上足場（床面積）', details: ['内部仕上足場'], kind: 'shape', shape: { output: 'area' }, auto: {},
    note: '積算チェックリスト: 躯体工事用と仕上工事用を分ける。壁仕上げのみの部分は項目を分ける。部屋の床を囲んだ項目を元にする。' },
  { id: 'outside-scaffold', label: '外部足場（外周 × 高さ）', details: ['枠組本足場'], kind: 'shape', shape: { output: 'lengthTimesHeight', heightM: 10 }, auto: {},
    note: '公共建築数量積算基準: 足場の中心の水平長さ × 構築物等の上部までの高さ。外周の線の項目を元にし、高さを直す。' },
  { id: 'safety-rail', label: '安全手すり（外周の長さ）', details: ['安全手すり'], kind: 'shape', shape: { output: 'perimeter' }, auto: {}, note: '足場の水平長さ。' },
  { id: 'baseboard', label: '幅木（周長 − 出入口の幅）', details: [], kind: 'shape', shape: { output: 'perimeter' }, auto: {},
    note: '床を囲んだ項目の周長。出入口の建具を元に足し「開口の幅」で引き算にする。' },
  { id: 'glass', label: 'ガラス（建具の開口の面積）', details: [], kind: 'factor', auto: {},
    note: '建具の項目を元にし、係数を「開口の面積」にする（ガラスの割合は係数で）。' },
  { id: 'sealing', label: '建具周囲シーリング（開口の周長）', details: ['ガラスシーリング'], kind: 'factor', auto: {},
    note: '建具の項目を元にし、係数を「開口の周長」にする。' },
  // ── 交差（SPEC-B12）。元は配管・ダクト・ケーブルの経路、区画は名称に「防火区画」などを含む線の項目 ──
  { id: 'fire-penetration', label: '防火区画貫通処理（区画の線との交差）', details: ['防火区画貫通処理'], kind: 'crossing',
    crossing: { barrierNameIncludes: ['防火区画'], planCrossings: true, includeRises: true }, auto: { kinds: ['length'] },
    note: '経路の線が「防火区画」の線と交わる数と、立上り・立下り（床の貫通）の数。区画は名称に「防火区画」を含む線の項目。部位（壁・床）で分けるときは項目を分ける。' },
  { id: 'sleeve', label: 'スリーブ（壁・床との交差）', details: ['スリーブ'], kind: 'crossing',
    crossing: { barrierNameIncludes: ['壁', 'スラブ', '床'], planCrossings: true, includeRises: true }, auto: { kinds: ['length'] },
    note: '経路が壁の線と交わる数と、立上り・立下りの数。壁・床は名称に「壁」「スラブ」「床」を含む線の項目。' },
  { id: 'deck-opening', label: 'デッキプレート開口切断（床の貫通）', details: ['デッキプレート開口切断'], kind: 'crossing',
    crossing: { barrierNameIncludes: [], planCrossings: false, includeRises: true }, auto: { kinds: ['length'] },
    note: '立上り・立下り（床の貫通）の数。' },
  // ── 鉄骨（SPEC-B13）。元は鉄骨の部材の項目（断面を持つ）──
  { id: 'steel-required', label: '形鋼（所要数量）', details: ['形鋼'], kind: 'steel', steel: { output: 'mass', basis: 'required' }, auto: {},
    note: '公共建築数量積算基準: 鉄骨材料の所要数量は 形鋼・鋼管・平鋼 5% 増し。' },
  { id: 'steel-design', label: '鉄骨（設計数量）', details: ['工場加工組立', '鉄骨運搬', '現場建方', '溶融亜鉛めっき'], kind: 'steel', steel: { output: 'mass', basis: 'design' }, auto: {},
    note: '書式の備考: 設計数量。' },
  { id: 'steel-paint', label: '錆止め塗装（鉄骨の表面積）', details: ['工場錆止め塗装', '現場錆止め塗装'], kind: 'steel', steel: { output: 'paint', surface: 'contour' }, auto: {},
    note: '公共建築数量積算基準: 鉄骨部材表面の面積（略算: 外周 2H＋4B−2t1）。' },
  { id: 'steel-fireproof', label: '耐火被覆（吹付け: 鉄骨の外周）', details: ['耐火被覆'], kind: 'steel', steel: { output: 'fireproof', surface: 'contour' }, auto: {},
    note: '耐火被覆材の厚さの中心の寸法による面積が原則。巻付け（箱張り）は表面の種類を「箱」にする。' },
  {
    id: 'carry-in', label: '機器搬入（100kg以上の機器）', details: ['機器搬入'], kind: 'carry', carry: true,
    auto: { kinds: ['count'], minMassKg: 100 },
    note: '単体100kg以上。電気設備は受変電・電力貯蔵装置等、機械設備は機器の種類を限らない。元ごとに質量÷容積600kg/㎥以上を重量品、未満を容積品とし、表M1-1-68の補正率を適用する。区分未選択は両方を合計し、単独搬入は30％増し。根拠: 設備数量積算基準 第2編第1章第1節、単価積算基準 第3編第1章5・第4編第1章第1節5。',
  },
  {
    id: 'carry-out', label: '機器搬出（100kg以上の撤去機器）', details: ['機器搬出'], kind: 'carry', carry: true,
    auto: { kinds: ['count'], minMassKg: 100, condition: '撤去（廃棄）' },
    note: '撤去（廃棄）の単体100kg以上の機器を元にする。電気設備は受変電・電力貯蔵装置等、機械設備は機器の種類を限らない。区分・補正率は機器搬入と同じで、区分未選択は重量品・容積品の両方を合計する。根拠: 単価積算基準 第3編第2章第2節・第4編第2章第1節2。',
  },
  {
    id: 'waste', label: '発生材（撤去（廃棄）の質量 → ㎥）', details: ['発生材積込', '発生材運搬', '発生材処分'], kind: 'mass', waste: true,
    auto: { condition: '撤去（廃棄）' },
    note: '公共建築設備数量積算基準 第2編第1章第5節。撤去（廃棄）の拾いの質量（1単位あたりの質量 × 数量）を t にし、発生材の種類の見かけ比重（環境省の参考値）で ㎥ にする。',
  },
]

/**
 * 規則の自動の元を、連動の項目に写すときの値。条件の無い `auto: {}` は「元を手で選ぶ」規則（埋戻し・根切りなど）なので写さない。
 * 鉄骨の規則の `{}` だけは「鉄骨の部材の項目すべて」を表すので写す。
 */
export function linkRuleAuto(rule: LinkRule): LinkAutoSources | undefined {
  const hasCondition = Object.values(rule.auto).some(value => value !== undefined)
  return hasCondition || rule.kind === 'steel' ? structuredClone(rule.auto) as LinkAutoSources : undefined
}

/**
 * 搬入・搬出の自動の元を内訳書の編に合わせる。
 *
 * 公共建築工事標準単価積算基準（令和8年改定）第3編第1章5
 * 「機器搬入」（E22）・第2章第2節「機器搬出」は、
 * 電気の対象を受変電・電力貯蔵装置等とする。
 * 関連する細目は表E1-2-22〜25・29。
 * 下記の名称語は、この対象を自動選択するための候補語。
 *
 * 第4編第1章第1節5・第2章第1節2の機械設備は、
 * 単体100kg以上の機器について種類を限定しない。
 * 最低質量・種別・撤去条件など、baseの他の条件は維持する。
 */
export function carryAutoFor(
  book: BreakdownBook | undefined,
  base: LinkAutoSources,
): LinkAutoSources {
  const auto = structuredClone(base)

  if (book === '電気設備') {
    return {
      ...auto,
      books: ['電気設備'],
      nameIncludes: [
        '受配電盤', '受電盤', '配電盤', '引込盤', '高圧',
        'キュービクル', '変圧器', 'トランス', 'コンデンサ',
        'リアクトル', '直流電源', '蓄電池', '電力貯蔵', '無停電',
      ],
    }
  }

  if (book === '機械設備') {
    return { ...auto, books: ['機械設備'] }
  }

  return auto
}

export function linkRuleForDetail(name: string): LinkRule | undefined {
  return LINK_RULES.find(rule => rule.details.includes(name))
}
