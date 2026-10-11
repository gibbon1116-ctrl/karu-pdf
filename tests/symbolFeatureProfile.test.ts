import {expect,it} from 'vitest'
import mupdf from 'mupdf'
import {extractVectorPage} from '../src/worker/vectorExtract'
import {segmentEndpoints} from '../src/core/vectorPaths'
import {compareSymbolInteriors,compareSymbolFills,compareSymbolFeatureProfiles,confirmSymbolVectorFeatures,describeSymbolInterior,probeSymbolVectorFeatures,
  SymbolFeatureGeometry,type SymbolBodyPose,type SymbolWorldImage,type SymbolInteriorProfile} from '../src/core/symbolFeatureProfile'

const pose:SymbolBodyPose={center:[30,60],width:10,height:8,angle:0}
const cup='25 56 m 35 56 l 35 61 33 64 30 64 c 27 64 25 61 25 56 c h S'
const arc='23.5 56 m 26 52 34 52 36.5 56 c S'
function fixture(commands:string,body=pose,rotation=0){
  const doc=new mupdf.PDFDocument(),p=doc.addPage([0,0,160,160],0,{},
    `q 1 0 0 -1 0 160 cm .7 w 0 G 0 g ${rotation?'0 1 -1 0 100 30 cm':''} ${commands} Q`)
  doc.insertPage(-1,p);p.destroy()
  const vector=extractVectorPage(doc,0),page=doc.loadPage(0),pix=page.toPixmap(mupdf.Matrix.scale(4,4),mupdf.ColorSpace.DeviceGray,false,false)
  const image:SymbolWorldImage={width:pix.getWidth(),height:pix.getHeight(),gray:Uint8Array.from(pix.getPixels(),v=>255-v),origin:[0,0],scale:4}
  pix.destroy();page.destroy();doc.destroy()
  return {vector,image,probe:probeSymbolVectorFeatures(new SymbolFeatureGeometry(vector.segments,vector.widths,true),body,.7),body}
}
const longPose:SymbolBodyPose={center:[30,60],width:20,height:4,angle:0}
const longRect='20 58 20 4 re S'
const circlePath='31.6 60 m 31.6 60.883656 30.883656 61.6 30 61.6 c 29.116344 61.6 28.4 60.883656 28.4 60 c 28.4 59.116344 29.116344 58.4 30 58.4 c 30.883656 58.4 31.6 59.116344 31.6 60 c h'
const whiteCircle=`q 1 g ${circlePath} f Q ${circlePath} S`
const longWire='5 60 m 28.4 60 l S'
const splitWire='5 60 m 20 60 l S 20 60 m 28.4 60 l S'
function longFixture(wiring='',circle=true,marks=''){
  return fixture(`${longRect} ${wiring} ${marks} ${circle?whiteCircle:''}`,longPose)
}
function ownedInterior(f:ReturnType<typeof fixture>){
  return describeSymbolInterior(f.image,f.body,f.probe.ownership)
}
function gridInterior(regions:Uint8Array,regionAreas:number[],mask=new Uint8Array(48*48)):SymbolInteriorProfile {
  return {known:true,mask,ink:mask.reduce((sum,v)=>sum+v,0)/mask.length,holes:[],regions,regionAreas}
}
it('separates a convex top arc from plain cup bodies and crossing wiring',()=>{
  const a=fixture(`${cup} ${arc} 30 10 m 30 56 l S`),b=fixture(`${cup} 30 10 m 30 56 l S`)
  expect(confirmSymbolVectorFeatures(a.probe,a.image).topArc).toBe('present')
  expect(confirmSymbolVectorFeatures(b.probe,b.image).topArc).toBe('absent')
})
it('uses the same arc contract for a rectangular apparatus body',()=>{
  const a=fixture(`25 56 10 8 re S ${arc}`),b=fixture('25 56 10 8 re S')
  expect(confirmSymbolVectorFeatures(a.probe,a.image).topArc).toBe('present')
  expect(confirmSymbolVectorFeatures(b.probe,b.image).topArc).toBe('absent')
})
it('does not assert a visible arc when a white overlay erases legacy geometry',()=>{
  const f=fixture(`${cup} ${arc} 1 g 22 49 16 8 re f`)
  expect(f.probe.topArc).toBe('present')
  expect(confirmSymbolVectorFeatures(f.probe,f.image).topArc).toBe('absent')
})
it('normalizes attachment orientation without modifying geometry or snap endpoints',()=>{
  const f=fixture(`${cup} ${arc}`,{center:[40,60],width:10,height:8,angle:90},90)
  const segments=f.vector.segments.slice(),widths=f.vector.widths.slice(),endpoints=segmentEndpoints(segments)
  expect(confirmSymbolVectorFeatures(f.probe,f.image).topArc).toBe('present')
  expect(f.vector.segments).toEqual(segments);expect(f.vector.widths).toEqual(widths)
  expect(segmentEndpoints(f.vector.segments)).toEqual(endpoints)
})
it('recognizes split rectangular wings but does not name a single through-wire as a frame',()=>{
  const wings='15 58 m 27 58 l S 33 58 m 45 58 l S 15 62 m 27 62 l S 33 62 m 45 62 l S'
  const a=fixture(wings),b=fixture('15 60 m 45 60 l S')
  expect(confirmSymbolVectorFeatures(a.probe,a.image).annexFrame).toBe('present')
  expect(confirmSymbolVectorFeatures(b.probe,b.image).annexFrame).toBe('absent')
})
it('preserves uncertainty for truncated geometry, dense regions, clipped crops and low resolution',()=>{
  const f=fixture(`${cup} ${arc}`)
  expect(probeSymbolVectorFeatures(new SymbolFeatureGeometry(f.vector.segments,f.vector.widths,false),pose,.7).topArc).toBe('unknown')
  expect(probeSymbolVectorFeatures(new SymbolFeatureGeometry(new Float32Array(Array.from({length:257},()=>[25,53,27,54]).flat()),undefined,true),pose).topArc).toBe('unknown')
  expect(confirmSymbolVectorFeatures(f.probe,{...f.image,origin:[30,60]}).topArc).toBe('unknown')
  expect(describeSymbolInterior({...f.image,scale:1},pose).known).toBe(false)
})
it('distinguishes fill, outline and white holes, retaining even-odd/white-overpaint equivalence',()=>{
  const filled=fixture('25 56 10 8 re f'),outline=fixture('25 56 10 8 re S')
  const hole=fixture('25 56 10 8 re f 1 g 27 58 6 4 re f'),evenOdd=fixture('25 56 10 8 re 27 58 6 4 re f*')
  const d=(f:ReturnType<typeof fixture>)=>describeSymbolInterior(f.image,pose)
  expect(compareSymbolInteriors(d(filled),d(outline))).toBe('different')
  expect(compareSymbolInteriors(d(filled),d(hole))).toBe('different')
  expect(compareSymbolInteriors(d(hole),d(evenOdd))).toBe('same')
})
it('retains white-hole position while treating a wire that splits a hole as uncertain',()=>{
  const a=fixture('25 56 10 8 re S 25 56 5 8 re f'),b=fixture('25 56 10 8 re S 30 56 5 8 re f')
  expect(compareSymbolInteriors(describeSymbolInterior(a.image,pose),describeSymbolInterior(b.image,pose))).toBe('different')
  const plain=fixture('25 56 10 8 re S'),wire=fixture('25 56 10 8 re S 23 60 m 37 60 l S')
  expect(compareSymbolInteriors(describeSymbolInterior(plain.image,pose),describeSymbolInterior(wire.image,pose))).toBe('unknown')
})
it('does not collapse an undersampled two-segment cap into known absence',()=>{
  const f=fixture(`${cup} 24 56 m 30 52 l 36 56 l S`)
  expect(f.probe.topArc).toBe('unknown')
})
it('counts owned diagonal marks once across subdivisions and excludes crossing wires',()=>{
  const a=fixture('25 56 10 8 re S 27 62 m 30 60 l 33 58 l S 22 60 m 38 60 l S')
  const b=fixture('25 56 10 8 re S 27 62 m 33 58 l S 27 60 m 30 58 l S')
  const plain=fixture('25 56 10 8 re S 22 52 m 38 68 l S')
  expect(confirmSymbolVectorFeatures(a.probe,a.image).interiorLineCount).toBe(1)
  expect(confirmSymbolVectorFeatures(b.probe,b.image).interiorLineCount).toBe(2)
  expect(confirmSymbolVectorFeatures(plain.probe,plain.image).interiorLineCount).toBe(0)
})
it('never clears unknown required attachment/text with a matching interior',()=>{
  const f=fixture('25 56 10 8 re f'),interior=describeSymbolInterior(f.image,pose,f.probe.ownership)
  const a={interior,bodyText:{status:'read' as const,text:'S'}},b={interior,bodyText:{status:'unknown' as const,text:''}}
  expect(compareSymbolFeatureProfiles(a,b,['interiorAppearance','topArc','bodyText'])).toEqual({decision:'unknown',features:{interiorAppearance:'same',topArc:'unknown',bodyText:'unknown'}})
  expect(compareSymbolFeatureProfiles(a,b,[]).decision).toBe('unknown')
})
it('keeps body and nearby lettering independent, preserves case, and does not treat unread as absent',()=>{
  const a={bodyText:{status:'read' as const,text:'Ｓ'},nearbyText:{status:'read' as const,text:'b'}}
  const b={bodyText:{status:'read' as const,text:'S'},nearbyText:{status:'read' as const,text:'B'}}
  expect(compareSymbolFeatureProfiles(a,b,['bodyText']).decision).toBe('same')
  expect(compareSymbolFeatureProfiles(a,b,['bodyText','nearbyText']).decision).toBe('different')
  expect(compareSymbolFeatureProfiles({nearbyText:{status:'none',text:''}},{nearbyText:{status:'unknown',text:''}},['nearbyText']).decision).toBe('unknown')
})
it('does not assert geometry completeness by default or treat faint ink as known absence',()=>{
  const f=fixture(`${cup} .8 G ${arc}`)
  expect(probeSymbolVectorFeatures(new SymbolFeatureGeometry(f.vector.segments,f.vector.widths),pose).topArc).toBe('unknown')
  expect(confirmSymbolVectorFeatures(f.probe,f.image).topArc).toBe('unknown')
})
it('does not confirm blank rendered bodies or malformed borrowed geometry',()=>{
  const f=fixture(`${cup} 1 g 20 50 20 20 re f`),d=describeSymbolInterior(f.image,pose)
  expect(d.known).toBe(false);expect(compareSymbolInteriors(d,d)).toBe('unknown')
  expect(()=>new SymbolFeatureGeometry(new Float32Array([0,0,NaN,1]))).toThrow()
})
it('reports a bounded unknown result instead of retaining an unbounded white-region list',()=>{
  const cells=Array.from({length:35},(_,i)=>`${25.5+i%7*1.3} ${56.5+Math.floor(i/7)*1.3} .8 .8 re`).join(' ')
  const f=fixture(`25 56 10 8 re f 1 g ${cells} f`)
  const d=describeSymbolInterior(f.image,pose)
  expect(d.known).toBe(false);expect(d.unknownReason).toBe('region-limit');expect(d.holes).toHaveLength(0)
  expect(compareSymbolFeatureProfiles({bodyText:{status:'read',text:''}},{bodyText:{status:'read',text:''}},['bodyText']).decision).toBe('unknown')
})
it('removes an incoming wire from a long fixture interior only when ownership is supplied',()=>{
  const a=longFixture(longWire),b=longFixture()
  expect(a.probe.ownership).toBeDefined();expect(b.probe.ownership).toBeDefined()
  expect(a.probe.ownership!.strokeWidth).toBe(.7)
  expect(a.probe.ownership!.foreign).toHaveLength(1)
  expect(a.probe.ownership!.foreign[0].a).toEqual([-15,2])
  expect(a.probe.ownership!.foreign[0].b[0]).toBeCloseTo(8.4)
  expect(a.probe.ownership!.foreign[0].width).toBeCloseTo(.7)
  const raw=describeSymbolInterior(a.image,a.body),clean=ownedInterior(a)
  expect(compareSymbolInteriors(raw,describeSymbolInterior(b.image,b.body))).toBe('unknown')
  expect(compareSymbolInteriors(clean,ownedInterior(b))).toBe('same')
  expect(compareSymbolFills(clean,ownedInterior(b))).toBe('same')
  expect(raw).not.toHaveProperty('erased')
  expect(raw).not.toHaveProperty('regions');expect(raw).not.toHaveProperty('regionAreas')
  expect(clean.regions).toBeInstanceOf(Uint8Array);expect(clean.regions).toHaveLength(48*48)
  expect(clean.regionAreas).toBeDefined()
  expect(clean.erased).toBeGreaterThan(0)
  expect(clean.erased).toBe((raw.mask.reduce((sum,v)=>sum+v,0)-clean.mask.reduce((sum,v)=>sum+v,0))/raw.mask.length)
  expect(clean.ink+clean.erased!).toBeCloseTo(raw.ink,12)
  expect(ownedInterior(b).erased).toBe(0)
})
it('keeps an internal same-width wire piece owned because a split at the outline cannot distinguish it from symbol ink',()=>{
  const a=longFixture(splitWire),b=longFixture()
  expect(a.probe.ownership).toBeDefined()
  expect(a.probe.ownership!.foreign).toHaveLength(0)
  const internal=a.probe.ownership!.owned.find(line=>Math.abs(line.a[0])<.001&&Math.abs(line.b[0]-8.4)<.001&&Math.abs(line.a[1]-2)<.001)
  expect(internal).toBeDefined();expect(internal!.width).toBeCloseTo(.7)
  expect(compareSymbolFills(ownedInterior(a),ownedInterior(b))).not.toBe('same')
  const reversed=longFixture('5 60 m 20 60 l S 28.4 60 m 20 60 l S')
  expect(reversed.probe.ownership!.foreign).toHaveLength(0)
  expect(reversed.probe.ownership!.owned.some(line=>Math.abs(line.a[0]-8.4)<.001&&Math.abs(line.b[0])<.001&&Math.abs(line.a[1]-2)<.001)).toBe(true)
  expect(compareSymbolFills(ownedInterior(reversed),ownedInterior(b))).not.toBe('same')
})
it('preserves strong body differences without changing conservative hole-count comparison',()=>{
  const plain=longFixture(longWire,false),circle=longFixture(longWire)
  const a=ownedInterior(plain),b=ownedInterior(circle)
  expect(a.known).toBe(true);expect(b.known).toBe(true)
  // The unchanged comparison deliberately keeps modest hole-count changes unknown.
  // A normal-width central circle cannot be required to bypass that rule.
  expect(compareSymbolInteriors(a,b)).toBe('unknown')
  expect(compareSymbolFills(a,b)).not.toBe('same')
  expect(compareSymbolFills(b,a)).not.toBe('same')
  // A 2.4 stroke is outside the 0.7 template width band, so S01b treats it as
  // background structure. Its visible ink must still prevent a same result.
  const strong=fixture(`${longRect} ${longWire} q 2.4 w ${whiteCircle} Q`,longPose)
  const c=ownedInterior(strong)
  expect(c.known).toBe(true)
  expect(compareSymbolFills(a,c)).not.toBe('same')
  expect(compareSymbolFills(c,a)).not.toBe('same')
})
it('retains a diagonal confined to the body as owned ink',()=>{
  const a=longFixture(longWire,true,'22 61.5 m 26 58.5 l S'),b=longFixture(longWire)
  expect(a.probe.ownership).toBeDefined()
  const diagonals=a.probe.ownership!.owned.filter(line=>Math.abs(line.a[0]-line.b[0])>3.9&&Math.abs(line.a[1]-line.b[1])>2.9)
  expect(diagonals).toHaveLength(1)
  expect(a.probe.ownership!.foreign.every(line=>Math.abs(line.a[1]-line.b[1])<.01)).toBe(true)
  const clean=ownedInterior(a)
  expect(clean.known).toBe(true)
  expect(compareSymbolInteriors(clean,ownedInterior(b))).not.toBe('same')
  expect(compareSymbolFills(clean,ownedInterior(b))).not.toBe('same')
  expect(compareSymbolFills(ownedInterior(b),clean)).not.toBe('same')
})
it('classifies thin background wiring independently of attachment stroke-width selection',()=>{
  const a=longFixture('q .1 w 5 60 m 55 60 l S Q'),b=longFixture()
  expect(a.probe.ownership).toBeDefined()
  expect(a.probe.ownership!.foreign).toHaveLength(1)
  expect(a.probe.ownership!.foreign[0].width).toBeCloseTo(.1)
  expect(a.probe.ownership!.foreign[0].a).toEqual([-15,2])
  expect(a.probe.ownership!.foreign[0].b).toEqual([35,2])
  expect(compareSymbolInteriors(ownedInterior(a),ownedInterior(b))).toBe('same')
  expect(compareSymbolFills(ownedInterior(a),ownedInterior(b))).toBe('same')
})
it('does not classify body edges as foreign under a two-degree pose error',()=>{
  const angle=2*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle)
  const tx=30-30*c+60*s,ty=60-30*s-60*c
  const f=fixture(`q ${c} ${s} ${-s} ${c} ${tx} ${ty} cm ${longRect} ${whiteCircle} Q`,longPose)
  expect(f.probe.ownership).toBeDefined()
  expect(f.probe.ownership!.foreign).toHaveLength(0)
  const edges=f.probe.ownership!.owned.filter(line=>Math.hypot(line.b[0]-line.a[0],line.b[1]-line.a[1])>3.9)
  expect(edges).toHaveLength(4)
  expect(edges.some(line=>[line.a,line.b].some(p=>p[1]<-.14||p[1]>4.14))).toBe(true)
})
it('omits ownership above 512 nearby lines while retaining existing attachment processing',()=>{
  const dense=Array.from({length:513},(_,i)=>`5 ${56+i*.015} m 55 ${56+i*.015} l S`).join(' ')
  const f=fixture(`${longRect} q .1 w ${dense} Q ${whiteCircle}`,longPose)
  expect(f.vector.segments.length/4).toBeGreaterThan(512)
  expect(f.probe.complete).toBe(true)
  expect(f.probe.ownership).toBeUndefined()
  expect(f.probe).not.toHaveProperty('ownership')
  const original=describeSymbolInterior(f.image,f.body),fallback=describeSymbolInterior(f.image,f.body,f.probe.ownership)
  expect(fallback).toEqual(original)
  expect(fallback).not.toHaveProperty('erased')
  expect(fallback).not.toHaveProperty('regions')
  expect(compareSymbolFills(fallback,fallback)).toBe('unknown')
})
it('omits ownership for incomplete geometry, a local limit failure or an empty core',()=>{
  const f=longFixture(longWire)
  const incomplete=probeSymbolVectorFeatures(new SymbolFeatureGeometry(f.vector.segments,f.vector.widths,false),longPose,.7)
  expect(incomplete.complete).toBe(false);expect(incomplete).not.toHaveProperty('ownership')
  const dense=probeSymbolVectorFeatures(new SymbolFeatureGeometry(new Float32Array(Array.from({length:257},()=>[25,53,27,54]).flat()),undefined,true),longPose,.7)
  expect(dense.complete).toBe(false);expect(dense).not.toHaveProperty('ownership')
  const thin=probeSymbolVectorFeatures(new SymbolFeatureGeometry(f.vector.segments,f.vector.widths,true),{...longPose,height:.2},.7)
  expect(thin.complete).toBe(true);expect(thin).not.toHaveProperty('ownership')
})
it('preserves borrowed coordinates, widths and snap endpoints during ownership and erasure',()=>{
  const f=longFixture(`${splitWire} q .1 w 5 60 m 55 60 l S Q`,true,'22 61.5 m 26 58.5 l S')
  const segments=f.vector.segments.slice(),widths=f.vector.widths.slice(),endpoints=segmentEndpoints(segments),gray=f.image.gray.slice()
  const geometry=new SymbolFeatureGeometry(f.vector.segments,f.vector.widths,true)
  const probe=probeSymbolVectorFeatures(geometry,f.body,.7)
  expect(probe.ownership).toBeDefined()
  const ownership=JSON.stringify(probe.ownership),interior=describeSymbolInterior(f.image,f.body,probe.ownership)
  const mask=interior.mask.slice(),regions=interior.regions?.slice(),areas=interior.regionAreas?.slice()
  compareSymbolFills(interior,interior);compareSymbolInteriors(interior,interior)
  expect(geometry.segments).toBe(f.vector.segments);expect(geometry.widths).toBe(f.vector.widths)
  expect(f.vector.segments).toEqual(segments);expect(f.vector.widths).toEqual(widths)
  expect(segmentEndpoints(f.vector.segments)).toEqual(endpoints)
  expect(f.image.gray).toEqual(gray);expect(JSON.stringify(probe.ownership)).toBe(ownership)
  expect(interior.mask).toEqual(mask);expect(interior.regions).toEqual(regions);expect(interior.regionAreas).toEqual(areas)
}, 30_000) // Builds and renders a PDF; the full suite can push it past 5 s.
it('keeps a body dominated by erased foreign ink unknown',()=>{
  const f=fixture('5 60 m 55 60 l S',longPose),raw=describeSymbolInterior(f.image,f.body),clean=ownedInterior(f)
  expect(f.probe.ownership).toBeDefined()
  expect(f.probe.ownership!.foreign).toHaveLength(1)
  expect(f.probe.ownership!.owned).toHaveLength(0)
  expect(raw.known).toBe(true)
  expect(clean.known).toBe(false);expect(clean.unknownReason).toBe('foreign-dominated')
  expect(clean.erased).toBeCloseTo(raw.ink,12);expect(clean.ink).toBe(0)
  expect(compareSymbolInteriors(clean,clean)).toBe('unknown')
  expect(compareSymbolFills(clean,clean)).toBe('unknown')
})
it('protects an internal cup bar aligned with same-width wiring ending at the curved outline',()=>{
  const t=.3,y=56+15*t-6*t*t-t*t*t,left=25+6*t*t-t*t*t,right=60-left
  const wire=`5 ${y} m ${left} ${y} l S`,bar=`${left} ${y} m ${right} ${y} l S`
  const a=fixture(`${cup} ${wire} ${bar}`),b=fixture(`${cup} ${wire}`)
  const isBar=(line:{a:[number,number];b:[number,number]})=>line.a[0]>0&&line.b[0]<10
    &&Math.abs(line.a[1]-(y-56))<.001&&Math.abs(line.a[1]-line.b[1])<.001
  expect(a.probe.ownership).toBeDefined()
  expect(a.probe.ownership!.owned.filter(isBar)).toHaveLength(1)
  expect(a.probe.ownership!.foreign.filter(isBar)).toHaveLength(0)
  const ai=ownedInterior(a),bi=ownedInterior(b)
  expect(ai.known).toBe(true);expect(bi.known).toBe(true)
  expect(compareSymbolFills(ai,bi)).not.toBe('same')
  expect(compareSymbolFills(bi,ai)).not.toBe('same')
})
it('joins thin diagonal dashes across 1.4pt gaps and removes even the pieces wholly inside the body',()=>{
  const lengths=[7,.7,7,.7,7],unit=1/Math.hypot(1,.12)
  let offset=-14
  const dashes=lengths.map(len=>{
    const start=offset,end=offset+len
    offset=end+1.4
    return `${30+start*unit} ${60+start*.12*unit} m ${30+end*unit} ${60+end*.12*unit} l S`
  }).join(' ')
  const a=longFixture(`q .1 w ${dashes} Q`),b=longFixture()
  expect(a.probe.ownership).toBeDefined()
  expect(a.probe.ownership!.foreign).toHaveLength(lengths.length)
  expect(a.probe.ownership!.foreign.every(line=>Math.abs(line.width-.1)<.001)).toBe(true)
  expect(a.probe.ownership!.foreign.some(line=>[line.a,line.b].every(p=>p[0]>0&&p[0]<20&&p[1]>0&&p[1]<4))).toBe(true)
  expect(a.probe.ownership!.owned.some(line=>line.width<.2)).toBe(false)
  const ai=ownedInterior(a),bi=ownedInterior(b)
  expect(ai.known).toBe(true);expect(bi.known).toBe(true)
  expect(compareSymbolFills(ai,bi)).toBe('same')
  expect(compareSymbolFills(bi,ai)).toBe('same')
})
it('ignores confined thin lettering for structural regions while retaining its visible ink',()=>{
  const marks='q .1 w 20 60.125 m 28.4 60.125 l S 23.125 59.5 m 23.125 60.75 l S Q'
  const a=longFixture('',true,marks),b=longFixture()
  expect(a.probe.ownership).toBeDefined()
  expect(a.probe.ownership!.foreign).toHaveLength(0)
  expect(a.probe.ownership!.owned.filter(line=>line.width<.2)).toHaveLength(2)
  const ai=ownedInterior(a),bi=ownedInterior(b)
  expect(ai.known).toBe(true);expect(bi.known).toBe(true)
  expect(ai.erased).toBe(0)
  expect(ai.mask).not.toEqual(bi.mask)
  expect(ai.ink).toBeGreaterThan(bi.ink)
  // Lettering cells next to matching body strokes stay protected, so the
  // partition is the same up to a few cells rather than identical.
  expect(ai.regionAreas).toHaveLength(bi.regionAreas!.length)
  ai.regionAreas!.forEach((area,i)=>expect(Math.abs(area-bi.regionAreas![i])).toBeLessThan(.01))
  expect(compareSymbolFills(ai,bi)).toBe('same')
  expect(compareSymbolFills(bi,ai)).toBe('same')
})
it('distinguishes a white central circle from a black filled circle in a long fixture',()=>{
  const a=longFixture(),b=fixture(`${longRect} ${circlePath} f ${circlePath} S`,longPose)
  const ai=ownedInterior(a),bi=ownedInterior(b)
  expect(ai.known).toBe(true);expect(bi.known).toBe(true)
  expect(compareSymbolFills(ai,bi)).toBe('different')
  expect(compareSymbolFills(bi,ai)).toBe('different')
})
it('accepts a one-percent larger fixture even when its end lines leave the normalized mask',()=>{
  const a=fixture(`q .35 w ${longRect} ${whiteCircle} Q`,longPose)
  const b=fixture(`q .35 w 1.01 0 0 1.01 -.3 -.6 cm ${longRect} ${whiteCircle} Q`,longPose)
  const ai=ownedInterior(a),bi=ownedInterior(b)
  expect(ai.known).toBe(true);expect(bi.known).toBe(true)
  expect(b.probe.ownership!.foreign).toHaveLength(0)
  expect(ai.mask[24*48]).toBe(1);expect(bi.mask[24*48]).toBe(0)
  expect(ai.mask[24*48+47]).toBe(1);expect(bi.mask[24*48+47]).toBe(0)
  expect(compareSymbolFills(ai,bi)).toBe('same')
  expect(compareSymbolFills(bi,ai)).toBe('same')
})
it('omits structural labels above 32 regions without changing the visible mask or legacy holes',()=>{
  const body:SymbolBodyPose={center:[50,50],width:40,height:40,angle:0}
  const marks=Array.from({length:35},(_,i)=>{
    const x=34+i%7*5,y=34+Math.floor(i/7)*5
    return `${x-1} ${y} m ${x+1} ${y} l S`
  }).join(' ')
  const f=fixture(`30 30 40 40 re f q .1 w ${marks} Q`,body)
  expect(f.probe.ownership).toBeDefined()
  expect(f.probe.ownership!.foreign).toHaveLength(0)
  expect(f.probe.ownership!.owned.filter(line=>line.width>0&&line.width<.2)).toHaveLength(35)
  const raw=describeSymbolInterior(f.image,f.body),d=ownedInterior(f)
  expect(d.known).toBe(true);expect(d.holes).toHaveLength(0)
  expect(d.mask).toEqual(raw.mask);expect(d.ink).toBe(raw.ink);expect(d.erased).toBe(0)
  expect(d).not.toHaveProperty('regions');expect(d).not.toHaveProperty('regionAreas')
  expect(compareSymbolFills(d,d)).toBe('unknown')
})
it('returns unknown for fills without structural regions or with an unknown interior',()=>{
  const f=longFixture(),raw=describeSymbolInterior(f.image,f.body),d=ownedInterior(f)
  expect(compareSymbolFills(raw,d)).toBe('unknown')
  expect(compareSymbolFills(d,raw)).toBe('unknown')
  expect(compareSymbolFills({...d,known:false},d)).toBe('unknown')
  expect(compareSymbolFills(d,{...d,known:false})).toBe('unknown')
  expect(compareSymbolFills({...d,mask:new Uint8Array(1)},d)).toBe('unknown')
  expect(compareSymbolFills(d,{...d,regions:new Uint8Array(1)})).toBe('unknown')
})
it('routes interiorAppearance through fill comparison for same, different and unknown interiors',()=>{
  const f=longFixture(),a=ownedInterior(f),b=ownedInterior(fixture(`${longRect} ${circlePath} f ${circlePath} S`,longPose))
  const raw=describeSymbolInterior(f.image,f.body)
  for(const [sample,target] of [[a,a],[a,b],[a,raw]]){
    const result=compareSymbolFills(sample,target)
    expect(compareSymbolFeatureProfiles({interior:sample},{interior:target},['interiorAppearance']))
      .toEqual({decision:result,features:{interiorAppearance:result}})
  }
})
it('checks structural spanning in both directions before rejecting a fill difference',()=>{
  const whole=new Uint8Array(48*48),split=new Uint8Array(48*48),black=new Uint8Array(48*48)
  for(let y=4;y<44;y++)for(let x=4;x<44;x++){
    const at=y*48+x
    whole[at]=1;black[at]=1
    if(x<23)split[at]=1
    else if(x>24)split[at]=2
  }
  const a=gridInterior(whole,[1600/(48*48)]),b=gridInterior(split,[760/(48*48),760/(48*48)],black)
  expect(compareSymbolFills(a,b)).toBe('unknown')
  expect(compareSymbolFills(b,a)).toBe('unknown')
})
it('uses the specified inclusive core-area and fill thresholds and excludes four-neighbor boundaries',()=>{
  const regions=new Uint8Array(48*48),guard=new Uint8Array(48*48).fill(1)
  for(let y=10;y<22;y++)for(let x=10;x<22;x++)regions[y*48+x]=1
  for(let y=11;y<21;y++)for(let x=11;x<21;x++)guard[y*48+x]=0
  const a=gridInterior(regions,[.04],guard)
  const filled=(count:number)=>{
    const mask=guard.slice()
    // All marked cells remain inside every shifted 10-by-10 core window.
    // The surrounding ink makes translation unable to lower the fill ratio.
    for(let i=0;i<count;i++)mask[(13+Math.floor(i/6))*48+13+i%6]=1
    return gridInterior(regions.slice(),[.04],mask)
  }
  expect(compareSymbolFills(a,filled(15))).toBe('same')
  expect(compareSymbolFills(a,filled(16))).toBe('unknown')
  expect(compareSymbolFills(a,filled(35))).toBe('unknown')
  expect(compareSymbolFills(a,filled(36))).toBe('different')
  const edges=new Uint8Array(48*48)
  for(let y=10;y<22;y++)for(let x=10;x<22;x++)if(x===10||x===21||y===10||y===21)edges[y*48+x]=1
  expect(compareSymbolFills(a,gridInterior(regions.slice(),[.04],edges))).toBe('same')
  const small=gridInterior(regions.slice(),[.039])
  expect(compareSymbolFills(small,{...filled(36),regionAreas:[.039],ink:.1})).toBe('same')
  expect(compareSymbolFills(small,{...filled(36),regionAreas:[.039],ink:.100001})).toBe('unknown')
})
it('requires six core cells and excludes mask-edge cells from region cores',()=>{
  const five=new Uint8Array(48*48),six=new Uint8Array(48*48),black=new Uint8Array(48*48).fill(1)
  for(let y=10;y<13;y++)for(let x=10;x<17;x++)five[y*48+x]=1
  for(let y=10;y<13;y++)for(let x=10;x<18;x++)six[y*48+x]=1
  const a=gridInterior(five,[.04]),b=gridInterior(six,[.04])
  expect(compareSymbolFills(a,{...gridInterior(five.slice(),[.04],black),ink:.1})).toBe('same')
  expect(compareSymbolFills(b,{...gridInterior(six.slice(),[.04],black),ink:.1})).toBe('different')
  const full=new Uint8Array(48*48).fill(1),edgeInk=new Uint8Array(48*48)
  for(let y=0;y<48;y++)for(let x=0;x<48;x++)if(!x||!y||x===47||y===47)edgeInk[y*48+x]=1
  expect(compareSymbolFills(gridInterior(full,[1]),gridInterior(full.slice(),[1],edgeInk))).toBe('same')
})

