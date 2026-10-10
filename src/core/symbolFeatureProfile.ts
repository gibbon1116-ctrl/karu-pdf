import type { Point, Rect } from './annotations'
import type { SearchImage } from '../worker/protocol'

/** Search-owned observations of visible features. Never persisted in PDF data,
 * appended to VectorPage, or used by snap. Unknown is not absence. */
export type SymbolFeatureState = 'present' | 'absent' | 'unknown'
export interface SymbolWorldImage extends SearchImage { origin: Point; scale: number }
export interface SymbolBodyPose { center: Point; width: number; height: number; angle: number }
export interface SymbolVectorFeatureProbe {
  topArc: SymbolFeatureState
  annexFrame: SymbolFeatureState
  /** Local canonical pt coordinates, relative to the body pose. */
  arc: Point[]
  frame: Array<[Point, Point]>
  /** Collinear pieces count once; through-wires with remote endpoints are excluded. */
  interiorLines: Array<Array<[Point, Point]>>
  /** Local canonical pt coordinates; widths retain original page units. */
  ownership?: {
    foreign: Array<{ a:Point; b:Point; width:number }>
    owned: Array<{ a:Point; b:Point; width:number }>
    strokeWidth: number
  }
  complete: boolean
  pose: SymbolBodyPose
  region: Rect
}
export interface SymbolInteriorProfile {
  known: boolean
  unknownReason?: 'invalid-image'|'resolution'|'crop-clipped'|'blank-body'|'region-limit'|'foreign-dominated'
  mask: Uint8Array
  ink: number
  holes: Array<{ area: number; center: Point }>
  erased?: number
  /** Structural white regions; zero includes ink and boundary-connected white. */
  regions?: Uint8Array
  /** Region k occupies regionAreas[k-1] of the normalized grid. */
  regionAreas?: number[]
}
export type RequiredSymbolFeature = 'topArc' | 'annexFrame' | 'interiorLines' | 'interiorAppearance' | 'bodyText' | 'nearbyText'
export interface SymbolFeatureProfile {
  attachments?: ReturnType<typeof confirmSymbolVectorFeatures>
  interior?: SymbolInteriorProfile
  /** Kept separate: unread text is not an empty label. */
  bodyText?: { status:'read'|'none'|'unknown'; text:string }
  nearbyText?: { status:'read'|'none'|'unknown'; text:string }
}
/** Search lifetime only. Validate a borrowed page once, not once per candidate.
 * The document cache retains ownership of these arrays and snap uses them unchanged. */
export class SymbolFeatureGeometry {
  readonly complete: boolean
  readonly segments: Float32Array
  readonly widths?: Float32Array
  private readonly byY: Uint32Array
  constructor(segments: Float32Array, widths?: Float32Array, complete = false) {
    if (segments.length % 4 || widths && widths.length !== segments.length / 4 || !segments.every(Number.isFinite)
      || widths && !widths.every(w=>Number.isFinite(w)&&w>=0)) throw Error('Invalid symbol feature geometry')
    this.complete = complete && segments.length / 4 <= 400_000
    this.segments = segments; this.widths = widths
    this.byY = new Uint32Array(this.complete ? segments.length / 4 : 0)
    for (let i=0;i<this.byY.length;i++) this.byY[i]=i*4
    this.byY.sort((a,b)=>Math.min(segments[a+1],segments[a+3])-Math.min(segments[b+1],segments[b+3]))
  }
  get indexBytes(): number { return this.byY.byteLength }
  /** Conservative y window; accepted local lines are at most maxLength long.
   * A subarray borrows the index, without copying original page coordinates. */
  range(y0:number,y1:number,maxLength:number):Uint32Array {
    const bound=(y:number)=>{let lo=0,hi=this.byY.length;while(lo<hi){const mid=(lo+hi)>>>1,i=this.byY[mid];if(Math.min(this.segments[i+1],this.segments[i+3])<y)lo=mid+1;else hi=mid}return lo}
    return this.byY.subarray(bound(y0-maxLength),bound(y1+1e-6))
  }
}
const SIDE = 48
const MAX_LOCAL_SEGMENTS = 256
const MAX_OWNERSHIP_SEGMENTS = 512
const MAX_INTERIOR_REGIONS = 32
const radians = (angle: number) => angle * Math.PI / 180
function symbolStrokeMatches(width:number,strokeWidth:number):boolean {
  return !strokeWidth || !width || width >= .5*strokeWidth-1e-6 && width <= 2*strokeWidth+1e-6
}
function validPose(pose: SymbolBodyPose): boolean {
  return [...pose.center, pose.width, pose.height, pose.angle].every(Number.isFinite) && pose.width > 0 && pose.height > 0
}
function toWorld(p: Point, pose: SymbolBodyPose): Point {
  const c = Math.cos(radians(pose.angle)), s = Math.sin(radians(pose.angle))
  const dx = p[0] - pose.width / 2, dy = p[1] - pose.height / 2
  return [pose.center[0] + c * dx - s * dy, pose.center[1] + s * dx + c * dy]
}
function clipSymbolLine(a:Point,b:Point,rect:Rect):[number,number]|undefined {
  let lo=0,hi=1
  for(let axis=0;axis<2;axis++){
    const d=b[axis]-a[axis]
    if(!d){if(a[axis]<rect[axis]||a[axis]>rect[axis+2])return undefined}
    else{
      const u=(rect[axis]-a[axis])/d,v=(rect[axis+2]-a[axis])/d
      lo=Math.max(lo,Math.min(u,v));hi=Math.min(hi,Math.max(u,v))
      if(lo>hi)return undefined
    }
  }
  return [lo,hi]
}

