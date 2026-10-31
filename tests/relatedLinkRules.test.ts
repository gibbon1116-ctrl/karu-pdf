import { describe, expect, it } from 'vitest'
import type {
  CountFixture,
  QuantityKind,
  QuantityMethod,
} from '../src/core/countFixtures'
import { fixtureLinkSources } from '../src/core/fixtureLink'
import { LINK_RULES } from '../src/core/breakdown/linkRules'
import {
  defaultRcLink,
  linkFromRule,
} from '../src/core/breakdown/linkFromRule'
import type {
  RelatedOriginMatch,
  RelatedRule,
} from '../src/core/related/types'
import type { TakeoffRuleScopes } from '../src/core/takeoff/types'
import {
  relatedOriginMatches,
  scopeLinkPlan,
  scopePlanForContext,
  scopePlanForRules,
  withRelatedScopeContext,
} from '../src/app/relatedLinkRules'

const style: CountFixture['style'] = {
  shape: 'circle',
  fill: 'none',
  color: [1, 0, 0],
  size: 10,
  opacity: .8,
  showCode: true,
}

function fixture(
  id: string,
  name: string,
  method: QuantityMethod = 'click',
  kind?: QuantityKind,
  category = '試験',
): CountFixture {
  const inferred: QuantityKind = method === 'click' ? 'count'
    : method === 'polyline' ? 'length'
      : method === 'polygon' || method === 'lengthHeight' ? 'area'
        : 'volume'
  return {
    id, name, code: id, category, method,
    kind: kind ?? inferred, style, order: 0,
  }
}

const wall = fixture('wall', '壁下地', 'polygon')
const wallLine = fixture('wall-line', '壁下地', 'polyline')
const floor = fixture('floor', '床仕上げ', 'polygon')
const ceiling = fixture('ceiling', '天井仕上げ', 'polygon')
const roof = fixture('roof', '屋根', 'polygon')
const pipe = fixture('pipe', '配管', 'polyline')
const duct = fixture('duct', 'ダクト', 'polyline')
const cable = fixture('cable', 'ケーブル配線', 'polyline')
const equipment = fixture('equipment', '照明器具')
const pump = fixture('pump', 'ポンプ')
const paper = fixture('paper', '壁紙張り', 'polygon')
const mark = fixture('mark', '墨出し', 'polygon')
const edge = fixture('edge', '施工辺', 'polyline')
const box = fixture('box', '器具用ボックス')
const surface = fixture('surface', '配管塗装', 'polygon')

function plan(
  ruleId: string,
  classId: string,
  origin: CountFixture = wall,
  target: CountFixture = paper,
) {
  return scopeLinkPlan({ ruleId, classId, origin, target })
}

function scopesFor(
  entries: Readonly<Record<string, string>>,
): TakeoffRuleScopes {
  return {
    format: 'karu-takeoff-rule-scopes-1',
    masterVersion: 'test',
    sourceSha256: 'test',
    texts: [],
    scopeProfiles: {},
    scopeOptions: [],
    definitionHeads: {},
    rules: Object.fromEntries(
      Object.entries(entries).map(([id, classId]) => [id, { classId }]),
    ),
  } as unknown as TakeoffRuleScopes
}

