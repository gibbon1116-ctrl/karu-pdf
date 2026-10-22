import wasmUrl from '../../node_modules/mupdf/dist/mupdf-wasm.wasm?url'

let compiled: Promise<WebAssembly.Module> | undefined
export function sharedPdfModule(): Promise<WebAssembly.Module> {
  return compiled ??= (async () => {
    const response = await fetch(wasmUrl, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`PDF表示エンジンの取得に失敗しました (${response.status})`)
    if (typeof WebAssembly.compileStreaming === 'function') {
      try { return await WebAssembly.compileStreaming(response.clone()) } catch { /* A local server may use the wrong MIME type. */ }
    }
    return WebAssembly.compile(await response.arrayBuffer())
  })()
}

export async function preparePdfEngine(): Promise<void> {
  const module = await sharedPdfModule()
  // App also imports MuPDF for document operations. Configure that instance
  // before importing App, then share the same compiled module with its workers.
  const scope = globalThis as typeof globalThis & {
    $libmupdf_wasm_Module?: { instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void): WebAssembly.Exports }
  }
  scope.$libmupdf_wasm_Module = {
    instantiateWasm(imports: WebAssembly.Imports, done: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
      // Chromium disallows synchronous main-thread instantiation above 8 MB.
      void WebAssembly.instantiate(module, imports).then(instance => done(instance, module)).catch(showStartupError)
      return {}
    },
  }
}

export function showStartupError(error: unknown): void {
  const root = document.getElementById('root')!
  const message = document.createElement('p'), retry = document.createElement('button')
  message.setAttribute('role', 'alert')
  message.textContent = `かるPDFを起動できませんでした: ${error instanceof Error ? error.message : String(error)}`
  retry.textContent = '再読み込み'
  retry.onclick = () => location.reload()
  root.replaceChildren(message, retry)
}