/** Borrowed original geometry supplies possible attachments. Confirmation against
 * rendered pixels is separate: white overlays can erase these legacy lines. */
export function probeSymbolVectorFeatures(geometry: SymbolFeatureGeometry, pose: SymbolBodyPose, strokeWidth = 0): SymbolVectorFeatureProbe {
  if (!(geometry instanceof SymbolFeatureGeometry) || !validPose(pose) || !Number.isFinite(strokeWidth) || strokeWidth < 0) throw Error('Invalid symbol feature geometry')
  const {segments,widths} = geometry
  const w = pose.width, h = pose.height, long = Math.max(w, h), cx = w / 2, cy = h / 2
  const region: Rect = [-long * .6, -long * .6, w + long * .6, h + long * .6]
  const unknown: SymbolVectorFeatureProbe = { topArc:'unknown', annexFrame:'unknown', arc:[], frame:[], interiorLines:[], complete:false, pose, region }
  if (!geometry.complete) return unknown
  const corners = [[region[0],region[1]],[region[2],region[1]],[region[2],region[3]],[region[0],region[3]]].map(p => toWorld(p as Point,pose))
  const world:Rect = [Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))]
  const cos = Math.cos(radians(pose.angle)), sin = Math.sin(radians(pose.angle))
  const canonical = (x:number,y:number):Point => [cos*(x-pose.center[0])+sin*(y-pose.center[1])+cx,-sin*(x-pose.center[0])+cos*(y-pose.center[1])+cy]
  const local: Array<{ a:Point; b:Point; len:number }> = []
  const all: Array<{ a:Point; b:Point; len:number; width:number }> = []
  let ownershipLimited = false
  for (const i of geometry.range(world[1],world[3],long*8)) {
    // Reject distant lines before allocating points or rotating coordinates.
    if (Math.max(segments[i],segments[i+2]) < world[0] || Math.min(segments[i],segments[i+2]) > world[2]
      || Math.max(segments[i+1],segments[i+3]) < world[1] || Math.min(segments[i+1],segments[i+3]) > world[3]) continue
    const width = widths?.[i / 4] ?? 0
    const a = canonical(segments[i],segments[i+1]), b = canonical(segments[i+2],segments[i+3])
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!len || len > long * 8 || Math.max(a[0], b[0]) < region[0] || Math.min(a[0], b[0]) > region[2]
      || Math.max(a[1], b[1]) < region[1] || Math.min(a[1], b[1]) > region[3]) continue
    if (!ownershipLimited) {
      if (all.length === MAX_OWNERSHIP_SEGMENTS) ownershipLimited = true
      else all.push({ a, b, len, width })
    }
    if (!symbolStrokeMatches(width,strokeWidth)) continue
    local.push({ a, b, len })
    if (local.length > MAX_LOCAL_SEGMENTS) return unknown
  }
  const tolerance = Math.max(.08, Math.min(.25, Math.min(w, h) * .035))
  const out = Math.max(2*tolerance,.04*long,.3), m = Math.max(2*tolerance,.15*Math.min(w,h))
  let ownership:SymbolVectorFeatureProbe['ownership']
  if (!ownershipLimited && w > 2*m && h > 2*m) {
    const core:Rect = [m,m,w-m,h-m], body:Rect = [-tolerance,-tolerance,w+tolerance,h+tolerance]
    const parent = new Uint16Array(all.length)
    for(let i=0;i<parent.length;i++)parent[i]=i
    const root=(i:number)=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i]}return i}
    const gap=Math.max(2,.15*long)
    const close=(a:Point,b:Point)=>(a[0]-b[0])**2+(a[1]-b[1])**2<=gap**2
    const turn = Math.sin(Math.PI/60)
    for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
      const a=all[i],b=all[j]
      // Matching strokes are assessed individually: an aligned body mark must
      // not inherit a remote endpoint from wiring that stops at the outline.
      if(symbolStrokeMatches(a.width,strokeWidth)||symbolStrokeMatches(b.width,strokeWidth))continue
      if(Math.abs(a.width-b.width)>.1*Math.max(a.width,b.width))continue
      if(!close(a.a,b.a)&&!close(a.a,b.b)&&!close(a.b,b.a)&&!close(a.b,b.b))continue
      const ax=a.b[0]-a.a[0],ay=a.b[1]-a.a[1],bx=b.b[0]-b.a[0],by=b.b[1]-b.a[1]
      if(Math.abs(ax*by-ay*bx)>turn*a.len*b.len)continue
      const onA=(p:Point)=>Math.abs(ax*(p[1]-a.a[1])-ay*(p[0]-a.a[0]))<=tolerance*a.len
      const onB=(p:Point)=>Math.abs(bx*(p[1]-b.a[1])-by*(p[0]-b.a[0]))<=tolerance*b.len
      if(!(onA(b.a)&&onA(b.b)||onB(a.a)&&onB(a.b)))continue
      const ra=root(i),rb=root(j)
      if(ra!==rb)parent[rb]=ra
    }
    const enters = new Uint8Array(all.length), remote = new Uint8Array(all.length)
    const outside=(p:Point)=>p[0]<-out||p[1]<-out||p[0]>w+out||p[1]>h+out
    for(let i=0;i<all.length;i++){
      const line=all[i],at=root(i),part=clipSymbolLine(line.a,line.b,core)
      if(part&&part[1]>part[0])enters[at]=1
      if(outside(line.a)||outside(line.b))remote[at]=1
    }
    ownership = { foreign:[], owned:[], strokeWidth }
    for(let i=0;i<all.length;i++){
      const line=all[i],at=root(i),value={a:line.a,b:line.b,width:line.width}
      if(enters[at]&&remote[at])ownership.foreign.push(value)
      else if(clipSymbolLine(line.a,line.b,body))ownership.owned.push(value)
    }
  }
  const interior: Array<{angle:number;offset:number;lines:Array<[Point,Point]>}> = []
  for (const line of local) {
    const inside = (p:Point) => p[0] >= -tolerance && p[1] >= -tolerance && p[0] <= w+tolerance && p[1] <= h+tolerance
    if (!inside(line.a) || !inside(line.b) || line.len < Math.min(w,h)*.25) continue
    const mx = (line.a[0]+line.b[0])/2, my = (line.a[1]+line.b[1])/2
    if (((mx-cx)/(w*.38))**2+((my-cy)/(h*.38))**2 > 1) continue
    const dx = (line.b[0]-line.a[0])/w, dy = (line.b[1]-line.a[1])/h
    const angle = (Math.atan2(dy,dx)+Math.PI)%Math.PI
    if (Math.abs(Math.sin(angle)) < .25 || Math.abs(Math.cos(angle)) < .25) continue
    const offset = Math.cos(angle)*my/h-Math.sin(angle)*mx/w
    let group = interior.find(g=>Math.abs(g.angle-angle)<Math.PI/18&&Math.abs(g.offset-offset)<.04)
    if (!group) { group={angle,offset,lines:[]};interior.push(group) }
    group.lines.push([line.a,line.b])
  }
  const horizontal = local.filter(s => Math.abs(s.a[1] - s.b[1]) < tolerance+Math.sin(Math.PI/60)*s.len
    && Math.abs((s.a[1] + s.b[1]) / 2 - cy) < h * .7 && s.len > w * .4 && s.len < w * 8)
  const bands: Array<{ y:number; left:boolean; right:boolean; lines:Array<[Point,Point]> }> = []
  for (const line of horizontal) {
    const y = line.a[1]+(cx-line.a[0])*(line.b[1]-line.a[1])/(line.b[0]-line.a[0])
    let band = bands.find(b => Math.abs(b.y - y) < tolerance)
    if (!band) { band = { y, left:false, right:false, lines:[] }; bands.push(band) }
    const min = Math.min(line.a[0], line.b[0]), max = Math.max(line.a[0], line.b[0])
    if (min < cx - w * .6 && max > cx - w * .6) band.left = true
    if (max > cx + w * .6 && min < cx + w * .6) band.right = true
    band.lines.push([line.a, line.b])
  }
  const paired = bands.filter(b => b.left && b.right)
  let frame: Array<[Point,Point]> = []
  for (let i = 0; i < paired.length && !frame.length; i++) for (const b of paired.slice(i + 1)) {
    const a = paired[i]
    if (Math.abs(a.y - b.y) > h * .2 && Math.abs(a.y - b.y) < h * 1.2 && Math.abs((a.y + b.y) / 2 - cy) < h * .2) {
      // The observed part beside the body establishes the wings. Do not demand
      // remote endpoints of a long CAD edge outside the bounded rendered crop.
      frame = [...a.lines, ...b.lines].map(([a,b]):[Point,Point] => {
        const dx = b[0] - a[0], dy = b[1] - a[1]
        const u = (region[0] - a[0]) / dx, v = (region[2] - a[0]) / dx
        const lo = Math.max(0,Math.min(u,v)), hi = Math.min(1,Math.max(u,v))
        return [[a[0]+dx*lo,a[1]+dy*lo],[a[0]+dx*hi,a[1]+dy*hi]]
      }); break
    }
  }
  const arcLines = local.filter(s => Math.max(s.a[1], s.b[1]) <= tolerance
    && Math.min(s.a[1], s.b[1]) >= -long * .6 && s.len < long * .75)
  const nodes: Array<{ p:Point; edges:number[] }> = [], edges: Array<[number,number]> = []
  const node = (p:Point) => {
    let i = nodes.findIndex(n => Math.hypot(n.p[0] - p[0], n.p[1] - p[1]) <= tolerance)
    if (i < 0) { i = nodes.length; nodes.push({ p, edges:[] }) }
    return i
  }
  for (const line of arcLines) {
    const a = node(line.a), b = node(line.b), i = edges.length
    edges.push([a,b]); nodes[a].edges.push(i); nodes[b].edges.push(i)
  }
  const seen = new Set<number>(), chains: Point[][] = []
  let ambiguous = false
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].edges.length !== 1 || seen.has(nodes[i].edges[0])) continue
    const pts = [nodes[i].p]; let at = i, previous = -1
    while (nodes[at].edges.length <= 2) {
      const edge = nodes[at].edges.find(e => e !== previous && !seen.has(e))
      if (edge === undefined) break
      seen.add(edge); const [a,b] = edges[edge]; at = a === at ? b : a; pts.push(nodes[at].p); previous = edge
    }
    if (pts.length < 3) continue
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
    const aw = Math.max(...xs) - Math.min(...xs), ah = Math.max(...ys) - Math.min(...ys)
    const first = pts[0], last = pts[pts.length - 1]
    if (aw < w * .6 || aw > w * 1.6 || ah < h * .08 || ah > long * .6
      || Math.abs(last[1] - first[1]) > h * .25 || Math.abs(last[0] - first[0]) < aw * .8) continue
    let turn = 0, sign = 0, convex = true
    for (let j = 1; j < pts.length - 1; j++) {
      const a = pts[j - 1], b = pts[j], c = pts[j + 1]
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
      const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])
      const angle = Math.atan2(cross, dot)
      if (Math.abs(angle) > .02) { if (sign && Math.sign(angle) !== sign) convex = false; sign = Math.sign(angle); turn += Math.abs(angle) }
    }
    if (convex && turn > Math.PI / 4) {
      if (pts.length < 4) ambiguous = true
      else chains.push(pts)
    }
  }
  return { topArc:chains.length === 1 && !ambiguous ? 'present' : chains.length || ambiguous ? 'unknown' : 'absent',
    annexFrame:frame.length ? 'present' : 'absent', arc:chains.length === 1 ? chains[0] : [], frame, interiorLines:interior.map(g=>g.lines), complete:true, pose, region,
    ...(ownership ? {ownership} : {}) }
}

