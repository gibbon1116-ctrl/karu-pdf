import { FIXTURE_PRESETS, nextCountStyle, nextQuantityLineStyle, type CountFixture, type FixturePreset, type QuantityKind, type QuantityMethod, type QuantityDefaults } from './countFixtures'

export interface MasterType {
  conditions: readonly string[]
  field: string
  category: string
  type: string
  name: string
  kind: QuantityKind
  method: QuantityMethod
  defaults?: QuantityDefaults
  code: string
  codeFromSpec?: 'concat' | 'replace'
  specs: readonly string[]
}
export interface MasterEntry extends FixturePreset { key: string; field: string; type: string; search: string; codeSearch: string }

const list = (text: string) => text.split(', ')
const iv = list('1.6mm, 2.0mm, 2.6mm, 5.5sq, 8sq, 14sq, 22sq, 38sq, 60sq, 100sq, 150sq, 200sq, 250sq, 325sq')
const vvf = list('1.6-2C, 1.6-3C, 2.0-2C, 2.0-3C, 2.6-2C, 2.6-3C')
const cv = [2, 3.5, 5.5, 8, 14, 22, 38, 60, 100, 150, 200, 250, 325].flatMap(size =>
  [1, 2, 3, 4].filter(cores => cores === 1 ? size >= 14 : cores === 2 ? size <= 150 : cores === 4 ? size <= 100 : true).map(cores => `${size}sq-${cores}C`))
const cvt = list('8sq, 14sq, 22sq, 38sq, 60sq, 100sq, 150sq, 200sq, 250sq, 325sq')
const highVoltage = cvt.slice(2)
const control = [1.25, 2, 3.5, 5.5].flatMap(size => (size <= 2 ? [2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 24, 30] : [2, 3, 4, 5, 6, 8]).map(cores => `${size}sq-${cores}C`))
const shielded = [1.25, 2].flatMap(size => [2, 3, 4, 5, 6, 8, 10, 12].map(cores => `${size}sq-${cores}C`))
const lan = list('Cat5e-4P, Cat6-4P, Cat6A-4P')
const ae = list('0.9-2C, 0.9-4C, 0.9-6C, 0.9-10C, 1.2-2C, 1.2-4C, 1.2-6C, 1.2-10C')
const rack = list('W200, W300, W400, W500, W600, W800, W1000')
const a15 = list('15A, 20A, 25A, 32A, 40A, 50A, 65A, 80A, 100A, 125A, 150A')
const a200 = [...a15, '200A'], a80 = a15.slice(0, 8), a50 = a15.slice(0, 6), a40d = a15.slice(4)
const waterPlastic = list('13, 16, 20, 25, 30, 40, 50')
const drainPlastic = list('40, 50, 65, 75, 100, 125, 150')
const roundDuct = list('φ100, φ125, φ150, φ175, φ200, φ225, φ250, φ300, φ350, φ400, φ450, φ500, φ600')
const wireConditions = ['管内配線', '合成樹脂管内配線（PF・CD・FEP）', 'ケーブルラック配線', '二重天井内・二重床内・ピット内・トラフ内配線'] as const
const cableConditions = [...wireConditions, 'サドル止め（コンクリート）', 'サドル止め・ステープル止め（木造）', '地中管路内', '架空（ちょう架）']
// 計画1章: 設備数量積算基準R7・標準単価積算基準R8。候補だけで既定は選ばない。
export function standardConditions(category: string, type: string): readonly string[] {
  if (category === '電線') return [...wireConditions, 'ダクト内配線']
  if (['ケーブル（低圧）', 'ケーブル（高圧）', '制御ケーブル', '通信・弱電ケーブル', '耐火・耐熱ケーブル'].includes(category)) return cableConditions
  if (category === '電線管') return type === 'CD' ? ['コンクリート埋込配管'] : type === 'FEP' ? ['地中埋設', '露出配管'] : ['隠ぺい配管', '露出配管', 'コンクリート埋込配管', '地中埋設']
  if (category === 'ケーブルラック・ダクト') return ['屋内', '屋外']
  if (category === '照明器具') return ['天井直付', '天井埋込', '壁付', '吊下げ', '床置・据置']
  if (['配管（給水・給湯）', '配管（排水・通気）', '配管（消火・冷温水・蒸気）', '冷媒管', 'ドレン管'].includes(category)) return ['屋内一般配管', '機械室・便所配管', '屋外配管（架空・暗渠内・共同溝内）', '屋外露出配管', '地中配管']
  if (category === 'ダクト') return ['屋内一般', '機械室', '屋外露出']
  if (category === '保温') return ['屋内露出（一般居室・廊下）', '屋内隠ぺい（天井内・パイプシャフト）', '機械室・書庫・倉庫', '屋外露出・浴室・厨房', '暗渠内']
  if (category === '塗装' || type === '塗装') return ['屋内', '屋外']
  if (category === '土工' && type === '根切り') return ['直掘り工法', '法付け工法']
  if (category === '撤去') return ['撤去（廃棄）', '取外し（再使用）']
  if (['スイッチ', 'コンセント', '配線器具'].includes(category)) return ['隠ぺい（埋込）', '露出']
  return []
}
const length = (field: string, category: string, type: string, code: string, name: string, specs: readonly string[], codeFromSpec?: MasterType['codeFromSpec']): MasterType =>
  ({ conditions: standardConditions(category, type), field, category, type, code, name, specs, kind: 'length', method: 'polyline', ...(codeFromSpec ? { codeFromSpec } : {}) })
