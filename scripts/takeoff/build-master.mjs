#!/usr/bin/env node
// 拾い範囲と関連数量のマスター（実行用データ）を、引継ぎパックの抽出スナップショットから作る（開発時のみ）。Claude が作成（2026-10-18）。
//
// 使い方: node scripts/takeoff/build-master.mjs <引継ぎパックのフォルダ>
//   出力: src/core/takeoff/master.data.json（アプリが機能の初回利用時に遅延読込する）
//         docs/調査/拾い範囲/変換診断.json（照合結果・競合・保留の理由。非公開の調査資料）
//
// 方針（統合実装指示書 §2.3・§4）:
// - 原本 Excel の SHA256 と manifest の一致、949 ID の一意性、件数、全件 false を確かめてから変換する。不一致なら停止する。
// - Excel の数式・文章・AST はコードとして実行しない。値は文字列・JSON として読み、構造だけを検証する。
// - 「後ろのシートが勝つ」上書きはしない。定義ID・対象プロパティごとに照合し、一致しないものは MASTER_CONFLICT として記録する。
// - 原本の auto_enable / export_enabled は書き換えない（すべて false のまま保持し、実行時の許可は案件の採用で別に持つ）。
// - 実図面（案件 PDF）の照合表・資料の所在 URL・個人名・ローカルパスは出力しない。

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packDir = process.argv[2]
if (!packDir) {
  console.error('使い方: node scripts/takeoff/build-master.mjs <引継ぎパックのフォルダ>')
  process.exit(2)
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// 生成データは「JSON 文字列を JSON.parse する TS モジュール」にする（大きな JSON を tsc に型推論させない・実行時の解析も速い）。
const outData = path.join(repoRoot, 'src', 'core', 'takeoff', 'master.data.ts')
const outRules = path.join(repoRoot, 'src', 'core', 'takeoff', 'ruleScopes.data.ts')
const dataModule = (typeName, value) => [
  '// 生成ファイル（scripts/takeoff/build-master.mjs）。手で編集しない。',
  `import type { ${typeName} } from './types'`,
  '',
  `const data: ${typeName} = JSON.parse(${JSON.stringify(JSON.stringify(value))})`,
  'export default data',
  '',
].join('\n')
const outDiag = path.join(repoRoot, 'docs', '調査', '拾い範囲', '変換診断.json')

const fail = message => { console.error(`変換を停止しました: ${message}`); process.exit(1) }
const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))

// ---- 1. 原本と引継ぎファイルの照合 -------------------------------------------------------
const manifest = readJson(path.join(packDir, 'manifest.json'))
const sourceDir = path.join(packDir, 'source')
const workbook = readdirSync(sourceDir).find(name => name === manifest.source_workbook)
if (!workbook) fail(`原本 ${manifest.source_workbook} が source フォルダにありません`)
const workbookHash = sha256(path.join(sourceDir, workbook))
if (workbookHash !== manifest.source_sha256) fail(`原本の SHA256 が manifest と一致しません（${workbookHash}）`)
for (const file of manifest.files) {
  if (!file.path.startsWith('data/')) continue
  const actual = sha256(path.join(packDir, file.path))
  if (actual !== file.sha256) fail(`${file.path} の SHA256 が manifest と一致しません`)
}

const snapshot = readJson(path.join(packDir, 'data', 'definitions949.snapshot.json'))
const tablesSnapshot = readJson(path.join(packDir, 'data', 'source_tables.snapshot.json'))
if (snapshot.source_sha256 !== manifest.source_sha256) fail('949定義スナップショットの元 hash が原本と一致しません')
if (tablesSnapshot.source_sha256 !== manifest.source_sha256) fail('テーブルスナップショットの元 hash が原本と一致しません')
if (tablesSnapshot.tables.length !== manifest.native_tables) fail(`テーブル数 ${tablesSnapshot.tables.length} が manifest の ${manifest.native_tables} と一致しません`)
const sheetCount = new Set(tablesSnapshot.tables.map(table => table.sheet)).size

const definitions = snapshot.definitions
if (definitions.length !== manifest.definitions) fail(`定義数 ${definitions.length} が manifest の ${manifest.definitions} と一致しません`)
const ids = definitions.map(definition => definition.definition_id)
if (new Set(ids).size !== ids.length) fail('定義IDが重複しています')
if (ids.some(id => typeof id !== 'string' || !id.trim())) fail('空の定義IDがあります')

const countBy = (values, key) => values.reduce((counts, value) => {
  const k = key(value); counts[k] = (counts[k] ?? 0) + 1; return counts
}, {})
const sameCounts = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
if (!sameCounts(countBy(definitions, d => d.source_execution_state), manifest.execution_states)) fail('実行状態の件数が manifest と一致しません')
if (!sameCounts(countBy(definitions, d => d.implementation_role), manifest.implementation_roles)) fail('実装用の役割の件数が manifest と一致しません')

const flagPaths = [
  d => d.auto_enable, d => d.export_enabled,
  d => d.source_contract.auto_enable, d => d.source_contract.export_enabled, d => d.source_contract.adoption_approved,
  d => d.input_contract.stage_conditions.auto_enable, d => d.input_contract.stage_conditions.export_enabled,
  d => d.price_allocation_policy.export_enabled, d => d.price_allocation_policy.adoption_approved, d => d.price_allocation_policy.price_adopted,
]
for (const definition of definitions) {
  for (const flag of flagPaths) {
    const value = flag(definition)
    if (value !== false && value !== undefined) fail(`${definition.definition_id} に false でない採用・出力フラグがあります`)
  }
}

