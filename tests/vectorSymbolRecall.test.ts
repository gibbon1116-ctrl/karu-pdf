import { describe, expect, it } from 'vitest'
import type { Rect } from '../src/core/annotations'
import { prepareVectorTemplate, vectorSymbolSearch, type VectorSymbolOptions } from '../src/core/vectorSymbolSearch'
import { detectTemplateRings, mergeCollinearStrokes, voteRingCenters } from '../src/core/vectorStrokes'

type Line = [number, number, number, number]
const square: Line[] = [[0,0,20,0],[20,0,20,20],[20,20,0,20],[0,20,0,0]]
const asymmetric: Line[] = [[0,0,20,0],[0,0,0,8],[0,8,5,8],[5,8,5,3]]
const circle = (n: number, r = 8): Line[] => Array.from({ length: n }, (_, i) => [r*Math.cos(i*2*Math.PI/n),r*Math.sin(i*2*Math.PI/n),r*Math.cos((i+1)*2*Math.PI/n),r*Math.sin((i+1)*2*Math.PI/n)])
const outlet = (n = 24): Line[] => [...circle(n),[-2,-5,-2,5],[2,-5,2,5]]
const stamp = (lines: Line[], x: number, y: number, angle = 0, scale = 1) => lines.flatMap(([ax,ay,bx,by]) => {
  const c = Math.cos(angle)*scale, s = Math.sin(angle)*scale
  return [x+c*ax-s*ay,y+s*ax+c*ay,x+c*bx-s*by,y+s*bx+c*by]
})
const split = (lines: Line[], fractions: number[]): Line[] => lines.flatMap(([ax,ay,bx,by]) => fractions.slice(1).map((t, j) => [ax+(bx-ax)*fractions[j],ay+(by-ay)*fractions[j],ax+(bx-ax)*t,ay+(by-ay)*t]))
const uniform = (n: number) => Array.from({ length: n+1 }, (_, i) => i/n)
function search(sample: Line[], targets: Line[][], options: Partial<VectorSymbolOptions> = {}, sampleWidth = .5, widths?: number[]) {
  const data = new Float32Array([...stamp(sample,30,30), ...targets.flatMap((v,i) => stamp(v,100+i*70,30))])
  const aligned = new Float32Array([ ...Array(sample.length).fill(sampleWidth), ...targets.flatMap((v,i) => Array(v.length).fill(widths?.[i] ?? sampleWidth)) ])
  const xs = sample.flatMap(l => [l[0],l[2]]), ys = sample.flatMap(l => [l[1],l[3]])
  const rect: Rect = [30+Math.min(...xs),30+Math.min(...ys),30+Math.max(...xs),30+Math.max(...ys)]
  const before = data.slice(), beforeWidths = aligned.slice()
  const result = vectorSymbolSearch(data,rect,{ threshold:.85,...options },data,aligned,aligned)
  expect(data).toEqual(before); expect(aligned).toEqual(beforeWidths)
  return result
}
const expectSites = (result: ReturnType<typeof search>, xs: number[], centerOffset = 0) => {
  expect(result.matches).toHaveLength(xs.length)
  expect(result.matches.map(m => Math.round(m.center[0]-centerOffset)).sort((a,b)=>a-b)).toEqual(xs)
}