function imageValue(image: SymbolWorldImage, point: Point): number | undefined {
  const x = Math.round((point[0] - image.origin[0]) * image.scale), y = Math.round((point[1] - image.origin[1]) * image.scale)
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return undefined
  // Subpixel curve vertices fall on antialiased edges; inspect a one-pixel band.
  let value = 0
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (x + dx >= 0 && y + dy >= 0 && x + dx < image.width && y + dy < image.height)
      value = Math.max(value, image.gray[(y + dy) * image.width + x + dx])
  }
  return value
}
function validImage(image: SymbolWorldImage): boolean {
  return Number.isFinite(image.scale) && image.scale > 0 && image.origin.every(Number.isFinite)
    && Number.isSafeInteger(image.width) && Number.isSafeInteger(image.height) && image.width > 0 && image.height > 0
    && image.gray.length === image.width * image.height
}
/** A truncated or missing crop cannot establish absence. Geometry-only presence
 * also cannot establish a visible feature after PDF clipping/white overpainting. */
export function confirmSymbolVectorFeatures(probe: SymbolVectorFeatureProbe, image: SymbolWorldImage): { topArc:SymbolFeatureState; annexFrame:SymbolFeatureState; interiorLineCount?:number } {
  const unknown = { topArc:'unknown', annexFrame:'unknown', interiorLineCount:undefined } as const
  if (!validImage(image) || Math.min(probe.pose.width, probe.pose.height) * image.scale < 16) return unknown
  const [x0,y0,x1,y1] = probe.region
  if ([[x0,y0],[x1,y0],[x1,y1],[x0,y1]].some(p => imageValue(image, toWorld(p as Point, probe.pose)) === undefined)) return unknown
  const confirm = (state:SymbolFeatureState, lines:Array<[Point,Point]>):SymbolFeatureState => {
    if (state !== 'present') return state
    let ink = 0, nonwhite = 0, total = 0
    for (const [a,b] of lines) for (let j = 0; j <= 4; j++) {
      const value = imageValue(image, toWorld([a[0] + (b[0] - a[0]) * j / 4, a[1] + (b[1] - a[1]) * j / 4], probe.pose))
      if (value === undefined) return 'unknown'
      total++; if (value >= 128) ink++; if(value>0)nonwhite++
    }
    return !total ? 'unknown' : ink / total >= .8 ? 'present' : nonwhite === 0 ? 'absent' : 'unknown'
  }
  const interior = probe.interiorLines.map(lines=>confirm('present',lines))
  // Unknown geometry also makes a zero observed mark count inconclusive.
  const interiorLineCount = !probe.complete || interior.includes('unknown') ? undefined : interior.filter(state=>state==='present').length
  return { topArc:confirm(probe.topArc, probe.arc.slice(1).map((b,i) => [probe.arc[i],b])), annexFrame:confirm(probe.annexFrame, probe.frame), interiorLineCount }
}