describe('SPEC-T12 許可の一覧', () => {
  it.each([
    'RECORD', 'PLAN', 'PROTECT', 'PROTECT_ACTUAL', 'SCAFFOLD',
    'OPEN_REINF', 'VOLUME', 'WALL_FRAME', 'CEILING_FRAME', 'HANGING',
    'EXIST_FACE', 'EXIST_POINT', 'LINE', 'CRACK', 'DEFECT_POINT',
    'PATCH', 'PROPERTY', 'UNKNOWN',
  ])('%s は個数・経路・面積を自動生成しない', classId => {
    for (const [origin, target] of [
      [equipment, box], [pipe, surface], [wall, paper],
    ] as const) {
      expect(plan('TEST', classId, origin, target).kind).toBe('none')
    }
  })

  it('ルールIDが無い場合も既存の振り分けへ戻さない', () => {
    expect(scopeLinkPlan({
      classId: 'POINT', origin: equipment, target: box,
    }).kind).toBe('none')
  })

  it.each(['M-043', 'M-090', 'M-104'])(
    'BRANCH %s は経路の長さだけを許可する',
    id => {
      expect(plan(id, 'BRANCH', pipe, edge)).toEqual({
        kind: 'placement', placement: 'route',
      })
      expect(plan(id, 'BRANCH', pipe, surface).kind).toBe('none')
      expect(plan(id, 'BRANCH', equipment, edge).kind).toBe('none')
    },
  )

  it('BRANCH B-170 は床の外周だけを使う', () => {
    expect(plan('B-170', 'BRANCH', floor, edge)).toMatchObject({
      kind: 'link', link: { kind: 'shape', shape: { output: 'perimeter' } },
    })
    expect(plan('B-170', 'BRANCH', wall, edge).kind).toBe('none')
    expect(plan('OTHER', 'BRANCH', equipment, pump).kind).toBe('none')
  })

  it.each([
    ['DETAIL', 'B-043', '型枠運搬', 'rc', 'formwork'],
    ['CONTACT', 'B-037', '普通合板型枠（基礎部）', 'rc', 'formwork'],
    ['CONTACT', 'B-037', '普通合板型枠（地上軸部）', 'rc', 'formwork'],
    ['MATERIAL', 'B-038', '異形鉄筋', 'rc', 'rebar'],
    ['MATERIAL', 'B-044', '鉄筋加工組立', 'rc', 'rebar'],
    ['MATERIAL', 'B-045', '鉄筋運搬', 'rc', 'rebar'],
    ['SURFACE', 'B-054', '錆止め塗装', 'steel', 'paint'],
    ['SURFACE', 'B-055', '耐火被覆', 'steel', 'fireproof'],
  ] as const)('%s %s は標準規則を使う', (classId, id, name, kind, output) => {
    const result = plan(id, classId, wall, fixture('target', name, 'polygon'))
    expect(result).toMatchObject({
      kind: 'link',
      link: { kind, [kind]: { output }, sources: [] },
    })
    expect(plan('OTHER', classId, wall, paper).kind).toBe('none')
  })

  it('名称で標準規則を決定できなければ連動しない', () => {
    expect(plan('B-037', 'CONTACT').kind).toBe('none')
    expect(plan('B-038', 'MATERIAL').kind).toBe('none')
    expect(plan('B-043', 'DETAIL').kind).toBe('link')
    expect(plan('B-029', 'DETAIL').kind).toBe('none')
  })

  it('発生材は標準規則の細目だけを使う', () => {
    expect(plan(
      'B-031', 'WASTE', wall, fixture('waste', '発生材運搬'),
    )).toMatchObject({
      kind: 'link',
      link: { kind: 'mass', auto: { condition: '撤去（廃棄）' } },
    })
    expect(plan('B-031', 'WASTE', wall, paper).kind).toBe('none')
  })

  it.each(['E-003', 'E-015', 'E-024'])(
    '%s は開口単位で拾い、回路ごとの交差を使わない',
    id => {
      const result = plan(id, 'OPENING', cable, box)
      expect(result).toMatchObject({ kind: 'none' })
      if (result.kind !== 'none') throw new Error('NONE が必要')
      expect(result.reason).toContain('貫通口ごとに点')
      expect(result.reason).toContain('回路ごと')
    },
  )

  it.each(['M-055', 'M-103'])('%s は標準の交差規則を使う', id => {
    expect(plan(id, 'OPENING', pipe, box)).toMatchObject({
      kind: 'link',
      link: {
        kind: 'crossing',
        crossing: { barrierNameIncludes: ['防火区画'] },
        auto: { kinds: ['length'] },
      },
    })
    expect(plan('A-door-18', 'OPENING', equipment, edge).kind).toBe('none')
  })

  it.each(['A-ceiling-01', 'A-wall-01', 'A-floor-01'])(
    '%s の墨出しは壁の平面長・底辺だけを使う',
    id => {
      for (const method of ['polyline', 'polygon', 'lengthHeight'] as const) {
        expect(plan(
          id, 'MARK', fixture('origin', '壁下地', method), mark,
        )).toMatchObject({
          kind: 'link',
          link: {
            kind: 'shape',
            shape: {
              output: 'lengthTimesHeight',
              lengthBasis: 'baseEdge',
              heightM: 1,
            },
          },
        })
      }
      for (const origin of [floor, ceiling, equipment]) {
        expect(plan(id, 'MARK', origin, mark).kind).toBe('none')
      }
      expect(scopeLinkPlan({
        ruleId: id, classId: 'MARK', origin: wall, target: mark,
        projectMode: '新築',
      }).kind).toBe('none')
    },
  )

  it('屋根の墨出しと建具起点の墨出しを許可しない', () => {
    expect(plan('A-roof-waterproof-05', 'MARK', roof, mark).kind).toBe('none')
    const door: CountFixture = {
      ...fixture('door', '建具・扉'),
      opening: { widthM: .9, heightM: 2.1 },
    }
    expect(plan('A-wall-01', 'MARK', door, mark).kind).toBe('none')
  })

  it.each(['E-020', 'M-010', 'M-011'])(
    '%s は経路の表面積・長さを使う',
    id => {
      expect(plan(id, 'FILTER_ROUTE', pipe, surface)).toMatchObject({
        kind: 'link',
        link: {
          kind: 'factor',
          // SPEC-T13: 押した起点と同じ名称の項目を自動の元にする（撤去は除く）
          sources: [],
          auto: {
            nameIncludes: [pipe.name],
            nameExcludes: ['撤去'],
            factorFrom: 'outerCircumference',
          },
        },
      })
      expect(plan(id, 'FILTER_ROUTE', duct, surface)).toEqual({
        kind: 'placement', placement: 'route',
      })
      expect(plan(id, 'FILTER_ROUTE', pipe, edge)).toEqual({
        kind: 'placement', placement: 'route',
      })
      expect(plan(id, 'FILTER_ROUTE', equipment, surface).kind).toBe('none')
    },
  )

  it('経路表面積の対象を管・ダクトに限定する', () => {
    expect(plan('E-020', 'FILTER_ROUTE', cable, surface).kind).toBe('none')
    expect(plan('OTHER', 'FILTER_ROUTE', pipe, surface).kind).toBe('none')
  })

  it.each([
    ['E-001', 'ROUTE'],
    ['E-002', 'UNIQUE_ROUTE'],
    ['E-121', 'ROUTE'],
  ] as const)('%s は経路から経路への配置だけを許可する', (id, classId) => {
    expect(plan(id, classId, cable, fixture('conduit', '電線管', 'polyline')))
      .toEqual({ kind: 'placement', placement: 'route' })
    expect(plan(id, classId, equipment, edge).kind).toBe('none')
    expect(plan(id, classId, pipe, surface).kind).toBe('none')
  })

  it.each(['E-033', 'E-070', 'M-028', 'M-039'])(
    '%s の機器起点から経路数量を作らない',
    id => {
      expect(plan(id, 'ROUTE', equipment, edge).kind).toBe('none')
    },
  )

  it('ラックも経路として判定する', () => {
    expect(plan(
      'E-002', 'UNIQUE_ROUTE',
      fixture('rack', 'ケーブルラック', 'polyline'), edge,
    )).toEqual({ kind: 'placement', placement: 'route' })
  })

  it('polyline 以外の長さの提案先には長さの係数連動を作る', () => {
    expect(plan(
      'M-043', 'BRANCH', pipe,
      fixture('length', '対象区間', 'click', 'length'),
    )).toMatchObject({ kind: 'link', link: { kind: 'factor' } })
  })

  it('E-009 だけを経路の端点に配置する', () => {
    expect(plan('E-009', 'ENDPOINT', pipe, box)).toEqual({
      kind: 'placement', placement: 'point',
    })
    expect(plan('OTHER', 'ENDPOINT', pipe, box).kind).toBe('none')
    expect(plan('E-009', 'ENDPOINT', equipment, box).kind).toBe('none')
  })

  it.each(['E-034', 'E-039', 'M-013', 'B-028'])(
    '%s だけを起点1つに1つの部品にする',
    id => {
      expect(plan(id, 'POINT', equipment, box)).toEqual({
        kind: 'placement', placement: 'component',
      })
      expect(plan(id, 'POINT', pipe, box).kind).toBe('none')
      expect(plan(id, 'POINT', equipment, surface).kind).toBe('none')
    },
  )

  it('冷凍機からポンプ等へ個数を写さない', () => {
    expect(plan(
      'M-019', 'POINT', fixture('chiller', '冷凍機'), pump,
    ).kind).toBe('none')
    expect(plan('E-076', 'POINT', equipment, box).kind).toBe('none')
  })

  it.each(['B-111', 'A-wall-21', 'A-floor-29'])(
    '%s の幅木は壁の底辺か床の外周を使う',
    id => {
      expect(plan(id, 'BASEBOARD', wall, edge)).toMatchObject({
        kind: 'link',
        link: {
          kind: 'shape', factor: 2,
          shape: { output: 'baseLength', deductDoorWidths: true },
        },
      })
      expect(plan(id, 'BASEBOARD', floor, edge)).toMatchObject({
        kind: 'link',
        link: { kind: 'shape', shape: { output: 'perimeter' } },
      })
      expect(plan(id, 'BASEBOARD', equipment, edge).kind).toBe('none')
    },
  )

  it('詳細線の幅木・伸縮目地・コーナービードは別に拾う', () => {
    expect(plan('A-floor-18', 'BASEBOARD', floor, edge).kind).toBe('none')
    expect(plan('B-080', 'JOINT', floor, edge).kind).toBe('none')
    expect(plan('A-wall-19', 'CORNER', wall, edge).kind).toBe('none')
  })

  it.each(['B-134', 'A-ceiling-19'])(
    '%s の廻り縁は天井の polygon の外周だけを使う',
    id => {
      expect(plan(id, 'JOINT', ceiling, edge)).toMatchObject({
        kind: 'link', link: { kind: 'shape', shape: { output: 'perimeter' } },
      })
      expect(plan(id, 'JOINT', wall, edge).kind).toBe('none')
      expect(plan(id, 'JOINT', equipment, edge).kind).toBe('none')
    },
  )

  it('立上りの高さを勝手に補わない', () => {
    for (const origin of [roof, floor]) {
      const result = plan(
        'A-roof-waterproof-27', 'UPSTAND',
        origin, fixture('up', '防水立上り', 'polygon'),
      )
      expect(result).toMatchObject({
        kind: 'link',
        link: { kind: 'shape', shape: { output: 'lengthTimesHeight' } },
      })
      if (result.kind !== 'link') throw new Error('連動が必要')
      expect(result.link.shape?.heightM).toBeUndefined()
    }
    expect(plan('OTHER', 'UPSTAND', roof, surface).kind).toBe('none')
  })

  it('埋戻し・ガラスは手動で標準規則の元を選ぶ', () => {
    for (const [id, classId] of [
      ['B-018', 'BACKFILL'], ['B-096', 'AREA'],
    ] as const) {
      const result = plan(id, classId)
      expect(result.kind).toBe('none')
      if (result.kind !== 'none') throw new Error('NONE が必要')
      expect(result.reason).toContain('標準の規則')
    }
  })

  it.each([
    ['AREA', 'A-floor-26', floor, fixture('t1', '床下地', 'polygon')],
    ['FLOOR', 'B-118', floor, fixture('t2', '床表面仕上げ', 'polygon')],
    ['CEILING_FINISH', 'A-ceiling-23', ceiling, fixture('t3', '天井塗装', 'polygon')],
    ['ROOF', 'A-roof-waterproof-23', roof, fixture('t4', '屋根防水', 'polygon')],
    ['WALL_FINISH', 'A-wall-22', wall, paper],
    ['FIRE_ASSEMBLY', 'A-wall-25', wall, paper],
  ] as const)('%s の同一面は控除後の面積を使う', (classId, id, origin, target) => {
    expect(plan(id, classId, origin, target)).toMatchObject({
      kind: 'link',
      link: { kind: 'factor', factor: 1 },
    })
    expect(plan(id, classId, equipment, target).kind).toBe('none')
    expect(plan(id, classId, pipe, target).kind).toBe('none')
  })

  it('壁の線から同じ壁面を求めるときは高さ未設定の形状連動にする', () => {
    const result = plan('A-wall-22', 'WALL_FINISH', wallLine, paper)
    expect(result).toMatchObject({
      kind: 'link',
      link: {
        shape: { output: 'lengthTimesHeight', lengthBasis: 'baseEdge' },
      },
    })
    if (result.kind !== 'link') throw new Error('連動が必要')
    expect(result.link.shape?.heightM).toBeUndefined()
    expect(result.note).toContain('片面')
    expect(result.note).toContain('高さ')
  })

  it.each(['幅木', '巾木', '見切縁', '目地', 'シール'])(
    '壁・床・天井を含む%sの線を施工面の元にしない',
    word => {
      const origin = fixture('member', `壁・床・天井 ${word}`, 'polyline')
      expect(plan('A-wall-22', 'WALL_FINISH', origin, paper).kind).toBe('none')
      expect(plan('A-wall-01', 'MARK', origin, mark).kind).toBe('none')
    },
  )

  it.each([
    ['FLOOR', 'B-017'],
    ['AREA', 'B-104'],
    ['AREA', 'A-interior-units-19'],
    ['AREA', 'A-interior-units-30'],
    ['ROOF', 'A-roof-waterproof-08'],
    ['WALL_FINISH', 'B-149'],
    ['WALL_FINISH', 'A-exterior-wall-17'],
    ['EXIST_FACE', 'B-116'],
  ] as const)('%s %s の独立範囲は面積を写さない', (classId, id) => {
    expect(plan(id, classId, wall, paper).kind).toBe('none')
  })

  it('部位が違う面積は写さず、部位はルールの分類・部位から決める', () => {
    expect(plan('A-floor-26', 'AREA', wall, floor).kind).toBe('none')
    // 名称に部位の無い面（防水層・地業など）は、ルールの起点の品目群の部位の面とみなす
    expect(plan(
      'A-floor-26', 'AREA', fixture('unknown', '施工面', 'polygon'), paper,
    ).kind).toBe('link')
    // 天井のルールの「壁紙張り」は天井の面（提案先の名称の「壁」で部位を決めない）
    const ceiling = fixture('ceiling', '天井仕上げ（囲む）', 'polygon')
    expect(plan('A-ceiling-32', 'CEILING_FINISH', ceiling, paper).kind).toBe('link')
    expect(plan('A-ceiling-32', 'CEILING_FINISH', wall, paper).kind).toBe('none')
    // 屋上防水の面 → 別の防水（名称に部位が無くても屋根の面）
    const roofSheet = fixture('roof', '塗膜防水', 'polygon')
    const asphalt = fixture('asphalt', 'アスファルト防水', 'polygon')
    expect(plan('A-roof-waterproof-23', 'ROOF', roofSheet, asphalt).kind).toBe('link')
    // 線の起点は名称で壁と分かるときだけ
    expect(plan('A-floor-26', 'AREA', fixture('line', '施工線', 'polyline', 'length'), paper).kind).toBe('none')
  })

  it('起点の連動・自己参照を拒否し、提案先の既存連動を保持する', () => {
    const linkedOrigin: CountFixture = {
      ...wall, link: { kind: 'factor', sources: [{ itemId: 'other' }] },
    }
    expect(plan('A-wall-22', 'WALL_FINISH', linkedOrigin, paper).kind).toBe('none')
    expect(plan('A-wall-22', 'WALL_FINISH', wall, wall).kind).toBe('none')
    const linkedTarget: CountFixture = {
      ...paper, link: { kind: 'shape', shape: { output: 'area' }, sources: [] },
    }
    expect(plan('A-wall-22', 'WALL_FINISH', wall, linkedTarget))
      .toEqual({ kind: 'existing-link' })
  })
})

