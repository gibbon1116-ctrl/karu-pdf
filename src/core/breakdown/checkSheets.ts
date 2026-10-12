// 数量チェックシート（建築・新営）の判定のデータ（SPEC-B15）。Claude が作成。
// 出典: 積算チェックリスト（建築工事）の ④工種別チェックシート（仮設・土工・地業・躯体・外部仕上・内部仕上・金属）。
// 「内訳数量 ∈ 基準 × (下限)〜(上限)」「≒ 基準」などの判定を、拾った項目の数量と基本の値から自動で行う。

/** 判定に使う基本の値。手で入れる（延べ面積・建築面積は拾いから自動の候補も出す）。 */
export const CHECK_BASICS = [
  { key: 'buildingArea', label: '建築面積', unit: '㎡' },
  { key: 'totalFloorArea', label: '延べ面積', unit: '㎡' },
  { key: 'perimeter', label: '建物周長（外壁の総長さ）', unit: 'm' },
  { key: 'parapetHeight', label: 'パラペットまでの高さ', unit: 'm' },
  { key: 'floorsAbove', label: '地上階数', unit: '階' },
  { key: 'firstFloorArea', label: '1階床面積', unit: '㎡' },
  { key: 'steelFloorArea', label: '鉄骨造部分の延べ面積', unit: '㎡' },
  { key: 'stairCount', label: '階段室の箇所数', unit: 'か所' },
  { key: 'gravelThickness', label: '砂利地業の厚さ', unit: 'm' },
  { key: 'leanConcreteThickness', label: '捨コンクリートの厚さ', unit: 'm' },
] as const
export type CheckBasisKey = typeof CHECK_BASICS[number]['key']

/**
 * 内訳数量の集め方。建築の項目（`breakdown.book === '建築'`）のうち、種目・科目・中科目・名前が合うものの全図面の合計を足す。
 * 単位が `unit` と違う項目は足さない（数えた項目の名前は根拠に出す）。
 */
export interface CheckQuantityGroup {
  id: string
  label: string
  unit: '㎡' | '㎥' | 'm' | 't' | 'か所'
  /** 種目（既定 ['庁舎']） */
  sections?: readonly string[]
  subjects?: readonly string[]
  middles?: readonly string[]
  /** 名前がどれかに一致 */
  names?: readonly string[]
  /** 名前がどれかを含む */
  nameIncludes?: readonly string[]
  /** 名前がどれかで始まる */
  nameStartsWith?: readonly string[]
  /** 名前がどれかを含むものは除く */
  nameExcludes?: readonly string[]
  /** 合計に掛ける係数（所要数量の項目から設計数量にする 1/1.04 など） */
  factor?: number
}