/** Visible, normalized body only: surrounding wiring is not a required feature.
 * Flood-fill reports white regions enclosed by visible ink, preserving white
 * overpainting and even-odd holes without reconstructing PDF paint operations. */
export function describeSymbolInterior(image: SymbolWorldImage, pose: SymbolBodyPose, ownership?:SymbolVectorFeatureProbe['ownership']): SymbolInteriorProfile {
  const mask = new Uint8Array(SIDE * SIDE), unknown:SymbolInteriorProfile = { known:false, mask, ink:0, holes:[], ...(ownership ? {erased:0} : {}) }
  if (!validPose(pose) || !validImage(image)) return {...unknown,unknownReason:'invalid-image'}
  if(Math.min(pose.width, pose.height) * image.scale < 16)return {...unknown,unknownReason:'resolution'}
  let ink = 0
  for (let y = 0; y < SIDE; y++) for (let x = 0; x < SIDE; x++) {
    const point = toWorld([(x + .5) / SIDE * pose.width, (y + .5) / SIDE * pose.height], pose)
    const px = Math.floor((point[0] - image.origin[0]) * image.scale), py = Math.floor((point[1] - image.origin[1]) * image.scale)
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return {...unknown,unknownReason:'crop-clipped'}
    mask[y * SIDE + x] = image.gray[py * image.width + px] >= 96 ? 1 : 0; ink += mask[y * SIDE + x]
  }
  let structural:Uint8Array|undefined
  if(ownership){
    const cw=pose.width/SIDE,ch=pose.height/SIDE,foreign=new Uint8Array(mask.length),owned=new Uint8Array(mask.length)
    const cover=(lines:Array<{a:Point;b:Point;width:number}>,cells:Uint8Array)=>{
      for(const {a,b,width} of lines){
        const r=Math.max(width,.1)/2+1.5/image.scale+.5*Math.hypot(cw,ch)
        const x0=Math.max(0,Math.ceil((Math.min(a[0],b[0])-r)/cw-.5)),x1=Math.min(SIDE-1,Math.floor((Math.max(a[0],b[0])+r)/cw-.5))
        const y0=Math.max(0,Math.ceil((Math.min(a[1],b[1])-r)/ch-.5)),y1=Math.min(SIDE-1,Math.floor((Math.max(a[1],b[1])+r)/ch-.5))
        const dx=b[0]-a[0],dy=b[1]-a[1],len2=dx*dx+dy*dy
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
          const at=y*SIDE+x
          if(cells[at])continue
          const px=(x+.5)*cw,py=(y+.5)*ch,t=len2?Math.max(0,Math.min(1,((px-a[0])*dx+(py-a[1])*dy)/len2)):0
          if((px-a[0]-t*dx)**2+(py-a[1]-t*dy)**2<=r*r)cells[at]=1
        }
      }
    }
    cover(ownership.owned.filter(line=>symbolStrokeMatches(line.width,ownership.strokeWidth)),owned);cover(ownership.foreign,foreign)
    const before=ink
    let erased=0
    for(let i=0;i<mask.length;i++)if(mask[i]&&foreign[i]&&!owned[i]){mask[i]=0;erased++}
    ink-=erased;unknown.erased=erased/mask.length
    if(erased>before*.5)return {...unknown,ink:ink/mask.length,unknownReason:'foreign-dominated'}
    // Background strokes remain visible in mask/ink/holes. Only the structural
    // copy ignores them, and matching owned strokes still protect their cells.
    structural=mask.slice()
    const background=new Uint8Array(mask.length)
    cover(ownership.owned.filter(line=>!symbolStrokeMatches(line.width,ownership.strokeWidth)),background)
    for(let i=0;i<structural.length;i++)if(background[i]&&!owned[i])structural[i]=0
  }
  // Two erased/blank legacy outlines are not two observed identical symbols.
  if(ink<8)return {...unknown,unknownReason:'blank-body'}
  const seen = new Uint8Array(mask.length), queue = new Uint16Array(mask.length), holes:SymbolInteriorProfile['holes'] = []
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] || seen[start]) continue
    seen[start] = 1; queue[0] = start
    let tail = 1, boundary = false, sx = 0, sy = 0
    for (let head = 0; head < tail; head++) {
      const at = queue[head], x = at % SIDE, y = Math.floor(at / SIDE)
      sx += x + .5; sy += y + .5
      if (!x || !y || x === SIDE - 1 || y === SIDE - 1) boundary = true
      for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const xx = x + dx, yy = y + dy, next = yy * SIDE + xx
        if (xx < 0 || yy < 0 || xx >= SIDE || yy >= SIDE || seen[next] || mask[next]) continue
        seen[next] = 1; queue[tail++] = next
      }
    }
    if (!boundary && tail >= 8) {
      if(holes.length>=MAX_INTERIOR_REGIONS)return {...unknown,unknownReason:'region-limit'}
      holes.push({ area:tail / mask.length, center:[sx / tail / SIDE, sy / tail / SIDE] })
    }
  }
  holes.sort((a,b) => b.area - a.area)
  let regions:Uint8Array|undefined,regionAreas:number[]|undefined
  if(structural){
    const labels=new Uint8Array(mask.length),areas:number[]=[]
    let limited=false
    seen.fill(0)
    for(let start=0;start<structural.length;start++){
      if(structural[start]||seen[start])continue
      seen[start]=1;queue[0]=start
      let tail=1,boundary=false
      for(let head=0;head<tail;head++){
        const at=queue[head],x=at%SIDE,y=Math.floor(at/SIDE)
        if(!x||!y||x===SIDE-1||y===SIDE-1)boundary=true
        for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
          const xx=x+dx,yy=y+dy,next=yy*SIDE+xx
          if(xx<0||yy<0||xx>=SIDE||yy>=SIDE||seen[next]||structural[next])continue
          seen[next]=1;queue[tail++]=next
        }
      }
      if(!boundary&&tail>=8){
        if(areas.length>=MAX_INTERIOR_REGIONS){limited=true;break}
        areas.push(tail/mask.length)
        for(let i=0;i<tail;i++)labels[queue[i]]=areas.length
      }
    }
    if(!limited){regions=labels;regionAreas=areas}
  }
  return { known:true, mask, ink:ink / mask.length, holes, ...(ownership ? {erased:unknown.erased} : {}),
    ...(regions ? {regions,regionAreas} : {}) }
}

