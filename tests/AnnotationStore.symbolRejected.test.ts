import { describe, expect, it } from 'vitest'
import { AnnotationStore } from '../src/editor/AnnotationStore'
import type { CountFixture } from '../src/core/countFixtures'
import type { Point, Rect } from '../src/core/annotations'

const fixture: CountFixture = { id: 'led', code: 'LED', name: '照明', category: '電気', order: 0,
  style: { shape: 'circle', fill: 'none', color: [1,0,0], size: 10, opacity: .8, showCode: true } }
const rect: Rect = [0,0,12,20]
const candidate = (x: number) => ({ pageIndex: 0, rect: [x-6,0,x+6,20] as Rect, center: [x,10] as Point, score: 1, confidence: 'high' as const })
async function setup() {
  const store = new AnnotationStore()
  await store.ensureCountFixtures(async () => [fixture], async () => {})
  store.selectFixture('led'); store.beginSymbolCandidates('led', rect)
  return store
}

describe('構造除外候補の一時表示', () => {
  it('既定で隠し表示を戻すと chosen を pending に戻す', async () => {
    const store = await setup()
    store.appendSymbolCandidates([{ ...candidate(30), rejected: 'structure' }, candidate(70)])
    const [rejected, ordinary] = store.symbolCandidates!
    expect(store.symbolRejectedFilter).toBe('hide')
    expect(store.visibleSymbolCandidates).toEqual([ordinary])
    store.toggleSymbolCandidate(rejected.id)
    expect(rejected.state).toBe('pending')
    store.setSymbolRejectedFilter('show')
    expect(store.visibleSymbolCandidates).toEqual([rejected, ordinary])
    store.chooseSymbolCandidates(true)
    store.setSymbolRejectedFilter('hide')
    expect(rejected.state).toBe('pending')
    expect(ordinary.state).toBe('chosen')
  })
  it('rejected・supplement・scale 付きは high を渡されても要確認として扱う', async () => {
    const store = await setup()
    store.appendSymbolCandidates([{ ...candidate(30), rejected: 'structure' }, { ...candidate(70), supplement: 'image', vectorScore: 1 },
      { ...candidate(110), scale: 1.04 }, candidate(150)])
    store.setSymbolRejectedFilter('show'); store.chooseHighConfidenceCandidates()
    expect(store.symbolCandidates!.map(c => [c.confidence,c.state])).toEqual([
      ['check','pending'], ['check','pending'], ['check','pending'], ['high','chosen'],
    ])
    expect(store.getPageAnnotations(0)).toHaveLength(0)
  })
  it('clear と begin は hide に戻し候補なしでも clear の早期 return に入らない', async () => {
    const store = await setup()
    store.setSymbolRejectedFilter('show'); store.beginSymbolCandidates('led',rect)
    expect(store.symbolRejectedFilter).toBe('hide')
    store.setSymbolRejectedFilter('show'); store.clearSymbolCandidates()
    expect(store.symbolRejectedFilter).toBe('hide')
    expect(store.symbolCandidates).toBeNull()
    store.setSymbolRejectedFilter('show'); store.clearSymbolCandidates()
    expect(store.symbolRejectedFilter).toBe('hide')
  })
})
