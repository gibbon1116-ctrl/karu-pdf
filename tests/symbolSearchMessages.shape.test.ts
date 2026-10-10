import {expect,it} from 'vitest'
import mupdf from 'mupdf'
import {extractVectorPage} from '../src/worker/vectorExtract'
import {describeLocalBody,LOCAL_IMAGE_MAX_PIXELS} from '../src/core/symbolLocalImage'
import {describeLocalLabel} from '../src/core/symbolGlyphs'
import {confirmSymbolVectorFeatures,describeSymbolInterior,type SymbolWorldImage} from '../src/core/symbolFeatureProfile'
import {decideSymbolShape} from '../src/core/symbolShapeDecision'
import {searchVectorMessage,probeVectorMatches,describeLocalMessage,
  type VectorSearchMessage,type VectorSearchResult,type LocalDescribeMessage,type VectorFeatureProbes} from '../src/worker/symbolSearchMessages'
import type {Rect} from '../src/core/annotations'

const cup='25 56 m 35 56 l 35 61 33 64 30 64 c 27 64 25 61 25 56 c h S'
const arc='23.5 56 m 26 52 34 52 36.5 56 c S'
function fixture(){
  const commands=[0,35,70,105].map((dx,i)=>`q 1 0 0 1 ${dx} 0 cm ${cup} ${i<2?arc:''} Q`).join(' ')
  const doc=new mupdf.PDFDocument(),p=doc.addPage([0,0,160,160],0,{},
    `q 1 0 0 -1 0 160 cm .7 w 0 G 0 g ${commands} Q`)
  doc.insertPage(-1,p);p.destroy()
  const vector=extractVectorPage(doc,0),page=doc.loadPage(0),pix=page.toPixmap(mupdf.Matrix.scale(4,4),mupdf.ColorSpace.DeviceGray,false,false)
  const image:SymbolWorldImage={width:pix.getWidth(),height:pix.getHeight(),gray:Uint8Array.from(pix.getPixels(),v=>255-v),origin:[0,0],scale:4}
  pix.destroy();page.destroy();doc.destroy()
  const message:VectorSearchMessage={
    type:'vector-search',id:1,segments:vector.segments,segmentWidths:vector.widths,
    sampleSegments:vector.segments,sampleWidths:vector.widths,sampleRect:[25,56,35,64],
    options:{threshold:.85,rotations:false,maxResults:50,region:[0,0,160,160]},
    features:{complete:true,sampleComplete:true,samePage:true},
  }
  return {vector,image,message}
}
function searched(message:VectorSearchMessage):VectorSearchResult {
  const result=searchVectorMessage(message)
  expect(result).not.toBeNull()
  if(!result)throw Error('Missing vector result')
  expect(result.matches.length).toBeGreaterThanOrEqual(4)
  return result
}
function probed(message:VectorSearchMessage,result:VectorSearchResult,limit?:number):VectorFeatureProbes {
  const probes=probeVectorMatches(message,result,limit)
  expect(probes).toBeDefined()
  if(!probes)throw Error('Missing vector probes')
  return probes
}
function localMessage(image:SymbolWorldImage,result:VectorSearchResult,probes?:VectorFeatureProbes):LocalDescribeMessage {
  return {type:'local-describe',id:1,image,bodies:result.matches.map(m=>m.rect.map(v=>v*image.scale) as Rect),
    ...(probes?{shape:{origin:image.origin,scale:image.scale,probes:probes.matches}}:{})}
}

it('probes the arc and non-arc matches in their original order',()=>{
  const {message}=fixture(),result=searched(message),before=result.matches.map(m=>({...m,center:[...m.center],rect:[...m.rect]}))
  const probes=probed(message,result)
  expect(probes.matches).toHaveLength(result.matches.length)
  expect(probes.sample.topArc).toBe('present')
  expect(probes.sample.complete).toBe(true)
  expect(Number.isFinite(probes.ms)).toBe(true)
  expect(probes.ms).toBeGreaterThanOrEqual(0)
  for(const [i,probe] of probes.matches.entries()){
    expect(probe.pose.center).toEqual(result.matches[i].center)
    expect(probe.pose.angle).toBe(result.matches[i].angle)
    expect(probe.pose.width).toBe(result.template.rect[2]-result.template.rect[0])
    expect(probe.pose.height).toBe(result.template.rect[3]-result.template.rect[1])
  }
  for(const [i,x] of [30,65,100,135].entries()){
    const at=result.matches.findIndex(m=>Math.hypot(m.center[0]-x,m.center[1]-60)<.5)
    expect(at).toBeGreaterThanOrEqual(0)
    expect(probes.matches[at].topArc).toBe(i<2?'present':'absent')
    expect(probes.matches[at].complete).toBe(true)
  }
  expect(result.matches).toEqual(before)
})