describe('自動の元・ダイアログの文脈', () => {
  const matches: RelatedOriginMatch[] = [
    { categories: ['分類A'], names: ['壁A'] },
    { categories: ['分類B'], names: ['壁B'] },
  ]

  it('ルールの枝をautoへ写さず、起点名称で拾い方・分類をまたいで選ぶ', () => {
    const a = fixture('a', '壁A', 'polygon', 'area', '分類A')
    const b = fixture('b', '壁A', 'lengthHeight', 'area', '分類B')
    const line = fixture('line', '壁A', 'polyline', 'length', '分類C')
    const other = fixture('other', '壁B', 'polygon', 'area', '分類A')
    const removal = fixture('removal', '壁A撤去', 'polygon', 'area', '分類A')
    const result = scopeLinkPlan({
      ruleId: 'A-wall-01', classId: 'MARK',
      origin: a, target: mark, originMatch: matches,
    })
    expect(result.kind).toBe('link')
    if (result.kind !== 'link') throw new Error('連動が必要')
    expect(result.link.auto).toEqual({
      nameIncludes: ['壁A'],
      nameExcludes: ['撤去'],
      kinds: ['area', 'length'],
    })
    const linked = { ...mark, link: result.link }
    expect(result.link.sources).toEqual([])
    expect(fixtureLinkSources([a, b, line, other, removal, linked], linked)
      .map(source => source.itemId)).toEqual(['a', 'b', 'line'])
  })

  it('名称・分類のないルール条件でも起点名称からautoを作る', () => {
    const result = scopeLinkPlan({
      ruleId: 'A-wall-01', classId: 'MARK',
      origin: wall, target: mark, originMatch: [{}],
    })
    expect(result).toMatchObject({
      kind: 'link',
      link: {
        sources: [],
        auto: {
          nameIncludes: [wall.name],
          nameExcludes: ['撤去'],
          kinds: ['area', 'length'],
        },
      },
    })
    if (result.kind !== 'link') throw new Error('連動が必要')
    expect(result.link.auto?.categories).toBeUndefined()
    expect(result.link.auto?.originAny).toBeUndefined()
  })

  it.each([
    '', '壁'.repeat(41), ' 壁', '壁 ', '壁\r下地', '壁\n下地',
    '壁\t下地', '壁\u2028下地', '壁\u2029下地',
  ])('不正な起点名称 %j は押した1項目へフォールバックする', name => {
    const origin = fixture('invalid', name, 'polygon', 'area', '壁下地')
    const result = scopeLinkPlan({
      ruleId: 'A-wall-01', classId: 'MARK',
      origin, target: mark, originMatch: matches,
    })
    expect(result.kind).toBe('link')
    if (result.kind !== 'link') throw new Error('連動が必要')
    expect(result.link.auto).toBeUndefined()
    expect(result.link.sources).toEqual([{ itemId: origin.id, factor: 1 }])
  })

  it('40字の起点名称はautoにできる', () => {
    const origin = fixture('limit', '壁'.repeat(40), 'polygon')
    const result = scopeLinkPlan({
      ruleId: 'A-wall-01', classId: 'MARK', origin, target: mark,
    })
    expect(result).toMatchObject({
      kind: 'link',
      link: { sources: [], auto: { nameIncludes: [origin.name] } },
    })
  })

  it('撤去を起点にした場合は撤去の同名項目を選び、除外語を付けない', () => {
    const origin = fixture('removal-a', '壁下地撤去', 'polygon')
    const same = fixture('removal-b', '壁下地撤去', 'lengthHeight')
    const newWall = fixture('new-wall', '壁下地', 'polygon')
    const result = scopeLinkPlan({
      ruleId: 'A-wall-01', classId: 'MARK', origin, target: mark,
    })
    expect(result.kind).toBe('link')
    if (result.kind !== 'link') throw new Error('連動が必要')
    expect(result.link.auto).toEqual({
      nameIncludes: ['壁下地撤去'],
      kinds: ['area', 'length'],
    })
    const linked = { ...mark, link: result.link }
    expect(fixtureLinkSources([origin, same, newWall, linked], linked)
      .map(source => source.itemId)).toEqual(['removal-a', 'removal-b'])
  })

  it('不正な配管名称のフォールバックでも外周の動的係数を保持する', () => {
    const origin = fixture('invalid-pipe', '配管\n', 'polyline')
    const result = scopeLinkPlan({
      ruleId: 'E-020', classId: 'FILTER_ROUTE',
      origin, target: surface,
    })
    expect(result.kind).toBe('link')
    if (result.kind !== 'link') throw new Error('連動が必要')
    expect(result.link.auto).toBeUndefined()
    expect(result.link.sources).toEqual([{
      itemId: origin.id,
      factor: 1,
      factorFrom: 'outerCircumference',
    }])
  })

  it('標準規則のautoを起点名称の条件へ変更しない', () => {
    const standard = LINK_RULES.find(rule => rule.id === 'steel-paint')
    if (!standard) throw new Error('標準規則が必要')
    const result = plan('B-054', 'SURFACE', wall, surface)
    expect(result.kind).toBe('link')
    if (result.kind !== 'link') throw new Error('連動が必要')
    expect(result.link.auto).toEqual(standard.auto)
    expect(result.link.auto?.nameExcludes).toBeUndefined()
  })

  it('複数ルールの条件を複製し重複を除く', () => {
    const rules = [{
      id: 'one', origin: { any: matches },
    }, {
      id: 'two', origin: { any: [matches[0]!] },
    }] as unknown as RelatedRule[]
    const actual = relatedOriginMatches(['one', 'two'], rules)
    expect(actual).toEqual(matches)
    expect(actual[0]).not.toBe(matches[0])
  })

  it('呼び径と動的係数を自動の元に渡す', () => {
    const result = scopeLinkPlan({
      ruleId: 'E-020', classId: 'FILTER_ROUTE', origin: pipe,
      target: { ...surface, name: '配管塗装 C51' },
      originMatch: [{ categories: ['配管'] }],
    })
    expect(result).toMatchObject({
      kind: 'link',
      link: {
        auto: {
          kinds: ['length'], sizeMatch: 'C51',
          factorFrom: 'outerCircumference',
        },
      },
    })
  })

  it('文脈の浅いコピー後もルールID・起点条件・案件区分を維持する', () => {
    const context = withRelatedScopeContext(
      { originFixtureId: wall.id },
      ['A-wall-01'],
      scopesFor({ 'A-wall-01': 'MARK' }),
      { originMatch: matches, projectMode: '新築' },
    )
    const resolve = scopePlanForContext({ ...context })
    expect(resolve?.(wall, mark).kind).toBe('none')
    expect(scopePlanForContext(undefined)).toBeUndefined()
    expect(scopePlanForContext({ originFixtureId: wall.id })).toBeUndefined()
  })

  it('未取得・未知のルールは配置にもフォールバックしない', () => {
    expect(scopePlanForRules(['x'], undefined, equipment, box).kind).toBe('none')
    expect(scopePlanForRules(
      ['x'], scopesFor({}), equipment, box,
    ).kind).toBe('none')
  })

  it('同じ分類でもルールごとの許可が異なれば NONE にする', () => {
    const scopes = scopesFor({ 'E-034': 'POINT', 'E-076': 'POINT' })
    expect(scopePlanForRules(
      ['E-034', 'E-076'], scopes, equipment, box,
    ).kind).toBe('none')
    expect(scopePlanForRules(
      ['E-034', 'E-034'], scopes, equipment, box,
    )).toEqual({ kind: 'placement', placement: 'component' })
  })
})

