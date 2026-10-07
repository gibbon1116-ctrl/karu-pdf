import { installWorkerExternalSendGuard } from '../security/externalSend'
import { buildEndpointIndex, searchVectorMessage, type SymbolSearchMessage, type SymbolSearchResponse } from './symbolSearchMessages'
import { searchSymbol } from '../core/symbolSearch'

const scope = typeof self !== 'undefined' && typeof document === 'undefined' ? self as unknown as DedicatedWorkerGlobalScope : null
// The existing guard groups non-PDF pixel Workers under its 'image' source.
if (scope) installWorkerExternalSendGuard(scope, 'image')
let busy = false
if (scope) scope.onmessage = (event: MessageEvent<SymbolSearchMessage>) => {
  const message = event.data
  const started = performance.now()
  try {
    if (busy) throw new Error('search already running')
    busy = true
    if (message.type === 'vector-search') {
      scope.postMessage({ type: 'progress', id: message.id, done: 0, total: 1 } satisfies SymbolSearchResponse)
      scope.postMessage({ type: 'vector-result', id: message.id, result: searchVectorMessage(message) } satisfies SymbolSearchResponse)
      return
    }
    if (message.type === 'endpoints') {
      const index = buildEndpointIndex(message)
      scope.postMessage({ type: 'endpoint-result', id: message.id, index, indexMs: performance.now() - started } satisfies SymbolSearchResponse,
        [index.points.buffer, index.offsets.buffer, index.ids.buffer])
      return
    }
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