// Test-only snapshot of the previous unshifted comparison. Fixtures below
// supply known, valid structural profiles. The optional area isolates the
// effect of translation from the change to the region-area threshold.
function unshiftedSymbolFills(a:SymbolInteriorProfile,b:SymbolInteriorProfile,minArea=.02):'same'|'different'|'unknown' {
  const core=(p:SymbolInteriorProfile)=>{
    const regions=p.regions!,cells:number[][]=p.regionAreas!.map(()=>[])
    for(let y=1;y<47;y++)for(let x=1;x<47;x++){
      const at=y*48+x,k=regions[at]
      if(k&&cells[k-1]&&regions[at-1]===k&&regions[at+1]===k&&regions[at-48]===k&&regions[at+48]===k)cells[k-1].push(at)
    }
    return cells.map((points,i)=>({id:i+1,points})).filter((region,i)=>p.regionAreas![i]>=minArea&&region.points.length>=6)
  }
  const ac=core(a),bc=core(b)
  const spans=(source:ReturnType<typeof core>,target:ReturnType<typeof core>,p:SymbolInteriorProfile)=>{
    for(const region of source){
      const counts=new Uint16Array(p.regionAreas!.length+1)
      for(const at of region.points){
        const k=p.regions![at]
        if(k&&k<counts.length)counts[k]++
      }
      if(target.filter(other=>counts[other.id]>=.25*other.points.length).length>=2)return true
    }
    return false
  }
  if(spans(ac,bc,b)||spans(bc,ac,a))return 'unknown'
  if(!ac.length&&!bc.length)return Math.abs(a.ink-b.ink)<=.1?'same':'unknown'
  const fill=(regions:ReturnType<typeof core>,p:SymbolInteriorProfile)=>{
    let maximum=0
    for(const region of regions){
      let ink=0
      for(const at of region.points)if(p.mask[at])ink++
      maximum=Math.max(maximum,ink/region.points.length)
    }
    return maximum
  }
  const af=fill(ac,b),bf=fill(bc,a)
  if(Math.max(af,bf)>.35)return 'different'
  return af<=.15&&bf<=.15?'same':'unknown'
}