// ---- テーブルの読み出し ----------------------------------------------------------------
const tables = new Map(tablesSnapshot.tables.map(table => [table.table_name, table]))
const rowsOf = name => {
  const table = tables.get(name)
  if (!table) fail(`テーブル ${name} がありません`)
  return table.records.map(record => {
    const row = { __row: record.source_row, __sheet: table.sheet }
    table.headers.forEach((header, index) => { row[header] = record.values[index] })
    return row
  })
}
const text = value => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return '' // Excel 数式の注記オブジェクトは実行・表示しない
  // 資料の所在 URL は実行時に使わないので出力しない（アプリは外部と通信しない。確認箇所の文は残す）
  return String(value).replace(/\s*https?:\/\/\S+/g, '').trim()
}
const optionalText = value => text(value) || undefined
const splitIds = value => [...new Set(text(value).split(/[\s/|,、]+/).filter(Boolean))].sort()
const splitList = value => text(value).split(/\s*[/|]\s*/).map(part => part.trim()).filter(part => part && part !== '—')
const parseJsonCell = (value, where) => {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value !== 'string') return undefined
  try { return JSON.parse(value) } catch { conflicts.push({ where, reason: 'JSON として読めないセル', value: value.slice(0, 120) }); return undefined }
}

const conflicts = []   // MASTER_CONFLICT: definition_id・プロパティ単位
const notes = []       // 照合の結果（競合ではない記録）
const conflict = (definitionId, property, reason, cells) =>
  conflicts.push({ definitionId, property, reason, cells })

// ---- 2. 既存ルールとの対応（4表の照合） -------------------------------------------------
const scopeDefinitionRows = new Map(rowsOf('ScopeDefinitions').map(row => [text(row['定義ID']), row]))
const p3Rows = new Map(rowsOf('P3Definitions').map(row => [text(row['定義ID']), row]))
const scopeOriginalRows = rowsOf('ScopeOriginalRules')
const rulesFromOriginal = new Map()
for (const row of scopeOriginalRows) {
  for (const definitionId of splitIds(row['対応する数量定義ID'])) {
    if (!rulesFromOriginal.has(definitionId)) rulesFromOriginal.set(definitionId, new Set())
    rulesFromOriginal.get(definitionId).add(text(row['元項目ID']))
  }
}

const ruleMapping = new Map()
for (const definition of definitions) {
  const id = definition.definition_id
  const scopeRow = scopeDefinitionRows.get(id)
  const p3Row = p3Rows.get(id)
  if (!scopeRow) conflict(id, 'rules', '拾う対象949定義に行がありません', [])
  if (!p3Row) conflict(id, 'rules', '全件整理追跡に行がありません', [])
  const fromScope = splitIds(scopeRow?.['対応する元項目ID'])
  const fromP3 = splitIds(p3Row?.['元916ルールID'])
  const fromReverse = splitIds(definition.reverse_binding_snapshot.cells.X)
  const fromOriginal = [...(rulesFromOriginal.get(id) ?? [])].sort()
  const agree = [fromP3, fromReverse, fromOriginal].every(list => JSON.stringify(list) === JSON.stringify(fromScope))
  if (!agree) {
    conflict(id, 'rules', '既存ルールとの対応が表の間で一致しません', [
      `拾う対象949定義!行${scopeRow?.__row}`, `全件整理追跡!行${p3Row?.__row}`,
      `逆方向949対応!行${definition.reverse_binding_snapshot.row}:X`, '拾う対象916元項目!対応する数量定義ID',
    ])
  }
  ruleMapping.set(id, agree ? fromScope : [])
}

// ---- 3. JSON Schema の再構成照合 ---------------------------------------------------------
// 定義ごとの json_schema は「必須キー＋共通の型表＋条件付き必須」から作れる形になっている。
// 共通の型表と定義別の上書きに分け、全件で元の schema と完全に一致することを確かめる（一致しない定義は MASTER_CONFLICT）。
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}
const canonicalJson = value => JSON.stringify(canonical(value))

const propertyShapes = new Map()
for (const definition of definitions) {
  for (const [key, shape] of Object.entries(definition.input_contract.json_schema.properties)) {
    const json = canonicalJson(shape)
    if (!propertyShapes.has(key)) propertyShapes.set(key, new Map())
    const counts = propertyShapes.get(key)
    counts.set(json, (counts.get(json) ?? 0) + 1)
  }
}
const propertyTypes = {}
for (const [key, counts] of [...propertyShapes].sort(([a], [b]) => a < b ? -1 : 1)) {
  const [json] = [...counts].sort((a, b) => b[1] - a[1])[0]
  propertyTypes[key] = JSON.parse(json)
}

const conditionToSchema = clause => {
  const { field, op, value } = clause.if
  if (op !== 'eq') return undefined
  const then = {
    required: clause.required,
    properties: Object.fromEntries(Object.entries(clause.require_values ?? {}).map(([key, v]) => [key, { const: v }])),
  }
  return { if: { required: [field], properties: { [field]: { const: value } } }, then }
}

export function rebuildSchema(record, types) {
  const properties = {}
  for (const key of record.schemaKeys) properties[key] = record.schemaOverrides?.[key] ?? types[key]
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: record.requiredKeys,
    properties,
    allOf: record.conditionalRequired.map(conditionToSchema),
    additionalProperties: true,
  }
}

// ---- 4. 方式・明細・補助量・未確定・ダクト・はつりの表 -------------------------------------
const formulaRows = rowsOf('H4Formulas')
const formulas = {}
for (const row of formulaRows) {
  const id = text(row['方式ID'])
  formulas[id] = {
    id,
    name: text(row['方式名']),
    expression: text(row['式・処理']),
    inputs: text(row['従来の必要入力']),
    caution: text(row['注意・除外']),
    sourceState: text(row['参照実装の状態']),
    contract: parseJsonCell(row['body入力契約JSON'], `数量算定24方式!行${row.__row}`) ?? null,
  }
}
for (const definition of definitions) {
  const formula = definition.source_contract.formula_candidate
  if (!formulas[formula]) conflict(definition.definition_id, 'formula', `算出方式 ${formula} が数量算定24方式にありません`, [`数量算定949対応!行${definition.source_locations.calculation.row}`])
  else if (canonicalJson(formulas[formula].contract) !== canonicalJson(definition.source_contract.input_shape)
    && formulas[formula].contract && definition.source_contract.input_shape) {
    const shapeKeys = Object.keys(definition.source_contract.input_shape).sort().join(',')
    const contractKeys = Object.keys(formulas[formula].contract).sort().join(',')
    const contractStatus = formulas[formula].contract.status
    // 同じキーで値の説明だけが違う（例: input_unit「元単位」）か、停止方式の状態が同じなら、定義側の制約として保持する。
    if (shapeKeys === contractKeys || (contractStatus && contractStatus === definition.source_contract.input_shape.status)) {
      notes.push(`${definition.definition_id}: 入力形状を定義側の制約として保持（方式 ${formula} の契約と説明が異なる）`)
    } else {
      conflict(definition.definition_id, 'inputShape', '定義の入力形状が方式の body 入力契約と一致しません', [`数量算定949対応!行${definition.source_locations.calculation.row}:K`, `数量算定24方式:${formula}`])
    }
  }
}

