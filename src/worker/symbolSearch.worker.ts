import { searchSymbol, type SymbolMatch, type SymbolSearchOptions, type SymbolSearchStats } from '../core/symbolSearch'
import type { SearchImage } from './protocol'
import { installWorkerExternalSendGuard } from '../security/externalSend'

export type WorkerSearchOptions = Omit<SymbolSearchOptions, 'shouldStop' | 'onProgress'>
export interface SymbolSearchMessage {
  type: 'search'; id: number; page: SearchImage; template: SearchImage; renderScale: number; options: WorkerSearchOptions
}
export type SymbolSearchResponse =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'error'; id: number; message: string }
  | { type: 'result'; id: number; matches: SymbolMatch[]; stats: SymbolSearchStats & { workerMs: number }; memory: { pagePixels: number; bytes: number; estimated: true } }

const scope = self as unknown as DedicatedWorkerGlobalScope
// The existing guard groups non-PDF pixel Workers under its 'image' source.
installWorkerExternalSendGuard(scope, 'image')
let busy = false
scope.onmessage = (event: MessageEvent<SymbolSearchMessage>) => {
  const message = event.data
  if (message.type !== 'search') return
  const started = performance.now()
  try {
    if (busy) throw new Error('search already running')
    busy = true
    // All pixel arrays are local to this invocation; no image or result cache is retained.
    const page = { width: message.page.width, height: message.page.height, data: message.page.gray }
    const template = { width: message.template.width, height: message.template.height, data: message.template.gray }
    const result = searchSymbol(page, template, { ...message.options,
      onProgress: (done, total) => scope.postMessage({ type: 'progress', id: message.id, done, total } satisfies SymbolSearchResponse) })
    scope.postMessage({ type: 'result', id: message.id, ...result,
      stats: { ...result.stats, workerMs: performance.now() - started },
      // Conservative pixel/typed-array estimate, not a measurement of browser/GPU memory.
      memory: { pagePixels: page.data.length, bytes: page.data.byteLength + template.data.byteLength + result.stats.estimatedWorkingBytes, estimated: true },
    } satisfies SymbolSearchResponse)
  } catch (error) {
    scope.postMessage({ type: 'error', id: message.id, message: error instanceof Error ? error.message : String(error) } satisfies SymbolSearchResponse)
  } finally { busy = false }
}