it('accepts a double circle with three diagonal marks under a 0.25pt pose-center error',()=>{
  // A deterministic raster avoids PDF antialiasing differences. At scale 8,
  // the 6pt body maps exactly to the 48-cell grid; 0.25pt is two cells.
  const body:SymbolBodyPose={center:[30,60],width:6,height:6,angle:0}
  const image:SymbolWorldImage={
    width:80,height:80,gray:new Uint8Array(80*80),origin:[25,55],scale:8
  }
  for(let y=0;y<80;y++)for(let x=0;x<80;x++){
    const dx=x+.5-40,dy=y+.5-40,r=Math.hypot(dx,dy),diagonal=(dx+dy)/Math.SQRT2
    const ring=r>=20&&r<=22||r>=14&&r<=16
    const hatch=r<14&&[-3,0,3].some(offset=>Math.abs(diagonal-offset)<=.5)
    if(ring||hatch)image.gray[y*80+x]=255
  }
  const ownership={foreign:[],owned:[],strokeWidth:.25}
  const a=describeSymbolInterior(image,body,ownership)
  const b=describeSymbolInterior(image,{...body,center:[30.25,60]},ownership)
  expect(a.known).toBe(true);expect(b.known).toBe(true)
  expect(a.regions).toBeDefined();expect(b.regions).toBeDefined()
  // Without translation the two-cell offset is not accepted (it reads as unknown or different).
  expect(unshiftedSymbolFills(a,b)).not.toBe('same')
  // Raising the area threshold alone must not clear this regression.
  expect(unshiftedSymbolFills(a,b,.04)).not.toBe('same')
  const am=a.mask.slice(),bm=b.mask.slice(),ar=a.regions!.slice(),br=b.regions!.slice()
  expect(compareSymbolFills(a,b)).toBe('same')
  expect(compareSymbolFills(b,a)).toBe('same')
  expect(a.mask).toEqual(am);expect(b.mask).toEqual(bm)
  expect(a.regions).toEqual(ar);expect(b.regions).toEqual(br)
})

