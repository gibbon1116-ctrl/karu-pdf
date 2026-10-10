/** Optional search-only paint stream. Legacy VectorPage geometry remains the snap source. */
export interface VectorPaint {
  /** x,y per vertex in displayed page pt coordinates. */
  points: Float32Array
  /** 1 starts a contour, 0 continues it; closures repeat the first vertex. */
  moves: Uint8Array
  /** Ten fields per paint, in PDF drawing order:
   * first vertex, count, kind (0 stroke/1 nonzero fill/2 even-odd fill/3 unresolved region),
   * displayed width, gray (0 black/1 white), alpha, x0,y0,x1,y1. */
  paths: Float32Array
  truncated: boolean
  /** Clipping, shading, blending or unsupported colors cannot be reconstructed exactly. */
  uncertain: boolean
}
export const PAINT_STRIDE = 10
export const MAX_PAINT_POINTS = 80_000
export const MAX_PAINT_PATHS = 16_384
export const paintBytes = (paint?: VectorPaint) => paint ? paint.points.byteLength + paint.moves.byteLength + paint.paths.byteLength : 0
export const paintBuffers = (paint?: VectorPaint): ArrayBuffer[] => paint ? [paint.points.buffer, paint.moves.buffer, paint.paths.buffer] as ArrayBuffer[] : []
export const copyPaint = (paint?: VectorPaint): VectorPaint | undefined => paint ? { ...paint, points:paint.points.slice(), moves:paint.moves.slice(), paths:paint.paths.slice() } : undefined