const FLOOR_WORDS = ['床', 'カーペット', '畳', 'フローリング']
export const CHECK_QUANTITY_GROUPS: readonly CheckQuantityGroup[] = [
  // 仮設
  { id: 'setOut', label: '遣方', unit: '㎡', names: ['遣方'] },
  { id: 'marking', label: '墨出し', unit: '㎡', names: ['墨出し'] },
  { id: 'curing', label: '養生（延べ面積）', unit: '㎡', names: ['養生（延べ面積）', '養生'], subjects: ['直接仮設'] },
  { id: 'cleaning', label: '整理清掃後片付け（延べ面積）', unit: '㎡', names: ['整理清掃後片付け（延べ面積）', '整理清掃後片付け'], subjects: ['直接仮設'] },
  { id: 'groundScaffold', label: '地足場', unit: '㎡', names: ['地足場'] },
  { id: 'outerScaffold', label: '外部足場（枠組本足場・単管本足場）', unit: '㎡', names: ['枠組本足場', '単管本足場'] },
  { id: 'safetyRail', label: '安全手すり', unit: 'm', names: ['安全手すり'] },
  { id: 'innerFrameScaffold', label: '内部躯体足場（鉄筋・型枠足場、躯体支保工）', unit: '㎡', names: ['鉄筋・型枠足場', '躯体支保工'] },
  { id: 'innerFinishScaffold', label: '内部仕上足場', unit: '㎡', names: ['内部仕上足場', '簡易型移動式足場', '枠組棚足場', '内部階段仕上足場', 'シャフト内足場'] },
  { id: 'scaffoldSheet', label: '外部足場シート類（垂直ネット張り）', unit: '㎡', names: ['垂直ネット張り'] },
  { id: 'narrowNet', label: '小幅ネット', unit: 'm', names: ['小幅ネット'] },
  // 土工
  { id: 'excavation', label: '根切り', unit: '㎥', names: ['根切り'] },
  { id: 'backfill', label: '埋戻し', unit: '㎥', names: ['埋戻し'] },
  { id: 'surplusSoil', label: '建設発生土処分', unit: '㎥', names: ['建設発生土処分'] },
  // 地業
  { id: 'gravel', label: '砂利地業', unit: '㎥', names: ['砂利地業'], subjects: ['地業'] },
  { id: 'leanConcrete', label: '捨コンクリート', unit: '㎥', names: ['捨コンクリート地業'], subjects: ['地業'] },
  // 躯体
  { id: 'concrete', label: 'コンクリート総量', unit: '㎥', subjects: ['コンクリート'], middles: ['躯体'], nameIncludes: ['コンクリート'], nameExcludes: ['構造体強度補正', '打設手間', '運搬'] },
  { id: 'concreteFoundation', label: 'コンクリート（基礎部）', unit: '㎥', subjects: ['コンクリート'], middles: ['躯体'], nameIncludes: ['（基礎部）'] },
  { id: 'concreteBody', label: 'コンクリート（軸部・土間）', unit: '㎥', subjects: ['コンクリート'], middles: ['躯体'], nameIncludes: ['（軸部）', '（土間）'] },
  { id: 'protectionConcrete', label: '防水押えコンクリート', unit: '㎥', subjects: ['コンクリート'], nameIncludes: ['押え'] },
  { id: 'formwork', label: '型枠総量', unit: '㎡', subjects: ['型枠'], middles: ['躯体'], nameIncludes: ['型枠', 'デッキプレート'], nameExcludes: ['運搬', '目地'] },
  { id: 'formworkTransport', label: '型枠運搬', unit: '㎡', subjects: ['型枠'], names: ['型枠運搬'] },
  { id: 'rebarDesign', label: '鉄筋総量（設計数量・鉄筋加工組立）', unit: 't', subjects: ['鉄筋'], middles: ['躯体'], names: ['鉄筋加工組立'] },
  { id: 'gasJoint', label: 'ガス圧接', unit: 'か所', subjects: ['鉄筋'], names: ['ガス圧接'] },
  { id: 'steelDesign', label: '鉄骨総量（設計数量・工場加工組立）', unit: 't', subjects: ['鉄骨'], names: ['工場加工組立'] },
  // 外部仕上
  { id: 'roofWaterproof', label: '屋根防水層（平部）', unit: '㎡', subjects: ['防水'], middles: ['外部'], nameIncludes: ['防水'], nameExcludes: ['立上り', '塗布', '入隅', '押え'] },
  { id: 'waterproofRise', label: '防水立上り部保護', unit: '㎡', subjects: ['防水'], middles: ['外部'], names: ['防水立上り部保護'] },
  { id: 'exteriorWall', label: '外壁仕上げ', unit: '㎡', subjects: ['左官', 'タイル', '石', '塗装', '内外装'], middles: ['外部'], nameIncludes: ['外壁', '壁'], nameExcludes: ['役物'] },
  { id: 'glass', label: 'ガラス', unit: '㎡', subjects: ['建具'], middles: ['ガラス'] },
  // 内部仕上
  { id: 'floorFinish', label: '床仕上げ（主仕上げ）', unit: '㎡', subjects: ['内外装', '左官', 'タイル', '石'], middles: ['内部'], nameIncludes: FLOOR_WORDS, nameExcludes: ['役物', '階段', '幅木', '下地', '断熱', 'ボーダー', '防湿'] },
  { id: 'wallFinish', label: '壁仕上げ（主仕上げ）', unit: '㎡', subjects: ['内外装', '左官', 'タイル', '石'], middles: ['内部'], nameStartsWith: ['壁', '耐火間仕切'], nameExcludes: ['役物', '下地'] },
  { id: 'ceilingFinish', label: '天井仕上げ（主仕上げ）', unit: '㎡', subjects: ['内外装', '左官'], middles: ['内部'], nameIncludes: ['天井'], nameExcludes: ['下地', '点検口', '見切'] },
  // 金属
  { id: 'nonSlip', label: '階段ノンスリップ', unit: 'm', subjects: ['金属'], nameIncludes: ['ノンスリップ'] },
]

