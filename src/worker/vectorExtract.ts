import mupdf from 'mupdf'
import type { DisplayListCache } from '../core/displayListCache'
import type { VectorPage } from '../core/vectorPaths'
import { MAX_PAINT_POINTS, MAX_PAINT_PATHS, PAINT_STRIDE, type VectorPaint } from '../core/vectorPaint'

/** Bounded capture allocated only for an explicit appearance request. */
class PaintCapture {
  points = new Float32Array(MAX_PAINT_POINTS * 2)
  moves = new Uint8Array(MAX_PAINT_POINTS)
  paths = new Float32Array(MAX_PAINT_PATHS * PAINT_STRIDE)
  count = 0; pathCount = 0; start = 0; truncated = false; uncertain = false
  clipDepth = 0
  begin() { this.start = this.count }
  unresolved(bounds:number[]) {
    if(this.truncated)return
    if(!bounds.every(Number.isFinite)){this.uncertain=true;return}
    if(this.pathCount>=MAX_PAINT_PATHS){this.truncated=true;return}
    this.paths.set([this.count,0,3,0,0,1,...bounds],this.pathCount++*PAINT_STRIDE)
  }
  point(p: number[], move: boolean) {
    if (this.truncated) return
    if (this.count >= MAX_PAINT_POINTS || !p.every(Number.isFinite)) { this.truncated = true; this.count = this.start; return }
    this.points[this.count*2] = p[0]; this.points[this.count*2+1] = p[1]; this.moves[this.count++] = move ? 1 : 0
  }
  end(kind:number,width:number,color:number[],alpha:number,colorSpace:string) {
    if (this.truncated || this.count === this.start) return
    if (this.pathCount >= MAX_PAINT_PATHS) { this.truncated = true; this.count = this.start; return }
    let gray = 0
    if (color.length === 1) gray = color[0]
    else if (color.length === 3) gray = .2126*color[0]+.7152*color[1]+.0722*color[2]
    else if (color.length === 4) gray = (1-color[3])*(1-(.2126*color[0]+.7152*color[1]+.0722*color[2]))
    else this.uncertain = true
    if (!Number.isFinite(gray) || !Number.isFinite(alpha)) this.uncertain = true
    const bounds = [Infinity,Infinity,-Infinity,-Infinity]
    for(let i=this.start;i<this.count;i++) { const x=this.points[i*2],y=this.points[i*2+1]; bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y) }
    // Unmodeled clipping affects this path, not unrelated symbols on the page.
    // Retain its full bounds conservatively: even geometry outside the clip is unresolved.
    if(this.clipDepth>0||!['DeviceGray','DeviceRGB','DeviceCMYK'].includes(colorSpace))kind=3
    this.paths.set([this.start,this.count-this.start,kind,width,Math.max(0,Math.min(1,gray)),Math.max(0,Math.min(1,alpha)),...bounds],this.pathCount++*PAINT_STRIDE)
  }
  finish():VectorPaint { return {points:this.points.slice(0,this.count*2),moves:this.moves.slice(0,this.count),paths:this.paths.slice(0,this.pathCount*PAINT_STRIDE),truncated:this.truncated,uncertain:this.uncertain} }
}

// Kept out of the Worker entry so the entry has no exports (the single-file build
// embeds each Worker as one bundle without exports).
/** Explicit request only. Produces the shared VectorPage geometry for search and snap;
 * do not insert search-specific cleanup here. Reuse the display cache only when it can
 * contain nothing except page contents; annotated/widget pages need a temporary list. */
