import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  catalogItems,
  catalogPresets,
  type CatalogItem,
} from '../src/core/catalog'
import {
  type CountFixture,
  type QuantityKind,
  type QuantityMethod,
} from '../src/core/countFixtures'
import type { FixtureLink } from '../src/core/fixtureLink'
import { fixtureFromPreset } from '../src/core/quantityMaster'
import { RELATED_RULES } from '../src/core/related/rules'
import type { RelatedRule } from '../src/core/related/types'
import masterData from '../src/core/takeoff/master.data'
import ruleScopesData from '../src/core/takeoff/ruleScopes.data'
import type {
  RuleScope,
  TakeoffMaster,
  TakeoffRuleScopes,
} from '../src/core/takeoff/types'
import { relatedAdditionKind } from '../src/editor/AnnotationStore'
import {
  auditRelatedLinks,
  auditSummary,
  auditToCsv,
  type AuditRow,
  type RelatedLinkAuditInput,
} from '../src/app/relatedLinkAudit'
import {
  relatedOriginMatches,
  scopePlanForRules,
} from '../src/app/relatedLinkRules'

const master = masterData as unknown as TakeoffMaster
const scopes = ruleScopesData as unknown as TakeoffRuleScopes
type Plan = RelatedLinkAuditInput['plan']

const style: CountFixture['style'] = {
  shape: 'circle',
  fill: 'none',
  color: [1, 0, 0],
  size: 10,
  opacity: 1,
  showCode: true,
}

function fixture(
  id: string,
  name: string,
  method: QuantityMethod = 'click',
  kind?: QuantityKind,
  category = '試験分類',
): CountFixture {
  const inferred: QuantityKind = method === 'click' ? 'count'
    : method === 'polyline' ? 'length'
      : method === 'polygon' || method === 'lengthHeight' ? 'area'
        : 'volume'
  return {
    id, name, method, kind: kind ?? inferred,
    code: '', category, style, order: 0,
  }
}

const wall = fixture('wall', '壁下地', 'polygon')
const wallLine = fixture('wall-line', '壁下地', 'polyline')
const floor = fixture('floor', '床仕上げ', 'polygon')
const ceiling = fixture('ceiling', '天井仕上げ', 'polygon')
const roof = fixture('roof', '屋根防水', 'polygon')
const pipe = fixture('pipe', '配管', 'polyline')
const duct = fixture('duct', 'ダクト', 'polyline')
const equipment = fixture('equipment', '照明器具')
const box = fixture('box', '器具用ボックス')
const paper = fixture('paper', '壁紙張り', 'polygon')
const mark = fixture('mark', '墨出し', 'polygon')
const edge = fixture('edge', '施工辺', 'polyline')
const area = fixture('area', '配管塗装', 'polygon')
const sameFaceSource = '元施工面のうち同一部位・同一面側の対象範囲だけ'
const wallSource = '壁の対象面側ごとに施工線長×対象高さ。開口を適用規則で処理'

function catalogItemFor(
  value: CountFixture,
  options: readonly unknown[] = [],
): CatalogItem {
  return {
    field: '建築',
    category: value.category,
    name: value.name,
    options,
  } as unknown as CatalogItem
}

function ruleFor(
  id: string,
  origin: CountFixture,
  target: CountFixture,
): RelatedRule {
  return {
    id,
    book: '建築',
    group: '試験',
    originText: origin.name,
    targetText: target.name,
    modes: ['改修', '新築'],
    question: '試験',
    kindText: '拾い候補',
    kind: 'item',
    priority: '高',
    origin: {
      any: [{ names: [origin.name], categories: [origin.category] }],
    },
    targets: [{ category: target.category, name: target.name }],
    note: '',
    refs: [],
  }
}

function scopeFor(classId: string, source: string): RuleScope {
  return {
    use: '工事項目',
    unit: '㎡',
    originScope: '起点の範囲',
    target: `対象の実施工範囲。元指定：${source}`,
    kind: '面・線・位置',
    split: '範囲を分ける',
    exclude: '除外範囲',
    difference: '独立範囲を確認',
    className: classId,
    classId,
    definitions: [],
  }
}

interface TableCase {
  title: string
  id: string
  classId: string
  source: string
  origin: CountFixture
  target: CountFixture
  actual: string
  negativeOrigin?: CountFixture
}

function inspect(
  entry: TableCase,
  override?: Plan,
  mode: '改修' | '新築' = '改修',
): AuditRow {
  const rule = ruleFor(entry.id, entry.origin, entry.target)
  const localScopes: TakeoffRuleScopes = {
    ...scopes,
    rules: { [rule.id]: scopeFor(entry.classId, entry.source) },
  }
  const rows = auditRelatedLinks({
    rules: [rule],
    scopes: localScopes,
    master,
    catalogItems: [
      catalogItemFor(entry.origin),
      catalogItemFor(entry.target),
    ],
    toFixture: item => item.name === entry.origin.name
      ? { ...entry.origin } : { ...entry.target },
    plan: override ?? ((ids, origin, target, projectMode) =>
      scopePlanForRules(ids, localScopes, origin, target, {
        originMatch: relatedOriginMatches(ids, [rule]),
        projectMode: projectMode === '新築' ? '新築' : '改修',
      })),
    existingKind: relatedAdditionKind,
  })
  const row = rows.find(value => value.originItem.endsWith(`／${mode}`))
  if (!row) throw new Error('点検行がありません')
  return row
}