const detailTemplates = {}
for (const row of rowsOf('ExpandDetailTemplates22')) {
  const id = text(row['形式ID'])
  detailTemplates[id] = {
    id,
    name: text(row['明細の種類']),
    units: splitList(row['単位候補']),
    method: text(row['計測・集計方法']),
    recordFields: splitList(row['明細ごとの必須項目']),
    split: text(row['区分']),
    exclude: text(row['除外']),
    missing: text(row['不足時']),
    schema: parseJsonCell(row['明細schemaJSON'], `詳細数量103定義!行${row.__row}`) ?? null,
    evidence: splitIds(row['根拠ID']),
    definitionCount: Number(row['対応定義数']) || 0,
  }
}
const detailByDefinition = new Map()
for (const row of rowsOf('ExpandDetail103')) {
  const id = text(row['定義ID'])
  const policy = parseJsonCell(row['定義別方針JSON'], `詳細数量103定義!行${row.__row}`)
  const formatId = text(row['明細形式ID']).replace(/^D103:/, '')
  if (!detailTemplates[formatId]) conflict(id, 'detail', `明細形式 ${formatId} が22形式にありません`, [`詳細数量103定義!行${row.__row}`])
  detailByDefinition.set(id, {
    format: formatId,
    scope: text(row['拾う対象・範囲']),
    recordFields: splitList(row['1明細の必須項目']),
    method: text(row['集計・計測の考え方']),
    split: text(row['分けて集計する条件']),
    exclude: text(row['除外・誤用防止']),
    missing: text(row['不足時の扱い']),
    unit: text(row['元単位']),
    schedule: policy?.schedule_schema ?? null,
    row: row.__row,
    id,
  })
}
// 定義別の明細 schema は「形式の schema のプロパティを定義別に上書きしたもの」として持ち、再構成が一致することを確かめる。
export function rebuildSchedule(template, overrides) {
  return { ...template, properties: { ...template.properties, ...overrides } }
}
for (const detail of detailByDefinition.values()) {
  const template = detailTemplates[detail.format]?.schema
  if (!detail.schedule || !template) continue
  const overrides = {}
  for (const [key, shape] of Object.entries(detail.schedule.properties ?? {})) {
    if (canonicalJson(shape) !== canonicalJson(template.properties?.[key])) overrides[key] = shape
  }
  if (canonicalJson(rebuildSchedule(template, overrides)) === canonicalJson(detail.schedule)) {
    detail.scheduleOverrides = overrides
    delete detail.schedule
  } else {
    conflict(detail.id, 'detail.schedule', '定義別の明細 schema を形式の schema から再構成できません', [`詳細数量103定義!行${detail.row}`])
  }
}
for (const [formatId, template] of Object.entries(detailTemplates)) {
  const count = [...detailByDefinition.values()].filter(value => value.format === formatId).length
  if (count !== template.definitionCount) notes.push(`明細形式 ${formatId}: 対応定義数 ${template.definitionCount} に対し実際の定義 ${count}`)
}

const unitMethods = {}
for (const row of rowsOf('Unit19MethodOptions')) {
  const id = text(row['方式ID'])
  const data = parseJsonCell(row['方式データJSON'], `単位方式の選択肢!行${row.__row}`)
  unitMethods[id] = {
    id,
    name: text(row['方式名']),
    unit: text(row['方式の単位']),
    scope: text(row['拾う対象・範囲']),
    calculation: text(row['算定方法']),
    requiredInputs: data?.required_inputs ?? splitList(row['方式固有の必須入力']),
    condition: text(row['適用・選択条件']),
    inclusion: text(row['包含・重複・禁止事項']),
    evidenceKind: text(row['根拠の種類']),
    use: text(row['用途']),
  }
}
const unitMethodBindings = new Map()
for (const row of rowsOf('Unit19MethodBindings')) {
  const id = text(row['定義ID'])
  if (!unitMethodBindings.has(id)) unitMethodBindings.set(id, [])
  unitMethodBindings.get(id).push({ method: text(row['方式ID']), meaning: text(row['対応付けの意味']) })
}
const unresolved = new Map()
for (const row of rowsOf('Unit19Definitions')) {
  const id = text(row['定義ID'])
  const methods = splitIds(row['選択可能な方式ID'])
  for (const method of methods) if (!unitMethods[method]) conflict(id, 'methods', `方式 ${method} が単位方式の選択肢にありません`, [`未確定19定義!行${row.__row}`])
  // 対応表の「案件条件で選択可」が選べる方式。「参照専用」は包含照合の参照として別に持つ。
  const bindings = unitMethodBindings.get(id) ?? []
  const bound = bindings.filter(binding => binding.meaning === '案件条件で選択可').map(binding => binding.method).sort()
  const referenceMethods = bindings.filter(binding => binding.meaning !== '案件条件で選択可').map(binding => binding.method).sort()
  if (JSON.stringify(bound) !== JSON.stringify(methods)) conflict(id, 'methods', '未確定19定義と方式の対応表で方式の集合が一致しません', [`未確定19定義!行${row.__row}`, '単位方式の選択肢!方式の対応'])
  unresolved.set(id, {
    category: text(row['整理区分']),
    methods,
    referenceMethods: referenceMethods.length ? referenceMethods : undefined,
    units: splitList(row['候補単位（合計不可）']),
    target: text(row['拾う対象・起終点']),
    exclusivity: text(row['方式の排他・併用条件']),
    check: text(row['項目固有の確認事項']),
    auxiliary: splitIds(row['参照する補助量ID']).filter(value => value !== '—'),
    dedupe: text(row['工程分解・重複判定']),
    row: row.__row,
  })
}