it('keeps white and black central circles different for positive and negative pose offsets',()=>{
  const white=ownedInterior(longFixture())
  for(const [dx,dy] of [[0,0],[.25,0],[-.25,0],[0,.25],[0,-.25],[.25,.25],[-.25,.25],[.25,-.25],[-.25,-.25]]){
    const body:SymbolBodyPose={...longPose,center:[30+dx,60+dy]}
    const black=ownedInterior(fixture(`${longRect} ${circlePath} f ${circlePath} S`,body))
    expect(white.known).toBe(true);expect(black.known).toBe(true)
    expect(compareSymbolFills(white,black)).toBe('different')
    expect(compareSymbolFills(black,white)).toBe('different')
  }
})

it('ignores splitting into white gaps between 0.02 and 0.04 when checking structural spanning',()=>{
  const whole=new Uint8Array(48*48),split=new Uint8Array(48*48)
  const am=new Uint8Array(48*48).fill(1),bm=new Uint8Array(48*48).fill(1)
  for(let y=10;y<15;y++)for(let x=10;x<38;x++){
    const at=y*48+x
    whole[at]=1;am[at]=0
    if(x<23){split[at]=1;bm[at]=0}
    else if(x>=25){split[at]=2;bm[at]=0}
  }
  const smallArea=65/(48*48)
  expect(smallArea).toBeGreaterThan(.02)
  expect(smallArea).toBeLessThan(.04)
  const a=gridInterior(whole,[140/(48*48)],am)
  const b=gridInterior(split,[smallArea,smallArea],bm)
  expect(unshiftedSymbolFills(a,b)).toBe('unknown')
  expect(unshiftedSymbolFills(b,a)).toBe('unknown')
  expect(compareSymbolFills(a,b)).toBe('same')
  expect(compareSymbolFills(b,a)).toBe('same')
})