const electric = (category: string, type: string, name: string, specs: readonly string[], code = type, codeFromSpec?: MasterType['codeFromSpec']) => length('電気設備', category, type, code, name, specs, codeFromSpec)
const mechanical = (category: string, type: string, name: string, specs: readonly string[], code = type) => length('機械設備', category, type, code, name, specs)
const light = (type: string, code: string, name: string, specs: readonly string[]): MasterType => ({ conditions: standardConditions('照明器具', type), field: '電気設備', category: '照明器具', type, code, name, specs, kind: 'count', method: 'click' })
const fromPreset = (field: string, f: FixturePreset): MasterType => ({ conditions: standardConditions(f.category, f.code), field, category: f.category, type: f.code, code: f.code, name: f.name, kind: f.kind ?? 'count', method: f.method ?? 'click', ...(f.defaults ? { defaults: { ...f.defaults } } : {}), specs: [] })
const countPresets = (field: string) => FIXTURE_PRESETS[field].filter(f => !f.kind || f.kind === 'count').map(f => fromPreset(field, f))
const surface = (field: string, category: string, type: string, name: string, kind: QuantityKind, method: QuantityMethod, code = type, specs: readonly string[] = [], defaults?: QuantityDefaults): MasterType =>
  ({ conditions: standardConditions(category, type), field, category, type, code, name, kind, method, specs, ...(defaults ? { defaults } : {}) })

