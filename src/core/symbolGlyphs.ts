import type { Rect } from './annotations'
import type { SymbolImagePatch } from './symbolLocalImage'

const W=20,H=28,N=W*H,INK=180
export interface GlyphReading { text:string; score:number; gap:number; alternative?:string; rect:Rect; distance:number; mask:Uint8Array }
export interface LocalLabel { text:string; status:'read'|'unknown'|'none'; glyphs:GlyphReading[] }
interface GlyphModel { text:string; mask:Uint8Array; spread:Uint8Array; stem:number }
let models:GlyphModel[]|undefined
// Independently constructed single-stroke ASCII alphabet, not drawing-specific glyphs.
// Complements filled system fonts for CAD outline/stroke lettering.
const STROKE_FONT:Record<string,string>={
 A:'M0 10L5 0L10 10M2 6L8 6',B:'M0 10V0H5Q10 0 10 2.5Q10 5 5 5H0M5 5Q10 5 10 7.5Q10 10 5 10H0',
 C:'M10 2Q8 0 5 0Q0 0 0 5Q0 10 5 10Q8 10 10 8',D:'M0 10V0H4Q10 0 10 5Q10 10 4 10Z',
 E:'M10 0H0V10H10M0 5H8',F:'M10 0H0V10M0 5H8',G:'M10 2Q8 0 5 0Q0 0 0 5Q0 10 5 10Q10 10 10 6H6',
 H:'M0 0V10M10 0V10M0 5H10',I:'M0 0H10M5 0V10M0 10H10',J:'M0 0H10V7Q10 10 5 10Q0 10 0 7',
 K:'M0 0V10M10 0L0 5L10 10',L:'M0 0V10H10',M:'M0 10V0L5 6L10 0V10',N:'M0 10V0L10 10V0',
 O:'M5 0Q0 0 0 5Q0 10 5 10Q10 10 10 5Q10 0 5 0Z',P:'M0 10V0H5Q10 0 10 2.5Q10 5 5 5H0',
 Q:'M5 0Q0 0 0 5Q0 10 5 10Q10 10 10 5Q10 0 5 0ZM6 7L10 11',R:'M0 10V0H5Q10 0 10 2.5Q10 5 5 5H0M5 5L10 10',
 S:'M10 2Q10 0 5 0Q0 0 0 2.5Q0 5 5 5Q10 5 10 7.5Q10 10 5 10Q0 10 0 8',T:'M0 0H10M5 0V10',
 U:'M0 0V7Q0 10 5 10Q10 10 10 7V0',V:'M0 0L5 10L10 0',W:'M0 0L2 10L5 4L8 10L10 0',
 X:'M0 0L10 10M10 0L0 10',Y:'M0 0L5 5L10 0M5 5V10',Z:'M0 0H10L0 10H10',
 '0':'M5 0Q0 0 0 5Q0 10 5 10Q10 10 10 5Q10 0 5 0Z','1':'M2 2L5 0V10M2 10H8',
 '2':'M0 2Q0 0 5 0Q10 0 10 2Q10 4 5 6L0 10H10','3':'M0 1Q3 0 5 0Q10 0 10 2.5Q10 5 5 5M5 5Q10 5 10 7.5Q10 10 5 10Q2 10 0 9',
 '4':'M8 10V0L0 7H10','5':'M10 0H0V5H5Q10 5 10 7.5Q10 10 5 10Q2 10 0 9',
 '6':'M9 1Q7 0 5 0Q0 0 0 5V7Q0 10 5 10Q10 10 10 7.5Q10 5 5 5H0','7':'M0 0H10L3 10',
 '8':'M5 0Q0 0 0 2.5Q0 5 5 5Q10 5 10 2.5Q10 0 5 0ZM5 5Q0 5 0 7.5Q0 10 5 10Q10 10 10 7.5Q10 5 5 5Z',
 '9':'M10 5H5Q0 5 0 2.5Q0 0 5 0Q10 0 10 3V5Q10 10 5 10Q3 10 1 9',
}
/** Continuous stems distinguish narrow CAD B/D/P from two round loops such as 8. */
function stem(mask:Uint8Array):number {
 let best=0
 for(let x=0;x<W*.45;x++){let n=0;for(let y=2;y<H-2;y++)n+=mask[y*W+x];best=Math.max(best,n/(H-4))}
 return best
}

