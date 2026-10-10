import mupdf from 'mupdf'
import type { Rect } from '../src/core/annotations'

/** Independently drawn primitives inspired by the documented feature distinctions.
 * No supplied standard-drawing bytes, images or vector paths are copied here. */
export interface RecognitionTruth { id: string; group: string; pageIndex: number; rect: Rect; center: [number,number] }
const circle = (r = 10) => {
  const k = r * .5522847498
  return `${2*r} ${r} m ${2*r} ${r+k} ${r+k} ${2*r} ${r} ${2*r} c ${r-k} ${2*r} 0 ${r+k} 0 ${r} c 0 ${r-k} ${r-k} 0 ${r} 0 c ${r+k} 0 ${2*r} ${r-k} ${2*r} ${r} c h`
}
const rect = '0 0 24 14 re'
const variants: Array<Array<{id:string;group?:string;body:string;size?:[number,number]}>> = [
  [
    {id:'duct-plain',body:`${rect} S`},
    {id:'duct-one',body:`${rect} S 0 14 m 24 0 l S`},
    {id:'duct-two',body:`${rect} S 0 12 m 21 0 l S 3 14 m 24 2 l S`},
    {id:'duct-cross',body:`${rect} S 0 0 m 24 14 l S 0 14 m 24 0 l S`},
    {id:'duct-reverse',body:`${rect} S 0 0 m 24 14 l S`},
    {id:'duct-hatch',body:`${rect} S 0 6 m 10 0 l S 0 12 m 20 0 l S 4 14 m 24 2 l S 14 14 m 24 8 l S`},
  ],
  [
    {id:'lamp-outline',body:`${circle()} S`},
    {id:'lamp-solid',body:`${circle()} f`},
    {id:'lamp-left',body:`${circle()} S 10 0 m 4.477 0 0 4.477 0 10 c 0 15.523 4.477 20 10 20 c h f`},
    {id:'lamp-right',body:`${circle()} S 10 0 m 15.523 0 20 4.477 20 10 c 20 15.523 15.523 20 10 20 c h f`},
    {id:'lamp-hatch',body:`${circle()} S 1 14 m 14 1 l S 6 19 m 19 6 l S`},
    {id:'lamp-cross',body:`${circle()} S 3 3 m 17 17 l S 3 17 m 17 3 l S`},
  ].map(v=>({...v,size:[20,20] as [number,number]})),
  [
    {id:'connected',group:'connected',body:`${rect} S 0 14 m 24 0 l S`},
    {id:'crossing-wire',group:'connected',body:`${rect} S 0 14 m 24 0 l S -15 7 m 39 7 l S`},
    {id:'bent-wire',group:'connected',body:`${rect} S 0 14 m 24 0 l S -15 7 m 0 7 l -2 30 l S`},
    {id:'text-overlap',group:'connected',body:`${rect} S 0 14 m 24 0 l S BT /F0 5 Tf 1 0 0 -1 9 9 Tm (AB) Tj ET`},
    {id:'connected-wrong',body:`${rect} S`},
  ],
  [
    {id:'white-hole',group:'hole',body:`${rect} f 1 g 6 4 12 6 re f 0 g`},
    {id:'evenodd-hole',group:'hole',body:`${rect} 6 4 12 6 re f*`},
    {id:'same-winding-solid',group:'solid',body:`${rect} 6 4 12 6 re f`},
    {id:'white-before-black',group:'solid',body:`1 g 6 4 12 6 re f 0 g ${rect} f`},
    {id:'solid',group:'solid',body:`${rect} f`},
    {id:'white-hidden-line',group:'hole',body:`${rect} f 0 7 m 24 7 l S 1 g 6 4 12 6 re f 0 g`},
  ],
  [
    {id:'interior-none',body:`${circle()} S`},
    {id:'interior-one',body:`${circle()} S 7 13 m 13 7 l S`},
    {id:'interior-two',body:`${circle()} S 5 12 m 11 6 l S 9 14 m 15 8 l S`},
    {id:'interior-external',group:'interior-one',body:`${circle()} S 7 13 m 13 7 l S -10 10 m 30 10 l S`},
  ].map(v=>({...v,size:[20,20] as [number,number]})),
]

export function recognitionFixture() {
  const pdf = new mupdf.PDFDocument(), font = new mupdf.Font('Helvetica'), fontRef = pdf.addSimpleFont(font)
  const truth: RecognitionTruth[] = []
  try {
    variants.forEach((pageVariants,pageIndex)=>{
      const commands:string[]=[]
      pageVariants.forEach((v,variant)=>{
        for(let copy=0;copy<2;copy++) {
          const cell=variant*2+copy,x=40+(cell%4)*120,y=35+Math.floor(cell/4)*80
          const [w,h]=v.size??[24,14]
          commands.push(`q 1 0 0 1 ${x} ${y} cm .6 w 0 G 0 g ${v.body} Q`)
          truth.push({id:`${v.id}-${copy}`,group:v.group??v.id,pageIndex,rect:[x-.5,y-.5,x+w+.5,y+h+.5],center:[x+w/2,y+h/2]})
          commands.push(`BT /F0 7 Tf 1 0 0 -1 ${x} ${y+h+22} Tm (${v.id}-${copy}) Tj ET`)
        }
      })
      const page=pdf.addPage([0,0,520,350],0,{Font:{F0:fontRef}},`q 1 0 0 -1 0 350 cm ${commands.join('\n')} Q`)
      try{pdf.insertPage(-1,page)}finally{page.destroy()}
    })
    const buffer=pdf.saveToBuffer('compress')
    try{return {bytes:new Uint8Array(buffer.asUint8Array()),truth}}
    finally{buffer.destroy()}
  }finally{fontRef.destroy();font.destroy();pdf.destroy()}
}

export function recognitionAccuracy(truth: RecognitionTruth[], sample: RecognitionTruth, centers: readonly (readonly number[])[]) {
  const expected=truth.filter(t=>t.pageIndex===sample.pageIndex&&t.group===sample.group)
  const found=new Set<string>(),unexpected: number[][]=[]
  for(const center of centers){
    const target=truth.find(t=>t.pageIndex===sample.pageIndex&&Math.hypot(t.center[0]-center[0],t.center[1]-center[1])<2)
    if(target&&target.group===sample.group&&!found.has(target.id))found.add(target.id)
    else unexpected.push([...center])
  }
  const tp=found.size,fp=unexpected.length,fn=expected.length-tp
  return {tp,fp,fn,precision:tp+fp?tp/(tp+fp):0,recall:expected.length?tp/expected.length:0,expected:expected.map(t=>t.id),unexpected}
}