const table: readonly TableCase[] = [
  {
    title: 'RECORD', id: 'RECORD-TEST', classId: 'RECORD',
    source: '確認対象：器具。承認前に数量は生成しない',
    origin: equipment, target: box, actual: 'NONE',
  },
  {
    title: 'BRANCH通常', id: 'E-010', classId: 'BRANCH',
    source: '対象工事を部材・用途・工程・単位別の子へ分ける',
    origin: equipment, target: box, actual: 'NONE',
  },
  ...['M-043', 'M-090', 'M-104'].map(id => ({
    title: `BRANCH ${id}`, id, classId: 'BRANCH',
    source: '対象区間を子の定義 F_SUBSET m で拾う',
    origin: pipe, target: edge, actual: 'route',
    negativeOrigin: equipment,
  })),
  {
    title: 'BRANCH床外周', id: 'B-170', classId: 'BRANCH',
    source: '子の定義 F_EDGE m',
    origin: floor, target: edge, actual: 'shape:perimeter',
    negativeOrigin: wall,
  },
  {
    title: 'DETAIL型枠運搬', id: 'B-043', classId: 'DETAIL',
    source: '設計詳細に基づく対象部材・接触面・構成鋼材等を独立計測',
    origin: wall, target: fixture('target', '型枠運搬', 'polygon'),
    actual: 'rc:formwork',
  },
  {
    title: 'DETAILその他', id: 'B-029', classId: 'DETAIL',
    source: '設計詳細に基づく対象部材・接触面・構成鋼材等を独立計測',
    origin: wall, target: paper, actual: 'NONE',
  },
  {
    title: 'CONTACT型枠', id: 'B-037', classId: 'CONTACT',
    source: '型枠の実接触面・部材別',
    origin: wall,
    target: fixture('target', '普通合板型枠（地上軸部）', 'polygon'),
    actual: 'rc:formwork',
  },
  ...['B-038', 'B-044', 'B-045'].map(id => ({
    title: `MATERIAL ${id}`, id, classId: 'MATERIAL',
    source: id === 'B-038' ? '構造配筋の径・長さ・継手' : '同一配筋範囲の設計数量',
    origin: wall, target: fixture('target', '異形鉄筋'), actual: 'rc:rebar',
  })),
  {
    title: 'WASTE標準細目', id: 'B-031', classId: 'WASTE',
    source: '撤去対象材を廃棄物源ID・材種・層別に計測し工程ごとに参照',
    origin: wall, target: fixture('target', '発生材運搬'), actual: 'mass',
  },
  {
    title: 'WASTEその他', id: 'B-031', classId: 'WASTE',
    source: '撤去対象材を廃棄物源ID・材種・層別に計測し工程ごとに参照',
    origin: wall, target: paper, actual: 'NONE',
  },
  ...['E-003', 'E-015', 'E-024'].map(id => ({
    title: `OPENING共有開口 ${id}`, id, classId: 'OPENING',
    source: '同一開口に複数回路が通っても開口1件',
    origin: pipe, target: box, actual: 'NONE',
  })),
  ...['M-055', 'M-103'].map(id => ({
    title: `OPENING交差 ${id}`, id, classId: 'OPENING',
    source: '壁床・開口・工法で個別',
    origin: pipe, target: box, actual: 'crossing',
  })),
  {
    title: 'OPENING建具枠辺', id: 'A-door-18', classId: 'OPENING',
    source: '建具詳細の対象枠辺。内外・上端/縦辺/下端を明示',
    origin: equipment, target: edge, actual: 'NONE',
  },
  {
    title: 'SURFACE鉄骨塗装', id: 'B-054', classId: 'SURFACE',
    source: '鋼材断面と長さ・塗装対象面',
    origin: wall, target: paper, actual: 'steel:paint',
  },
  {
    title: 'SURFACE耐火被覆', id: 'B-055', classId: 'SURFACE',
    source: '被覆工法・厚さの中心の寸法に基づく対象面積',
    origin: wall, target: paper, actual: 'steel:fireproof',
  },
  {
    title: 'SURFACE建具', id: 'A-door-27', classId: 'SURFACE',
    source: '対象現物の施工対象面。形状・内外寸・接続面を区別',
    origin: wall, target: paper, actual: 'NONE',
  },
  ...['A-ceiling-01', 'A-wall-01', 'A-floor-01'].map(id => ({
    title: `MARK ${id}`, id, classId: 'MARK',
    source: '仮設/施工計画ごとの工区・範囲・期間。共用部分は一回',
    origin: wall, target: mark, actual: 'shape:lengthTimesHeight',
    negativeOrigin: floor,
  })),
  {
    title: 'MARK屋根', id: 'A-roof-waterproof-05', classId: 'MARK',
    source: '仮設/施工計画ごとの工区・範囲・期間。共用部分は一回',
    origin: roof, target: mark, actual: 'NONE',
  },
  ...['E-020', 'M-010', 'M-011'].map(id => ({
    title: `FILTER_ROUTE ${id}`, id, classId: 'FILTER_ROUTE',
    source: '塗装・保温する対象区間だけ',
    origin: pipe, target: area, actual: 'factor(outerCircumference)',
    negativeOrigin: equipment,
  })),
  {
    title: 'FILTER_ROUTEダクト', id: 'M-010', classId: 'FILTER_ROUTE',
    source: '保温対象区間を管種・径・厚さ・部位別',
    origin: duct, target: area, actual: 'route',
    negativeOrigin: equipment,
  },
  ...[
    ['E-001', 'ROUTE'], ['E-002', 'UNIQUE_ROUTE'], ['E-121', 'ROUTE'],
  ].map(([id, classId]) => ({
    title: `経路 ${id}`, id: id!, classId: classId!,
    source: '用途・径別の実経路',
    origin: pipe, target: edge, actual: 'route',
    negativeOrigin: equipment,
  })),
  ...['E-033', 'E-070', 'M-028', 'M-039'].map(id => ({
    title: `機器起点経路 ${id}`, id, classId: 'ROUTE',
    source: '各系統の実経路・断面別',
    origin: equipment, target: edge, actual: 'NONE',
  })),
  {
    title: 'ENDPOINT', id: 'E-009', classId: 'ENDPOINT',
    source: '実際の接続端点',
    origin: pipe, target: box, actual: 'point',
    negativeOrigin: equipment,
  },
  ...['E-034', 'E-039', 'M-013', 'B-028'].map(id => ({
    title: `PER_ORIGIN ${id}`, id, classId: 'POINT',
    source: '起点1つに対象の現物が1つ',
    origin: equipment, target: box, actual: 'component',
    negativeOrigin: pipe,
  })),
  {
    title: 'POINT独立', id: 'M-019', classId: 'POINT',
    source: '図面・機器表・詳細図の対象現物ごとに1回',
    origin: equipment, target: box, actual: 'NONE',
  },
  ...['B-111', 'A-wall-21', 'A-floor-29'].map(id => ({
    title: `BASEBOARD ${id}`, id, classId: 'BASEBOARD',
    source: '元部位に対応する施工辺・目地線・端末線を個別選択',
    origin: wall, target: edge, actual: 'shape:baseLength',
    negativeOrigin: equipment,
  })),
  {
    title: 'BASEBOARD独立線', id: 'A-floor-18', classId: 'BASEBOARD',
    source: '詳細図に示す対象線を別途拾う',
    origin: floor, target: edge, actual: 'NONE',
  },
  ...['B-134', 'A-ceiling-19'].map(id => ({
    title: `JOINT廻り縁 ${id}`, id, classId: 'JOINT',
    source: '元部位に対応する施工辺・目地線・端末線を個別選択',
    origin: ceiling, target: edge, actual: 'shape:perimeter',
    negativeOrigin: wall,
  })),
  {
    title: 'JOINT独立線', id: 'B-080', classId: 'JOINT',
    source: '図示目地線・開口周囲の指定辺',
    origin: floor, target: edge, actual: 'NONE',
  },
  {
    title: 'CORNER', id: 'A-wall-19', classId: 'CORNER',
    source: '元部位に対応する施工辺・目地線・端末線を個別選択',
    origin: wall, target: edge, actual: 'NONE',
  },
  {
    title: 'UPSTAND', id: 'A-roof-waterproof-27', classId: 'UPSTAND',
    source: '立上りを施工する辺と高さを区間別に指定',
    origin: roof, target: area, actual: 'shape:lengthTimesHeight',
    negativeOrigin: equipment,
  },
  {
    title: 'BACKFILL', id: 'B-018', classId: 'BACKFILL',
    source: '同じ掘削体の控除対象を確定',
    origin: floor, target: paper, actual: 'NONE',
  },
  ...[
    ['AREA', 'A-floor-26', floor, fixture('target', '床下地', 'polygon')],
    ['FLOOR', 'A-floor-25', floor, fixture('target', '床仕上げ下地', 'polygon')],
    ['CEILING_FINISH', 'A-ceiling-23', ceiling, fixture('target', '天井塗装', 'polygon')],
    ['ROOF', 'A-roof-waterproof-23', roof, fixture('target', '屋根下地', 'polygon')],
    ['WALL_FINISH', 'B-083', wall, paper],
  ].map(([classId, id, origin, target]) => ({
    title: `SAME_FACE ${String(classId)}`,
    classId: classId as string, id: id as string,
    source: sameFaceSource,
    origin: origin as CountFixture, target: target as CountFixture,
    actual: 'factor(area)', negativeOrigin: equipment,
  })),
  {
    title: 'FLOOR表面仕上げ', id: 'B-118', classId: 'FLOOR',
    source: '表面仕上げ対象面',
    origin: floor, target: fixture('target', '床塗装', 'polygon'),
    actual: 'factor(area)', negativeOrigin: equipment,
  },
  ...['WALL_FINISH', 'FIRE_ASSEMBLY'].map(classId => ({
    title: `壁の施工線 ${classId}`,
    id: classId === 'FIRE_ASSEMBLY' ? 'A-wall-25' : 'A-wall-22',
    classId, source: wallSource,
    origin: wallLine, target: paper, actual: 'shape:lengthTimesHeight',
    negativeOrigin: pipe,
  })),
  {
    title: 'AREAガラス', id: 'B-096', classId: 'AREA',
    source: '建具内ガラスの実寸法',
    origin: equipment, target: area, actual: 'NONE',
  },
  {
    title: 'AREAフィルム', id: 'B-104', classId: 'AREA',
    source: 'フィルム施工面だけ',
    origin: floor, target: fixture('target', '床フィルム', 'polygon'),
    actual: 'NONE',
  },
  ...[
    ['FLOOR', 'B-017'],
    ['ROOF', 'A-roof-waterproof-08'],
    ['AREA', 'A-interior-units-19'],
    ['WALL_FINISH', 'B-149'],
    ['CEILING_FRAME', 'A-ceiling-15'],
    ['WALL_FRAME', 'B-122'],
  ].map(([classId, id]) => ({
    title: `独立施工面 ${classId}`,
    classId: classId!, id: id!,
    source: '対象工事独自の施工面を別途拾う',
    origin: wall, target: paper, actual: 'NONE',
  })),
  {
    title: '未定義の分類・元指定', id: 'UNKNOWN', classId: 'UNKNOWN',
    source: '未定義の範囲',
    origin: equipment, target: box, actual: 'NONE',
  },
]