const auxiliary = new Map()
for (const row of rowsOf('Aux48Definitions')) {
  auxiliary.set(text(row['定義ID']), {
    category: text(row['取扱い分類']),
    scope: text(row['拾う対象・範囲']),
    method: text(row['計測方法・算式']),
    inputs: splitList(row['必須入力']),
    use: text(row['補助量の用途']),
    difference: text(row['正式数量との違い']),
    target: text(row['別計上先・定義ID候補']),
    referCondition: text(row['別定義へ参照する条件']),
    forbidden: text(row['禁止する換算・重複']),
    dedupe: text(row['集計・重複の区分']),
    missing: text(row['不足時の扱い']),
    row: row.__row,
  })
}

const ductRules = rowsOf('Follow3DuctRules').map(row => ({
  id: text(row['規則ID']),
  target: text(row['対象']),
  rule: text(row['計測・算定の規則']),
  data: text(row['必要なデータ']),
  stop: text(row['除外・停止・誤用防止']),
  status: text(row['確認/提案の区分']),
}))
const ducts = new Map()
for (const row of rowsOf('Follow3DuctDefinitions')) {
  ducts.set(text(row['定義ID']), {
    profile: text(row['参照プロファイルID']),
    meaning: text(row['数量の意味']),
    unit: text(row['単位']),
    scope: text(row['拾う対象・範囲']),
    rules: text(row['優先規則']),
    structure: text(row['計算の構造']),
    inputs: splitList(row['追加必須入力/明細参照']),
    split: text(row['積算区分']),
    caution: text(row['連動・重複の注意']),
    remaining: text(row['案件で残る確認']),
    row: row.__row,
  })
}
const hatsuriModes = rowsOf('Follow3HatsuriModes').map(row => ({
  id: text(row['方式ID案']),
  definitionId: text(row['対応元949定義']),
  childId: text(row['提案子定義ID']),
  name: text(row['候補名']),
  unit: text(row['単位']),
  formula: text(row['算式候補']),
  scope: text(row['拾う対象・範囲']),
  method: text(row['算定方法']),
  requiredInputs: splitList(row['必須入力キー']),
  condition: text(row['成立・選択条件']),
  forbidden: text(row['禁止・包含・分担']),
}))
const hatsuriInputs = rowsOf('Follow3HatsuriInputs').map(row => ({
  key: text(row['入力・管理事項']),
  meaning: text(row['意味・拾う範囲']),
  type: text(row['型・単位']),
  missing: text(row['不足時・取り違え防止']),
}))

const ac41 = new Map()
for (const row of rowsOf('AC41Bindings')) {
  const id = text(row['元数量定義ID'])
  ac41.set(id, {
    binding: text(row['対応ID']),
    profile: text(row['条件プロファイルID']),
    classification: text(row['上位分類ID']),
    category: text(row['整理区分']),
    scope: text(row['整理後の数量範囲']),
    lookup: text(row['定義別の照会先']),
    removedKeys: splitIds(row['旧一律必須から除いたキー']),
    row: row.__row,
  })
}

// ---- 5. 範囲（拾う対象）の表 ---------------------------------------------------------------
const scopeProfiles = {}
for (const row of rowsOf('ScopeProfiles')) {
  scopeProfiles[text(row['分類ID'])] = {
    name: text(row['範囲の分類']),
    target: text(row['拾う対象・場所']),
    kind: text(row['面・線・位置の種類']),
    confirm: text(row['範囲を決めるときに確認すること']),
    exclude: text(row['含めない場所・取り違え注意']),
    howTo: text(row['関連元からの拾い直し方']),
    basis: text(row['根拠区分ID']),
  }
}
const scopeOptions = rowsOf('ScopeOptions').map(row => ({
  classId: text(row['対象分類']),
  id: text(row['範囲選択ID']),
  condition: text(row['この範囲を選ぶ条件']),
  range: text(row['数量を求める対象範囲']),
  kind: text(row['形状・位置の種類']),
  unit: text(row['単位']),
  locate: text(row['特定する場所・寸法']),
  exclude: text(row['含めない範囲・注意点']),
  source: text(row['原典の確認箇所']),
}))
for (const option of scopeOptions) {
  if (!scopeProfiles[option.classId]) notes.push(`範囲分岐 ${option.id} の分類 ${option.classId} が47分類にありません`)
}

const rules = {}
for (const row of scopeOriginalRows) {
  const id = text(row['元項目ID'])
  rules[id] = {
    use: text(row['項目の用途']),
    unit: text(row['単位・扱い']),
    originScope: text(row['関連元の拾い範囲']),
    target: text(row['関連先で拾う対象・場所']),
    kind: text(row['面・線・位置の種類']),
    split: text(row['拾う範囲・分け方']),
    exclude: text(row['含めない場所・取り違え注意']),
    difference: text(row['関連元と異なる点・拾い直し']),
    className: text(row['範囲の分類']),
    classId: text(row['分類ID']),
    definitions: splitIds(row['対応する数量定義ID']),
  }
}
if (Object.keys(rules).length !== 916) fail(`拾う対象916元項目が ${Object.keys(rules).length} 件です`)

// 逆方向24ルール（照会のための関係。数量式の反転には使わない）
const reverseRules = rowsOf('Reverse24_1').map(row => ({
  id: text(row['逆方向ルールID']),
  name: text(row['分類名']),
  originKind: text(row['起点の技術種別']),
  targetKind: text(row['探す対象の技術種別']),
  relation: text(row['参照関係コード']),
  operation: text(row['実行する操作']),
  scope: text(row['照会範囲・処理']),
}))

