import type { Rect } from './annotations'
import type { SearchImage } from '../worker/protocol'

/** Search-owned crop; body is in pixel coordinates relative to this crop. Never snap data. */
export interface SymbolImagePatch extends SearchImage { body: Rect }
export interface LocalBody { mask: Uint8Array; density: number; known: boolean; label?:import('./symbolGlyphs').LocalLabel }
export type LocalComparison = 'same' | 'different' | 'unknown'
export const LOCAL_IMAGE_MAX_PIXELS = 4 * 1024 * 1024
export interface LocalImageTile { rect: Rect; indices: number[] }
/** Search-only batching. Bound both the resident gray crop and the number of bodies. */
export function planLocalImageTiles(rects: readonly Rect[], scale: number): LocalImageTile[] {
  const tiles:LocalImageTile[]=[],ordered=rects.map((r,i)=>({r,i})).sort((a,b)=>a.r[1]-b.r[1]||a.r[0]-b.r[0])
  for(const {r,i} of ordered){
    const margin=Math.max(r[2]-r[0],r[3]-r[1])*.6
    const box:Rect=[Math.floor((r[0]-margin)*scale),Math.floor((r[1]-margin)*scale),Math.ceil((r[2]+margin)*scale),Math.ceil((r[3]+margin)*scale)]
    if((box[2]-box[0])*(box[3]-box[1])>LOCAL_IMAGE_MAX_PIXELS)continue
    const last=tiles.at(-1),union:Rect=last?[Math.min(last.rect[0],box[0]),Math.min(last.rect[1],box[1]),Math.max(last.rect[2],box[2]),Math.max(last.rect[3],box[3])]:box
    if(last&&last.indices.length<32&&(union[2]-union[0])*(union[3]-union[1])<=LOCAL_IMAGE_MAX_PIXELS){last.rect=union;last.indices.push(i)}
    else tiles.push({rect:box,indices:[i]})
  }
  return tiles
}
const SIDE = 24

export function describeLocalBody(image: SymbolImagePatch): LocalBody {
  const [x0,y0,x1,y1]=image.body,w=x1-x0,h=y1-y0,mask=new Uint8Array(SIDE*SIDE)
  const known=w>=10&&h>=10&&x0>=0&&y0>=0&&x1<=image.width&&y1<=image.height
    && image.gray.length===image.width*image.height
  if(!known)return {mask,density:0,known:false}
  let ink=0,total=0
  for(let y=0;y<SIDE;y++)for(let x=0;x<SIDE;x++){
    const xx=Math.min(image.width-1,Math.floor(x0+(x+.5)*w/SIDE)),yy=Math.min(image.height-1,Math.floor(y0+(y+.5)*h/SIDE))
    mask[y*SIDE+x]=image.gray[yy*image.width+xx]>=180?1:0
    if(x>=4&&x<SIDE-4&&y>=3&&y<SIDE-3){total++;ink+=mask[y*SIDE+x]}
  }
  return {mask,density:ink/total,known:true}
}

/** Only large, complementary interior differences establish rejection. Crossing lines
 * and whole-crop image scores alone cannot reject a candidate. */
export function compareLocalBody(sample: LocalBody,target: LocalBody): LocalComparison {
  if(!sample.known||!target.known)return 'unknown'
  const low=Math.min(sample.density,target.density),high=Math.max(sample.density,target.density)
  if(high>=.65&&low<=.35&&high-low>=.4)return 'different'
  let mismatch=0
  for(let y=3;y<SIDE-3;y++)for(let x=4;x<SIDE-4;x++)mismatch+=sample.mask[y*SIDE+x]!==target.mask[y*SIDE+x]?1:0
  return Math.abs(sample.density-target.density)<=.18&&mismatch/(16*18)<=.2?'same':'unknown'
}