function inspectSourceSelection(
  origin: CountFixture,
  otherOrigins: readonly CountFixture[],
  override?: Plan,
): AuditRow[] {
  const origins = [origin, ...otherOrigins]
  const rule: RelatedRule = {
    ...ruleFor('A-wall-01', origin, mark),
    origin: {
      any: origins.map(value => ({
        names: [value.name],
        categories: [value.category],
      })),
    },
  }
  const localScopes: TakeoffRuleScopes = {
    ...scopes,
    rules: { [rule.id]: scopeFor('MARK', '仮設/施工計画ごとの工区・範囲') },
  }
  const values = [...origins, mark]
  const items = values.map(value => catalogItemFor(value))
  const fixturesByItem = new Map<CatalogItem, CountFixture>(
    items.map((item, index) => [item, values[index]!]),
  )

  return auditRelatedLinks({
    rules: [rule],
    scopes: localScopes,
    master,
    catalogItems: items,
    toFixture: item => {
      const value = fixturesByItem.get(item)
      if (!value) throw new Error('点検用の品目がありません')
      return structuredClone(value)
    },
    plan: override ?? ((ids, currentOrigin, target, mode) =>
      scopePlanForRules(ids, localScopes, currentOrigin, target, {
        originMatch: relatedOriginMatches(ids, [rule]),
        projectMode: mode === '新築' ? '新築' : '改修',
      })),
    existingKind: relatedAdditionKind,
  })
}

