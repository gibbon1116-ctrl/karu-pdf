import mupdf from 'mupdf'
import type { Rect } from '../src/core/annotations'

// Display coordinates in pt. The first body's bounds are [35, 56, 45, 64].
// The padding includes its stroke while leaving the upper arc outside the sample.
export const symbolShapeSampleRect: Rect = [34.5, 55.5, 45.5, 64.5]

const cup='25 56 m 35 56 l 35 61 33 64 30 64 c 27 64 25 61 25 56 c h S'
const arc='23.5 56 m 26 52 34 52 36.5 56 c S'

/** Eight detector bodies: four with upper arcs and four without.
 * Thin grid lines provide background; two bodies have horizontal wiring. */
export function symbolShapePdf(): number[] {
  const doc=new mupdf.PDFDocument(),resources=doc.newDictionary()
  let ref: import('mupdf').PDFObject | undefined
  try {
    const positions=[[40,60],[151,62],[263,59],[371,61],[43,162],[149,159],[262,163],[373,160]]
    let content='q 1 0 0 -1 0 500 cm 0 G .06 w\n'
    for(let y=20;y<480;y+=17) content+=`10 ${y} m 490 ${y} l S\n`
    for(let x=15;x<490;x+=37) content+=`${x} 10 m ${x} 490 l S\n`
    content+='.42 w\n'
    positions.forEach(([x,y],i)=>{
      content+=`q 1 0 0 1 ${x-30} ${y-60} cm\n${cup}\n`
      if(i<4) content+=arc+'\n'
      content+='Q\n'
      if(i===1||i===5) content+=`${x-22} ${y} m ${x+22} ${y} l S\n`
    })
    content+='Q\n'
    ref=doc.addPage([0,0,500,500],0,resources,content);doc.insertPage(-1,ref)
    const buffer=doc.saveToBuffer('compress')
    try{return [...buffer.asUint8Array()]}finally{buffer.destroy()}
  }finally{ref?.destroy();resources.destroy();doc.destroy()}
}