it('counts shifted out-of-mask cells as white without shrinking the denominator or wrapping rows',()=>{
  const regions=new Uint8Array(48*48)
  for(let y=0;y<5;y++)for(let x=0;x<4;x++)regions[y*48+x]=1
  // Six core cells: x=1..2, y=1..3. At (-2,-2), only two sample
  // positions are in bounds, so the minimum fill is 2/6, not 2/2.
  const a=gridInterior(regions,[.04])
  const b=gridInterior(regions.slice(),[.04],new Uint8Array(48*48).fill(1))
  expect(compareSymbolFills(a,b)).toBe('unknown')
  expect(compareSymbolFills(b,a)).toBe('unknown')
})

// S10 snapshots only the changed algorithms: comparator-based indexing and
// exhaustive ownership pairing. Attachment processing remains shared with the
// unchanged production path, but runs against the independently sorted index.
type S10Point=[number,number]
type S10Rect=[number,number,number,number]
type S10Line=[number,number,number,number,number]

class S10ReferenceGeometry extends SymbolFeatureGeometry {
  override readonly complete:boolean
  private readonly referenceByY:Uint32Array

  constructor(segments:Float32Array,widths?:Float32Array,complete=false){
    if (segments.length % 4 || widths && widths.length !== segments.length / 4 || !segments.every(Number.isFinite)
      || widths && !widths.every(w=>Number.isFinite(w)&&w>=0)) throw Error('Invalid symbol feature geometry')
    super(segments,widths,false)
    this.complete = complete && segments.length / 4 <= 400_000
    this.referenceByY = new Uint32Array(this.complete ? segments.length / 4 : 0)
    for (let i=0;i<this.referenceByY.length;i++) this.referenceByY[i]=i*4
    this.referenceByY.sort((a,b)=>Math.min(segments[a+1],segments[a+3])-Math.min(segments[b+1],segments[b+3]))
  }

