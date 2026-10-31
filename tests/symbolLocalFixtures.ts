import mupdf from 'mupdf'
/** Independent primitive drawing oracle. Letters are PDF paths, with no text layer. */
export function localSymbolsFixture(){
 const doc=new mupdf.PDFDocument(),truth:Array<{label:string;black:boolean;x:number;y:number;rect:[number,number,number,number]}>=[],ops:string[]=[]
 const letters:Record<string,string>={
  A:'0 0 m 1.4 5.5 l 2.8 0 l S .7 2.2 m 2.1 2.2 l S',
  B:'0 0 m 0 5.5 l 1.1 5.5 l 3.3 5.5 3.3 2.8 1.1 2.8 c 0 2.8 l S 1.1 2.8 m 3.5 2.8 3.5 0 1.1 0 c 0 0 l S',
  C:'2.6 4.8 m 1.6 6 -.2 5.3 -.2 2.75 c -.2 .2 1.6 -.5 2.6 .7 c S',
  N:'0 0 m 0 5.5 l 2.8 0 l 2.8 5.5 l S',
  '8':'1.4 2.75 m -.6 2.75 -.6 5.5 1.4 5.5 c 3.4 5.5 3.4 2.75 1.4 2.75 c -.6 2.75 -.6 0 1.4 0 c 3.4 0 3.4 2.75 1.4 2.75 c S',
 }
 for(const [i,item] of ['A','B','C','A','B','C','8','black-C','black-N','black-B','wire'].entries()){
  const label=item==='wire'?'':item.replace('black-',''),black=label==='A'||item.startsWith('black-')||item==='wire'
  const x=30+i*45,y=50
  ops.push(`q .6 w 0 G 0 g ${x} ${y} 5 20 re ${black?'f':'S'} 1 g ${x+2.5} ${y+8} m ${x+5.6} ${y+8} ${x+5.6} ${y+12} ${x+2.5} ${y+12} c ${x-.6} ${y+12} ${x-.6} ${y+8} ${x+2.5} ${y+8} c B Q`)
  if(label)ops.push(`q 1 0 0 1 ${x+7} ${y+7} cm .3 w 0 G ${letters[label]} Q`)
  else ops.push(`q 0 G 2.5 w ${x-8} ${y+14} m ${x} ${y+10} l ${x-8} ${y+8} l S Q`)
  truth.push({label,black,x,y,rect:[x-1,y-1,x+6,y+21]})
 }
 try{const p=doc.addPage([0,0,540,130],0,{},ops.join('\n'));try{doc.insertPage(-1,p)}finally{p.destroy()}
  const bytes=doc.saveToBuffer('compress');try{return {bytes:new Uint8Array(bytes.asUint8Array()),truth}}finally{bytes.destroy()}
 }finally{doc.destroy()}
}