function sourceSelectionRow(
  rows: readonly AuditRow[],
  origin: CountFixture,
): AuditRow {
  const row = rows.find(value =>
    value.originItem === `${origin.name}（${origin.method}）／改修`)
  if (!row) throw new Error('起点の点検行がありません')
  return row
}

const fixtureCache = new Map<
  CatalogItem,
  Map<string | undefined, CountFixture>
>()

function toCatalogFixture(item: CatalogItem, key?: string): CountFixture {
  const cached = fixtureCache.get(item)?.get(key)
  if (cached) return structuredClone(cached)

  const selectedKey = key ?? item.options[0]?.key
  const preset = catalogPresets(item, {
    options: selectedKey === undefined ? [] : [selectedKey],
  })[0]
  const value: CountFixture = preset
    ? {
      ...fixtureFromPreset(preset, []),
      id: `audit-${item.key}-${selectedKey ?? 'default'}`,
    }
    : {
      id: `audit-${item.key}-plain`,
      code: '',
      name: item.name,
      category: item.category,
      order: 0,
      kind: 'count',
      style,
    }

  let itemCache = fixtureCache.get(item)
  if (!itemCache) {
    itemCache = new Map()
    fixtureCache.set(item, itemCache)
  }
  itemCache.set(key, structuredClone(value))
  return structuredClone(value)
}