// Order here, including each specs array, is the browsing and search order.
export const QUANTITY_MASTER: readonly MasterType[] = [
  electric('電線', 'IV', '600Vビニル絶縁電線', iv),
  electric('電線', 'EM-IE', '600V耐燃性ポリエチレン絶縁電線', iv),
  electric('電線', 'HIV', '600V二種ビニル絶縁電線', iv.slice(0, 10)),
  electric('ケーブル（低圧）', 'VVF', '600Vビニル絶縁ビニルシースケーブル平形', vvf),
  electric('ケーブル（低圧）', 'EM-EEF', '600V耐燃性ポリエチレンシースケーブル平形', vvf),
  electric('ケーブル（低圧）', 'CV', '600V架橋ポリエチレン絶縁ビニルシースケーブル', cv),
  electric('ケーブル（低圧）', 'EM-CE', '600V架橋ポリエチレン絶縁耐燃性ポリエチレンシースケーブル', cv),
  electric('ケーブル（低圧）', 'CVT', '600V架橋ポリエチレン絶縁ビニルシースケーブル（トリプレックス形）', cvt),
  electric('ケーブル（低圧）', 'EM-CET', '600V架橋ポリエチレン絶縁耐燃性ポリエチレンシースケーブル（トリプレックス形）', cvt),
  electric('ケーブル（低圧）', 'CVQ', '600V架橋ポリエチレン絶縁ビニルシースケーブル（カドラプレックス形）', cvt.slice(0, 7)),
  electric('ケーブル（高圧）', '6.6kV CVT', '6600V架橋ポリエチレン絶縁ビニルシースケーブル（トリプレックス形）', highVoltage),
  electric('ケーブル（高圧）', '6.6kV EM-CET', '6600V架橋ポリエチレン絶縁耐燃性ポリエチレンシースケーブル（トリプレックス形）', highVoltage),
  electric('制御ケーブル', 'CVV', '制御用ビニル絶縁ビニルシースケーブル', control),
  electric('制御ケーブル', 'EM-CEE', '制御用耐燃性ポリエチレンシースケーブル', control),
  electric('制御ケーブル', 'CVV-S', '制御用ビニル絶縁ビニルシースケーブル（遮へい付）', shielded),
  electric('制御ケーブル', 'EM-CEE-S', '制御用耐燃性ポリエチレンシースケーブル（遮へい付）', shielded),
  electric('通信・弱電ケーブル', 'UTP', 'LANケーブル（UTP）', lan),
  electric('通信・弱電ケーブル', 'EM-UTP', 'LANケーブル（耐燃性）', lan),
  electric('通信・弱電ケーブル', '光（SM）', '光ファイバケーブル（シングルモード）', list('2C, 4C, 8C, 12C, 24C, 48C'), 'SM'),
  electric('通信・弱電ケーブル', '光（GI）', '光ファイバケーブル（マルチモード）', list('2C, 4C, 8C, 12C, 24C'), 'GI'),
  electric('通信・弱電ケーブル', '同軸', '同軸ケーブル', list('S-5C-FB, S-7C-FB, S-10C-FB, 5C-FB, 7C-FB, 3C-2V, 5C-2V'), '', 'replace'),
  electric('通信・弱電ケーブル', 'EM-TOEV-SS', '屋内用通信電線（耐燃性）', list('0.5-2P, 0.5-4P, 0.5-10P, 0.5-20P, 0.5-30P, 0.5-50P, 0.5-100P')),
  electric('通信・弱電ケーブル', 'AE', '警報用ポリエチレン絶縁ケーブル', ae),
  electric('通信・弱電ケーブル', 'EM-AE', '警報用ポリエチレン絶縁ケーブル（耐燃性）', ae),
  electric('耐火・耐熱ケーブル', 'HP', '耐熱電線', list('0.9-2C, 0.9-4C, 1.2-2C, 1.2-3C, 1.2-4C, 1.2-6C, 1.2-10C')),
  electric('耐火・耐熱ケーブル', 'FP', '耐火ケーブル', list('2sq-2C, 2sq-3C, 3.5sq-2C, 3.5sq-3C, 5.5sq-2C, 5.5sq-3C, 8sq-3C, 14sq-3C, 22sq-3C, 38sq-3C, 60sq-3C')),
  electric('耐火・耐熱ケーブル', 'FP-C', '耐火ケーブル（小勢力・警報用）', list('1.2-2C, 1.2-3C, 1.2-4C')),
  electric('電線管', 'E', 'ねじなし電線管', list('19, 25, 31, 39, 51, 63, 75'), 'E', 'concat'),
  electric('電線管', 'C', '薄鋼電線管', list('19, 25, 31, 39, 51, 63, 75'), 'C', 'concat'),
  electric('電線管', 'G', '厚鋼電線管', list('16, 22, 28, 36, 42, 54, 70, 82, 92, 104'), 'G', 'concat'),
  electric('電線管', 'PF', '合成樹脂製可とう電線管（PF管）', list('14, 16, 22, 28, 36, 42'), 'PF', 'concat'),
  electric('電線管', 'CD', '合成樹脂製可とう電線管（CD管）', list('14, 16, 22, 28, 36, 42'), 'CD', 'concat'),
  electric('電線管', 'VE', '硬質ビニル電線管', list('14, 16, 22, 28, 36, 42, 54, 70, 82'), 'VE', 'concat'),
  electric('電線管', 'HIVE', '耐衝撃性硬質ビニル電線管', list('14, 16, 22, 28, 36, 42, 54'), 'HIVE', 'concat'),
  electric('電線管', 'FEP', '波付硬質合成樹脂管', list('30, 40, 50, 65, 80, 100, 125, 150, 200'), 'FEP', 'concat'),
  electric('電線管', 'プリカ', '金属製可とう電線管', list('10, 12, 15, 17, 24, 30, 38, 50, 63, 76, 83, 101'), 'プリカ', 'concat'),
  electric('ケーブルラック・ダクト', 'CR', 'ケーブルラック（鋼製）', rack),
  electric('ケーブルラック・ダクト', 'CR-AL', 'ケーブルラック（アルミ製）', rack),
  electric('ケーブルラック・ダクト', 'CR-SUS', 'ケーブルラック（ステンレス製）', rack.slice(0, 5)),
  electric('ケーブルラック・ダクト', 'MD', '金属ダクト', list('100×100, 150×100, 200×100, 200×150, 300×100, 300×150, 300×200, 400×200')),
  light('DL', 'DL', 'ダウンライト', list('φ100, φ125, φ150, φ200')),
  light('BL', 'BL', 'ベースライト（直付）', list('20形, 40形, 110形')),
  light('BE', 'BE', 'ベースライト（埋込）', list('20形, 40形, 110形, □450, □600')),
  light('非常用照明', 'EM', '非常用照明', list('埋込形, 直付形')),
  light('誘導灯（避難口）', 'GA', '誘導灯（避難口）', list('A級, B級, C級')),
  light('誘導灯（通路）', 'GB', '誘導灯（通路）', list('A級, B級, C級')),
  ...countPresets('電気設備').filter(f => f.category !== '照明器具' || ['BR', 'PD', 'SP', 'OL'].includes(f.code)),
  mechanical('配管（給水・給湯）', 'SGP-VA', '水道用硬質ポリ塩化ビニルライニング鋼管（VA）', a15),
  mechanical('配管（給水・給湯）', 'SGP-VB', '水道用硬質ポリ塩化ビニルライニング鋼管（VB）', a15),
  mechanical('配管（給水・給湯）', 'SGP-VD', '水道用硬質ポリ塩化ビニルライニング鋼管（VD）', a15),
  mechanical('配管（給水・給湯）', 'SGP-HVA', '水道用耐熱性硬質ポリ塩化ビニルライニング鋼管', a80),
  mechanical('配管（給水・給湯）', 'SUS', '一般配管用ステンレス鋼鋼管', list('13Su, 20Su, 25Su, 30Su, 40Su, 50Su, 60Su, 75Su, 80Su, 100Su')),
  mechanical('配管（給水・給湯）', '銅管', '銅管（Lタイプ）', a50, 'CUP'),
  mechanical('配管（給水・給湯）', 'HIVP', '耐衝撃性硬質ポリ塩化ビニル管', waterPlastic),
  mechanical('配管（給水・給湯）', 'HTVP', '耐熱性硬質ポリ塩化ビニル管', waterPlastic),
  mechanical('配管（給水・給湯）', 'PEX', '架橋ポリエチレン管', list('10, 13, 16, 20')),
  mechanical('配管（給水・給湯）', 'PB', 'ポリブテン管', list('10, 13, 16, 20, 25')),
  mechanical('配管（排水・通気）', 'VP', '硬質ポリ塩化ビニル管（VP）', drainPlastic),
  mechanical('配管（排水・通気）', 'VU', '硬質ポリ塩化ビニル管（VU）', [...drainPlastic, '200']),
  mechanical('配管（排水・通気）', '耐火VP', '耐火二層管', drainPlastic),
  mechanical('配管（排水・通気）', 'D-VA', '排水用硬質ポリ塩化ビニルライニング鋼管', a40d),
  mechanical('配管（消火・冷温水・蒸気）', 'SGP(白)', '配管用炭素鋼鋼管（白）', a200),
  mechanical('配管（消火・冷温水・蒸気）', 'SGP(黒)', '配管用炭素鋼鋼管（黒）', a200),
  mechanical('配管（消火・冷温水・蒸気）', 'STPG370', '圧力配管用炭素鋼鋼管（Sch40）', a200),
  mechanical('冷媒管', 'RP', '冷媒管（ペア）', list('6.35×9.52, 6.35×12.70, 9.52×15.88, 9.52×19.05, 9.52×22.22, 12.70×25.40, 15.88×28.58')),
  mechanical('冷媒管', 'CU', '冷媒用銅管（単管）', list('φ6.35, φ9.52, φ12.70, φ15.88, φ19.05, φ22.22, φ25.40, φ28.58, φ31.75, φ34.92, φ38.10, φ41.28')),
  mechanical('ドレン管', 'DP', 'ドレン管（硬質ポリ塩化ビニル管）', list('VP20, VP25, VP30, VP40, VP50')),
  mechanical('ダクト', 'SD', '角ダクト', list('200×150, 200×200, 250×150, 250×200, 300×200, 300×250, 350×250, 400×250, 400×300, 450×300, 500×300, 500×400, 600×300, 600×400, 700×400, 800×400, 800×500, 1000×400, 1000×500, 1200×500')),
  mechanical('ダクト', 'RD', 'スパイラルダクト', roundDuct),
  mechanical('ダクト', 'RDB', '丸ダクト（板巻き）', roundDuct),
  mechanical('ダクト', 'FLD', 'フレキシブルダクト', list('φ100, φ125, φ150, φ200, φ250')),
  ...countPresets('機械設備'),
  mechanical('保温', 'GW', '配管保温（グラスウール）', a15),
  surface('機械設備', '保温', 'DUCT-GW', 'ダクト保温（長方形）（長さ×周長）', 'area', 'lengthHeight'),
  mechanical('塗装', 'PIPE-PAINT', '配管塗装', a15),
  surface('建築', '内装（面積）', '床仕上げ', '床仕上げ（囲む）', 'area', 'polygon'),
  surface('建築', '内装（面積）', '天井仕上げ', '天井仕上げ（囲む）', 'area', 'polygon'),
  surface('建築', '内装（面積）', '壁仕上げ', '壁仕上げ（長さ×高さ）', 'area', 'lengthHeight'),
  surface('建築', '内装（面積）', '塗装', '壁の塗装（長さ×高さ）', 'area', 'lengthHeight'),
  surface('建築', '外部（面積）', '舗装', '舗装（囲む）', 'area', 'polygon'),
  surface('建築', '外部（面積）', '屋上防水', '屋上防水（囲む）', 'area', 'polygon'),
  surface('建築', 'コンクリート（体積）', '土間コンクリート', '土間コンクリート（囲む×厚さ）', 'volume', 'polygonDepth', '土間コンクリート', [], { depthM: .15 }),
  length('建築', '長さ', '巾木', '巾木', '巾木', []),
  length('建築', '長さ', 'シーリング', 'シーリング', 'シーリング', []),
  length('建築', '長さ', '見切り', '見切り', '見切り縁', []),
  ...countPresets('建築'),
  // Group the legacy eight by category, keeping their identities and defaults.
  ...FIXTURE_PRESETS['仮設・土工'].filter(f => f.category === '仮設').map(f => fromPreset('仮設・土工', f)),
  surface('仮設・土工', '仮設', '外部足場', '外部足場（長さ×高さ）', 'area', 'lengthHeight', '外部足場', list('枠組本足場, 単管本足場')),
  surface('仮設・土工', '仮設', '養生シート', '外部の養生シート（長さ×高さ）', 'area', 'lengthHeight'),
  surface('仮設・土工', '仮設', '仮囲い', '仮囲い（長さ×高さ）', 'area', 'lengthHeight'),
  ...FIXTURE_PRESETS['仮設・土工'].filter(f => f.category === '土工').map(f => fromPreset('仮設・土工', f)),
  surface('仮設・土工', '土工', '埋戻し', '埋戻し（囲む×深さ）', 'volume', 'polygonDepth'),
  surface('仮設・土工', '土工', '残土処分', '残土処分（囲む×深さ）', 'volume', 'polygonDepth'),
  surface('仮設・土工', '土工', '砕石地業', '砕石地業（囲む）', 'area', 'polygon'),
  ...FIXTURE_PRESETS['仮設・土工'].filter(f => f.category === '撤去').map(f => fromPreset('仮設・土工', f)),
  surface('仮設・土工', '撤去', '壁仕上げの撤去', '壁仕上げの撤去（長さ×高さ）', 'area', 'lengthHeight', '壁撤去'),
  surface('仮設・土工', '撤去', '間仕切壁の撤去', '間仕切壁の撤去（長さ×高さ）', 'area', 'lengthHeight', '間仕切撤去'),
]