  override get indexBytes():number{return this.referenceByY.byteLength}

  override range(y0:number,y1:number,maxLength:number):Uint32Array {
    const bound=(y:number)=>{let lo=0,hi=this.referenceByY.length;while(lo<hi){const mid=(lo+hi)>>>1,i=this.referenceByY[mid];if(Math.min(this.segments[i+1],this.segments[i+3])<y)lo=mid+1;else hi=mid}return lo}
    return this.referenceByY.subarray(bound(y0-maxLength),bound(y1+1e-6))
  }
}

function s10StrokeMatches(width:number,strokeWidth:number):boolean {
  return !strokeWidth || !width || width >= .5*strokeWidth-1e-6 && width <= 2*strokeWidth+1e-6
}

function s10ToWorld(p:S10Point,body:SymbolBodyPose):S10Point {
  const c=Math.cos(body.angle*Math.PI/180),s=Math.sin(body.angle*Math.PI/180)
  const dx=p[0]-body.width/2,dy=p[1]-body.height/2
  return [body.center[0]+c*dx-s*dy,body.center[1]+s*dx+c*dy]
}

function s10ClipLine(a:S10Point,b:S10Point,rect:S10Rect):[number,number]|undefined {
  let lo=0,hi=1
  for(let axis=0;axis<2;axis++){
    const d=b[axis]-a[axis]
    if(!d){if(a[axis]<rect[axis]||a[axis]>rect[axis+2])return undefined}
    else{
      const u=(rect[axis]-a[axis])/d,v=(rect[axis+2]-a[axis])/d
      lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v))
      if(lo>hi)return undefined
    }
  }
  return [lo,hi]
}

function s10ReferenceProbe(geometry:S10ReferenceGeometry,body:SymbolBodyPose,strokeWidth=0):ReturnType<typeof probeSymbolVectorFeatures> {
  const probe=probeSymbolVectorFeatures(geometry,body,strokeWidth)
  if(!probe.complete)return probe
  const result={...probe}
  delete result.ownership
  const {segments,widths}=geometry
  const w=body.width,h=body.height,long=Math.max(w,h),cx=w/2,cy=h/2
  const region:S10Rect=[-long*.6,-long*.6,w+long*.6,h+long*.6]
  const corners=[[region[0],region[1]],[region[2],region[1]],[region[2],region[3]],[region[0],region[3]]]
    .map(p=>s10ToWorld(p as S10Point,body))
  const world:S10Rect=[Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))]
  const cos=Math.cos(body.angle*Math.PI/180),sin=Math.sin(body.angle*Math.PI/180)
  const canonical=(x:number,y:number):S10Point=>[cos*(x-body.center[0])+sin*(y-body.center[1])+cx,-sin*(x-body.center[0])+cos*(y-body.center[1])+cy]
  const all:Array<{a:S10Point;b:S10Point;len:number;width:number}>=[]
  let ownershipLimited=false
  for(const i of geometry.range(world[1],world[3],long*8)){
    if (Math.max(segments[i],segments[i+2]) < world[0] || Math.min(segments[i],segments[i+2]) > world[2]
      || Math.max(segments[i+1],segments[i+3]) < world[1] || Math.min(segments[i+1],segments[i+3]) > world[3]) continue
    const width=widths?.[i/4]??0
    const a=canonical(segments[i],segments[i+1]),b=canonical(segments[i+2],segments[i+3])
    const len=Math.hypot(b[0]-a[0],b[1]-a[1])
    if (!len || len > long * 8 || Math.max(a[0], b[0]) < region[0] || Math.min(a[0], b[0]) > region[2]
      || Math.max(a[1], b[1]) < region[1] || Math.min(a[1], b[1]) > region[3]) continue
    if(!ownershipLimited){
      if(all.length===512)ownershipLimited=true
      else all.push({a,b,len,width})
    }
  }
  const tolerance=Math.max(.08,Math.min(.25,Math.min(w,h)*.035))
  const out=Math.max(2*tolerance,.04*long,.3),m=Math.max(2*tolerance,.15*Math.min(w,h))
  if(!ownershipLimited&&w>2*m&&h>2*m){
    const core:S10Rect=[m,m,w-m,h-m],bodyRect:S10Rect=[-tolerance,-tolerance,w+tolerance,h+tolerance]
    const parent=new Uint16Array(all.length)
    for(let i=0;i<parent.length;i++)parent[i]=i
    const root=(i:number)=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i}
    const gap=Math.max(2,.15*long)
    const close=(a:S10Point,b:S10Point)=>(a[0]-b[0])**2+(a[1]-b[1])**2<=gap**2
    const turn = Math.sin(Math.PI/60)
    for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
      const a=all[i],b=all[j]
      // Matching strokes are assessed individually: an aligned body mark must
      // not inherit a remote endpoint from wiring that stops at the outline.
      if(s10StrokeMatches(a.width,strokeWidth)||s10StrokeMatches(b.width,strokeWidth))continue
      if(Math.abs(a.width-b.width)>.1*Math.max(a.width,b.width))continue
      if(!close(a.a,b.a)&&!close(a.a,b.b)&&!close(a.b,b.a)&&!close(a.b,b.b))continue
      const ax=a.b[0]-a.a[0],ay=a.b[1]-a.a[1],bx=b.b[0]-b.a[0],by=b.b[1]-b.a[1]
      if(Math.abs(ax*by-ay*bx)>turn*a.len*b.len)continue
      const onA=(p:S10Point)=>Math.abs(ax*(p[1]-a.a[1])-ay*(p[0]-a.a[0]))<=tolerance*a.len
      const onB=(p:S10Point)=>Math.abs(bx*(p[1]-b.a[1])-by*(p[0]-b.a[0]))<=tolerance*b.len
      if(!(onA(b.a)&&onA(b.b)||onB(a.a)&&onB(a.b)))continue
      const ra=root(i),rb=root(j)
      if(ra!==rb)parent[rb]=ra
    }
    const enters=new Uint8Array(all.length),remote=new Uint8Array(all.length)
    const outside=(p:S10Point)=>p[0]<-out||p[1]<-out||p[0]>w+out||p[1]>h+out
    for(let i=0;i<all.length;i++){
      const line=all[i],at=root(i),part=s10ClipLine(line.a,line.b,core)
      if(part&&part[1]>part[0])enters[at]=1
      if(outside(line.a)||outside(line.b))remote[at]=1
    }
    const ownership:NonNullable<ReturnType<typeof probeSymbolVectorFeatures>['ownership']>={foreign:[],owned:[],strokeWidth}
    for(let i=0;i<all.length;i++){
      const line=all[i],at=root(i),value={a:line.a,b:line.b,width:line.width}
      if(enters[at]&&remote[at])ownership.foreign.push(value)
      else if(s10ClipLine(line.a,line.b,bodyRect))ownership.owned.push(value)
    }
    result.ownership=ownership
  }
  return result
}