it('does not create probes without features or without a vector result',()=>{
  const {message}=fixture(),result=searched(message)
  const {features,...plain}=message
  expect(features).toBeDefined()
  expect(probeVectorMatches(plain,result)).toBeUndefined()
  expect(probeVectorMatches(message,null)).toBeUndefined()
})

it('keeps same-page incomplete geometry unknown',()=>{
  const {message}=fixture()
  message.features={complete:false,sampleComplete:true,samePage:true}
  const probes=probed(message,searched(message))
  expect(probes.sample.complete).toBe(false)
  for(const probe of [probes.sample,...probes.matches]){
    expect(probe.complete).toBe(false)
    expect(probe.topArc).toBe('unknown')
    expect(probe.annexFrame).toBe('unknown')
    expect(probe.ownership).toBeUndefined()
  }
})

it('uses sampleComplete independently for a different sample page',()=>{
  const {message}=fixture()
  message.features={complete:true,sampleComplete:false,samePage:false}
  const probes=probed(message,searched(message))
  expect(probes.sample.complete).toBe(false)
  expect(probes.matches.every(p=>p.complete)).toBe(true)
  message.features={complete:false,sampleComplete:true,samePage:false}
  const other=probed(message,searched(message))
  expect(other.sample.complete).toBe(true)
  expect(other.sample.topArc).toBe('present')
  expect(other.matches.every(p=>!p.complete)).toBe(true)
})

it('adds shapes without changing the existing body or label descriptions',()=>{
  const {message,image,vector}=fixture(),segments=vector.segments.slice(),widths=vector.widths.slice()
  const result=searched(message),probes=probed(message,result),plainMessage=localMessage(image,result)
  const plain=describeLocalMessage(plainMessage),shaped=describeLocalMessage(localMessage(image,result,probes))
  expect(shaped).toHaveLength(result.matches.length)
  for(const [i,body] of shaped.entries()){
    const {shape,...existing}=body,patch={...image,body:plainMessage.bodies[i]}
    expect(existing).toEqual(plain[i])
    expect(existing).toEqual({...describeLocalBody(patch),label:describeLocalLabel(patch)})
    expect(plain[i]).not.toHaveProperty('shape')
    expect(shape).toEqual({
      features:confirmSymbolVectorFeatures(probes.matches[i],image),
      interior:describeSymbolInterior(image,probes.matches[i].pose,probes.matches[i].ownership),
    })
  }
  expect(vector.segments).toEqual(segments)
  expect(vector.widths).toEqual(widths)
})

it('confirms the sample and candidate shapes from rendered pixels',()=>{
  const {message,image}=fixture(),result=searched(message),probes=probed(message,result)
  const sample=describeLocalMessage({
    type:'local-describe',id:1,image,bodies:[result.template.rect.map(v=>v*image.scale) as Rect],
    shape:{origin:image.origin,scale:image.scale,probes:[probes.sample]},
  })[0].shape
  expect(sample).toBeDefined()
  expect(sample?.features.topArc).toBe('present')
  const bodies=describeLocalMessage(localMessage(image,result,probes))
  for(const [i,x] of [30,65,100,135].entries()){
    const at=result.matches.findIndex(m=>Math.hypot(m.center[0]-x,m.center[1]-60)<.5)
    expect(at).toBeGreaterThanOrEqual(0)
    expect(bodies[at].shape?.features.topArc).toBe(i<2?'present':'absent')
    const decision=decideSymbolShape(sample,bodies[at].shape)
    if(i<2)expect(decision.differences).not.toContain('topArc')
    else{
      expect(decision.decision).toBe('different')
      expect(decision.differences).toContain('topArc')
    }
  }
})

