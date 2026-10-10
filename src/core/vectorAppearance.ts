import type { Rect } from './annotations'
import { MAX_PAINT_PATHS, MAX_PAINT_POINTS, PAINT_STRIDE, type VectorPaint } from './vectorPaint'

const SIDE=24, PIXELS=SIDE*SIDE, MAX_WORK=8_000_000
function distance(x:number,y:number,ax:number,ay:number,bx:number,by:number){
  const dx=bx-ax,dy=by-ay,d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/d)):0
  return Math.hypot(x-ax-t*dx,y-ay-t*dy)
}
function validate(paint:VectorPaint){
  if(paint.points.length%2||paint.moves.length!==paint.points.length/2||paint.moves.length>MAX_PAINT_POINTS
    ||paint.paths.length%PAINT_STRIDE||paint.paths.length/PAINT_STRIDE>MAX_PAINT_PATHS||!paint.points.every(Number.isFinite))throw Error('Invalid paint data')
  for(let i=0;i<paint.paths.length;i+=PAINT_STRIDE){
    const p=paint.paths
    if(!p.subarray(i,i+PAINT_STRIDE).every(Number.isFinite)||!Number.isInteger(p[i])||!Number.isInteger(p[i+1])||p[i]<0||p[i+1]<0
      ||p[i]+p[i+1]>paint.moves.length||![0,1,2,3].includes(p[i+2])||p[i+3]<0||p[i+4]<0||p[i+4]>1||p[i+5]<0||p[i+5]>1
      ||p[i+8]<p[i+6]||p[i+9]<p[i+7])throw Error('Invalid paint path')
  }
}

/** Filled templates use their exterior for coarse matching; the paint test below
 * supplies hole/interior requirements. This does not modify page/snap arrays. */
export function paintTemplateGeometry(lines:Float32Array,widths:Float32Array,bounds:Rect,paint?:VectorPaint){
  if(!paint||paint.truncated||paint.uncertain)return {segments:lines,widths}
  let filled=false
  for(let i=0;i<paint.paths.length;i+=PAINT_STRIDE){const p=paint.paths;if((p[i+2]===1||p[i+2]===2)&&p[i+4]<Math.fround(.95)&&p[i+5]>0
    &&p[i+6]>=bounds[0]-1&&p[i+7]>=bounds[1]-1&&p[i+8]<=bounds[2]+1&&p[i+9]<=bounds[3]+1){filled=true;break}}
  if(!filled||lines.length/4>4096)return {segments:lines,widths}
  const points:Array<[number,number]>=[]
  for(let i=0;i<lines.length;i+=2)points.push([lines[i],lines[i+1]])
  points.sort((a,b)=>a[0]-b[0]||a[1]-b[1])
  const cross=(a:number[],b:number[],c:number[])=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
  const half=(values:Array<[number,number]>)=>{const hull:Array<[number,number]>=[];for(const p of values){while(hull.length>1&&cross(hull.at(-2)!,hull.at(-1)!,p)<=0)hull.pop();hull.push(p)}return hull}
  const lower=half(points),upper=half([...points].reverse());lower.pop();upper.pop();const hull=[...lower,...upper]
  if(hull.length<3)return {segments:lines,widths}
  const tol=Math.max(.1,Math.min(bounds[2]-bounds[0],bounds[3]-bounds[1])*.015)
  const onHull=(x:number,y:number)=>hull.some((a,i)=>{const b=hull[(i+1)%hull.length];return distance(x,y,a[0],a[1],b[0],b[1])<=tol})
  const ids:number[]=[]
  for(let i=0;i<lines.length;i+=4)if(onHull(lines[i],lines[i+1])&&onHull(lines[i+2],lines[i+3])&&onHull((lines[i]+lines[i+2])/2,(lines[i+1]+lines[i+3])/2))ids.push(i)
  if(ids.length<2)return {segments:lines,widths}
  return {segments:new Float32Array(ids.flatMap(i=>Array.from(lines.subarray(i,i+4)))),widths:new Float32Array(ids.map(i=>widths[i/4]))}
}