function s10Random(seed:number):()=>number {
  let state=seed>>>0
  return ()=>{
    state=(Math.imul(state,1664525)+1013904223)>>>0
    return state/0x100000000
  }
}

function s10WorldGeometry(lines:S10Line[],body:SymbolBodyPose):{segments:Float32Array;widths:Float32Array} {
  const segments:number[]=[],widths:number[]=[]
  for(const [x0,y0,x1,y1,width] of lines){
    segments.push(...s10ToWorld([x0,y0],body),...s10ToWorld([x1,y1],body))
    widths.push(width)
  }
  return {segments:new Float32Array(segments),widths:new Float32Array(widths)}
}

function s10ExpectProbe(segments:Float32Array,widths:Float32Array|undefined,body:SymbolBodyPose,strokeWidth:number,complete=true){
  const before=segments.slice(),beforeWidths=widths?.slice()
  const geometry=new SymbolFeatureGeometry(segments,widths,complete)
  const reference=new S10ReferenceGeometry(segments,widths,complete)
  const actual=probeSymbolVectorFeatures(geometry,body,strokeWidth)
  expect(actual).toEqual(s10ReferenceProbe(reference,body,strokeWidth))
  expect(segments).toEqual(before);expect(widths).toEqual(beforeWidths)
  expect(geometry.segments).toBe(segments);expect(geometry.widths).toBe(widths)
  return actual
}

it('S10 retains the exact stable comparator order for Float32 minima and every range window',()=>{
  const random=s10Random(0x51010)
  const words=new Uint32Array(1024),floats=new Float32Array(words.buffer)
  for(let i=0;i<words.length;i++){
    let bits=(random()*0x100000000)>>>0
    if((bits&0x7f800000)===0x7f800000)bits=(bits&0xff7fffff)>>>0
    words[i]=bits
  }
  const special=[-0,+0,-1,1,-3.4e38,3.4e38,2**-149,-(2**-149),-16,16]
  for(const count of [1,2,46,211,512,1024,4096]){
    const segments=new Float32Array(count*4)
    for(let i=0;i<count;i++){
      const y=i%3===0?special[i%special.length]:floats[i%floats.length]
      segments[i*4]=i-1000
      segments[i*4+1]=y
      segments[i*4+2]=1000-i
      segments[i*4+3]=i%4===0?y:i%3===0?y:floats[(i*17+7)%floats.length]
    }
    const before=segments.slice()
    const actual=new SymbolFeatureGeometry(segments,undefined,true)
    const reference=new S10ReferenceGeometry(segments,undefined,true)
    expect(actual.range(-Infinity,Infinity,0)).toEqual(reference.range(-Infinity,Infinity,0))
    expect(actual.indexBytes).toBe(count*Uint32Array.BYTES_PER_ELEMENT)
    for(const [y0,y1,maxLength] of [
      [-Infinity,Infinity,0],[-0,+0,0],[-1,1,0],[-100,20,3],
      [-3.4e38,-1e20,1e20],[1e20,3.4e38,1e20],
      [0,0,2**-149],[16,16,0],[5,-5,0]
    ]){
      expect(actual.range(y0,y1,maxLength)).toEqual(reference.range(y0,y1,maxLength))
    }
    expect(segments).toEqual(before)
  }
})

it('S10 keeps interleaved negative and positive zero ties in original segment order',()=>{
  const segments=new Float32Array([
    0,-0,1,+0,
    2,+0,3,+0,
    4,-0,5,-0,
    6,+0,7,-0,
    8,-1,9,-1,
    10,1,11,1
  ])
  const geometry=new SymbolFeatureGeometry(segments,undefined,true)
  expect(Array.from(geometry.range(-Infinity,Infinity,0))).toEqual([16,0,4,8,12,20])
  expect(geometry.range(-Infinity,Infinity,0))
    .toEqual(new S10ReferenceGeometry(segments,undefined,true).range(-Infinity,Infinity,0))
})

it('S10 preserves validation even without an index and preserves the 400000-segment index limit',()=>{
  const invalid:Array<[Float32Array,Float32Array|undefined]>=[
    [new Float32Array([0,0,1]),undefined],
    [new Float32Array([0,0,NaN,1]),undefined],
    [new Float32Array([0,Infinity,1,1]),undefined],
    [new Float32Array([0,0,1,1]),new Float32Array(0)],
    [new Float32Array([0,0,1,1]),new Float32Array([-1])],
    [new Float32Array([0,0,1,1]),new Float32Array([NaN])],
    [new Float32Array([0,0,1,1]),new Float32Array([Infinity])]
  ]
  for(const complete of [false,true])for(const [segments,widths] of invalid){
    expect(()=>new SymbolFeatureGeometry(segments,widths,complete)).toThrow('Invalid symbol feature geometry')
    expect(()=>new S10ReferenceGeometry(segments,widths,complete)).toThrow('Invalid symbol feature geometry')
  }
  const segments=new Float32Array([0,-1,1,1]),widths=new Float32Array([0])
  const incomplete=new SymbolFeatureGeometry(segments,widths,false)
  expect(incomplete.complete).toBe(false);expect(incomplete.indexBytes).toBe(0)
  expect(incomplete.range(-Infinity,Infinity,0)).toHaveLength(0)
  expect(incomplete.segments).toBe(segments);expect(incomplete.widths).toBe(widths)
  for(const count of [400_000,400_001]){
    const large=new Float32Array(count*4)
    const actual=new SymbolFeatureGeometry(large,undefined,true)
    const reference=new S10ReferenceGeometry(large,undefined,true)
    expect(actual.complete).toBe(count===400_000)
    expect(actual.indexBytes).toBe(count===400_000?count*4:0)
    expect(actual.range(-Infinity,Infinity,0)).toEqual(reference.range(-Infinity,Infinity,0))
  }
// 400,000 lines: several seconds under full-suite load.
}, 30_000)