export function normalizeMasterText(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s/g, '').replace(/[×*]/g, 'x').replace(/[φø]/g, 'φ')
}
let expanded: readonly MasterEntry[] | undefined
export function masterEntries(): readonly MasterEntry[] {
  return expanded ??= QUANTITY_MASTER.flatMap(t => (t.specs.length ? t.specs : ['']).map(spec => {
    const code = t.codeFromSpec === 'concat' ? t.code + spec : t.codeFromSpec === 'replace' ? spec : t.code
    return {
      key: JSON.stringify([t.field, t.category, t.type, spec]), field: t.field, type: t.type,
      conditions: [...t.conditions], category: t.category, code, ...(!t.codeFromSpec && spec ? { spec } : {}), name: t.name,
      kind: t.kind, method: t.method, ...(t.defaults ? { defaults: { ...t.defaults } } : {}),
      aggregation: t.kind === 'count' ? 'location' as const : 'document' as const,
      search: normalizeMasterText(`${t.field} ${t.category} ${t.type} ${code} ${t.codeFromSpec ? '' : spec} ${t.name}`),
      codeSearch: normalizeMasterText(`${code} ${t.codeFromSpec ? '' : spec}`),
    }
  }))
}
export function searchQuantityMaster(query: string, limit = 200): { entries: MasterEntry[]; total: number } {
  const terms = query.normalize('NFKC').split(/\s+/).map(normalizeMasterText).filter(Boolean)
  if (!terms.length) return { entries: [], total: 0 }
  // Size terms ("60", "5.5sq", "φ150") match the code and spec only, so "60" does not
  // also hit every "600V…" cable name. Entries whose code is exactly a word term come first.
  const sizeTerm = (term: string) => /^[0-9.φ□]/.test(term)
  const matches = masterEntries().filter(entry => terms.every(term => (sizeTerm(term) ? entry.codeSearch : entry.search).includes(term)))
  const exact = (entry: MasterEntry) => terms.some(term => !sizeTerm(term) && normalizeMasterText(entry.code) === term)
  const ranked = [...matches.filter(exact), ...matches.filter(entry => !exact(entry))]
  return { entries: ranked.slice(0, Math.max(0, Math.floor(limit))), total: ranked.length }
}

