import { describe, expect, it } from 'vitest'
import { nextCountStyle, type CountFixture } from '../src/core/countFixtures'
import {
  linkDependentTitle,
  linkRelations,
  linkSourceLabel,
  linkSourceText,
  linkSourceTitle,
} from '../src/app/linkRelations'

function fixture(id: string, changes: Partial<CountFixture> = {}): CountFixture {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    category: 'その他',
    order: 0,
    style: nextCountStyle([]),
    ...changes,
  }
}

// These tests exercise source selection only, without RC calculations.
function rcMember(kind: 'slab' | 'beam'): NonNullable<CountFixture['rc']> {
  return { kind, bars: [] } as NonNullable<CountFixture['rc']>
}

describe('linkRelations', () => {
  it('手動の元と引き算の元を双方向に対応させ、表示を共通化する', () => {
    const a = fixture('a', { name: '普通コンクリート（軸部）' })
    const b = fixture('b', { name: '開口控除' })
    const c = fixture('c', { name: '補足' })
    const linked = fixture('linked', {
      name: '集計',
      link: {
        kind: 'factor',
        sources: [
          { itemId: a.id, factor: 2 },
          { itemId: b.id, sign: -1 },
          { itemId: c.id },
        ],
      },
    })
    const fixtures = [a, b, c, linked]
    const before = JSON.stringify(fixtures)
    const relations = linkRelations(fixtures)

    expect(relations.sources.get(linked.id)).toEqual([
      { id: a.id, code: 'A', name: a.name, auto: false, sign: 1 },
      { id: b.id, code: 'B', name: b.name, auto: false, sign: -1 },
      { id: c.id, code: 'C', name: c.name, auto: false, sign: 1 },
    ])
    for (const source of [a, b, c]) {
      expect(relations.dependents.get(source.id)).toEqual([
        { id: linked.id, code: 'LINKED', name: '集計' },
      ])
    }
    expect(linkSourceText(relations.sources.get(linked.id)!))
      .toBe('← 普通コンクリート（軸部） ほか2')
    expect(linkSourceLabel(relations.sources.get(linked.id)![1]))
      .toBe('− B 開口控除')
    expect(linkSourceTitle(relations.sources.get(linked.id)!))
      .toBe('A 普通コンクリート（軸部）\n− B 開口控除\nC 補足')
    expect(linkDependentTitle(relations.dependents.get(a.id)!)).toBe('集計')
    expect(JSON.stringify(fixtures)).toBe(before)
  })

  it('自動の分類・種別・施工条件を反映し、手動で選んだ元は自動と重複しない', () => {
    const manual = fixture('manual', {
      category: '照明器具', conditions: ['撤去'],
    })
    const automatic = fixture('automatic', {
      category: '照明器具', conditions: ['撤去'],
    })
    const otherCategory = fixture('other-category', {
      category: '盤類', conditions: ['撤去'],
    })
    const otherKind = fixture('other-kind', {
      category: '照明器具', kind: 'length', conditions: ['撤去'],
    })
    const otherCondition = fixture('other-condition', {
      category: '照明器具', conditions: ['新設'],
    })
    const linkedCandidate = fixture('linked-candidate', {
      category: '照明器具', conditions: ['撤去'],
      link: { kind: 'factor', sources: [{ itemId: manual.id }] },
    })
    const linked = fixture('installation', {
      category: '照明器具', conditions: ['撤去'],
      link: {
        kind: 'factor',
        sources: [{ itemId: manual.id, factor: 2 }],
        auto: { categories: ['照明器具'], kinds: ['count'], condition: '撤去' },
      },
    })

    const relations = linkRelations([
      manual, automatic, otherCategory, otherKind, otherCondition,
      linkedCandidate, linked,
    ])

    expect(relations.sources.get(linked.id)).toEqual([
      { id: manual.id, code: manual.code, name: manual.name, auto: false, sign: 1 },
      { id: automatic.id, code: automatic.code, name: automatic.name, auto: true, sign: 1 },
    ])
    expect(linkSourceLabel(relations.sources.get(linked.id)![1]))
      .toBe('AUTOMATIC automatic（自動）')
    expect(relations.dependents.get(automatic.id)).toEqual([
      { id: linked.id, code: linked.code, name: linked.name },
    ])
    expect(relations.dependents.get(manual.id)?.map(item => item.id))
      .toEqual([linkedCandidate.id, linked.id])
    expect(relations.dependents.has(otherCategory.id)).toBe(false)
    expect(relations.dependents.has(otherKind.id)).toBe(false)
    expect(relations.dependents.has(otherCondition.id)).toBe(false)
    expect(relations.dependents.has(linkedCandidate.id)).toBe(false)
  })

  it('rcKinds の指定と空配列による全 RC 部材の自動選択を反映する', () => {
    const slab = fixture('slab', { rc: rcMember('slab') })
    const beam = fixture('beam', { rc: rcMember('beam') })
    const ordinary = fixture('ordinary')
    const slabRebar = fixture('slab-rebar', {
      link: {
        kind: 'rc',
        sources: [],
        auto: { rcKinds: ['slab'] },
        rc: { output: 'rebar', basis: 'required' },
      },
    })
    const allRebar = fixture('all-rebar', {
      link: {
        kind: 'rc',
        sources: [],
        auto: { rcKinds: [] },
        rc: { output: 'rebar' },
      },
    })
    const relations = linkRelations([slab, beam, ordinary, slabRebar, allRebar])

    expect(relations.sources.get(slabRebar.id)?.map(source => [source.id, source.auto]))
      .toEqual([[slab.id, true]])
    expect(relations.sources.get(allRebar.id)?.map(source => [source.id, source.auto]))
      .toEqual([[slab.id, true], [beam.id, true]])
    expect(relations.dependents.get(slab.id)?.map(item => item.id))
      .toEqual([slabRebar.id, allRebar.id])
    expect(relations.dependents.get(beam.id)?.map(item => item.id))
      .toEqual([allRebar.id])
    expect(relations.dependents.has(ordinary.id)).toBe(false)
  })

  it('形から根切り、根切りから埋戻しという連鎖を直接の元と先で表す', () => {
    const shape = fixture('shape', { kind: 'area' })
    const excavation = fixture('excavation', {
      name: '根切り',
      link: {
        kind: 'shape',
        sources: [{ itemId: shape.id }],
        shape: { output: 'excavation', depthM: 1 },
      },
    })
    const concrete = fixture('concrete', { kind: 'volume' })
    const backfill = fixture('backfill', {
      name: '埋戻し',
      link: {
        kind: 'factor',
        sources: [
          { itemId: excavation.id },
          { itemId: concrete.id, sign: -1 },
        ],
      },
    })
    const relations = linkRelations([shape, excavation, concrete, backfill])

    expect(relations.sources.get(backfill.id)?.map(source => [source.id, source.sign]))
      .toEqual([[excavation.id, 1], [concrete.id, -1]])
    expect(relations.dependents.get(shape.id)?.map(item => item.id))
      .toEqual([excavation.id])
    expect(relations.dependents.get(excavation.id)?.map(item => item.id))
      .toEqual([backfill.id])
    expect(relations.dependents.get(concrete.id)?.map(item => item.id))
      .toEqual([backfill.id])
    expect(relations.dependents.has(backfill.id)).toBe(false)
  })

  it('交差の区画と存在しない元を含めず、数量の有無に依存しない', () => {
    const line = fixture('line', { kind: 'length' })
    const barrier = fixture('barrier', { name: '防火区画', kind: 'length' })
    const crossing = fixture('crossing', {
      link: {
        kind: 'crossing',
        sources: [{ itemId: line.id }, { itemId: 'deleted' }],
        crossing: { barrierItemIds: [barrier.id], planCrossings: true },
      },
    })
    const empty = fixture('empty', {
      link: { kind: 'factor', sources: [{ itemId: 'deleted' }] },
    })
    const relations = linkRelations([line, barrier, crossing, empty])

    expect(relations.sources.get(crossing.id)).toEqual([
      { id: line.id, code: line.code, name: line.name, auto: false, sign: 1 },
    ])
    expect(relations.dependents.has(barrier.id)).toBe(false)
    expect(relations.dependents.has('deleted')).toBe(false)
    expect(relations.sources.get(empty.id)).toEqual([])
    expect(linkSourceText([])).toBe('')
    expect(linkSourceTitle([])).toBe('')
    expect(linkDependentTitle([])).toBe('')
  })

  it('同じ元に設定が複数あっても連動先の件数を重複させない', () => {
    const source = fixture('source')
    const linked = fixture('linked', {
      link: {
        kind: 'factor',
        sources: [
          { itemId: source.id, conditions: ['新設'] },
          { itemId: source.id, conditions: ['撤去'], sign: -1 },
        ],
      },
    })
    const relations = linkRelations([source, linked])

    expect(relations.sources.get(linked.id)).toHaveLength(2)
    expect(relations.dependents.get(source.id)).toEqual([
      { id: linked.id, code: linked.code, name: linked.name },
    ])
  })
})