export function extractVectorPage(document: import('mupdf').Document, pageIndex: number, cache?: DisplayListCache, includePaint = false): VectorPage {
  const started = performance.now(), page = document.loadPage(pageIndex)
  let list: import('mupdf').DisplayList | undefined, device: import('mupdf').Device | undefined
  let ownsList = true
  const capacity = 400_000, output = new Float32Array(capacity * 4), widths = new Float32Array(capacity)
  let currentWidth = 0
  const paint = includePaint ? new PaintCapture() : undefined
  let count = 0, truncated = false
  const stats: VectorPage['stats'] = { strokePaths: 0, fillPaths: 0, whiteFills: 0, curves: 0, images: 0, imageAreaRatio: 0, textGlyphs: 0, ms: { displayList: 0, walk: 0, total: 0 } }
  try {
    const bounds = page.getBounds(), area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
    const transform = (x: number, y: number, m: import('mupdf').Matrix): [number, number] => [m[0] * x + m[2] * y + m[4] - bounds[0], m[1] * x + m[3] * y + m[5] - bounds[1]]
    const unresolved = (b:number[]) => paint?.unresolved([b[0]-bounds[0],b[1]-bounds[1],b[2]-bounds[0],b[3]-bounds[1]])
    const add = (a: number[], b: number[]) => {
      if (truncated || !a.every(Number.isFinite) || !b.every(Number.isFinite) || Math.hypot(a[0] - b[0], a[1] - b[1]) < .05) return
      if (count >= capacity) { truncated = true; return }
      widths[count] = currentWidth
      output.set([a[0], a[1], b[0], b[1]], count++ * 4)
    }
    const walkPath = (path: import('mupdf').Path, m: import('mupdf').Matrix, fill: boolean, legacy = true) => {
      let current = [0, 0], first = [0, 0], hasSubpath = false
      const close = () => { if (hasSubpath) { if (legacy) add(current, first); paint?.point(first,false); current = first } }
      path.walk({
        moveTo: (x, y) => { if (fill) close(); first = current = transform(x, y, m); hasSubpath = true; paint?.point(current,true) },
        lineTo: (x, y) => { const end = transform(x, y, m); if (legacy) add(current, end); paint?.point(end,false); current = end },
        closePath: close,
        curveTo: (x1, y1, x2, y2, x3, y3) => {
          if (legacy) stats.curves++
          const end = transform(x3, y3, m)
          if (truncated && (!paint || paint.truncated)) { current = end; return }
          type Cubic = number[][]
          const midpoint = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          const flatness = ([a, b, c, d]: Cubic) => {
            const dx = d[0] - a[0], dy = d[1] - a[1], length2 = dx * dx + dy * dy
            // Distance to the chord line also detects collinear overshoot.
            const distance = (p: number[]) => {
              const t = length2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2)) : 0
              return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
            }
            return Math.max(distance(b), distance(c))
          }
          const pieces: Cubic[] = [[current, transform(x1, y1, m), transform(x2, y2, m), end]]
          while (pieces.length < 12) {
            let worst = .25, at = -1
            for (let i = 0; i < pieces.length; i++) { const f = flatness(pieces[i]); if (f > worst) { worst = f; at = i } }
            if (at < 0) break
            const [a, b, c, d] = pieces[at], ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d)
            const abc = midpoint(ab, bc), bcd = midpoint(bc, cd), middle = midpoint(abc, bcd)
            pieces.splice(at, 1, [a, ab, abc, middle], [middle, bcd, cd, d])
          }
          for (const p of pieces) { if (legacy) add(p[0], p[3]); paint?.point(p[3],false) }
          current = end
        },
      })
      // PDF filling implicitly closes every open subpath.
      if (fill) close()
    }
    const image = (m: import('mupdf').Matrix) => {
      stats.images++
      const corners = [transform(0, 0, m), transform(1, 0, m), transform(0, 1, m), transform(1, 1, m)]
      const width = Math.max(...corners.map(p => p[0])) - Math.min(...corners.map(p => p[0]))
      const height = Math.max(...corners.map(p => p[1])) - Math.min(...corners.map(p => p[1]))
      if (area > 0) stats.imageAreaRatio += width * height / area
      paint?.unresolved([Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))])
    }
    const text = (t: import('mupdf').Text) => t.walk({ showGlyph: (_font, _trm, glyph) => { if (glyph >= 0) stats.textGlyphs++ } })
    const displayStarted = performance.now()
    let cacheIsContentOnly = !!cache
    if (cache && page.isPDF()) {
      const pdfPage = page as import('mupdf').PDFPage
      const annotations = pdfPage.getAnnotations(), widgets = pdfPage.getWidgets()
      cacheIsContentOnly = annotations.length === 0 && widgets.length === 0
      for (const annotation of annotations) annotation.destroy()
      for (const widget of widgets) widget.destroy()
    }
    if (cache && cacheIsContentOnly) { list = cache.get(pageIndex); ownsList = false }
    else list = page.toDisplayList(false)
    stats.ms.displayList = performance.now() - displayStarted
    const walkStarted = performance.now()
    device = new mupdf.Device({
      // Release callback wrappers while display-list storage is still alive.
      strokePath: (path, stroke, m, colorspace, color, alpha) => {
        try {
          stats.strokePaths++
          currentWidth = stroke.getLineWidth() * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))
          paint?.begin()
          walkPath(path, m, false)
          paint?.end(0,currentWidth,color,alpha,colorspace.getName())
          if(paint&&stroke.getDashes()?.length){
            unresolved(path.getBounds(stroke,m))
          }
        }
        finally { path.destroy(); stroke.destroy(); colorspace.destroy() }
      },
      fillPath: (path, evenOdd, m, colorspace, color, alpha) => {
        try {
          stats.fillPaths++
          // Current approximation: nonwhite fills become outlines and white fills
          // add only statistics. Fill rules/white overlays do not subtract geometry.
          // Recognition improvements need a separate contract; snap also uses these lines.
          // MuPDF returns float32 color components: compare against the same
          // representation so PDF's exact .95/.05 boundary stays inclusive.
          const white = (color.length === 1 || color.length === 3) ? color.every(v => v >= Math.fround(.95))
            : color.length === 4 && color.every(v => v <= Math.fround(.05))
          if (white) stats.whiteFills++
          if (paint) {
            paint.begin(); currentWidth = 0; walkPath(path,m,true,!white); paint.end(evenOdd?2:1,0,color,alpha,colorspace.getName())
          } else if (!white) { currentWidth = 0; walkPath(path, m, true) }
        }
        finally { path.destroy(); colorspace.destroy() }
      },
      fillImage: (value, m) => {
        try { image(m) }
        finally { value.destroy() }
      },
      fillImageMask: (value, m, colorspace) => {
        try { image(m) }
        finally { value.destroy(); colorspace.destroy() }
      },
      fillText: (value, m, colorspace) => {
        try { text(value);if(paint)unresolved(value.getBounds(null as unknown as import('mupdf').StrokeState,m)) }
        finally { value.destroy(); colorspace.destroy() }
      },
      strokeText: (value, stroke, m, colorspace) => {
        try { text(value);if(paint)unresolved(value.getBounds(stroke,m)) }
        finally { value.destroy(); stroke.destroy(); colorspace.destroy() }
      },
      // Clip paths, shades and clip-only text/images do not add geometry.
      ...(paint ? {
        clipPath: (path:import('mupdf').Path) => { paint.clipDepth++;path.destroy() },
        clipStrokePath: (path:import('mupdf').Path,stroke:import('mupdf').StrokeState) => { paint.clipDepth++;path.destroy();stroke.destroy() },
        clipText: (value:import('mupdf').Text) => { paint.clipDepth++;value.destroy() },
        clipStrokeText: (value:import('mupdf').Text,stroke:import('mupdf').StrokeState) => { paint.clipDepth++;value.destroy();stroke.destroy() },
        clipImageMask: (value:import('mupdf').Image) => { paint.clipDepth++;value.destroy() },
        popClip: () => { if(paint.clipDepth>0)paint.clipDepth--;else paint.uncertain=true },
        fillShade: (shade:import('mupdf').Shade) => { paint.uncertain=true;shade.destroy() },
        beginMask: (_bounds:import('mupdf').Rect,_luminosity:boolean,colorspace:import('mupdf').ColorSpace) => { paint.uncertain=true;colorspace?.destroy() },
        beginTile: () => { paint.uncertain=true;return 0 },
        beginGroup: (_bounds:import('mupdf').Rect,colorspace:import('mupdf').ColorSpace,_isolated:boolean,knockout:boolean,blendmode:import('mupdf').BlendMode,alpha:number) => {
          if(knockout||blendmode!=='Normal'||alpha!==1)paint.uncertain=true
          colorspace?.destroy()
        },
      } : {}),
    })
    list.run(device, mupdf.Matrix.identity)
    device.close()
    stats.ms.walk = performance.now() - walkStarted
    const segments = output.slice(0, count * 4)
    return { pageIndex, segments, widths: widths.slice(0, count), segmentCount: count, truncated, stats, ...(paint ? {paint:paint.finish()} : {}) }
  } finally {
    device?.destroy(); if (ownsList) list?.destroy(); page.destroy()
    stats.ms.total = performance.now() - started
  }
}