/** Explicit standard import / user-requested refill, including legacy bundle categories. */
export function standardConditionsForFixture(f: Pick<FixturePreset, 'category' | 'code'>): string[] {
  const aliases: Record<string, readonly string[]> = { '電線・ケーブル': ['電線', 'ケーブル（低圧）'], 'ケーブルラック': ['ケーブルラック・ダクト'], '配管': ['配管（給水・給湯）', '配管（排水・通気）', '配管（消火・冷温水・蒸気）', '冷媒管', 'ドレン管'] }
  const categories = aliases[f.category] ?? [f.category]
  const types = QUANTITY_MASTER.filter(t => categories.includes(t.category) && (f.code === t.code || t.codeFromSpec === 'concat' && f.code.startsWith(t.code))).sort((a, b) => b.code.length - a.code.length)
  if (types[0]) return [...types[0].conditions]
  if (f.category === '配管' && ['SGP', 'VP', 'RP'].includes(f.code)) return [...standardConditions('配管（給水・給湯）', f.code)]
  return []
}
/** Materialize here so both tabs retain candidates through the existing fixture import path. */
export function fixtureFromPreset(p: FixturePreset, fixtures: readonly CountFixture[]): CountFixture {
  const { category, code, spec, name, kind, method, defaults, aggregation } = p
  const line = kind && kind !== 'count' ? nextQuantityLineStyle(fixtures) : undefined
  return { category, code, spec, name, kind, method, defaults: defaults ? { ...defaults } : undefined, aggregation, conditions: [...(p.conditions ?? standardConditionsForFixture(p))], id: crypto.randomUUID(), order: fixtures.reduce((n, f) => Math.max(n, f.order + 1), 0), style: line ? { ...nextCountStyle([]), color: line.color } : nextCountStyle(fixtures), ...(line ? { line: line.line } : {}) }
}
