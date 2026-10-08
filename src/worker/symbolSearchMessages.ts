// Messages and pure handlers of the symbol search Worker. Kept out of the Worker entry so
// the entry has no exports: the single-file build embeds Workers as one bundle without exports.
import { defaultVectorTolerance, vectorSymbolSearch, type VectorSymbolOptions } from '../core/vectorSymbolSearch'
import { segmentEndpoints } from '../core/vectorPaths'
import { buildSnapIndex, type SnapIndex } from '../core/snap'
import type { Rect } from '../core/annotations'
import { searchSymbol, type VerifyTarget, type SymbolMatch, type SymbolSearchOptions, type SymbolSearchStats } from '../core/symbolSearch'
import type { SearchImage } from './protocol'

export type WorkerSearchOptions = Omit<SymbolSearchOptions, 'shouldStop' | 'onProgress'>
export interface ImageSearchMessage {
  type: 'search'; id: number; page: SearchImage; template: SearchImage; renderScale: number; options: WorkerSearchOptions
}
export interface VectorSearchMessage {
  type: 'vector-search'; id: number; segments: Float32Array; segmentWidths?: Float32Array; sampleSegments: Float32Array; sampleWidths: Float32Array; sampleRect: Rect
  options: Omit<Partial<VectorSymbolOptions>, 'shouldStop'>
}
export interface EndpointMessage { type: 'endpoints'; id: number; segments: Float32Array; bounds: Rect }
export interface VerifyMessage {
  type: 'verify'; id: number; page: SearchImage; template: SearchImage; targets: VerifyTarget[]
  searchRadius?: number
}
export type SymbolSearchMessage = ImageSearchMessage | VectorSearchMessage | EndpointMessage | VerifyMessage
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
  return count < 2 ? null : vectorSymbolSearch(message.segments, message.sampleRect, message.options, message.sampleSegments, message.sampleWidths, message.segmentWidths)
}
export function buildEndpointIndex(message: EndpointMessage): SnapIndex {
  return buildSnapIndex(segmentEndpoints(message.segments, 200_000), message.bounds, 16)
}
export type SymbolSearchResponse =
  | { type: 'verify-result'; id: number; scores: Float32Array; verifyMs: number }
  | { type: 'vector-result'; id: number; result: VectorSearchResult | null }
  | { type: 'endpoint-result'; id: number; index: SnapIndex; indexMs?: number }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'error'; id: number; message: string }
  | { type: 'result'; id: number; matches: SymbolMatch[]; stats: SymbolSearchStats & { workerMs: number }; memory: { pagePixels: number; bytes: number; estimated: true } }