function spread(mask:Uint8Array):Uint8Array {
 const out=new Uint8Array(N)
 for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(mask[y*W+x])for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  if(x+dx>=0&&x+dx<W&&y+dy>=0&&y+dy<H)out[(y+dy)*W+x+dx]=1
 }
 return out
}
export function glyphSimilarity(a:Uint8Array,b:Uint8Array):number {
 if(a.length!==N||b.length!==N)return 0
 return compareMasks(a,spread(a),b,spread(b))
}
/** Average stroke width relative to glyph height. Broad wire fragments can fit
 * a dilated letter mask; abstain rather than assigning them a fixture name. */
export function glyphStrokeRatio(mask:Uint8Array):number {
 if(mask.length!==N)return Infinity
 let ink=0,perimeter=0
 for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(mask[y*W+x]){
  ink++
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]])if(x+dx<0||x+dx>=W||y+dy<0||y+dy>=H||!mask[(y+dy)*W+x+dx])perimeter++
 }
 return perimeter?2*ink/perimeter/H:Infinity
}
function compareMasks(a:Uint8Array,aa:Uint8Array,b:Uint8Array,bb:Uint8Array):number {
 let na=0,nb=0,ha=0,hb=0
 for(let i=0;i<N;i++){if(a[i]){na++;ha+=bb[i]}if(b[i]){nb++;hb+=aa[i]}}
 return na&&nb?Math.min(ha/na,hb/nb):0
}
function normalized(gray:Uint8Array,width:number,box:Rect,component?:Uint16Array,id?:number,threshold=INK):Uint8Array {
 const out=new Uint8Array(N)
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){
  const at=Math.floor(box[1]+(y+.5)*(box[3]-box[1])/H)*width+Math.floor(box[0]+(x+.5)*(box[2]-box[0])/W)
  out[y*W+x]=gray[at]>=threshold&&(!component||component[at]===id)?1:0
 }
 return out
}
/** Lazy, terminal-local short ASCII recognition. No model files, network or page cache.
 * Font fallback is allowed; unavailable Canvas produces unknown, never invented names. */
function glyphModels():GlyphModel[] {
 if(models)return models
 if(typeof OffscreenCanvas==='undefined')return []
 const canvas=new OffscreenCanvas(100,100),ctx=canvas.getContext('2d',{willReadFrequently:true})
 if(!ctx)return []
 models=[]
 const capture=(text:string)=>{
  const pixels=ctx.getImageData(0,0,100,100).data,gray=new Uint8Array(10000)
  let x0=100,y0=100,x1=0,y1=0
  for(let y=0;y<100;y++)for(let x=0;x<100;x++){const at=y*100+x;gray[at]=255-pixels[at*4];if(gray[at]>=INK){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1)}}
  const mask=normalized(gray,100,[x0,y0,x1,y1]);models!.push({text,mask,spread:spread(mask),stem:stem(mask)})
 }
 if(typeof Path2D!=='undefined')for(const [text,path] of Object.entries(STROKE_FONT))for(const weight of [.2,.35,.5]){
  ctx.fillStyle='white';ctx.fillRect(0,0,100,100);ctx.save();ctx.translate(12,12);ctx.scale(6.5,6.5)
  ctx.strokeStyle='black';ctx.lineWidth=weight;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke(new Path2D(path));ctx.restore();capture(text)
 }
 for(const font of ['Arial','Times New Roman','Courier New'])for(const bold of ['','bold '])for(const text of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'){
  ctx.fillStyle='white';ctx.fillRect(0,0,100,100);ctx.fillStyle='black';ctx.font=`${bold}64px ${font}`;ctx.fillText(text,10,75)
  capture(text)
 }
 return models
}

