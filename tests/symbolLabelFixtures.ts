import mupdf from 'mupdf'

export const circleLines = (x: number, y: number, r = 5) => Array.from({length:32},(_,i)=>[
  x+r*Math.cos(i*Math.PI/16), y+r*Math.sin(i*Math.PI/16), x+r*Math.cos((i+1)*Math.PI/16), y+r*Math.sin((i+1)*Math.PI/16),
]).flat()
export const outletLines = (x: number, y: number) => [...circleLines(x,y),x-1,y-4.9,x-1,y+4.9,x+1,y-4.9,x+1,y+4.9]
const paths = (lines: number[]) => Array.from({length:lines.length/4},(_,i)=>`${lines[i*4]} ${lines[i*4+1]} m ${lines[i*4+2]} ${lines[i*4+3]} l S`).join('\n')

/** Eight single circles (ET × 3, ETG × 2, 4H × 1, blank × 2)
 * and two double circles (20A). Text sits right, above and left of bodies. */
export function symbolLabelsPdf(): number[] {
  const doc=new mupdf.PDFDocument(),font=new mupdf.Font('Helvetica'),fontRef=doc.addSimpleFont(font),fonts=doc.newDictionary(),resources=doc.newDictionary()
  let ref: import('mupdf').PDFObject | undefined
  try {
    fonts.put('F1',fontRef);resources.put('Font',fonts)
    const positions=[[40,60],[150,60],[260,60],[370,60],[40,160],[150,160],[260,160],[370,160],[40,260],[260,260]]
    const labels=['ET','ET','ET','ETG','ETG','4H','','','20A','20A']
    let content='q 1 0 0 -1 0 500 cm 0 G .06 w\n'
    for(let y=20;y<480;y+=17) content+=`10 ${y} m 490 ${y} l S\n`
    for(let x=15;x<490;x+=37) content+=`${x} 10 m ${x} 490 l S\n`
    content+='.42 w\n'
    positions.forEach(([x,y],i)=>{content+=paths(outletLines(x,y))+'\n';if(i>=8) content+=paths(circleLines(x,y,7))+'\n'})
    content+='Q\n'
    positions.forEach(([x,y],i)=>{
      if(!labels[i]) return
      const [tx,ty]=i%3===1?[x-4,y-9]:i%3===2?[x-18,y+2]:[x+8,y+2]
      content+=`BT /F1 6 Tf ${tx} ${500-ty} Td (${labels[i]}) Tj ET\n`
    })
    ref=doc.addPage([0,0,500,500],0,resources,content);doc.insertPage(-1,ref)
    const buffer=doc.saveToBuffer('compress')
    try{return [...buffer.asUint8Array()]}finally{buffer.destroy()}
  }finally{ref?.destroy();resources.destroy();fonts.destroy();fontRef.destroy();font.destroy();doc.destroy()}
}