// 採用基準の管理枠（案件で採用を確認するまで有効にしない）
const basisRegistry = rowsOf('AdoptionBasisRegistry').map(row => ({
  id: text(row['資料管理ID（本ブック）']),
  name: text(row['資料の正式名称/管理枠']),
  publisher: text(row['発行主体']),
  version: text(row['確認した版/採用状況']),
  role: text(row['資料の役割']),
  scope: text(row['適用範囲・条件']),
}))
const projectSettings = rowsOf('AdoptionProjectSettings').map(row => ({
  key: text(row['入力キー']),
  meaning: text(row['案件で確定する事項']),
  howTo: text(row['確認方法・留意点']),
}))

// ---- 6. 入力キーの辞書 ---------------------------------------------------------------
const keyLabels = {}
const addKey = (key, entry) => {
  if (!key || keyLabels[key]) return
  keyLabels[key] = entry
}
for (const row of rowsOf('CI__9')) {
  addKey(text(row['入力キー']), {
    type: text(row['型']),
    use: text(row['用途']),
    meaning: text(row['意味・取得する情報']),
    system: text(row['入力/判定の担当']).startsWith('システム'),
  })
}
for (const name of ['AC41Fields', 'Held179Fields', 'Reverse24_2', 'Selection31Inputs']) {
  for (const row of rowsOf(name)) {
    addKey(text(row['入力キー']), { type: text(row['型']), use: name, meaning: text(row['意味・確認対象'] ?? row['意味・取得する情報'] ?? row['意味'] ?? row['意味・入力上の扱い']), system: false })
  }
}

// ---- 7. 定義の圧縮・結合 ---------------------------------------------------------------
const condTable = []
const condIndex = new Map()
const intern = value => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return undefined
  const json = canonicalJson(value)
  if (!condIndex.has(json)) { condIndex.set(json, condTable.length); condTable.push(canonical(value)) }
  return condIndex.get(json)
}
const keyNames = []
const keyNameIndex = new Map()
const keyId = key => {
  if (!keyNameIndex.has(key)) { keyNameIndex.set(key, keyNames.length); keyNames.push(key) }
  return keyNameIndex.get(key)
}
const keysets = []
const keysetIndex = new Map()
const internKeys = keys => {
  const json = JSON.stringify(keys)
  if (!keysetIndex.has(json)) { keysetIndex.set(json, keysets.length); keysets.push(keys.map(keyId)) }
  return keysetIndex.get(json)
}
// 表示用の長い文で2回以上出るものは texts へまとめ、番号で参照する（実行時は masterText で戻す）。
const textCounts = new Map()
const countText = value => {
  if (typeof value === 'string' && value.length >= 12) textCounts.set(value, (textCounts.get(value) ?? 0) + 1)
}
const texts = []
const textIndex = new Map()
const packText = value => {
  if (typeof value !== 'string' || (textCounts.get(value) ?? 0) < 2) return value
  if (!textIndex.has(value)) { textIndex.set(value, texts.length); texts.push(value) }
  return textIndex.get(value)
}
// 識別子・単位は番号化しない（表示用の文だけをまとめる）
const IDENTIFIER_KEYS = new Set(['id', 'format', 'unit', 'classId', 'category'])
const packTexts = object => object && Object.fromEntries(Object.entries(object).map(([key, value]) =>
  [key, IDENTIFIER_KEYS.has(key) ? value : packText(value)]))

const usedKeys = new Set()
const collectFields = value => {
  if (Array.isArray(value)) { value.forEach(collectFields); return }
  if (value && typeof value === 'object') {
    if (typeof value.field === 'string') usedKeys.add(value.field)
    if (Array.isArray(value.required)) value.required.forEach(key => typeof key === 'string' && usedKeys.add(key))
    Object.values(value).forEach(collectFields)
  }
}

// 段階条件: 数量段階の required / conditional_required は定義の必須入力と同じもの（上で照合済み）なので持たない。
// auto_enable / export_enabled はすべて false（冒頭で照合済み）なので持たない。残りを部分ごとに共有表へ入れる。
const packStages = (id, contract) => {
  const stage = contract.stage_conditions
  const result = {}
  for (const [key, value] of Object.entries(stage)) {
    if (key === 'auto_enable' || key === 'export_enabled') continue
    if (key === 'quantity' && value && typeof value === 'object') {
      const { required, conditional_required: conditionalRequired, ...rest } = value
      if (canonicalJson(conditionalRequired) !== canonicalJson(contract.conditional_required)) {
        result.quantityConditionalRequired = intern(conditionalRequired)
      }
      if (required && required.some(keyName => !contract.required_keys.includes(keyName))) result.quantityRequired = internKeys(required)
      result.quantity = intern(rest)
      continue
    }
    result[key] = typeof value === 'object' && value !== null ? intern(value) : value
  }
  return result
}

