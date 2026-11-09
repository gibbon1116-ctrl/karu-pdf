import mupdf from 'mupdf'
import type { Rect } from '../src/core/annotations'

export interface OutletTruth {
  id: string; group: string; geometryGroup?: string; pageIndex: number; rect: Rect; center: [number, number]
}
type Variant = { group?: string; geometryGroup?: string; body?: string; circle?: number; split?: boolean; reverse?: boolean; order?: boolean; rotate?: boolean; width?: number; wire?: string; label?: string }

// Original primitives drawn specifically for this test, not copied from a diagram.
function circlePath(parts = 4) {
  const numbers=(values:number[])=>values.map(v=>v.toFixed(6)).join(' ')
  const r=9, at=(angle:number)=>[9+r*Math.cos(angle),9+r*Math.sin(angle)]
  if(parts===36) return `${numbers(at(0))} m ${Array.from({length:36},(_,i)=>`${numbers(at((i+1)*2*Math.PI/36))} l`).join(' ')} h`
  const delta=2*Math.PI/parts,k=4/3*Math.tan(delta/4)
  return `${numbers(at(0))} m ${Array.from({length:parts},(_,i)=>{
    const a=i*delta,b=(i+1)*delta,p=at(a),q=at(b)
    return `${numbers([p[0]-k*r*Math.sin(a),p[1]+k*r*Math.cos(a),q[0]+k*r*Math.sin(b),q[1]-k*r*Math.cos(b),...q])} c`
  }).join(' ')} h`
}
function slots(split=false,reverse=false) {
  return [9,13].map(y=>{
    const a=reverse?16:2,b=reverse?2:16
    return split?`${a} ${y} m 9 ${y} l S 9 ${y} m ${b} ${y} l S`:`${a} ${y} m ${b} ${y} l S`
  }).join(' ')
}
const base=`${circlePath()} S ${slots()}`
const pages: Variant[][] = [
  [{},{circle:8},{circle:36},{split:true},{reverse:true},{order:true},{rotate:true},{width:.45},{width:.8}],
  [{},{wire:'-22 9 m 0 9 l S'},{wire:'9 -22 m 9 0 l S'},{wire:'-22 9 m 40 9 l S'},
    {wire:'-22 -8 m -8 -8 l -8 9 l 0 9 l S'},{split:true,wire:'-22 9 m 0 9 l S'}],
  [
    {group:'outlet'}, {group:'outlet'},
    {group:'outlet-ground',body:`${base} 6 3 m 12 3 l S 7 5 m 11 5 l S 8 7 m 10 7 l S`},
    {group:'outlet-three',body:`${base} 2 5 m 16 5 l S`},
    {group:'circle',body:`${circlePath()} S`},
    {group:'cross',body:`${circlePath()} S 3 3 m 15 15 l S 3 15 m 15 3 l S`},
    {group:'half',body:`${circlePath()} S 9 0 m 4.029 0 0 4.029 0 9 c 0 13.971 4.029 18 9 18 c h f`},
    {group:'solid',body:`${circlePath()} f`},
  ],
  [{group:'outlet-g',geometryGroup:'outlet',label:'G'}, {group:'outlet-2',geometryGroup:'outlet',label:'2'}, {}],
  [{group:'outlet-thin',width:.2},{group:'outlet-thin',width:.2}],
]

export function outletRecognitionFixture() {
  const pdf=new mupdf.PDFDocument(),font=new mupdf.Font('Helvetica'),fontRef=pdf.addSimpleFont(font),truth:OutletTruth[]=[]
  try {
    pages.forEach((variants,pageIndex)=>{
      const counts=new Map<string,number>(),commands:string[]=[]
      variants.forEach((v,index)=>{
        const x=45+index%4*120,y=45+Math.floor(index/4)*95,group=v.group??'outlet',copy=counts.get(group)??0
        counts.set(group,copy+1)
        const circle=`${circlePath(v.circle)} S`,slot=slots(v.split,v.reverse)
        const body=v.body??(v.order?`${slot} ${circle}`:`${circle} ${slot}`)
        commands.push(`q 1 0 0 1 ${x} ${y} cm ${v.width??.5} w 0 G 0 g ${v.rotate?'0 1 -1 0 18 0 cm':''} ${body} ${v.wire??''} Q`)
        truth.push({id:`p${pageIndex+1}-${group}-${copy}`,group,...(v.geometryGroup?{geometryGroup:v.geometryGroup}:{}),pageIndex,rect:[x-.5,y-.5,x+18.5,y+18.5],center:[x+9,y+9]})
        if(v.label) commands.push(`BT /F0 7 Tf 1 0 0 -1 ${x+23} ${y+11} Tm (${v.label}) Tj ET`)
      })
      const page=pdf.addPage([0,0,520,350],0,{Font:{F0:fontRef}},`q 1 0 0 -1 0 350 cm ${commands.join('\n')} Q`)
      try { pdf.insertPage(-1,page) } finally { page.destroy() }
    })
    const buffer=pdf.saveToBuffer('compress')
    try { return {bytes:new Uint8Array(buffer.asUint8Array()),truth} } finally { buffer.destroy() }
  } finally {fontRef.destroy();font.destroy();pdf.destroy()}
}

export function outletRecognitionAccuracy(truth:OutletTruth[],sample:OutletTruth,centers:readonly (readonly number[])[],pageIndex=sample.pageIndex) {
  const group=sample.geometryGroup??sample.group,expected=truth.filter(t=>t.pageIndex===pageIndex&&(t.geometryGroup??t.group)===group)
  const found=new Set<string>(),unexpected:number[][]=[]
  for(const center of centers) {
    const target=truth.find(t=>t.pageIndex===pageIndex&&Math.hypot(t.center[0]-center[0],t.center[1]-center[1])<2)
    if(target&&(target.geometryGroup??target.group)===group&&!found.has(target.id)) found.add(target.id)
    else unexpected.push([...center])
  }
  const tp=found.size,fp=unexpected.length,fn=expected.length-tp
  return {tp,fp,fn,precision:tp+fp?tp/(tp+fp):0,recall:expected.length?tp/expected.length:0,expected:expected.map(t=>t.id),unexpected}
}