/** Strong interior differences reject; uncertain topology stays pending. A wire
 * can split a white region, so a hole count alone never establishes rejection. */
export function compareSymbolInteriors(a: SymbolInteriorProfile, b: SymbolInteriorProfile): 'same' | 'different' | 'unknown' {
  if (!a.known || !b.known || a.mask.length !== SIDE*SIDE || b.mask.length !== SIDE*SIDE) return 'unknown'
  const area = (p:SymbolInteriorProfile) => p.holes.reduce((sum,h) => sum + h.area, 0)
  // A crossing wire changes connected-component counts and the largest-hole
  // centroid. It cannot by itself establish a different apparatus.
  if (a.holes.length !== b.holes.length && Math.min(area(a), area(b)) >= .05 && Math.abs(a.ink - b.ink) <= .18) return 'unknown'
  if (Math.abs(area(a) - area(b)) > .12 || Math.abs(a.ink - b.ink) > .35) return 'different'
  const ha = a.holes[0], hb = b.holes[0]
  if (ha && hb && ha.area > .08 && hb.area > .08 && Math.hypot(ha.center[0] - hb.center[0], ha.center[1] - hb.center[1]) > .2) return 'different'
  const near=(mask:Uint8Array,x:number,y:number)=>{
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&y+dy>=0&&x+dx<SIDE&&y+dy<SIDE&&mask[(y+dy)*SIDE+x+dx])return true
    return false
  }
  let mismatch = 0
  for(let y=0;y<SIDE;y++)for(let x=0;x<SIDE;x++){
    if(a.mask[y*SIDE+x]&&!near(b.mask,x,y))mismatch++
    if(b.mask[y*SIDE+x]&&!near(a.mask,x,y))mismatch++
  }
  return Math.abs(area(a) - area(b)) <= .03 && a.holes.length === b.holes.length && mismatch / a.mask.length <= .1 ? 'same' : 'unknown'
}