const masterDefinitions = []
let schemaMismatch = 0
for (const definition of definitions) {
  const id = definition.definition_id
  const contract = definition.input_contract
  const scopeRow = scopeDefinitionRows.get(id) ?? {}
  const reviewCells = definition.scope_review_snapshot.cells
  const reverseCells = definition.reverse_binding_snapshot.cells
  const continuationCells = definition.continuation_snapshot.cells
  const reverse = parseJsonCell(reverseCells.S, `逆方向949対応!行${definition.reverse_binding_snapshot.row}:S`) ?? {}
  const continuation = parseJsonCell(continuationCells.J, `全949件_連続生成!行${definition.continuation_snapshot.row}:J`) ?? {}

  const stagePatches = []
  // R 列（必須キー一覧）と Y 列（入力型スキーマの required）の一致
  if (JSON.stringify(contract.required_keys) !== JSON.stringify(contract.json_schema.required)) {
    conflict(id, 'requiredKeys', '必須キー一覧と入力型スキーマの required が一致しません', [`定義949行_必須入力!行${definition.source_locations.inputs.row}:R`, `定義949行_必須入力!行${definition.source_locations.inputs.row}:Y`])
  }
  // 段階条件の quantity.required / conditional_required が定義の必須入力と一致するか（不一致は保持して記録）
  const quantityStage = contract.stage_conditions.quantity
  if (quantityStage && typeof quantityStage === 'object') {
    const stageRequired = quantityStage.required ?? []
    const missingFromDefinition = stageRequired.filter(key => !contract.required_keys.includes(key))
    const addedByDefinition = contract.required_keys.filter(key => !stageRequired.includes(key))
    if (missingFromDefinition.length) {
      conflict(id, 'stage.quantity.required', `数量段階の必須キーが定義の必須キーにありません: ${missingFromDefinition.join(', ')}`, [`定義949行_必須入力!行${definition.source_locations.inputs.row}`])
    } else if (addedByDefinition.length) {
      // 後段のシート（詳細数量・ダクト・型枠等）で定義の必須キーへ追加されたもの。数量段階は定義の必須キー（上位集合）で判定する。
      stagePatches.push({ property: 'stage.quantity.required', added: addedByDefinition, cell: `定義949行_必須入力!行${definition.source_locations.inputs.row}:R` })
    }
    if (canonicalJson(quantityStage.conditional_required) !== canonicalJson(contract.conditional_required)) {
      conflict(id, 'stage.quantity.conditional_required', '数量段階の条件付き必須が定義の条件付き必須と一致しません', [`定義949行_必須入力!行${definition.source_locations.inputs.row}`])
    }
  }
  // 整理後163対応で旧一律必須から除いたキーを、必須へ戻していないこと（CC26-31）
  const ac = ac41.get(id)
  if (ac) {
    const revived = ac.removedKeys.filter(key => contract.required_keys.includes(key))
    if (revived.length) conflict(id, 'requiredKeys', `整理後163対応で除いた旧一律必須キーが必須に残っています: ${revived.join(', ')}`, [`整理後163対応!行${ac.row}`])
  }

  // JSON Schema の上書き（共通の型表と異なるプロパティだけ）
  const schemaKeys = Object.keys(contract.json_schema.properties)
  const schemaOverrides = {}
  for (const key of schemaKeys) {
    const shape = contract.json_schema.properties[key]
    if (canonicalJson(shape) !== canonicalJson(propertyTypes[key])) schemaOverrides[key] = canonical(shape)
  }
  const record = {
    requiredKeys: contract.required_keys,
    conditionalRequired: contract.conditional_required,
    schemaKeys,
    schemaOverrides,
  }
  const rebuilt = rebuildSchema(record, propertyTypes)
  if (canonicalJson(rebuilt) !== canonicalJson(contract.json_schema)) {
    schemaMismatch++
    conflict(id, 'jsonSchema', '入力型スキーマを共通の型表と条件付き必須から再構成できません', [`定義949行_必須入力!行${definition.source_locations.inputs.row}:Y`])
  }

  collectFields(contract.required_keys.map(key => ({ field: key })))
  collectFields(contract.conditional_required)
  collectFields(contract.stage_conditions)
  collectFields(contract.condition_ast)

  // 範囲の再検証（訂正の元値と適用後の値を履歴として残す。上書きの勝敗は付けない）
  const patches = [...stagePatches]
  if (text(reviewCells.D) !== text(reviewCells.E)) {
    patches.push({ property: 'scope.classId', from: text(reviewCells.D), to: text(reviewCells.E), cell: `949定義の再検証!行${definition.scope_review_snapshot.row}:D→E` })
  }
  const scopeClass = text(scopeRow['分類ID'])
  if (scopeClass && text(reviewCells.E) && scopeClass !== text(reviewCells.E)) {
    conflict(id, 'scope.classId', `拾う対象949定義の分類 ${scopeClass} と再検証後の分類 ${text(reviewCells.E)} が一致しません`, [`拾う対象949定義!行${scopeRow.__row}`, `949定義の再検証!行${definition.scope_review_snapshot.row}:E`])
  }
  if (text(scopeRow['元単位']) !== text(definition.original_unit)) {
    conflict(id, 'unit', `拾う対象949定義の元単位 ${text(scopeRow['元単位'])} と定義の元単位 ${definition.original_unit} が一致しません`, [`拾う対象949定義!行${scopeRow.__row}`])
  }

  const policyRefs = definition.price_allocation_policy.source_policy_refs
  const entry = {
    id,
    trade: definition.trade,
    label: definition.label,
    unit: definition.original_unit,
    role: definition.implementation_role,
    state: definition.source_execution_state,
    quantityRole: definition.source_quantity_role,
    formula: definition.source_contract.formula_candidate,
    shape: definition.source_contract.input_shape,
    scopeText: definition.current_scope_text,
    item: definition.proposed_item_id,
    rules: ruleMapping.get(id) ?? [],
    scope: {
      target: text(scopeRow['実際に拾う対象・場所']),
      kind: text(scopeRow['面・線・位置の種類']),
      split: text(scopeRow['拾う範囲・分け方']),
      exclude: text(scopeRow['含めない場所・取り違え注意']),
      difference: text(scopeRow['関連元と異なる点・拾い直し']),
      origin: text(scopeRow['関連元の項目']),
      className: text(scopeRow['範囲の分類']),
      classId: scopeClass || text(reviewCells.E),
      confirm: text(scopeRow['確定に必要な確認']),
      keptExclude: text(scopeRow['元定義の除外（保持）']),
    },
    review: {
      status: text(reviewCells.H),
      checks: text(reviewCells.K),
      mistakes: text(reviewCells.M),
      project: text(reviewCells.O),
      place: text(reviewCells.T),
    },
    requiredKeys: internKeys(contract.required_keys),
    conditionalRequired: intern(contract.conditional_required),
    conditionAst: intern(contract.condition_ast),
    stages: packStages(id, contract),
    schemaKeys: internKeys(schemaKeys),
    schemaOverrides: Object.keys(schemaOverrides).length ? schemaOverrides : undefined,
    checks: contract.specific_checks.map(check => ({ id: check.check_id, text: check.text, effect: check.effect })),
    continuation: {
      policy: text(continuationCells.F),
      reason: text(continuationCells.G),
      nextRules: continuation.next_rule_candidates ?? splitIds(continuationCells.I),
      catalogKeyCount: (continuation.catalog_candidate_keys ?? []).length,
    },
    reverse: {
      status: text(reverseCells.M),
      rootRules: reverse.root_rule_candidates ?? [],
      candidateRules: reverse.candidate_rule_candidates ?? [],
      contextRules: reverse.context_only_rules ?? [],
      children: reverse.selection_children ?? [],
    },
    price: {
      family: definition.price_allocation_policy.reference_family,
      gate: definition.price_allocation_policy.gate,
      allocationRequired: definition.price_allocation_policy.allocation_required,
    },
    policies: {
      auxiliary: policyRefs.auxiliary_policy ? true : undefined,
      unitMethod: policyRefs.unit_method_policy ? true : undefined,
      detail: policyRefs.detailed_profile ? true : undefined,
    },
    detail: detailByDefinition.get(id),
    unresolved: unresolved.get(id),
    auxiliary: auxiliary.get(id),
    duct: ducts.get(id),
    hatsuri: hatsuriModes.filter(mode => mode.definitionId === id).map(mode => mode.id),
    ac41: ac ? { profile: ac.profile, classification: ac.classification, removedKeys: ac.removedKeys } : undefined,
    patches: patches.length ? patches : undefined,
    source: {
      calculation: definition.source_locations.calculation.row,
      inputs: definition.source_locations.inputs.row,
      review: definition.source_locations.scope_review.row,
      price: definition.source_locations.price_allocation.row,
      scope: scopeRow.__row,
    },
  }
  if (!entry.hatsuri.length) delete entry.hatsuri

  // 方針の参照と実データの対応（親・補助・未確定・明細の役割を保持していること）
  if (entry.policies.detail && !entry.detail) conflict(id, 'detail', '単価分担949照合で明細方針の参照があるが詳細数量103定義に行がありません', [`単価分担949照合!行${entry.source.price}`])
  if (entry.policies.unitMethod && !entry.unresolved) conflict(id, 'unresolved', '方式未確定の参照があるが未確定19定義に行がありません', [`単価分担949照合!行${entry.source.price}`])
  if (entry.policies.auxiliary && !entry.auxiliary) conflict(id, 'auxiliary', '補助量の参照があるが補助量48定義に行がありません', [`単価分担949照合!行${entry.source.price}`])
  if (entry.role === '未確定方式' && !entry.unresolved) conflict(id, 'unresolved', '方式未確定の役割だが方式の選択肢がありません', [])

  masterDefinitions.push(JSON.parse(JSON.stringify(entry)))
}

