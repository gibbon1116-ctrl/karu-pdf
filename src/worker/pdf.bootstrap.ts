/// <reference lib="webworker" />
export {}

const scope = self as unknown as DedicatedWorkerGlobalScope & {
  $libmupdf_wasm_Module?: { instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void): WebAssembly.Exports }
}

const queued: MessageEvent[] = []
scope.onmessage = async event => {
  if (event.data?.type !== 'pdf-init') { queued.push(event); return }
  const module = event.data.module as WebAssembly.Module
  // Keep close/cancel messages that may arrive while the runtime is importing.
  scope.onmessage = event => { queued.push(event) }
  scope.$libmupdf_wasm_Module = {
    instantiateWasm(imports, done) {
      const instance = new WebAssembly.Instance(module, imports)
      done(instance, module)
      return instance.exports
    },
  }
  try {
    await import('./pdf.worker')
    const handler = scope.onmessage!
    for (const event of queued) handler.call(scope, event)
  } catch (error) { setTimeout(() => { throw error }) }
}