export function describeLocalLabel(image:SymbolImagePatch):LocalLabel {
 const b=image.body,long=Math.max(b[2]-b[0],b[3]-b[1]),margin=long*.6
 if(long<20||image.gray.length!==image.width*image.height)return {text:'',status:'unknown',glyphs:[]}
 const x0=Math.max(0,Math.floor(b[0]-margin)),y0=Math.max(0,Math.floor(b[1]-margin)),x1=Math.min(image.width,Math.ceil(b[2]+margin)),y1=Math.min(image.height,Math.ceil(b[3]+margin))
 const w=x1-x0,h=y1-y0
 if(w<=0||h<=0||w*h>256*256*4)return {text:'',status:'unknown',glyphs:[]}
 const gray=new Uint8Array(w*h)
 for(let y=0;y<h;y++)gray.set(image.gray.subarray((y+y0)*image.width+x0,(y+y0)*image.width+x1),y*w)
 const body:Rect=[b[0]-x0,b[1]-y0,b[2]-x0,b[3]-y0],cx=(body[0]+body[2])/2,cy=(body[1]+body[3])/2
 const inside=(x:number,y:number)=>x>=body[0]-2&&x<=body[2]+2&&y>=body[1]-2&&y<=body[3]+2
 const templates=glyphModels()
 if(!templates.length)return {text:'',status:'unknown',glyphs:[]}
 const seen=new Uint16Array(w*h),queue=new Int32Array(w*h),found:GlyphReading[]=[]
 let id=0,clipped=false
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const start=y*w+x;if(seen[start]||gray[start]<INK||inside(x,y))continue
  id++;if(id>=65535)return {text:'',status:'unknown',glyphs:found.slice(0,6)}
  queue[0]=start;seen[start]=id;let tail=1,ax=x,ay=y,bx=x,by=y
  for(let head=0;head<tail;head++){
   const at=queue[head],xx=at%w,yy=Math.floor(at/w);ax=Math.min(ax,xx);bx=Math.max(bx,xx);ay=Math.min(ay,yy);by=Math.max(by,yy)
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const nx=xx+dx,ny=yy+dy,n=ny*w+nx
    if(nx<0||ny<0||nx>=w||ny>=h||seen[n]||inside(nx,ny)||gray[n]<INK)continue
    seen[n]=id;queue[tail++]=n
   }
  }
  const cw=bx-ax+1,ch=by-ay+1,mx=(ax+bx+1)/2,my=(ay+by+1)/2
  if(ch<long*.14||ch>long*.58||cw/ch<.12||cw/ch>1.15||Math.abs(my-cy)>long*.4||Math.abs(mx-cx)>long*.75)continue
  // Detect separately from the body, then restore only the outside edge band.
  // This keeps body fragments out of OCR without amputating a close character stem.
  const recovered=new Uint8Array(w*h)
  let rx0=ax,ry0=ay,rx1=bx+1,ry1=by+1
  let px0=ax,py0=ay,px1=bx+1,py1=by+1
  for(let yy=Math.max(0,ay-2);yy<Math.min(h,by+3);yy++)for(let xx=Math.max(0,ax-2);xx<Math.min(w,bx+3);xx++){
    const at=yy*w+xx,outside=xx<body[0]-.5||xx>body[2]+.5||yy<body[1]-.5||yy>body[3]+.5
    if(gray[at]>=140&&(seen[at]===id||outside&&((xx>=ax&&xx<=bx&&yy>=ay&&yy<=by)||inside(xx,yy)))){
      recovered[at]=gray[at];rx0=Math.min(rx0,xx);ry0=Math.min(ry0,yy);rx1=Math.max(rx1,xx+1);ry1=Math.max(ry1,yy+1)
      if(gray[at]>=INK){px0=Math.min(px0,xx);py0=Math.min(py0,yy);px1=Math.max(px1,xx+1);py1=Math.max(py1,yy+1)}
    }
  }
  const primary=normalized(recovered,w,[px0,py0,px1,py1]),secondary=normalized(recovered,w,[rx0,ry0,rx1,ry1],undefined,undefined,140)
  const expanded=spread(primary),secondaryExpanded=spread(secondary),vertical=stem(primary),secondaryVertical=stem(secondary)
  const firstScores=new Map<string,number>(),secondScores=new Map<string,number>()
  for(const t of templates){
    // Vertical continuity constrains stem/loop letters. At tiny resolutions a
    // thick sloping leg in A/X can alias to a vertical stem; do not penalize it.
    const stemWeight='BDPREFHKLMNU8'.includes(t.text)?.15:0
    firstScores.set(t.text,Math.max(firstScores.get(t.text)??0,compareMasks(primary,expanded,t.mask,t.spread)-Math.abs(vertical-t.stem)*stemWeight))
    secondScores.set(t.text,Math.max(secondScores.get(t.text)??0,compareMasks(secondary,secondaryExpanded,t.mask,t.spread)-Math.abs(secondaryVertical-t.stem)*stemWeight))
  }
  const strong=[...firstScores].sort((a,b)=>b[1]-a[1]),soft=[...secondScores].sort((a,b)=>b[1]-a[1])
  // Accept anti-alias recovery only when it substantially improves the fit and
  // separates the best character. Tiny changes cannot rename an ambiguous B/8.
  const useSoft=strong[0][1]<.90&&soft[0][1]>=strong[0][1]+.025&&soft[0][1]-soft[1][1]>=.04
  const rank=useSoft?soft:strong,best=rank[0]
  if(!best)continue
  const mask=useSoft?secondary:primary
  // Diagonal lettering is thin at this scale; broad crossing-wire triangles
  // must not acquire A/V/X names. Loop letters naturally occupy more pixels.
  if('AVWXYZ47'.includes(best[0])&&glyphStrokeRatio(mask)>.12){clipped=true;continue}
  found.push({text:best[0],score:best[1],gap:best[1]-(rank[1]?.[1]??0),alternative:rank[1]?.[0],rect:[rx0+x0,ry0+y0,rx1+x0,ry1+y0],mask,
   distance:Math.hypot(Math.max(body[0]-bx,0,ax-body[2]),Math.max(body[1]-by,0,ay-body[3]))})
 }
 found.sort((a,b)=>a.distance-b.distance)
 const reliable=(g:GlyphReading)=>g.score>=.90&&g.gap>=(['B8','8B','CG','GC','O0','0O','I1','1I','S5','5S','A4','4A','Z2','2Z'].includes(g.text+(g.alternative??''))?.06:.025)
 const plausible=found.filter(g=>g.score>=.82),first=plausible.find(reliable)
 if(!first)return {text:'',status:found.length||clipped?'unknown':'none',glyphs:plausible.slice(0,6)}
 const height=first.rect[3]-first.rect[1],line=plausible.filter(g=>Math.abs(g.rect[3]-first.rect[3])<height*.25&&Math.abs((g.rect[3]-g.rect[1])-height)<height*.3&&g.distance<=first.distance+height*.8)
  .sort((a,b)=>a.rect[0]-b.rect[0]).slice(0,6)
 const text=line.map(g=>g.text).join(''),readable=line.every(reliable)
 return {text:readable?text:'',status:readable?'read':'unknown',glyphs:line}
}