for (const definition of masterDefinitions) {
  for (const part of [definition.scope, definition.review, definition.price, definition.detail, definition.auxiliary, definition.unresolved, definition.duct]) {
    if (part) Object.values(part).forEach(countText)
  }
  definition.checks.forEach(check => countText(check.text))
  countText(definition.scopeText); countText(definition.continuation.reason)
}
for (const definition of masterDefinitions) {
  for (const name of ['scope', 'review', 'price', 'detail', 'auxiliary', 'unresolved', 'duct']) {
    if (definition[name]) definition[name] = packTexts(definition[name])
  }
  definition.checks = definition.checks.map(check => ({ ...check, text: packText(check.text) }))
  definition.scopeText = packText(definition.scopeText)
  definition.continuation.reason = packText(definition.continuation.reason)
}
// 既存ルールの拾う対象（候補カードで使う軽いデータ）は別ファイルにし、独自の texts を持つ。
const ruleTextCounts = new Map()
for (const rule of Object.values(rules)) {
  for (const value of Object.values(rule)) {
    if (typeof value === 'string' && value.length >= 12) ruleTextCounts.set(value, (ruleTextCounts.get(value) ?? 0) + 1)
  }
}
const ruleTexts = []
const ruleTextIndex = new Map()
const packRuleText = value => {
  if (typeof value !== 'string' || (ruleTextCounts.get(value) ?? 0) < 2) return value
  if (!ruleTextIndex.has(value)) { ruleTextIndex.set(value, ruleTexts.length); ruleTexts.push(value) }
  return ruleTextIndex.get(value)
}
const packedRules = Object.fromEntries(Object.entries(rules).map(([id, rule]) =>
  [id, Object.fromEntries(Object.entries(rule).map(([key, value]) =>
    [key, IDENTIFIER_KEYS.has(key) ? value : packRuleText(value)]))]))

// 辞書に無いキーは、後段のシートで定義の必須キーへ追加されたもの。追加元のシートを説明に付ける（derived: true）。
for (const definition of masterDefinitions) {
  for (const patch of definition.patches ?? []) {
    if (patch.property !== 'stage.quantity.required') continue
    const origin = definition.duct ? 'ダクト13定義の積算規則' : definition.hatsuri ? '貫通口はつりの方式分岐'
      : definition.detail ? '詳細数量103定義' : '949定義の再検証'
    for (const key of patch.added) {
      if (!keyLabels[key]) keyLabels[key] = { type: 'string', use: 'definition', meaning: `${origin}で追加された入力（${key}）`, system: false, derived: true }
    }
  }
}
const missingKeyLabels = [...usedKeys].filter(key => !keyLabels[key]).sort()
const keyLabelsUsed = Object.fromEntries([...usedKeys].sort().filter(key => keyLabels[key]).map(key => [key, keyLabels[key]]))
const usedPropertyTypes = propertyTypes