type Mask={fill:Uint8Array;line:Uint8Array;known:boolean}
/** Bounded, candidate-local analytic occupancy. No images or PDF originals live here. */
export function createPaintMatcher(sample:VectorPaint,target:VectorPaint,bounds:Rect,tolerance:number){
  validate(sample);if(target!==sample)validate(target)
  let remaining=MAX_WORK
  const makeIndex=(paint:VectorPaint)=>{
    const cells=new Map<string,number[]>();let visits=0,known=!paint.truncated&&!paint.uncertain
    if(known)for(let i=0;i<paint.paths.length;i+=PAINT_STRIDE){
      const p=paint.paths,pad=p[i+3]/2,x0=Math.floor((p[i+6]-pad)/64),x1=Math.floor((p[i+8]+pad)/64),y0=Math.floor((p[i+7]-pad)/64),y1=Math.floor((p[i+9]+pad)/64)
      const count=(x1-x0+1)*(y1-y0+1);visits+=count
      if(count>8192||visits>250_000){known=false;break}
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const key=`${x},${y}`,bucket=cells.get(key);if(bucket)bucket.push(i);else cells.set(key,[i])}
    }
    const query=(rect:Rect)=>{
      const found=new Set<number>(),x0=Math.floor(rect[0]/64),x1=Math.floor(rect[2]/64),y0=Math.floor(rect[1]/64),y1=Math.floor(rect[3]/64)
      if((x1-x0+1)*(y1-y0+1)>8192)return null
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)for(const i of cells.get(`${x},${y}`)??[])found.add(i)
      return [...found].sort((a,b)=>a-b)
    }
    return {paint,known,query}
  }
  const sampleIndex=makeIndex(sample),targetIndex=target===sample?sampleIndex:makeIndex(target)
  const width=bounds[2]-bounds[0],height=bounds[3]-bounds[1],short=Math.min(width,height)
  function mask(index:ReturnType<typeof makeIndex>,center:readonly number[],angle:number):Mask {
    const fill=new Uint8Array(PIXELS),line=new Uint8Array(PIXELS)
    if(!index.known||remaining<=0)return {fill,line,known:false}
    const cos=Math.cos(angle),sin=Math.sin(angle),rx=(Math.abs(cos)*width+Math.abs(sin)*height)/2,ry=(Math.abs(sin)*width+Math.abs(cos)*height)/2
    const rect:Rect=[center[0]-rx,center[1]-ry,center[0]+rx,center[1]+ry],paths=index.query(rect)
    if(!paths)return {fill,line,known:false}
    const p=index.paint.paths,vertices=index.paint.points,moves=index.paint.moves
    const selected=paths.filter(i=>{
      const pad=p[i+3]/2+tolerance
      if(p[i+8]+pad<rect[0]||p[i+6]-pad>rect[2]||p[i+9]+pad<rect[1]||p[i+7]-pad>rect[3])return false
      if(p[i+2]!==0)return true
      // An open stroke crossing both sides is wiring. A closed contour stays.
      if((p[i+6]<rect[0]-tolerance&&p[i+8]>rect[2]+tolerance)||(p[i+7]<rect[1]-tolerance&&p[i+9]>rect[3]+tolerance)){
        const start=p[i],end=start+p[i+1];let contour=start,closed=false
        for(let v=start+1;v<=end;v++)if(v===end||moves[v]){if(v-contour>2&&Math.hypot(vertices[(v-1)*2]-vertices[contour*2],vertices[(v-1)*2+1]-vertices[contour*2+1])<.02)closed=true;contour=v}
        if(!closed)return false
      }
      return true
    })
    if(selected.some(i=>p[i+2]===3))return {fill,line,known:false}
    let visible=false
    for(let row=0;row<SIDE;row++)for(let col=0;col<SIDE;col++){
      const lx=((col+.5)/SIDE-.5)*width,ly=((row+.5)/SIDE-.5)*height,x=center[0]+cos*lx-sin*ly,y=center[1]+sin*lx+cos*ly
      let ink=0,areaInk=0
      for(const i of selected){
        const kind=p[i+2],radius=p[i+3]/2+(kind===0?tolerance*.45:0)
        if(x<p[i+6]-radius||y<p[i+7]-radius||x>p[i+8]+radius||y>p[i+9]+radius)continue
        let covered=false,winding=0,crossings=0
        const start=p[i],end=start+p[i+1]
        for(let v=start+1;v<end;v++){
          if(--remaining<0)return {fill,line,known:false}
          if(moves[v])continue
          const ax=vertices[(v-1)*2],ay=vertices[(v-1)*2+1],bx=vertices[v*2],by=vertices[v*2+1]
          if(kind===0){if(distance(x,y,ax,ay,bx,by)<=radius){covered=true;break}}
          else if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax){crossings++;winding+=by>ay?1:-1}
        }
        if(kind!==0)covered=kind===2?crossings%2!==0:winding!==0
        if(!covered)continue
        const gray=p[i+4]>=Math.fround(.95)?1:p[i+4],alpha=p[i+5],dark=1-gray
        ink=ink*(1-alpha)+dark*alpha
        if(kind!==0||p[i+3]>=short*.18)areaInk=areaInk*(1-alpha)+dark*alpha
        else areaInk*=1-alpha*gray
      }
      const at=row*SIDE+col
      if(ink>=.05)visible=true
      fill[at]=areaInk>=.05?1:0
      // Exclude perimeter from internal-line comparison. Fill comparison uses all pixels.
      line[at]=row>=3&&row<SIDE-3&&col>=3&&col<SIDE-3&&ink-areaInk>=.05?1:0
    }
    // Completely covered legacy outlines cannot establish a visible symbol.
    return {fill,line,known:visible}
  }
  const sampleMask=mask(sampleIndex,[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2],0)
  const coverage=(a:Uint8Array,b:Uint8Array,invert=false)=>{
    let ink=0,covered=0
    for(let row=0;row<SIDE;row++)for(let col=0;col<SIDE;col++){
      const at=row*SIDE+col;if((!!a[at])===invert)continue;ink++
      let hit=false
      for(let dy=-1;dy<=1&&!hit;dy++)for(let dx=-1;dx<=1&&!hit;dx++){
        const x=col+dx,y=row+dy;if(x>=0&&x<SIDE&&y>=0&&y<SIDE&&(!!b[y*SIDE+x])!==invert)hit=true
      }
      if(hit)covered++
    }
    return ink?covered/ink:1
  }
  const cache=new Map<string,{known:boolean;score:number;lineScore:number;fillScore:number}>()
  return (center:readonly number[],degrees:number)=>{
    const key=`${center[0].toFixed(3)},${center[1].toFixed(3)},${degrees.toFixed(2)}`,cached=cache.get(key)
    if(cached)return cached
    const targetMask=mask(targetIndex,center,degrees*Math.PI/180),known=sampleMask.known&&targetMask.known
    const lineScore=known?Math.min(coverage(sampleMask.line,targetMask.line),coverage(targetMask.line,sampleMask.line)):0
    const fillScore=known?Math.min(coverage(sampleMask.fill,targetMask.fill),coverage(targetMask.fill,sampleMask.fill),coverage(sampleMask.fill,targetMask.fill,true),coverage(targetMask.fill,sampleMask.fill,true)):0
    const result={known,score:Math.min(lineScore,fillScore),lineScore,fillScore}
    if(cache.size>=128)cache.delete(cache.keys().next().value!)
    cache.set(key,result);return result
  }
}