it('supports missing probes without changing their body descriptions',()=>{
  const {message,image}=fixture(),result=searched(message),probes=probed(message,result)
  const plain=describeLocalMessage(localMessage(image,result)),local=localMessage(image,result,probes)
  local.shape!.probes[0]=undefined
  const bodies=describeLocalMessage(local)
  expect(bodies[0]).toEqual(plain[0])
  expect(bodies[0]).not.toHaveProperty('shape')
  expect(bodies.slice(1).every(b=>!!b.shape)).toBe(true)
})

it('rejects a probe count different from the body count',()=>{
  const {message,image}=fixture(),result=searched(message),probes=probed(message,result)
  const local=localMessage(image,result,probes)
  local.shape!.probes=local.shape!.probes.slice(1)
  expect(()=>describeLocalMessage(local)).toThrow('Invalid local shape input')
  local.shape!.probes=[...probes.matches,undefined]
  expect(()=>describeLocalMessage(local)).toThrow('Invalid local shape input')
})

it.each([0,-1,NaN,Infinity,-Infinity])('rejects invalid shape scale %s',scale=>{
  const {message,image}=fixture(),result=searched(message),probes=probed(message,result)
  const local=localMessage(image,result,probes)
  local.shape!.scale=scale
  expect(()=>describeLocalMessage(local)).toThrow('Invalid local shape input')
})

it.each([NaN,Infinity,-Infinity])('rejects non-finite shape origins %s',value=>{
  const {message,image}=fixture(),result=searched(message),probes=probed(message,result)
  const local=localMessage(image,result,probes)
  local.shape!.origin=[value,0]
  expect(()=>describeLocalMessage(local)).toThrow('Invalid local shape input')
  local.shape!.origin=[0,value]
  expect(()=>describeLocalMessage(local)).toThrow('Invalid local shape input')
})

it('preserves the existing local image limits',()=>{
  const image={width:1,height:1,gray:new Uint8Array(1)}
  const body:Rect=[0,0,1,1]
  expect(()=>describeLocalMessage({type:'local-describe',id:1,image,bodies:Array.from({length:33},()=>body)}))
    .toThrow('局所画像の上限を超えました')
  expect(()=>describeLocalMessage({type:'local-describe',id:1,
    image:{width:LOCAL_IMAGE_MAX_PIXELS+1,height:1,gray:new Uint8Array(LOCAL_IMAGE_MAX_PIXELS+1)},bodies:[]}))
    .toThrow('局所画像の上限を超えました')
})

it('bounds match ownership without discarding probes or attachments',()=>{
  const {message,image}=fixture(),result=searched(message),normal=probed(message,result)
  expect(normal.matches.every(p=>!!p.ownership)).toBe(true)
  const first=normal.matches[0].ownership!
  const limit=first.foreign.length+first.owned.length
  expect(limit).toBeGreaterThan(0)
  const bounded=probed(message,result,limit)
  expect(bounded.matches).toHaveLength(result.matches.length)
  expect(bounded.sample).toEqual(normal.sample)
  expect(bounded.matches[0]).toEqual(normal.matches[0])
  expect(bounded.matches.slice(1).every(p=>!p.ownership)).toBe(true)
  const retained=bounded.matches.reduce((sum,p)=>sum+(p.ownership?.foreign.length??0)+(p.ownership?.owned.length??0),0)
  expect(retained).toBeLessThanOrEqual(limit)
  for(const [i,probe] of bounded.matches.entries()){
    const {ownership,...features}=probe,{ownership:originalOwnership,...originalFeatures}=normal.matches[i]
    expect(features).toEqual(originalFeatures)
    if(i===0)expect(ownership).toEqual(originalOwnership)
  }
  const bodies=describeLocalMessage(localMessage(image,result,bounded))
  expect(bodies[1].shape).toBeDefined()
  expect(bodies[1].shape?.interior.regions).toBeUndefined()
  const decision=decideSymbolShape(bodies[0].shape,bodies[1].shape)
  expect(decision.unknown).toContain('interior')
})

it('can omit every match ownership with a zero budget',()=>{
  const {message}=fixture(),result=searched(message),normal=probed(message,result),bounded=probed(message,result,0)
  expect(bounded.matches).toHaveLength(normal.matches.length)
  expect(bounded.matches.every(p=>!p.ownership)).toBe(true)
  expect(bounded.sample).toEqual(normal.sample)
})