/** Compare visible fill inside structural region cores. A changed partition
 * remains unknown before any fill difference can establish rejection. */
export function compareSymbolFills(a:SymbolInteriorProfile,b:SymbolInteriorProfile):'same'|'different'|'unknown' {
  if(!a.known||!b.known||!a.regions||!b.regions||!a.regionAreas||!b.regionAreas
    ||a.mask.length!==SIDE*SIDE||b.mask.length!==SIDE*SIDE||a.regions.length!==SIDE*SIDE||b.regions.length!==SIDE*SIDE)return 'unknown'
  const core=(p:SymbolInteriorProfile)=>{
    const regions=p.regions!,cells:number[][]=p.regionAreas!.map(()=>[])
    for(let y=1;y<SIDE-1;y++)for(let x=1;x<SIDE-1;x++){
      const at=y*SIDE+x,k=regions[at]
      if(k&&cells[k-1]&&regions[at-1]===k&&regions[at+1]===k&&regions[at-SIDE]===k&&regions[at+SIDE]===k)cells[k-1].push(at)
    }
    return cells.map((points,i)=>({id:i+1,points})).filter((region,i)=>p.regionAreas![i]>=.04&&region.points.length>=6)
  }
  const ac=core(a),bc=core(b)
  const spans=(source:ReturnType<typeof core>,target:ReturnType<typeof core>,p:SymbolInteriorProfile)=>{
    for(const region of source){
      const counts=new Uint16Array(p.regionAreas!.length+1)
      for(const at of region.points){
        const k=p.regions![at]
        if(k&&k<counts.length)counts[k]++
      }
      if(target.filter(other=>counts[other.id]>=.25*other.points.length).length>=2)return true
    }
    return false
  }
  if(spans(ac,bc,b)||spans(bc,ac,a))return 'unknown'
  if(!ac.length&&!bc.length)return Math.abs(a.ink-b.ink)<=.1?'same':'unknown'
  const fill=(regions:ReturnType<typeof core>,p:SymbolInteriorProfile,dx:number,dy:number)=>{
    let maximum=0
    for(const region of regions){
      let ink=0
      for(const at of region.points){
        const x=at%SIDE+dx,y=Math.floor(at/SIDE)+dy
        if(x>=0&&y>=0&&x<SIDE&&y<SIDE&&p.mask[y*SIDE+x])ink++
      }
      maximum=Math.max(maximum,ink/region.points.length)
    }
    return maximum
  }
  let af=0,bf=0,best=Infinity
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
    const forward=fill(ac,b,dx,dy),backward=fill(bc,a,-dx,-dy)
    const maximum=Math.max(forward,backward)
    if(maximum<best){best=maximum;af=forward;bf=backward}
  }
  if(Math.max(af,bf)>.35)return 'different'
  return af<=.15&&bf<=.15?'same':'unknown'
}