describe('SPEC-T12 原本の期待表', () => {
  it.each(table)('$title: 正しい結果と不一致を両方判定する', entry => {
    const row = inspect(entry)
    expect(row.link, entry.title).toBe(entry.actual)
    expect(row.verdict, row.reasons.join('\n')).toBe('OK')

    const wrong: Plan = () => ({
      kind: 'placement',
      placement: entry.actual === 'component' ? 'route' : 'component',
    })
    const bad = inspect(entry, wrong)
    expect(bad.verdict).toBe('ERROR')
    expect(bad.reasons[0]).toContain('E12:')
    expect(bad.reasons[0]).toContain(`原本分類=${entry.classId}`)
    expect(bad.reasons[0]).toContain(`元指定=${entry.source}`)
    expect(bad.reasons[0]).toContain('期待=')
    expect(bad.reasons[0]).toContain('実際=')
  })

  it.each(table.filter(entry => entry.negativeOrigin !== undefined))(
    '$title: 許可されない起点では NONE が正しい',
    entry => {
      const origin = entry.negativeOrigin
      if (!origin) throw new Error('否定例の起点が必要')
      const row = inspect({ ...entry, origin })
      expect(row.link).toBe('NONE')
      expect(row.verdict, row.reasons.join('\n')).toBe('OK')
    },
  )

  it.each([
    'PLAN', 'PROTECT', 'SCAFFOLD', 'OPEN_REINF', 'VOLUME',
    'WALL_FRAME', 'CEILING_FRAME', 'HANGING', 'EXIST_FACE',
    'EXIST_POINT', 'LINE',
  ])('%s は component・route・point の生成も ERROR にする', classId => {
    const entry: TableCase = {
      title: classId, id: 'MANUAL', classId,
      source: '対象の範囲を独立して拾う',
      origin: equipment, target: box, actual: 'NONE',
    }
    expect(inspect(entry).verdict).toBe('OK')
    for (const placement of ['component', 'route', 'point'] as const) {
      expect(inspect(entry, () => ({
        kind: 'placement', placement,
      })).verdict).toBe('ERROR')
    }
  })

  it('点検は計画側のルールIDだけで同一面と決めない', () => {
    const entry: TableCase = {
      title: '原本との独立照合',
      id: 'A-floor-26', classId: 'AREA',
      source: '対象工事独自の施工面を別途拾う',
      origin: floor, target: fixture('target', '床下地', 'polygon'),
      actual: 'factor(area)',
    }
    const row = inspect(entry)
    expect(row.verdict).toBe('ERROR')
    expect(row.reasons[0]).toContain('期待=NONE')
    expect(row.reasons[0]).toContain('実際=factor(area)')
  })

  it('新築の墨出しに形状連動を付けると ERROR にする', () => {
    const entry = table.find(value => value.id === 'A-wall-01')
    if (!entry) throw new Error('墨出しの試験が必要')
    expect(inspect(entry, undefined, '新築').verdict).toBe('OK')
    const row = inspect(entry, (_ids, origin) => ({
      kind: 'link',
      link: {
        kind: 'shape',
        shape: {
          output: 'lengthTimesHeight', heightM: 1, lengthBasis: 'baseEdge',
        },
        factor: 1,
        sources: [{ itemId: origin.id, factor: 1 }],
      },
    }), '新築')
    expect(row.verdict).toBe('ERROR')
  })

  it('高さ・底辺指定・幅木係数を含めて検査する', () => {
    const markCase = table.find(value => value.id === 'A-wall-01')
    const baseCase = table.find(value => value.id === 'B-111')
    if (!markCase || !baseCase) throw new Error('試験データが必要')

    for (const shape of [
      { output: 'lengthTimesHeight' as const, heightM: 1 },
      { output: 'lengthTimesHeight' as const, heightM: 2, lengthBasis: 'baseEdge' as const },
    ]) {
      expect(inspect(markCase, (_ids, origin) => ({
        kind: 'link',
        link: {
          kind: 'shape', shape, factor: 1,
          sources: [{ itemId: origin.id, factor: 1 }],
        },
      })).verdict).toBe('ERROR')
    }

    expect(inspect(baseCase, (_ids, origin) => ({
      kind: 'link',
      link: {
        kind: 'shape',
        shape: { output: 'baseLength', deductDoorWidths: true },
        factor: 1,
        sources: [{ itemId: origin.id, factor: 1 }],
      },
    })).verdict).toBe('ERROR')
  })

  it('auto にしかない動的係数も実際の数量へ反映する', () => {
    const entry = table.find(value => value.id === 'E-020')
    if (!entry) throw new Error('配管塗装の試験が必要')
    const row = inspect(entry, () => ({
      kind: 'link',
      link: {
        kind: 'factor',
        factor: 1,
        sources: [],
        auto: {
          categories: ['試験分類'],
          kinds: ['length'],
          factorFrom: 'outerCircumference',
        },
      },
    }))
    expect(row.link).toBe('factor(outerCircumference)')
    expect(row.verdict).toBe('OK')
  })

  it('古い existing フォールバックによる component を見逃さない', () => {
    const row = inspect(table[0]!, () => ({ kind: 'existing' }))
    expect(row.link).toBe('component')
    expect(row.verdict).toBe('ERROR')
  })

  it('提案先の既存連動を数量の実態として検査する', () => {
    const template: FixtureLink = {
      kind: 'rc', rc: { output: 'formwork' },
      sources: [], auto: { rcKinds: [] },
    }
    const entry: TableCase = {
      ...table[0]!,
      target: { ...box, link: template },
      actual: 'rc:formwork',
    }
    const row = inspect(entry)
    expect(row.link).toBe('rc:formwork')
    expect(row.verdict).toBe('OK')
    expect(row.reasons[0]).toContain('existing-link')
  })
})

