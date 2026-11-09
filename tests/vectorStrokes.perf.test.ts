import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Rect } from '../src/core/annotations'
import { vectorSymbolSearch } from '../src/core/vectorSymbolSearch'
import { CellMap, cellKey, cellX, cellY, spatialIndex, gridLines, mergeCollinearStrokes } from '../src/core/vectorStrokes'

type Line = [number, number, number, number]
const square: Line[] = [[0,0,10,0],[10,0,10,10],[10,10,0,10],[0,10,0,0],[0,0,10,10],[10,0,0,10]]
const outlet: Line[] = [
  ...Array.from({ length: 24 }, (_, i): Line => [4*Math.cos(i*Math.PI/12),4*Math.sin(i*Math.PI/12),
    4*Math.cos((i+1)*Math.PI/12),4*Math.sin((i+1)*Math.PI/12)]),
  [-1,-2,-1,2], [1,-2,1,2],
]
const centers = Array.from({ length: 200 }, (_, i) => [20+i%40*30,20+Math.floor(i/40)*30])

function fixture(ring: boolean) {
  const data: number[] = []
  let state = 42
  const random = () => ((state = (Math.imul(state,1664525)+1013904223) >>> 0)/0x100000000)
  for (let i = 0; i < 100_000; i++) {
    const x = random()*5000, y = 500+random()*5000, angle = random()*Math.PI*2, length = 2+random()*28
    data.push(x,y,x+Math.cos(angle)*length,y+Math.sin(angle)*length)
  }
  const lines = ring ? outlet : square
  for (const [i, [x,y]] of centers.entries()) {
    const angle = ring ? i%4*Math.PI/2 : 0, cos = Math.cos(angle), sin = Math.sin(angle)
    for (const [ax,ay,bx,by] of lines) {
      // Half the symbols have every edge subdivided, including both slots.
      const parts = i%2 ? 2 : 1
      for (let j = 0; j < parts; j++) {
        const x0 = ax+(bx-ax)*j/parts, y0 = ay+(by-ay)*j/parts
        const x1 = ax+(bx-ax)*(j+1)/parts, y1 = ay+(by-ay)*(j+1)/parts
        data.push(x+cos*x0-sin*y0,y+sin*x0+cos*y0,x+cos*x1-sin*y1,y+sin*x1+cos*y1)
      }
    }
  }
  return { segments: new Float32Array(data), rect: (ring ? [16,16,24,24] : [20,20,30,30]) as Rect }
}

function stableResult(result: ReturnType<typeof vectorSymbolSearch>) {
  const { ms, mergeMs, candidateMs, verifyMs, ...counts } = result.stats
  return { matches: result.matches, rejected: result.rejected, template: result.template, stats: counts }
}

