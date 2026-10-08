import mupdf from 'mupdf'
import type { DisplayListCache } from '../core/displayListCache'
import type { VectorPage } from '../core/vectorPaths'

// Kept out of the Worker entry so the entry has no exports (the single-file build
// embeds each Worker as one bundle without exports).
/** Explicit prototype request only. Reuse the display cache only when it can
 * contain nothing except page contents; annotated/widget pages need a temporary list. */
export function extractVectorPage(document: import('mupdf').Document, pageIndex: number, cache?: DisplayListCache): VectorPage {
  const started = performance.now(), page = document.loadPage(pageIndex)
  let list: import('mupdf').DisplayList | undefined, device: import('mupdf').Device | undefined
  let ownsList = true
  const capacity = 400_000, output = new Float32Array(capacity * 4)
  let count = 0, truncated = false
  const stats: VectorPage['stats'] = { strokePaths: 0, fillPaths: 0, curves: 0, images: 0, imageAreaRatio: 0, textGlyphs: 0, ms: { displayList: 0, walk: 0, total: 0 } }
  try {
    const bounds = page.getBounds(), area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
    const transform = (x: number, y: number, m: import('mupdf').Matrix): [number, number] => [m[0] * x + m[2] * y + m[4] - bounds[0], m[1] * x + m[3] * y + m[5] - bounds[1]]
    const add = (a: number[], b: number[]) => {
      if (truncated || !a.every(Number.isFinite) || !b.every(Number.isFinite) || Math.hypot(a[0] - b[0], a[1] - b[1]) < .05) return
      if (count >= capacity) { truncated = true; return }
      output.set([a[0], a[1], b[0], b[1]], count++ * 4)
    }
    const walkPath = (path: import('mupdf').Path, m: import('mupdf').Matrix, fill: boolean) => {
      let current = [0, 0], first = [0, 0], hasSubpath = false
      const close = () => { if (hasSubpath) { add(current, first); current = first } }
      path.walk({
        moveTo: (x, y) => { if (fill) close(); first = current = transform(x, y, m); hasSubpath = true },
        lineTo: (x, y) => { const end = transform(x, y, m); add(current, end); current = end },
        closePath: close,
        curveTo: (x1, y1, x2, y2, x3, y3) => {
          stats.curves++
          const end = transform(x3, y3, m)
          if (truncated) { current = end; return }
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
          for (const p of pieces) add(p[0], p[3])
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
      strokePath: (path, stroke, m, colorspace) => {
        try { stats.strokePaths++; walkPath(path, m, false) }
        finally { path.destroy(); stroke.destroy(); colorspace.destroy() }
      },
      fillPath: (path, _evenOdd, m, colorspace) => {
        try { stats.fillPaths++; walkPath(path, m, true) }
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
      fillText: (value, _m, colorspace) => {
        try { text(value) }
        finally { value.destroy(); colorspace.destroy() }
      },
      strokeText: (value, stroke, _m, colorspace) => {
        try { text(value) }
        finally { value.destroy(); stroke.destroy(); colorspace.destroy() }
      },
      // Clip paths, shades and clip-only text/images do not add geometry.
    })
    list.run(device, mupdf.Matrix.identity)
    device.close()
    stats.ms.walk = performance.now() - walkStarted
    const segments = output.slice(0, count * 4)
    return { pageIndex, segments, segmentCount: count, truncated, stats }
  } finally {
    device?.destroy(); if (ownsList) list?.destroy(); page.destroy()
    stats.ms.total = performance.now() - started
  }
}