describe('subdivision-independent vector recall', () => {
  it('merges two, seven and irregular five-part sides in both directions', () => {
    const two = split(square,uniform(2)), seven = split(square,uniform(7)), irregular = split(square,[0,.03,.18,.59,.77,1])
    expectSites(search(square,[two,seven,irregular]),[30,100,170,240],10)
    expectSites(search(seven,[square,two]),[30,100,170],10)
  })
  it('ignores drawing order and endpoint direction', () => {
    const divided = split(square,uniform(7))
    const shuffled = divided.map((v,i)=>({v,key:(i*17)%divided.length})).sort((a,b)=>a.key-b.key).map(v=>v.v)
    expectSites(search(square,[[...divided].reverse(),shuffled,divided.map(([a,b,c,d])=>[c,d,a,b])]),[30,100,170,240],10)
  })
  it('finds circles at 24, 40 and 12 subdivisions through ring anchors', () => {
    const result = search(circle(24),[circle(40),circle(12)])
    expectSites(result,[30,100,170]); expect(result.stats.ringAnchor).toBe(true)
    expect(result.matches.some(m=>m.source==='ring')).toBe(true)
  })
  it('finds outlets with differently divided circles and split slots', () => {
    const splitSlots: Line[] = [...circle(40),...split(outlet().slice(24),uniform(2))]
    expectSites(search(outlet(),[outlet(40),splitSlots]),[30,100,170])
  })
  it('finds 90 and 37 degree split asymmetric symbols only with rotations', () => {
    const targets = [Math.PI/2,37*Math.PI/180].map(angle => {
      const flat = stamp(split(asymmetric,uniform(5)),0,0,angle)
      return Array.from({length:flat.length/4},(_,i)=>flat.slice(i*4,i*4+4) as Line)
    })
    const rotated = search(asymmetric,targets,{rotations:true})
    expect(rotated.matches).toHaveLength(3)
    expect(rotated.matches.map(m=>Math.round(m.angle)).sort((a,b)=>a-b)).toEqual([0,37,90])
    for (const [index,angle] of [Math.PI/2,37*Math.PI/180].entries()) {
      const x=100+index*70+10*Math.cos(angle)-4*Math.sin(angle),y=30+10*Math.sin(angle)+4*Math.cos(angle)
      expect(rotated.matches.some(m=>Math.hypot(m.center[0]-x,m.center[1]-y)<.01)).toBe(true)
    }
    expect(search(asymmetric,targets,{rotations:false}).matches).toHaveLength(1)
  })
  it('uses scale only beyond absolute tolerance and respects the limited range', () => {
    const scaled = (scale: number) => square.map(l=>l.map(v=>v*scale) as Line)
    const result = search(square,[scaled(1.03),scaled(1.01),scaled(1.12)],{tolerance:.25})
    expectSites(result,[30,100,170],10)
    expect(result.matches.find(m=>m.center[0]>90&&m.center[0]<130)?.scale).toBeCloseTo(1.03)
    expect(result.matches.find(m=>m.center[0]>150)?.scale).toBeUndefined()
    expect(search(square,[scaled(1.03)],{tolerance:.25,scaleRange:0}).matches).toHaveLength(1)
    expect(search(square,[scaled(1.12)],{tolerance:.25,scaleRange:.5}).matches).toHaveLength(1)
  })
  it('retains the original width policy', () => {
    const result = search(square,[square,square,square],{},.5,[.3,.9,.2])
    expectSites(result,[30,100,170],10)
    expect(result.stats.targetSegments).toBe(16); expect(result.stats.widthFilteredSegments).toBe(12)
  })
  it('finds wired targets from both bare and wired samples', () => {
    const body = outlet(), variants: Line[][] = [body,[...body,[-30,0,-8,0]],[...body,[-30,0,30,0]],[...body,[0,-30,0,-8]]]
    for (const sample of [body,variants[1]]) {
      // Sample selection is the symbol body; external wiring seeds cleanup.
      const data = new Float32Array([...stamp(sample,30,30),...variants.flatMap((v,i)=>stamp(v,100+i*70,30))])
      const widths = new Float32Array(data.length/4).fill(.5)
      expectSites(vectorSymbolSearch(data,[22,22,38,38],{threshold:.85},data,widths,widths),[30,100,170,240,310])
    }
  })
  it('protects an internal collinear slot while removing actual wiring inside the selection', () => {
    const body: Line[] = [...circle(24,4),[-2,0,2,0],[-2,2,2,2]]
    const lines = new Float32Array([...stamp(body,20,20),10,20,16,20,16,20,16.8,20])
    const result = prepareVectorTemplate(lines,new Float32Array(lines.length/4).fill(.5),[15,15,25,25])
    expect(Array.from(result.segments)).toContain(18)
    expect(Array.from(result.segments.slice(-8))).toEqual(stamp(body.slice(-2),20,20))
    expect(result.removed.wiring).toBe(1)
  })
  it('excludes a bare circle and flags a crossed circle when it reaches coverage', () => {
    const result = search(outlet(),[circle(40),[...circle(24),[-5,-5,5,5],[-5,5,5,-5]]])
    expect(result.matches.some(m=>Math.abs(m.center[0]-100)<2)).toBe(false)
    for (const match of result.matches.filter(m=>m.center[0]>120)) expect(match.extra).toBeGreaterThan(.4)
  })
  it.fails('SPEC 12 limitation: an added third slot cannot exceed .4 extra with unchanged length fractions', () => {
    const result = search(outlet(),[[...outlet(),[0,-5,0,5]]])
    const match = result.matches.find(m=>Math.abs(m.center[0]-100)<2)!
    expect(match).toBeDefined(); expect(match.extra).toBeGreaterThan(.4)
  })
  it('records the superset limitation without changing score or extra', () => {
    const result = search(outlet(),[[...outlet(),[0,-5,0,5]]])
    const match = result.matches.find(m=>Math.abs(m.center[0]-100)<2)!
    expect(match).toBeDefined(); expect(match.score).toBeCloseTo(1)
    expect(match.extra).toBeGreaterThan(0); expect(match.extra).toBeLessThan(.4)
  })
  it('reports geometry sites, final results, sources and cancellation', () => {
    const result = search(square,[split(square,uniform(7))],{exhaustiveAnchors:true})
    expect(result.stats.placements).toBeGreaterThan(0); expect(result.stats.final).toBe(result.matches.length)
    expect(result.stats.geometrySites).toBeGreaterThanOrEqual(result.stats.final)
    expect(result.stats.anchors).toBe(4); expect(result.matches.every(m=>m.source)).toBe(true)
    const stopped = search(square,[square],{shouldStop:()=>true})
    expect(stopped.stats.stopped).toBe(true); expect(stopped.stats.placements).toBe(0)
  })
})

