// Messages and pure handlers of the symbol search Worker. Kept out of the Worker entry so
// the entry has no exports: the single-file build embeds Workers as one bundle without exports.
import { defaultVectorTolerance, vectorSymbolSearch, type VectorSymbolOptions } from '../core/vectorSymbolSearch'
import { segmentEndpoints } from '../core/vectorPaths'
import type { VectorPaint } from '../core/vectorPaint'
import { buildSnapIndex, type SnapIndex } from '../core/snap'
import type { Point, Rect } from '../core/annotations'
import { searchSymbol, type VerifyTarget, type SymbolMatch, type SymbolSearchOptions, type SymbolSearchStats } from '../core/symbolSearch'
import type { SearchImage } from './protocol'
import { describeLocalBody, LOCAL_IMAGE_MAX_PIXELS, type LocalBody } from '../core/symbolLocalImage'
import { describeLocalLabel, type LocalLabel } from '../core/symbolGlyphs'
import { SymbolFeatureGeometry, probeSymbolVectorFeatures, confirmSymbolVectorFeatures, describeSymbolInterior,
  type SymbolVectorFeatureProbe, type SymbolInteriorProfile } from '../core/symbolFeatureProfile'

export type WorkerSearchOptions = Omit<SymbolSearchOptions, 'shouldStop' | 'onProgress'>
export interface ImageSearchMessage {
  type: 'search'; id: number; page: SearchImage; template: SearchImage; renderScale: number; options: WorkerSearchOptions
}
/** Coordinates and width alignment follow VectorPage. The task Worker owns transferred
 * copies, while the document cache retains its originals for subsequent search/snap. */
export interface VectorSearchMessage {
  type: 'vector-search'; id: number; segments: Float32Array; segmentWidths?: Float32Array; sampleSegments: Float32Array; sampleWidths: Float32Array; sampleRect: Rect
  options: Omit<Partial<VectorSymbolOptions>, 'shouldStop'>
  paint?: VectorPaint; samplePaint?: VectorPaint
  features?: {complete:boolean;sampleComplete:boolean;samePage:boolean}
}
export interface VectorFeatureProbes { sample:SymbolVectorFeatureProbe; matches:SymbolVectorFeatureProbe[]; ms:number }
/** Uses original extraction geometry, never a cleaned search template; bounds share its display pt space. */
export interface EndpointMessage { type: 'endpoints'; id: number; segments: Float32Array; bounds: Rect }
export interface VerifyMessage {
  type: 'verify'; id: number; page: SearchImage; template: SearchImage; targets: VerifyTarget[]
  searchRadius?: number
}
export interface LocalDescribeMessage {
  type: 'local-describe'; id: number; image: SearchImage; bodies: Rect[]
  shape?: {origin:Point;scale:number;probes:Array<SymbolVectorFeatureProbe|undefined>}
}
export interface LocalShape {
  features:ReturnType<typeof confirmSymbolVectorFeatures>
  interior:SymbolInteriorProfile
}
export type LocalDescribedBody = LocalBody & {shape?:LocalShape}
export interface LocalLabelMessage { type:'local-labels'; id:number; labels:LocalLabel[] }
export type SymbolSearchMessage = ImageSearchMessage | VectorSearchMessage | EndpointMessage | VerifyMessage | LocalDescribeMessage | LocalLabelMessage
export type VectorSearchResult = ReturnType<typeof vectorSymbolSearch>
export function searchVectorMessage(message: VectorSearchMessage): VectorSearchResult | null {
  const [x0, y0, x1, y1] = message.sampleRect
  const tolerance = defaultVectorTolerance(message.sampleRect)
  let count = 0
  for (let i=0; i<message.sampleSegments.length; i+=4) {
    const a=message.sampleSegments
    if (a[i]>=x0-tolerance && a[i]<=x1+tolerance && a[i+1]>=y0-tolerance && a[i+1]<=y1+tolerance
      && a[i+2]>=x0-tolerance && a[i+2]<=x1+tolerance && a[i+3]>=y0-tolerance && a[i+3]<=y1+tolerance
      && (a[i]!==a[i+2] || a[i+1]!==a[i+3])) count++
  }
  return count < 2 ? null : vectorSymbolSearch(message.segments, message.sampleRect, message.options, message.sampleSegments, message.sampleWidths, message.segmentWidths,
    message.samplePaint&&message.paint?{sample:message.samplePaint,target:message.paint}:undefined)
}
export function probeVectorMatches(message:VectorSearchMessage,result:VectorSearchResult|null,ownershipLimit=200_000):VectorFeatureProbes|undefined {
  if(!message.features||!result)return undefined
  const started=performance.now()
  const target=new SymbolFeatureGeometry(message.segments,message.segmentWidths,message.features.complete)
  const source=message.features.samePage?target:new SymbolFeatureGeometry(message.sampleSegments,message.sampleWidths,message.features.sampleComplete)
  const t=result.template.rect,w=t[2]-t[0],h=t[3]-t[1],strokeWidth=result.template.strokeWidth
  const sample=probeSymbolVectorFeatures(source,{center:[(t[0]+t[2])/2,(t[1]+t[3])/2],width:w,height:h,angle:0},strokeWidth)
  let ownershipCount=0,limited=false
  const matches=result.matches.map(m=>{
    const probe=probeSymbolVectorFeatures(target,{center:m.center,width:w,height:h,angle:m.angle},strokeWidth)
    if(probe.ownership){
      const count=probe.ownership.foreign.length+probe.ownership.owned.length
      if(limited||ownershipCount+count>ownershipLimit){limited=true;delete probe.ownership}
      else ownershipCount+=count
    }
    return probe
  })
  return {sample,matches,ms:performance.now()-started}
}
export function describeLocalMessage(message:LocalDescribeMessage):LocalDescribedBody[] {
  if(message.bodies.length>32||message.image.gray.byteLength>LOCAL_IMAGE_MAX_PIXELS)throw Error('局所画像の上限を超えました')
  const shape=message.shape
  if(shape&&(shape.probes.length!==message.bodies.length||!Number.isFinite(shape.scale)||shape.scale<=0
    ||shape.origin.length!==2||!shape.origin.every(Number.isFinite)))throw Error('Invalid local shape input')
  const img=shape?{...message.image,origin:shape.origin,scale:shape.scale}:undefined
  return message.bodies.map((body,i)=>{
    const patch={...message.image,body}
    const described:LocalDescribedBody={...describeLocalBody(patch),label:describeLocalLabel(patch)}
    const probe=shape?.probes[i]
    if(probe&&img)described.shape={features:confirmSymbolVectorFeatures(probe,img),interior:describeSymbolInterior(img,probe.pose,probe.ownership)}
    return described
  })
}
export function buildEndpointIndex(message: EndpointMessage): SnapIndex {
  return buildSnapIndex(segmentEndpoints(message.segments, 200_000), message.bounds, 16)
}
export type SymbolSearchResponse =
  | { type:'local-described'; id:number; bodies:LocalDescribedBody[] }
  | { type:'local-labels-resolved'; id:number; labels:LocalLabel[] }
  | { type: 'verify-result'; id: number; scores: Float32Array; verifyMs: number }
  | { type: 'vector-result'; id: number; result: VectorSearchResult | null; probes?:VectorFeatureProbes }
  | { type: 'endpoint-result'; id: number; index: SnapIndex; indexMs?: number }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'error'; id: number; message: string }
  | { type: 'result'; id: number; matches: SymbolMatch[]; stats: SymbolSearchStats & { workerMs: number }; memory: { pagePixels: number; bytes: number; estimated: true } }