it('S10 matches the complete reference probe for seeded geometry, rotations and stroke widths',()=>{
  const random=s10Random(0x51020)
  const angles=[0,2,37,90,183,270,-45]
  const strokes=[0,.1,.7,2.4]
  const counts=[0,1,14,46,64,211,256,257]
  for(let trial=0;trial<32;trial++){
    const body:SymbolBodyPose={
      center:[-150+random()*300,-150+random()*300],
      width:10+random()*20,height:4+random()*12,angle:angles[trial%angles.length]
    }
    const w=body.width,h=body.height,long=Math.max(w,h)
    const lines:S10Line[]=[]
    for(let i=0;i<counts[trial%counts.length];i++){
      let x0:number,y0:number,x1:number,y1:number
      if(i%5===0){
        x0=-long*.4+(i%11)*long*.1;y0=h*.5
        x1=x0+long*.08;y1=y0
      }else if(i%5===1){
        x0=w*.2;y0=h*.8;x1=w*.8;y1=h*.2
      }else{
        x0=-long*.5+random()*(w+long)
        y0=-long*.5+random()*(h+long)
        x1=x0+(random()-.5)*long
        y1=y0+(random()-.5)*long
      }
      const width=[0,.1,.11,.12,.35,.7,1.4,2.4][Math.floor(random()*8)]
      if(i%7===0)lines.push([x1,y1,x0,y0,width])
      else lines.push([x0,y0,x1,y1,width])
    }
    const data=s10WorldGeometry(lines,body)
    s10ExpectProbe(data.segments,data.widths,body,strokes[trial%strokes.length])
    if(trial%8===0){
      s10ExpectProbe(data.segments,undefined,body,.7)
      s10ExpectProbe(data.segments,data.widths,body,.7,false)
    }
  }
})

it('S10 compares ordered arc, frame, interior and ownership arrays against the reference',()=>{
  for(const angle of [0,2,37,90,183,-45]){
    const body:SymbolBodyPose={center:[-30,60],width:20,height:12,angle}
    const lines:S10Line[]=[
      [0,0,3,-4,.7],[3,-4,10,-6,.7],[10,-6,17,-4,.7],[17,-4,20,0,.7],
      [-8,3,28,3,.7],[-8,9,28,9,.7],
      [6,9,10,6,.7],[10,6,14,3,.7],
      [0,0,20,0,.7],[20,0,20,12,.7],[20,12,0,12,.7],[0,12,0,0,.7],
      [-7,6,-2,6,.1],[-.6,6,4.4,6,.1],[5.8,6,10.8,6,.1],
      [12.2,6,17.2,6,.1],[18.6,6,23.6,6,.1],
      [7,8,13,4,.35]
    ]
    const data=s10WorldGeometry(lines,body)
    for(const strokeWidth of [0,.35,.7,2.4]){
      const actual=s10ExpectProbe(data.segments,data.widths,body,strokeWidth)
      expect(actual.complete).toBe(true)
      expect(actual.ownership).toBeDefined()
      if(angle===0&&strokeWidth===.7){
        expect(actual.topArc).toBe('present')
        expect(actual.annexFrame).toBe('present')
        expect(actual.interiorLines).toHaveLength(1)
        expect(actual.ownership!.foreign).toHaveLength(7)
      }
    }
  }
})

it('S10 preserves ownership immediately below, at and above its 512-segment limit',()=>{
  for(const count of [511,512,513])for(const angle of [0,37,90,183]){
    const body:SymbolBodyPose={center:[-50,25],width:20,height:12,angle}
    const lines:S10Line[]=[]
    for(let i=0;i<count;i++){
      if(i<13){
        const x=-7+i*2.5
        lines.push([x,6,x+1.2,6,.1])
      }else{
        const at=i-13,x=.5+(at%25)*.72,y=1+Math.floor(at/25)*.45
        lines.push(i%2?[x,y,x+.55,y,.1]:[x+.55,y,x,y,.1])
      }
    }
    const data=s10WorldGeometry(lines,body)
    for(const strokeWidth of [.7,2.4]){
      const actual=s10ExpectProbe(data.segments,data.widths,body,strokeWidth)
      expect(actual.complete).toBe(true)
      if(count<=512){
        expect(actual.ownership).toBeDefined()
        expect(actual.ownership!.foreign.length+actual.ownership!.owned.length).toBe(count)
        expect(actual.ownership!.foreign.length).toBeGreaterThanOrEqual(13)
      }else{
        expect(actual).not.toHaveProperty('ownership')
      }
    }
  }
})

it('S10 preserves local truncation before ownership processing',()=>{
  const body:SymbolBodyPose={center:[10,6],width:20,height:12,angle:0}
  for(const count of [256,257]){
    const lines:S10Line[]=Array.from({length:count},(_,i)=>[4,2+i*.02,5,2+i*.02,.7])
    const data=s10WorldGeometry(lines,body)
    const actual=s10ExpectProbe(data.segments,data.widths,body,.7)
    expect(actual.complete).toBe(count===256)
    if(count===257)expect(actual).not.toHaveProperty('ownership')
  }
})

it('S10 preserves close, width, parallel and collinearity thresholds around endpoint cells',()=>{
  const body:SymbolBodyPose={center:[10,6],width:20,height:12,angle:0}
  const random=s10Random(0x51030)
  const lines:S10Line[]=[]
  for(const boundary of [-9,-6,-3,-0,+0,3,6,9,12,15,18,21,24]){
    for(const offset of [-1e-6,0,1e-6]){
      const x=boundary+offset
      lines.push([x-1,6,x,6,.1])
      lines.push([x+3,6,x+4,6,.1])
      lines.push([x+3-1e-6,6,x+4-1e-6,6,.1])
      lines.push([x+3+1e-6,6,x+4+1e-6,6,.1])
    }
  }
  for(let i=0;i<80;i++){
    const x=-8+random()*34,y=2+random()*8
    const angle=[0,Math.PI/60-1e-6,Math.PI/60,Math.PI/60+1e-6][i%4]
    const width=[.1,.11,.111111,.111112,.7][i%5]
    lines.push([x,y,x+Math.cos(angle),y+Math.sin(angle),width])
  }
  const data=s10WorldGeometry(lines,body)
  for(const strokeWidth of [.7,2.4]){
    const actual=s10ExpectProbe(data.segments,data.widths,body,strokeWidth)
    expect(actual.complete).toBe(true)
    expect(actual.ownership).toBeDefined()
  }
})

it('S10 retains original floating-point ownership semantics when squared gap overflows',()=>{
  const body:SymbolBodyPose={center:[0,0],width:1e155,height:12,angle:0}
  const segments=new Float32Array([
    0,-7,0,-4,
    0,-1,0,2,
    0,5,0,8,
    1,-1,1,2
  ])
  const widths=new Float32Array([.1,.1,.1,.11])
  const actual=s10ExpectProbe(segments,widths,body,.7)
  expect(actual.complete).toBe(true)
  expect(actual.ownership).toBeDefined()
})

it('S10 matches reference probes for huge and negative page coordinates and empty cores',()=>{
  const segments=new Float32Array([
    -3e38,-3e38,-2.9e38,-2.9e38,
    3e38,3e38,2.9e38,2.9e38,
    -1e20,0,1e20,0,
    -0,+0,+0,-0,
    0,-1,0,1
  ])
  const widths=new Float32Array([.1,.7,.1,0,.1])
  const bodies:SymbolBodyPose[]=[
    {center:[0,0],width:20,height:12,angle:0},
    {center:[-3e38,-3e38],width:1e38,height:1e38,angle:37},
    {center:[3e38,3e38],width:1e38,height:1e38,angle:90},
    {center:[0,0],width:1e308,height:1e308,angle:45},
    {center:[0,0],width:20,height:.2,angle:0}
  ]
  for(const body of bodies)for(const strokeWidth of [0,.7,2.4]){
    s10ExpectProbe(segments,widths,body,strokeWidth)
  }
})