describe('stroke and ring primitives', () => {
  it('does not merge dashed gaps or drifting arc tangents; bounds maximum length', () => {
    const dashed = new Float32Array([0,0,1,0,1.4,0,2.4,0,2.4,0,3.4,0])
    expect(mergeCollinearStrokes(dashed,.3).count).toBe(2)
    expect(mergeCollinearStrokes(new Float32Array(circle(720).flat()),.3).count).toBeGreaterThan(20)
    const bounded = mergeCollinearStrokes(new Float32Array(split(square,uniform(7)).flat()),.3,{maxLength:8})
    for (let i=0;i<bounded.lines.length;i+=4) expect(Math.hypot(bounded.lines[i+2]-bounded.lines[i],bounded.lines[i+3]-bounded.lines[i+1])).toBeLessThanOrEqual(8)
    expect(mergeCollinearStrokes(new Float32Array(square.flat()),.3,{maxLength:8}).count).toBe(0)
    expect(mergeCollinearStrokes(new Float32Array([0,0,0,0]),.3).count).toBe(0)
  })
  it('fits shuffled/reversed rings, handles junction arcs, and ignores squares', () => {
    const ring = circle(40).reverse().map(([a,b,c,d])=>[c,d,a,b])
    expect(detectTemplateRings(new Float32Array(ring.flat()),.3)[0].radius).toBeCloseTo(8)
    expect(detectTemplateRings(new Float32Array([...circle(40).flat(),8,0,16,0]),.3)).toHaveLength(1)
    expect(detectTemplateRings(new Float32Array(square.flat()),.3)).toHaveLength(0)
  })
  it('votes independently of subdivision and reports vote limits and cancellation', () => {
    const lines = new Float32Array([...stamp(circle(12),20,30),...stamp(circle(40),70,30)].reverse())
    // Reversing all coordinates exchanges axes and endpoints; centers exchange axes too.
    const result = voteRingCenters(lines,8,.5)
    expect(result.centers).toHaveLength(2)
    expect(result.centers.every(v=>v.support>=.6*2*Math.PI*8)).toBe(true)
    expect(voteRingCenters(lines,8,.5,{maxVotes:1}).limited).toBe(true)
    const long = new Float32Array(Array.from({length:5000},(_,i)=>[i,0,i+.1,0]).flat())
    expect(voteRingCenters(long,8,.5,{shouldStop:()=>true}).stopped).toBe(true)
    expect(mergeCollinearStrokes(long,.3,{shouldStop:()=>true}).stopped).toBe(true)
  })
  it('merges 100,000 random lines without an all-pairs scan (1s advisory)', () => {
    let state = 42
    const random = () => ((state=(Math.imul(state,1664525)+1013904223)>>>0)/0x100000000)
    const lines = new Float32Array(400_000)
    for(let i=0;i<lines.length;i+=4) {
      const x=random()*5000,y=random()*5000,angle=random()*2*Math.PI,length=.1+random()*20
      lines.set([x,y,x+Math.cos(angle)*length,y+Math.sin(angle)*length],i)
    }
    const before=performance.now(), result=mergeCollinearStrokes(lines,.5)
    console.log('VECTOR_STROKES_PERF',JSON.stringify({ms:performance.now()-before,input:100_000,output:result.count}))
    expect(result.count).toBeLessThanOrEqual(100_000)
  },30_000)
})