describe('SPEC-T13 自動の元の二重計上点検', () => {
  const origin = fixture(
    'source-wall', '軽量鉄骨壁下地', 'lengthHeight', 'area', '壁下地',
  )
  const sameName = fixture(
    'source-wall-polygon', '軽量鉄骨壁下地', 'polygon', 'area', '別分類',
  )
  const board = fixture(
    'source-board', '壁せっこうボード張り', 'lengthHeight', 'area', '壁下地',
  )
  const removal = fixture(
    'source-removal', '軽量鉄骨壁下地撤去', 'lengthHeight', 'area', '壁下地',
  )

  const oldBroadPlan: Plan = (_ids, currentOrigin) => ({
    kind: 'link',
    link: {
      kind: 'shape',
      shape: {
        output: 'lengthTimesHeight',
        heightM: 1,
        lengthBasis: 'baseEdge',
      },
      factor: 1,
      sources: [],
      auto: {
        nameIncludes: [currentOrigin.name, board.name],
        kinds: ['area', 'length'],
      },
    },
  })

  it('同じルールの別品目を選ぶ旧autoをE9にする', () => {
    const row = sourceSelectionRow(
      inspectSourceSelection(origin, [sameName, board, removal], oldBroadPlan),
      origin,
    )
    expect(row.link).toBe('shape:lengthTimesHeight')
    expect(row.verdict).toBe('ERROR')
    expect(row.reasons.some(reason => reason.startsWith('E9:'))).toBe(true)
    expect(row.reasons.join('\n')).toContain(board.name)
    expect(row.reasons.join('\n')).toContain(removal.name)
    expect(row.reasons.some(reason => reason.startsWith('E12:'))).toBe(false)
    expect(auditSummary([row]).byReason.E9).toBe(1)
  })

  it('起点名称を含んでいても撤去が混ざればE9にする', () => {
    const row = sourceSelectionRow(
      inspectSourceSelection(origin, [removal], (_ids, currentOrigin) => ({
        kind: 'link',
        link: {
          kind: 'shape',
          shape: {
            output: 'lengthTimesHeight',
            heightM: 1,
            lengthBasis: 'baseEdge',
          },
          factor: 1,
          sources: [],
          auto: {
            nameIncludes: [currentOrigin.name],
            kinds: ['area', 'length'],
          },
        },
      })),
      origin,
    )
    expect(row.verdict).toBe('ERROR')
    expect(row.reasons.join('\n'))
      .toContain(`E9: 同じ部位の別の項目（${removal.name}）も元になり二重に数える`)
  })

  it('同名の異なる拾い方を選び、ボード・撤去を除くとE9にならない', () => {
    const rows = inspectSourceSelection(origin, [sameName, board, removal])
    expect(rows.every(row => row.verdict === 'OK')).toBe(true)
    expect(auditSummary(rows).byReason.E9).toBeUndefined()
    const row = sourceSelectionRow(rows, origin)
    expect(row.sources).toContain('"nameIncludes":["軽量鉄骨壁下地"]')
    expect(row.sources).toContain('"nameExcludes":["撤去"]')
    expect(row.sources).toContain('点検で元になった品目：軽量鉄骨壁下地')
    expect(row.sources).not.toContain(board.name)
    expect(row.sources).not.toContain(removal.name)
  })

  it('撤去を起点にした場合は撤去の同名項目を選んでもE9にならない', () => {
    const sameRemoval = fixture(
      'same-removal', removal.name, 'polygon', 'area', '別分類',
    )
    const row = sourceSelectionRow(
      inspectSourceSelection(removal, [sameRemoval, origin]),
      removal,
    )
    expect(row.verdict).toBe('OK')
    expect(row.sources).toContain(`点検で元になった品目：${removal.name}`)
    expect(row.sources).not.toContain('"nameExcludes"')
    expect(row.reasons.some(reason => reason.startsWith('E9:'))).toBe(false)
  })

  it('E12とE9を独立に判定し、両方の誤りを残す', () => {
    const row = sourceSelectionRow(
      inspectSourceSelection(origin, [board], () => ({
        kind: 'link',
        link: {
          kind: 'factor',
          sources: [],
          auto: {
            nameIncludes: [origin.name, board.name],
            kinds: ['area'],
          },
        },
      })),
      origin,
    )
    expect(row.verdict).toBe('ERROR')
    expect(row.reasons.some(reason => reason.startsWith('E12:'))).toBe(true)
    expect(row.reasons.some(reason => reason.startsWith('E9:'))).toBe(true)
    expect(auditSummary([row]).byReason).toEqual({ E12: 1, E9: 1 })
  })

  it('手動の元に別品目を混ぜてもE9にする', () => {
    const rows = inspectSourceSelection(origin, [board], (_ids, currentOrigin) => ({
      kind: 'link',
      link: {
        kind: 'shape',
        shape: {
          output: 'lengthTimesHeight',
          heightM: 1,
          lengthBasis: 'baseEdge',
        },
        factor: 1,
        sources: [
          { itemId: currentOrigin.id, factor: 1 },
          { itemId: 'audit:A-wall-01:origin:1', factor: 1 },
        ],
      },
    }))
    const row = sourceSelectionRow(rows, origin)
    expect(row.verdict).toBe('ERROR')
    expect(row.reasons.some(reason => reason.startsWith('E9:'))).toBe(true)
  })

  it('sources列の実際の品目名は最大5名称にする', () => {
    const others = Array.from({ length: 6 }, (_, index) =>
      fixture(`other-${index}`, `壁別品目${index}`, 'polygon', 'area', '壁下地'))
    const row = sourceSelectionRow(
      inspectSourceSelection(origin, others, () => ({
        kind: 'link',
        link: {
          kind: 'shape',
          shape: {
            output: 'lengthTimesHeight',
            heightM: 1,
            lengthBasis: 'baseEdge',
          },
          factor: 1,
          sources: [],
          auto: { kinds: ['area'] },
        },
      })),
      origin,
    )
    expect(row.verdict).toBe('ERROR')
    const sample = row.sources.split('点検で元になった品目：')[1]
    expect(sample).toBe(
      '軽量鉄骨壁下地・壁別品目0・壁別品目1・壁別品目2・壁別品目3、ほか2名称',
    )
    expect(auditToCsv([row])).toContain('点検で元になった品目：')
  })

  it('標準規則のautoは従来の期待表で検証する', () => {
    const entry = table.find(value => value.id === 'B-054')
    if (!entry) throw new Error('鉄骨塗装の試験が必要')
    const row = inspect(entry)
    expect(row.verdict).toBe('OK')
    expect(row.reasons.join('\n')).toContain('期待=STD(steel-paint)')
    expect(row.reasons.some(reason => reason.startsWith('E9:'))).toBe(false)
  })
})