/** No averaged score can clear an unknown mandatory feature. The caller supplies
 * requirements from the selected/confirmed template, not from a high-scoring hit.
 * Appearance alone does not read S/T, GV/BV, or nearby A/B/c lettering. */
export function compareSymbolFeatureProfiles(sample:SymbolFeatureProfile,target:SymbolFeatureProfile,
  required:readonly RequiredSymbolFeature[]):{decision:'same'|'different'|'unknown'; features:Partial<Record<RequiredSymbolFeature,'same'|'different'|'unknown'>>} {
  const features:Partial<Record<RequiredSymbolFeature,'same'|'different'|'unknown'>> = {}
  for(const key of required){
    let result:'same'|'different'|'unknown' = 'unknown'
    if(key==='topArc'||key==='annexFrame'){
      const a=sample.attachments?.[key],b=target.attachments?.[key]
      if(a&&b&&a!=='unknown'&&b!=='unknown')result=a===b?'same':'different'
    }else if(key==='interiorLines'){
      const a=sample.attachments?.interiorLineCount,b=target.attachments?.interiorLineCount
      if(a!==undefined&&b!==undefined)result=a===b?'same':'different'
    }else if(key==='interiorAppearance'){
      if(sample.interior&&target.interior)result=compareSymbolFills(sample.interior,target.interior)
    }else{
      const a=sample[key],b=target[key]
      if(a&&b&&a.status!=='unknown'&&b.status!=='unknown'&&(a.status==='none'||a.text.trim())&&(b.status==='none'||b.text.trim())){
        // NFKC resolves full-width lettering; case is preserved for contact
        // notation. Existing nearby-label normalization is not changed here.
        result=a.status===b.status&&(a.status==='none'||a.text.normalize('NFKC').trim()===b.text.normalize('NFKC').trim())?'same':'different'
      }
    }
    features[key]=result
  }
  const values=Object.values(features)
  return {decision:values.includes('different')?'different':values.length&&values.every(v=>v==='same')?'same':'unknown',features}
}