export type CheckOperator = '≧' | '≒' | '∈' | '＝' | '＜'

/** 判定の許容（≒ は ±10%、＝ は ±1%）。チェックシートに許容の定めは無いので、Claude の既定値。 */
export const CHECK_APPROX_TOLERANCE = 0.10
export const CHECK_EQUAL_TOLERANCE = 0.01

export interface CheckValues {
  basis(key: CheckBasisKey): number | undefined
  quantity(groupId: string): number | undefined
}

export interface CheckRow {
  id: string
  sheet: '仮設' | '土工' | '地業' | '躯体' | '外部仕上' | '内部仕上' | '金属'
  /** 判定する内訳数量（`CHECK_QUANTITY_GROUPS` の id） */
  group: string
  operator: CheckOperator
  /** チェック項目の文（チェックシートの表記） */
  basisText: string
  /** 基準の値。使う基本の値・数量が無ければ undefined（判定しない） */
  basis(values: CheckValues): number | undefined
  /** ∈ の係数の範囲（基準 × 下限〜上限） */
  range?: readonly [number, number]
  note?: string
}

const product = (...values: Array<number | undefined>) =>
  values.every(value => value !== undefined) ? values.reduce<number>((a, b) => a * b!, 1) : undefined

export const CHECK_ROWS: readonly CheckRow[] = [
  // ── 仮設 ──
  { id: 'setOut', sheet: '仮設', group: 'setOut', operator: '≧', basisText: '建築面積', basis: v => v.basis('buildingArea'), note: '建築面積に含まれないドライエリア・ピット等を足す。' },
  { id: 'marking', sheet: '仮設', group: 'marking', operator: '≧', basisText: '延べ面積', basis: v => v.basis('totalFloorArea'), note: '延べ面積に含まれないドライエリア・ピット・バルコニー等を足す。' },
  { id: 'curing', sheet: '仮設', group: 'curing', operator: '≧', basisText: '延べ面積', basis: v => v.basis('totalFloorArea') },
  { id: 'cleaning', sheet: '仮設', group: 'cleaning', operator: '≧', basisText: '延べ面積', basis: v => v.basis('totalFloorArea') },
  { id: 'groundScaffold', sheet: '仮設', group: 'groundScaffold', operator: '≧', basisText: '建築面積', basis: v => v.basis('buildingArea'), note: '地下部の水平投影面積を足す。' },
  { id: 'outerScaffold', sheet: '仮設', group: 'outerScaffold', operator: '≒', basisText: '（建物周長＋8m）× パラペットまでの高さ',
    basis: v => { const p = v.basis('perimeter'); return product(p === undefined ? undefined : p + 8, v.basis('parapetHeight')) } },
  { id: 'safetyRail', sheet: '仮設', group: 'safetyRail', operator: '≒', basisText: '外部足場周長（建物周長＋8m）',
    basis: v => { const p = v.basis('perimeter'); return p === undefined ? undefined : p + 8 } },
  { id: 'innerFrameScaffold', sheet: '仮設', group: 'innerFrameScaffold', operator: '＝', basisText: '延べ面積', basis: v => v.basis('totalFloorArea') },
  { id: 'innerFinishScaffold', sheet: '仮設', group: 'innerFinishScaffold', operator: '≒', basisText: '延べ面積', basis: v => v.basis('totalFloorArea') },
  { id: 'scaffoldSheet', sheet: '仮設', group: 'scaffoldSheet', operator: '≒', basisText: '外部足場面積', basis: v => v.quantity('outerScaffold') },
  { id: 'narrowNet', sheet: '仮設', group: 'narrowNet', operator: '≒', basisText: '（建物周長＋8m）× 階数',
    basis: v => { const p = v.basis('perimeter'); return product(p === undefined ? undefined : p + 8, v.basis('floorsAbove')) } },
  // ── 土工 ──
  { id: 'soilBalance', sheet: '土工', group: 'excavation', operator: '＝', basisText: '埋戻し量 ＋ 建設発生土処分量',
    basis: v => { const a = v.quantity('backfill'), b = v.quantity('surplusSoil'); return a === undefined || b === undefined ? undefined : a + b },
    note: '根切り・埋戻し・建設発生土処分の収支（埋戻し B 種＝流用土の場合）。' },
  { id: 'excavationArea', sheet: '土工', group: 'excavation', operator: '∈', basisText: '建築面積 ×（1.2）〜（2.0）（つぼ・布掘り）', basis: v => v.basis('buildingArea'), range: [1.2, 2.0],
    note: '総掘りの場合は当てはまらない（深さと周長率で確認する）。' },
  // ── 地業 ──
  { id: 'gravel', sheet: '地業', group: 'gravel', operator: '≒', basisText: '1階床面積 × 砂利地業の厚さ', basis: v => product(v.basis('firstFloorArea'), v.basis('gravelThickness')) },
  { id: 'leanConcrete', sheet: '地業', group: 'leanConcrete', operator: '∈', basisText: '1階床面積 × 捨コンクリートの厚さ ×（0.3）〜（0.7）',
    basis: v => product(v.basis('firstFloorArea'), v.basis('leanConcreteThickness')), range: [0.3, 0.7] },
  // ── 躯体 ──
  { id: 'concrete', sheet: '躯体', group: 'concrete', operator: '∈', basisText: '延べ面積 ×（0.8）〜（1.0）', basis: v => v.basis('totalFloorArea'), range: [0.8, 1.0] },
  { id: 'concreteFoundation', sheet: '躯体', group: 'concreteFoundation', operator: '∈', basisText: '延べ面積 ×（0.2）〜（0.5）', basis: v => v.basis('totalFloorArea'), range: [0.2, 0.5] },
  { id: 'concreteBody', sheet: '躯体', group: 'concreteBody', operator: '∈', basisText: '延べ面積 ×（0.5）〜（0.8）', basis: v => v.basis('totalFloorArea'), range: [0.5, 0.8] },
  { id: 'protectionConcrete', sheet: '躯体', group: 'protectionConcrete', operator: '≒', basisText: '建築面積 × 0.08（防水押え 厚さ 80）', basis: v => product(v.basis('buildingArea'), 0.08) },
  { id: 'formworkByArea', sheet: '躯体', group: 'formwork', operator: '∈', basisText: '延べ面積 ×（4.0）〜（5.5）', basis: v => v.basis('totalFloorArea'), range: [4.0, 5.5] },
  { id: 'formworkByConcrete', sheet: '躯体', group: 'formwork', operator: '∈', basisText: 'コンクリート総量 ×（5.5）〜（6.5）', basis: v => v.quantity('concrete'), range: [5.5, 6.5] },
  { id: 'formworkTransport', sheet: '躯体', group: 'formworkTransport', operator: '＝', basisText: '型枠総量（デッキプレート等を除く）', basis: v => v.quantity('formwork') },
  { id: 'rebarByArea', sheet: '躯体', group: 'rebarDesign', operator: '∈', basisText: '延べ面積 ×（0.10）〜（0.14）', basis: v => v.basis('totalFloorArea'), range: [0.10, 0.14] },
  { id: 'rebarByConcrete', sheet: '躯体', group: 'rebarDesign', operator: '∈', basisText: 'コンクリート総量 ×（0.13）〜（0.16）', basis: v => v.quantity('concrete'), range: [0.13, 0.16] },
  { id: 'gasJoint', sheet: '躯体', group: 'gasJoint', operator: '∈', basisText: '鉄筋総量 ×（9）〜（15）', basis: v => v.quantity('rebarDesign'), range: [9, 15] },
  { id: 'steel', sheet: '躯体', group: 'steelDesign', operator: '∈', basisText: '鉄骨造部分の延べ面積 ×（0.08）〜（0.12）（中・高層 S 造）', basis: v => v.basis('steelFloorArea'), range: [0.08, 0.12] },
  // ── 外部仕上 ──
  { id: 'roofWaterproof', sheet: '外部仕上', group: 'roofWaterproof', operator: '≒', basisText: '建築面積', basis: v => v.basis('buildingArea') },
  { id: 'waterproofRise', sheet: '外部仕上', group: 'waterproofRise', operator: '≧', basisText: '建物周長 × 0.4（立上り H=400）', basis: v => product(v.basis('perimeter'), 0.4) },
  { id: 'exteriorWallByArea', sheet: '外部仕上', group: 'exteriorWall', operator: '∈', basisText: '延べ面積 ×（0.7）〜（1.2）', basis: v => v.basis('totalFloorArea'), range: [0.7, 1.2] },
  { id: 'exteriorWallByHeight', sheet: '外部仕上', group: 'exteriorWall', operator: '≒', basisText: '建物周長 × パラペットまでの高さ', basis: v => product(v.basis('perimeter'), v.basis('parapetHeight')) },
  { id: 'glass', sheet: '外部仕上', group: 'glass', operator: '∈', basisText: '外壁見付面積（建物周長 × 高さ）×（0.1）〜（0.3）', basis: v => product(v.basis('perimeter'), v.basis('parapetHeight')), range: [0.1, 0.3] },
  // ── 内部仕上 ──
  { id: 'floorFinish', sheet: '内部仕上', group: 'floorFinish', operator: '≒', basisText: '延べ面積 × 0.95', basis: v => product(v.basis('totalFloorArea'), 0.95) },
  { id: 'wallFinish', sheet: '内部仕上', group: 'wallFinish', operator: '∈', basisText: '延べ面積 ×（1.0）〜（1.8）', basis: v => v.basis('totalFloorArea'), range: [1.0, 1.8] },
  { id: 'ceilingFinish', sheet: '内部仕上', group: 'ceilingFinish', operator: '≒', basisText: '延べ面積 × 0.95', basis: v => product(v.basis('totalFloorArea'), 0.95) },
  // ── 金属 ──
  { id: 'nonSlip', sheet: '金属', group: 'nonSlip', operator: '∈', basisText: '階段室の箇所数 ×（階数 − 1）×（50）〜（65）（階段幅 2.5m 程度）',
    basis: v => { const f = v.basis('floorsAbove'); return product(v.basis('stairCount'), f === undefined ? undefined : f - 1) }, range: [50, 65] },
]

/** 拾いから延べ面積・建築面積の候補を出すときに使う内訳数量（大きいほうを候補にする）。 */
export const CHECK_BASIS_SUGGESTIONS: Readonly<Partial<Record<CheckBasisKey, readonly string[]>>> = {
  totalFloorArea: ['marking', 'curing', 'cleaning'],
  buildingArea: ['setOut', 'groundScaffold'],
}