/** Search-scoped font exemplars complement generic fonts. Only already readable
 * single characters supply names; ambiguous targets need a distinct best class. */
export function resolveLocalLabels(labels:readonly LocalLabel[]):LocalLabel[] {
 const groups=new Map<string,GlyphReading[]>()
 for(const label of labels)if(label.status==='read'&&label.glyphs.length===1){
  const refs=groups.get(label.text)??[]
  if(refs.length<8&&!refs.some(g=>glyphSimilarity(g.mask,label.glyphs[0].mask)>.995))refs.push(label.glyphs[0])
  groups.set(label.text,refs)
 }
 const references=[...groups].map(([text,refs])=>({text,refs:refs.map(g=>({mask:g.mask,spread:spread(g.mask)}))}))
 return labels.map(label=>{
  if(label.status!=='unknown'||label.glyphs.length!==1)return label
  const g=label.glyphs[0],expanded=spread(g.mask),rank=references.map(({text,refs})=>({text,score:Math.max(...refs.map(r=>compareMasks(g.mask,expanded,r.mask,r.spread)))})).sort((a,b)=>b.score-a.score)
  if(rank[0]?.score>=.94&&rank[0].score-(rank[1]?.score??0)>=.035)return {...label,text:rank[0].text,status:'read'}
  return label
 })
}

/** Glyph equality can supplement an uncertain character name using a readable sample.
 * A confidently read different character is never renamed by visual similarity. */
export function compareLocalLabel(sample:LocalLabel,target:LocalLabel):'same'|'different'|'unknown' {
 if(sample.status==='read'&&target.status==='read')return sample.text===target.text?'same':'different'
 if(sample.status==='none'&&target.status==='none')return 'same'
 if(sample.status==='read'&&target.status==='none'||sample.status==='none'&&target.status==='read')return 'different'
 if(sample.status==='read'&&sample.glyphs.length===1&&target.glyphs.length){
  const g=target.glyphs[0],similarity=glyphSimilarity(sample.glyphs[0].mask,g.mask)
  if(similarity>=.94)return 'same'
 }
 return 'unknown'
}