// ---- 8. 出力 -------------------------------------------------------------------------------
const master = {
  format: 'karu-takeoff-master-1',
  masterVersion: `v${manifest.source_library_version}-${manifest.source_sha256.slice(0, 12)}`,
  sourceSha256: manifest.source_sha256,
  sourceLibraryVersion: manifest.source_library_version,
  counts: {
    definitions: masterDefinitions.length,
    rules: Object.keys(rules).length,
    executionStates: manifest.execution_states,
    implementationRoles: manifest.implementation_roles,
  },
  keyNames,
  keysets,
  conditions: condTable,
  texts,
  propertyTypes: usedPropertyTypes,
  keyLabels: keyLabelsUsed,
  formulas,
  detailTemplates,
  unitMethods,
  ductRules,
  hatsuriModes,
  hatsuriInputs,
  reverseRules,
  basisRegistry,
  projectSettings,
  definitions: masterDefinitions,
}
const ruleScopes = {
  format: 'karu-takeoff-rule-scopes-1',
  masterVersion: master.masterVersion,
  sourceSha256: manifest.source_sha256,
  texts: ruleTexts,
  scopeProfiles,
  scopeOptions,
  rules: packedRules,
  // 候補カードで本体（949定義）を読まずに出す見出し
  definitionHeads: Object.fromEntries(masterDefinitions.map(definition => [definition.id, {
    label: definition.label,
    unit: definition.unit,
    role: definition.role,
    classId: definition.scope.classId,
  }])),
}

const conflictIds = [...new Set(conflicts.map(entry => entry.definitionId).filter(Boolean))]
master.conflicts = conflicts
  .filter(entry => entry.definitionId)
  .map(entry => ({ definitionId: entry.definitionId, property: entry.property, reason: entry.reason, cells: entry.cells }))

mkdirSync(path.dirname(outData), { recursive: true })
writeFileSync(outData, dataModule('TakeoffMaster', master))
writeFileSync(outRules, dataModule('TakeoffRuleScopes', ruleScopes))
// ---- 9. 受入仕様の fixture（試験用。値は原本の TEST 値。実案件・実図面の情報は含めない） -------------
// 原本の NOT_RUN は「未実施」のまま渡す。試験で実行した結果だけを合否として記録する。
const outFixtures = path.join(repoRoot, 'tests', 'fixtures', 'takeoff', 'acceptance.json')
const detailExamples = rowsOf('ExpandDetailExamples46').map(row => {
  const data = parseJsonCell(row['入力・期待結果JSON'], `明細の計算例!行${row.__row}`) ?? {}
  const values = data.variables_I_to_L ?? {}
  const names = data.variable_names_I_to_L ?? {}
  return {
    caseId: text(row['ケースID']),
    format: text(row['明細形式']),
    kind: text(row['種別']),
    unit: text(row['単位']),
    variables: Object.fromEntries(Object.entries(names).map(([letter, name]) => [name, values[letter]])),
    expectedQuantity: data.quantity_expected ?? data.expected_quantity ?? null,
    expectedState: data.expected_state ?? data.state ?? null,
    missing: data.missing ?? null,
    calculation: text(row['検算式']),
    sourceStatus: text(row['実機実施']) || 'NOT_RUN',
  }
})
const methodCases = rowsOf('MethodInputAcceptanceCases').map(row => {
  const data = parseJsonCell(row['入力・期待結果データJSON'], `方式別入力と受入!行${row.__row}`) ?? {}
  return {
    caseId: text(row['ケースID']),
    methodId: text(row['方式ID']),
    definitionIds: data.definition_ids ?? splitIds(row['対応する定義ID']),
    kind: text(row['ケース種別']),
    goal: text(row['試験の目的']),
    input: data.input ?? {},
    variables: data.variables ?? [],
    values: data.values ?? [],
    calc: data.calc ?? null,
    expectedQuantity: data.expected_quantity ?? null,
    expectedUnit: data.expected_unit ?? '',
    expectedState: data.expected_state ?? null,
    stopReason: text(row['停止理由・確認事項']),
    sourceStatus: text(row['実施記録']) || 'NOT_RUN',
  }
})
const additionalCases = readJson(path.join(packDir, 'data', 'additional_acceptance_cases.json')).cases
mkdirSync(path.dirname(outFixtures), { recursive: true })
writeFileSync(outFixtures, JSON.stringify({
  format: 'karu-takeoff-acceptance-1',
  masterVersion: master.masterVersion,
  note: '原本の受入仕様から抽出した試験用の入力と期待。値は架空の TEST 値で、実規格・採用値ではない。原本の実施状態は NOT_RUN。',
  detailExamples,
  methodCases,
  additionalCases,
}, null, 1) + '\n')

mkdirSync(path.dirname(outDiag), { recursive: true })
const diagnostics = {
  createdBy: 'scripts/takeoff/build-master.mjs',
  sourceWorkbook: manifest.source_workbook,
  sourceSha256: manifest.source_sha256,
  sheets: sheetCount,
  tables: tablesSnapshot.tables.length,
  definitions: masterDefinitions.length,
  uniqueIds: true,
  allSourceFlagsFalse: true,
  schemaRebuilt: masterDefinitions.length - schemaMismatch,
  ruleMappings: { definitionsWithRules: masterDefinitions.filter(d => d.rules.length).length, rulesWithDefinitions: Object.values(rules).filter(r => r.definitions.length).length },
  keys: { used: usedKeys.size, labelled: Object.keys(keyLabelsUsed).length, missingLabels: missingKeyLabels },
  conflictDefinitions: conflictIds.length,
  conflicts,
  notes,
  outputBytes: Buffer.byteLength(JSON.stringify(master)),
  ruleScopeBytes: Buffer.byteLength(JSON.stringify(ruleScopes)),
}
writeFileSync(outDiag, JSON.stringify(diagnostics, null, 2) + '\n')
console.log(`定義 ${masterDefinitions.length} / ルール ${Object.keys(rules).length} / スキーマ再構成 ${diagnostics.schemaRebuilt} / 競合定義 ${conflictIds.length} / 競合 ${conflicts.length} / キー ${usedKeys.size}（表示名なし ${missingKeyLabels.length}） / 本体 ${diagnostics.outputBytes} bytes / 拾う対象 ${diagnostics.ruleScopeBytes} bytes`)
