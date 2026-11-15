import { describe, expect, it } from 'vitest'
import type { Point, Rect } from '../src/core/annotations'
import type { CountFixture } from '../src/core/countFixtures'
import { AnnotationStore } from '../src/editor/AnnotationStore'

const fixture: CountFixture = { id: 'led', code: 'LED', name: '照明', category: '電気', order: 0,
  style: { shape: 'circle', fill: 'none', color: [1, 0, 0], size: 10, opacity: .8, showCode: true } }
const sampleRect: Rect = [0, 0, 24, 24]
const candidate = (x: number, y: number, pageIndex = 0) => ({
  pageIndex, center: [x, y] as Point, rect: [x - 4, y - 4, x + 4, y + 4] as Rect,
  sampleBox: [x - 12, y - 12, x + 12, y + 12] as Rect, score: 1,
})
async function setup() {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => [fixture,
    { ...fixture, id: 'other', name: '別の項目', order: 1 },
    { ...fixture, id: 'another', name: 'さらに別の項目', order: 2 },
  ], async () => {})
  store.selectFixture('led')
  store.beginSymbolCandidates('led', sampleRect)
  return store
}

describe('記号本体に載った印と候補の対応づけ', () => {
  it('10pt 間隔の縦並びで下の他項目の印を上の候補に対応づけない', async () => {
    const store = await setup()
    store.createCountMarks('other', [{ pageIndex: 0, center: [30, 50] }])
    store.appendSymbolCandidates([candidate(30, 40), candidate(30, 50)])
    const [upper, lower] = store.symbolCandidates!
    expect(upper.otherFixture).toBeUndefined()
    expect(upper.state).toBe('pending')
    expect(lower.otherFixture).toBe('other')
    expect(lower.state).toBe('pending')
    expect(store.visibleSymbolCandidates).toEqual([upper])
  })

  it('10pt 間隔の縦並びで下の同項目の印は下だけを counted にする', async () => {
    const store = await setup()
    store.createCountMarks('led', [{ pageIndex: 0, center: [30, 50] }])
    store.appendSymbolCandidates([candidate(30, 40), candidate(30, 50)])
    expect(store.symbolCandidates!.map(c => c.state)).toEqual(['pending', 'counted'])
    expect(store.symbolCandidates!.map(c => c.otherFixture)).toEqual([undefined, undefined])
  })

  it.each(['led', 'other'])('%s の印が本体内で中心から 2pt ずれていても対応づける', async fixtureId => {
    const store = await setup()
    store.createCountMarks(fixtureId, [{ pageIndex: 0, center: [52, 50] }])
    store.appendSymbolCandidates([candidate(50, 50)])
    const [match] = store.symbolCandidates!
    expect(match.state).toBe(fixtureId === 'led' ? 'counted' : 'pending')
    expect(match.otherFixture).toBe(fixtureId === 'other' ? 'other' : undefined)
  })

  it.each(['led', 'other'])('%s の印が中心から 6pt 離れて本体の拡張範囲外なら半径内でも対応づけない', async fixtureId => {
    const store = await setup()
    store.createCountMarks(fixtureId, [{ pageIndex: 0, center: [56, 50] }])
    store.appendSymbolCandidates([candidate(50, 50)])
    expect(store.symbolCandidates![0].state).toBe('pending')
    expect(store.symbolCandidates![0].otherFixture).toBeUndefined()
  })

  it.each([{ offset: 5, matched: true }, { offset: 5.3, matched: false }])('本体の短辺の 15% の余白を適用する（ずれ $offset pt）', async ({ offset, matched }) => {
    const store = await setup()
    store.createCountMarks('other', [{ pageIndex: 0, center: [50 + offset, 50] }])
    store.appendSymbolCandidates([candidate(50, 50)])
    expect(store.symbolCandidates![0].otherFixture).toBe(matched ? 'other' : undefined)
  })

  it('小さい本体にも最低 0.3pt の余白を設ける', async () => {
    const store = await setup()
    store.createCountMarks('other', [{ pageIndex: 0, center: [50.75, 50] }])
    store.appendSymbolCandidates([{ ...candidate(50, 50), rect: [49.5, 49.5, 50.5, 50.5] }])
    expect(store.symbolCandidates![0].otherFixture).toBe('other')
  })

  it.each([{ offset: 2, matched: true }, { offset: 2.01, matched: false }])('本体内でも従来の半径を超えない（ずれ $offset pt）', async ({ offset, matched }) => {
    const store = await setup()
    store.beginSymbolCandidates('led', [0, 0, 4, 4])
    store.createCountMarks('other', [{ pageIndex: 0, center: [50 + offset, 50] }])
    store.appendSymbolCandidates([candidate(50, 50)])
    expect(store.symbolCandidates![0].otherFixture).toBe(matched ? 'other' : undefined)
  })

  it.each(['led', 'other'])('%s の印が本体の重なりにある場合は近い候補1件だけに対応づける', async fixtureId => {
    const store = await setup()
    store.createCountMarks(fixtureId, [{ pageIndex: 0, center: [54, 50] }])
    store.appendSymbolCandidates([candidate(50, 50), candidate(56, 50)])
    const [farther, nearer] = store.symbolCandidates!
    expect(farther.state).toBe('pending')
    expect(farther.otherFixture).toBeUndefined()
    expect(nearer.state).toBe(fixtureId === 'led' ? 'counted' : 'pending')
    expect(nearer.otherFixture).toBe(fixtureId === 'other' ? 'other' : undefined)
  })

  it('等距離なら候補の並び順で先の1件だけに対応づける', async () => {
    const store = await setup()
    store.createCountMarks('other', [{ pageIndex: 0, center: [53, 50] }])
    store.appendSymbolCandidates([candidate(56, 50), candidate(50, 50)])
    expect(store.symbolCandidates!.map(c => c.otherFixture)).toEqual(['other', undefined])
  })

  it.each([['other', 'another'], ['another', 'other']])('複数の他項目の印は近い項目を採用する（%s → %s）', async (first, second) => {
    const store = await setup()
    for (const fixtureId of [first, second]) {
      store.createCountMarks(fixtureId, [{ pageIndex: 0, center: [fixtureId === 'other' ? 53 : 51, 50] }])
    }
    store.appendSymbolCandidates([candidate(50, 50)])
    expect(store.symbolCandidates![0].otherFixture).toBe('another')
  })

  it.each([['led', 'other'], ['other', 'led']])('同項目と他項目の印が載る場合は counted を優先する（%s → %s）', async (first, second) => {
    const store = await setup()
    for (const fixtureId of [first, second]) store.createCountMarks(fixtureId, [{ pageIndex: 0, center: [50, 50] }])
    store.appendSymbolCandidates([candidate(50, 50)])
    expect(store.symbolCandidates![0].state).toBe('counted')
    expect(store.symbolCandidates![0].otherFixture).toBeUndefined()
  })

  it.each(['led', 'other'])('%s の印に近い候補が追加されたら以前の対応を外す', async fixtureId => {
    const store = await setup()
    store.createCountMarks(fixtureId, [{ pageIndex: 0, center: [54, 50] }])
    store.appendSymbolCandidates([candidate(50, 50)])
    const previous = store.symbolCandidates![0]
    expect(previous.state).toBe(fixtureId === 'led' ? 'counted' : 'pending')
    expect(previous.otherFixture).toBe(fixtureId === 'other' ? 'other' : undefined)
    store.appendSymbolCandidates([candidate(54, 50)])
    expect(previous.state).toBe('pending')
    expect(previous.otherFixture).toBeUndefined()
    expect(store.symbolCandidates![1].state).toBe(fixtureId === 'led' ? 'counted' : 'pending')
    expect(store.symbolCandidates![1].otherFixture).toBe(fixtureId === 'other' ? 'other' : undefined)
  })

  it.each(['led', 'other'])('%s の印を削除すると counted と otherFixture を解除する', async fixtureId => {
    const store = await setup()
    const [id] = store.createCountMarks(fixtureId, [{ pageIndex: 0, center: [50, 50] }])
    store.appendSymbolCandidates([candidate(50, 50)])
    store.remove(id)
    expect(store.symbolCandidates![0].state).toBe('pending')
    expect(store.symbolCandidates![0].otherFixture).toBeUndefined()
  })

  it('別ページの同じ座標の候補には印を対応づけない', async () => {
    const store = await setup()
    store.createCountMarks('other', [{ pageIndex: 0, center: [50, 50] }])
    store.appendSymbolCandidates([candidate(50, 50, 1), candidate(50, 50, 0)])
    expect(store.symbolCandidates!.map(c => c.otherFixture)).toEqual([undefined, 'other'])
  })

  it('他項目の印が後から載ると hide 中の chosen を pending に戻す', async () => {
    const store = await setup()
    store.appendSymbolCandidates([candidate(50, 50), candidate(80, 50)])
    store.chooseSymbolCandidates(true)
    store.createCountMarks('other', [{ pageIndex: 0, center: [50, 50] }])
    expect(store.symbolCandidates!.map(c => c.state)).toEqual(['pending', 'chosen'])
    store.setSymbolOtherFilter('show')
    expect(store.visibleSymbolCandidates).toHaveLength(2)
    expect(store.symbolCandidates![0].state).toBe('pending')
  })
})