describe('SPEC-T13 実データ全件点検', () => {
  it('全対象ルールを改修・新築で点検し E9を含むERROR=0 とする', async () => {
    const targetRules = RELATED_RULES.filter(rule =>
      rule.kind === 'item'
      || (rule.kind === 'check' && rule.create !== undefined))

    const rows = auditRelatedLinks({
      rules: RELATED_RULES,
      scopes,
      master,
      catalogItems: catalogItems(),
      toFixture: toCatalogFixture,
      plan: (ids, origin, target, mode) =>
        scopePlanForRules(ids, scopes, origin, target, {
          originMatch: relatedOriginMatches(ids, RELATED_RULES),
          projectMode: mode === '新築' ? '新築' : '改修',
        }),
      existingKind: relatedAdditionKind,
    })
    const summary = auditSummary(rows)
    const failures = rows.filter(row => row.verdict === 'ERROR')
    console.log('SPEC-T13 related link audit', {
      totalRules: RELATED_RULES.length,
      targetRules: targetRules.length,
      auditedRules: new Set(rows.map(row => row.ruleId)).size,
      rows: rows.length,
      ...summary,
    })

    const output = process.env.RELATED_AUDIT_OUT
    if (output) {
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, auditToCsv(rows), 'utf8')
      console.log(`SPEC-T13 CSV: ${output}`)
    }

    expect(rows.length).toBeGreaterThan(0)
    expect(new Set(rows.map(row => row.ruleId))).toEqual(
      new Set(targetRules.map(rule => rule.id)),
    )
    expect(summary.OK + summary.ERROR + summary.REVIEW).toBe(rows.length)

    const modesByRule = new Map<string, Set<string>>()
    for (const row of rows) {
      const modes = modesByRule.get(row.ruleId) ?? new Set<string>()
      if (row.originItem.endsWith('／改修')) modes.add('改修')
      if (row.originItem.endsWith('／新築')) modes.add('新築')
      modesByRule.set(row.ruleId, modes)
    }
    for (const rule of targetRules) {
      expect(modesByRule.get(rule.id), rule.id)
        .toEqual(new Set(['改修', '新築']))
    }
    expect(
      summary.byReason.E9 ?? 0,
      JSON.stringify(
        failures.filter(row => row.reasons.some(reason => reason.startsWith('E9:')))
          .slice(0, 20),
        null,
        2,
      ),
    ).toBe(0)
    expect(summary.ERROR, JSON.stringify(failures.slice(0, 20), null, 2)).toBe(0)
  }, 120_000)
})

