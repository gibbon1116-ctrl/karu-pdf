import {expect,it} from 'vitest'
import {decideSymbolShape,type LocalShapeLike,type SymbolShapeFeature} from '../src/core/symbolShapeDecision'
import type {SymbolInteriorProfile} from '../src/core/symbolFeatureProfile'

function interior(filled=false):SymbolInteriorProfile {
  const side=48,mask=new Uint8Array(side*side),regions=new Uint8Array(side*side)
  for(let y=9;y<=38;y++)for(let x=9;x<=38;x++){
    const at=y*side+x,boundary=x===9||x===38||y===9||y===38
    if(boundary||filled)mask[at]=1
    if(!boundary)regions[at]=1
  }
  return {known:true,mask,ink:mask.reduce((sum,v)=>sum+v,0)/mask.length,
    holes:filled?[]:[{area:28*28/mask.length,center:[.5,.5]}],regions,regionAreas:[28*28/mask.length]}
}
function shape(features:Partial<LocalShapeLike['features']>={},fill=interior()):LocalShapeLike {
  return {features:{topArc:'absent',annexFrame:'absent',interiorLineCount:0,...features},interior:fill}
}

it('requires all four features to be known and equal',()=>{
  expect(decideSymbolShape(shape(),shape())).toEqual({decision:'same',differences:[],unknown:[]})
  expect(decideSymbolShape(shape({topArc:'present',annexFrame:'present',interiorLineCount:2}),
    shape({topArc:'present',annexFrame:'present',interiorLineCount:2}))).toEqual({decision:'same',differences:[],unknown:[]})
})

it.each([
  ['topArc',{topArc:'present'}],
  ['annexFrame',{annexFrame:'present'}],
  ['interiorLines',{interiorLineCount:1}],
] as const)('reports a known difference in %s',(feature,features)=>{
  expect(decideSymbolShape(shape(),shape(features))).toEqual({decision:'different',differences:[feature],unknown:[]})
  expect(decideSymbolShape(shape(features),shape())).toEqual({decision:'different',differences:[feature],unknown:[]})
})

it('compares visible interior fills',()=>{
  expect(decideSymbolShape(shape(),shape({},interior(true)))).toEqual({decision:'different',differences:['interior'],unknown:[]})
  expect(decideSymbolShape(shape({},interior(true)),shape())).toEqual({decision:'different',differences:['interior'],unknown:[]})
})

it.each([
  ['topArc',{topArc:'unknown'}],
  ['annexFrame',{annexFrame:'unknown'}],
  ['interiorLines',{interiorLineCount:undefined}],
] as const)('does not turn unknown %s into a difference',(feature,features)=>{
  expect(decideSymbolShape(shape(),shape(features))).toEqual({decision:'unknown',differences:[],unknown:[feature]})
  expect(decideSymbolShape(shape(features),shape())).toEqual({decision:'unknown',differences:[],unknown:[feature]})
  expect(decideSymbolShape(shape(features),shape(features))).toEqual({decision:'unknown',differences:[],unknown:[feature]})
})

it('keeps incomplete interior observations unknown',()=>{
  const unavailable={...interior(),known:false}
  expect(decideSymbolShape(shape(),shape({},unavailable))).toEqual({decision:'unknown',differences:[],unknown:['interior']})
  expect(decideSymbolShape(shape({},unavailable),shape())).toEqual({decision:'unknown',differences:[],unknown:['interior']})
  const withoutOwnership={...interior(),regions:undefined,regionAreas:undefined}
  expect(decideSymbolShape(shape(),shape({},withoutOwnership))).toEqual({decision:'unknown',differences:[],unknown:['interior']})
})

it('reports all four features unknown when either observation is missing',()=>{
  const unknown:SymbolShapeFeature[]=['topArc','annexFrame','interiorLines','interior']
  expect(decideSymbolShape(undefined,shape())).toEqual({decision:'unknown',differences:[],unknown})
  expect(decideSymbolShape(shape(),undefined)).toEqual({decision:'unknown',differences:[],unknown})
  expect(decideSymbolShape(undefined,undefined)).toEqual({decision:'unknown',differences:[],unknown})
})

it('keeps unknown features alongside a decisive difference',()=>{
  const target=shape({topArc:'present',annexFrame:'unknown',interiorLineCount:undefined},{...interior(),known:false})
  expect(decideSymbolShape(shape(),target)).toEqual({
    decision:'different',differences:['topArc'],unknown:['annexFrame','interiorLines','interior'],
  })
})

it('reports multiple differences in feature order',()=>{
  expect(decideSymbolShape(shape(),shape({topArc:'present',annexFrame:'present',interiorLineCount:2},interior(true)))).toEqual({
    decision:'different',differences:['topArc','annexFrame','interiorLines','interior'],unknown:[],
  })
})