describe('共有した標準規則の変換', () => {
  it('全標準規則を変換でき、規則データを変更しない', () => {
    const before = structuredClone(LINK_RULES)
    for (const rule of LINK_RULES) {
      const result = linkFromRule(rule, rule.details[0] ?? rule.label, [])
      expect(result.kind).toBe(rule.waste ? 'mass' : rule.kind)
      expect(result.sources).toEqual([])
    }
    expect(LINK_RULES).toEqual(before)
  })

  it('RCの設計数量・所要数量と搬入区分を保持する', () => {
    expect(defaultRcLink('異形鉄筋')).toMatchObject({
      output: 'rebar', basis: 'required',
    })
    expect(defaultRcLink('鉄筋運搬')).toMatchObject({
      output: 'rebar', basis: 'design',
    })
    const carry = LINK_RULES.find(rule => rule.id === 'carry-in')
    if (!carry) throw new Error('規則が必要')
    expect(linkFromRule(carry, '機器搬入', [
      { label: ' 区分 ', value: ' 容積品 ' },
    ]).carry?.class).toBe('bulky')
    // SPEC-T15: 区分を選ばないときは class を付けない（重量品・容積品の両方を元ごとに判定）
    expect(linkFromRule(carry, '機器搬入', []).carry).toEqual({})
  })

  it('返した可変オブジェクトを変更しても標準規則は変わらない', () => {
    const rule = LINK_RULES.find(entry => entry.id === 'fire-penetration')
    if (!rule) throw new Error('規則が必要')
    const before = structuredClone(rule)
    const result = linkFromRule(rule, '防火区画貫通処理', [])
    result.crossing?.barrierNameIncludes?.push('変更')
    expect(rule).toEqual(before)
  })
})