describe('候補展開・CSV・集計', () => {
  it('未登録の起点を4方式・2区分で点検する', () => {
    const rule = ruleFor('MISSING', equipment, box)
    const rows = auditRelatedLinks({
      rules: [rule],
      scopes: { ...scopes, rules: {} },
      master,
      catalogItems: [],
      toFixture: () => { throw new Error('呼ばれない') },
      plan: () => ({ kind: 'none' }),
      existingKind: relatedAdditionKind,
    })
    expect(rows).toHaveLength(8)
    expect(new Set(rows.map(row => row.originMethod))).toEqual(new Set([
      'click', 'polyline', 'polygon', 'lengthHeight',
    ]))
    expect(rows.every(row => row.verdict === 'OK')).toBe(true)
    expect(rows.every(row => row.originItem.includes('品目一覧に無い'))).toBe(true)
  })

  it('起点・提案先の選択肢にある拾い方を両方展開する', () => {
    const rule = ruleFor('OPTIONS', wall, paper)
    const options = [{ key: 'area' }, { key: 'line' }]
    const rows = auditRelatedLinks({
      rules: [rule],
      scopes: {
        ...scopes,
        rules: { [rule.id]: scopeFor('AREA', sameFaceSource) },
      },
      master,
      catalogItems: [
        catalogItemFor(wall, options),
        catalogItemFor(paper, options),
      ],
      toFixture: (item, key) => fixture(
        item.name, item.name, key === 'line' ? 'polyline' : 'polygon',
      ),
      plan: () => ({ kind: 'none' }),
      existingKind: relatedAdditionKind,
    })
    expect(rows).toHaveLength(8)
    expect(new Set(rows.map(row => row.originMethod)))
      .toEqual(new Set(['polygon', 'polyline']))
    expect(new Set(rows.map(row => row.targetKind)))
      .toEqual(new Set(['area', 'length']))
  })

  it.each([
    ['式', 'count'], ['か所', 'count'], ['m', 'length'], ['㎡', 'area'],
  ] as const)('create の %s を %s にする', (unit, kind) => {
    const rule: RelatedRule = {
      ...ruleFor('CREATE', equipment, box),
      kind: 'check',
      targets: [],
      create: { name: '確認項目', unit },
    }
    const rows = auditRelatedLinks({
      rules: [rule],
      scopes: { ...scopes, rules: { CREATE: scopeFor('RECORD', '確認記録') } },
      master,
      catalogItems: [],
      toFixture: () => { throw new Error('呼ばれない') },
      plan: () => ({ kind: 'none' }),
      existingKind: relatedAdditionKind,
    })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(row => row.targetKind === kind)).toBe(true)
  })

  it('note と create のない check を対象外にする', () => {
    const rule = ruleFor('BASE', equipment, box)
    expect(auditRelatedLinks({
      rules: [
        { ...rule, id: 'NOTE', kind: 'note' },
        { ...rule, id: 'CHECK', kind: 'check' },
      ],
      scopes, master, catalogItems: [],
      toFixture: () => { throw new Error('呼ばれない') },
      plan: () => ({ kind: 'none' }),
      existingKind: relatedAdditionKind,
    })).toEqual([])
  })

  it('参照テキストを解決する', () => {
    const rule = ruleFor('REF', equipment, box)
    const scope: RuleScope = {
      ...scopeFor('RECORD', ''),
      target: 0, difference: 1, unit: 2,
    }
    const rows = auditRelatedLinks({
      rules: [rule],
      scopes: {
        ...scopes,
        texts: ['対象。元指定：承認前に数量は生成しない', '差分', '式'],
        rules: { REF: scope },
      },
      master, catalogItems: [],
      toFixture: () => { throw new Error('呼ばれない') },
      plan: () => ({ kind: 'none' }),
      existingKind: relatedAdditionKind,
    })
    expect(rows[0]?.excelDifference).toBe('差分')
    expect(rows[0]?.excelUnit).toBe('式')
    expect(rows[0]?.reasons[0]).toContain('元指定=承認前に数量は生成しない')
  })

  it('BOM・CRLF・引用符・カンマ・改行を保持する', () => {
    const row: AuditRow = {
      ...inspect(table[0]!),
      originText: '壁,"特記"\n次行',
      reasons: ['理由A', '理由B'],
    }
    const csv = auditToCsv([row])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv).toContain('"壁,""特記""\r\n次行"')
    expect(csv).toContain('"理由A | 理由B"')
    expect(csv.replace(/\r\n/gu, '')).not.toMatch(/[\r\n]/u)
  })

  it('判定と理由を集計し、同一行の理由を重複計上しない', () => {
    const ok = inspect(table[0]!)
    const error = inspect(table[0]!, () => ({
      kind: 'placement', placement: 'component',
    }))
    const duplicated: AuditRow = {
      ...error, reasons: [...error.reasons, ...error.reasons],
    }
    expect(auditSummary([ok, duplicated])).toEqual({
      OK: 1, ERROR: 1, REVIEW: 0,
      byReason: { OK: 1, E12: 1 },
    })
    expect(auditSummary([])).toEqual({
      OK: 0, ERROR: 0, REVIEW: 0, byReason: {},
    })
    expect(auditToCsv([])).toContain('"ruleId"')
  })
})