describe('vector search equivalence and advisory performance', () => {
  it('round-trips numeric keys and preserves overflow cells and traversal order', () => {
    const limit = 0x100000
    for (const x of [-limit+1,-1,0,1,limit-1]) for (const y of [-limit+1,-1,0,1,limit-1]) {
      expect(cellX(cellKey(x,y))).toBe(x)
      expect(cellY(cellKey(x,y))).toBe(y)
    }
    const cells = new CellMap<number>()
    for (const [i,[x,y]] of [[0,0],[-limit,0],[limit,0],[0,-limit],[0,limit],[1e7,-1e7]].entries()) cells.setCell(x,y,i)
    expect(cells.size).toBe(1)
    expect(cells.overflow.size).toBe(5)
    expect(cells.getCell(0,0)).toBe(0)
    expect(cells.getCell(1e7,-1e7)).toBe(5)
    // Interleave ordinary and overflow cells. A large query must keep their
    // original insertion order, including a line crossing the numeric boundary.
    const segments = new Float32Array([1e7,0,1e7+1,0, 0,0,1,0, -1e7,0,-1e7+1,0,
      limit-1,1,limit+1,1, 2,0,3,0])
    const grid = spatialIndex(segments,1)
    expect([...gridLines(grid,1,[-1e7-2,-2,1e7+2,2])]).toEqual([0,4,8,12,16])
    for (const i of [0,4,8,12,16]) {
      expect(gridLines(grid,1,[segments[i],segments[i+1],segments[i+2],segments[i+3]]).has(i)).toBe(true)
    }
    // A narrow query exercises direct overflow lookup, separately from the
    // occupied-cell path used above.
    expect([...gridLines(grid,1,[1e7,0,1e7,0])]).toEqual([0])
  })

  it('retains endpoint/cell insertion order during greedy merging', () => {
    const lines = new Float32Array([0,0,4,0, 4,.1,6,.1, 4,-.1,6,-.1, 6,0,8,0])
    const merged = mergeCollinearStrokes(lines,.4)
    expect(merged).toEqual({ lines: new Float32Array([0,0,8,0]), count: 1, stopped: false })
    const shifted = lines.map((v,i) => i%2 ? v : v+1e7)
    expect(mergeCollinearStrokes(shifted,.4).lines).toEqual(new Float32Array([1e7,0,1e7+8,0]))
    // Exceeding maxLength consumes the first neighbor before abandoning the
    // seed. The surviving stroke exposes endpoint order and within-cell order.
    expect(mergeCollinearStrokes(new Float32Array([0,0,4,0, 4,0,7,0, -3,0,0,0]),.4,{ maxLength: 5 }).lines)
      .toEqual(new Float32Array([4,0,7,0]))
    expect(mergeCollinearStrokes(new Float32Array([0,0,4,0, 4,.1,7,.1, 4,-.1,7,-.1]),.4,{ maxLength: 5 }).lines)
      .toEqual(new Float32Array([4,.1,7,.1]))
    expect(mergeCollinearStrokes(new Float32Array([0,0,4,0, 4,.1,7,.1, 4,.15,7,.15]),.4,{ maxLength: 5 }).lines)
      .toEqual(new Float32Array([4,.15,7,.15]))
  })

  for (const ring of [false,true]) it(ring ? '200 rotated outlets in 100,000 random lines' : '200 crossed squares in 100,000 random lines', () => {
    const { segments, rect } = fixture(ring)
    const times: number[] = [], heaps: number[] = [], phases: number[][] = []
    let first: ReturnType<typeof stableResult> | undefined
    for (let run = 0; run < 3; run++) {
      const heap = process.memoryUsage().heapUsed, started = performance.now()
      const result = vectorSymbolSearch(segments,rect,{ rotations: ring })
      times.push(performance.now()-started); heaps.push(process.memoryUsage().heapUsed-heap)
      phases.push([result.stats.mergeMs,result.stats.candidateMs,result.stats.verifyMs])
      expect(result.matches).toHaveLength(200)
      expect(result.rejected).toEqual([])
      const expected = centers.map(([x,y]) => [x+(ring ? 0 : 5),y+(ring ? 0 : 5)])
      const found = new Set<number>()
      for (const match of result.matches) {
        const index = expected.findIndex(([x,y]) => Math.hypot(x-match.center[0],y-match.center[1]) < 1)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(found.has(index)).toBe(false)
        found.add(index)
        expect(match.score).toBeCloseTo(1,12)
        expect(match.extra).toBe(0)
        expect(match.around).toBe(0)
        expect(match.source).toBe('primary')
        expect((ring ? [index%2*90,index%2*90+180] : [0,180]).some(a => Math.abs(match.angle-a) < 1e-6)).toBe(true)
      }
      expect(result.stats).toMatchObject({
        targetSegments: 100_000+300*(ring ? 26 : 6), widthFilteredSegments: segments.length/4,
        templateStrokes: ring ? 26 : 6, anchors: 3, ringAnchor: false, // templates with straight key strokes skip the ring anchor
        final: 200, scaled: 0, limited: 0, regionExcluded: 0, structureExcluded: 0,
        structureExcludedSites: 0, rotationExcluded: 0, stopped: false, ringLimited: false,
      })
      const stable = stableResult(result)
      if (first) expect(stable).toEqual(first)
      else first = stable
    }
    console.log('VECTOR_PERF',JSON.stringify({ fixture: ring ? 'outlet' : 'crossed-square',
      medianMs: [...times].sort((a,b)=>a-b)[1], heapUsedDelta: heaps, medianHeapUsedDelta: [...heaps].sort((a,b)=>a-b)[1],
      times, phases, digest: createHash('sha256').update(JSON.stringify(first)).digest('hex'), stats: first!.stats }))
  },60_000)
})
