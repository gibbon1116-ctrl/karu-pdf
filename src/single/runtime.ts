import type { FontName } from '../core/fontMetrics'

declare global {
  var __singleWasm: WebAssembly.Module
  var __singleDiagnostics: { wasmDecodes: number; wasmCompiles: number; fontDecodes: Partial<Record<FontName, number>>; violations: { directive: string; blockedURI: string }[]; uiReadyMs?: number }
}
const fonts = new Map<FontName, Uint8Array<ArrayBuffer>>()
const faces = new Map<FontName, Promise<void>>()
export function embeddedBytes(id: string): Uint8Array<ArrayBuffer> {
  const encoded = document.getElementById(id)?.textContent
  if (!encoded) throw new Error(`埋め込みデータがありません: ${id}`)
  const native = Uint8Array as typeof Uint8Array & { fromBase64?: (value: string) => Uint8Array<ArrayBuffer> }
  if (native.fromBase64) return native.fromBase64(encoded)
  const binary = atob(encoded), bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
export function fontBytes(name: FontName): Uint8Array<ArrayBuffer> {
  if (name !== 'BIZUDGothic' && name !== 'BIZUDMincho') throw new Error('未知のフォントです')
  let bytes = fonts.get(name)
  if (!bytes) {
    bytes = embeddedBytes(`single-font-${name}`); fonts.set(name, bytes)
    __singleDiagnostics.fontDecodes[name] = (__singleDiagnostics.fontDecodes[name] || 0) + 1
  }
  return bytes
}
export function ensureFont(name: FontName): Promise<void> {
  let pending = faces.get(name)
  if (!pending) {
    pending = (async () => {
      const face = new FontFace(`Karu${name}`, fontBytes(name).buffer)
      await face.load(); document.fonts.add(face)
    })()
    faces.set(name, pending)
  }
  return pending
}
export function createSingleWorker(kind: 'pdf' | 'image' | 'symbol-search'): Worker {
  const code = document.getElementById(`single-worker-${kind}`)?.textContent
  if (!code) throw new Error('埋め込み Worker がありません')
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  const worker = new Worker(url)
  URL.revokeObjectURL(url)
  worker.addEventListener('message', event => {
    if (event.data?.type === 'single-csp') {
      event.stopImmediatePropagation(); __singleDiagnostics.violations.push(event.data.violation)
    }
    if (event.data?.type === 'single-font-request') {
      event.stopImmediatePropagation()
      const name = event.data.name as FontName
      try {
        const bytes = fontBytes(name)
        worker.postMessage({ type: 'single-font-response', name, bytes })
        void ensureFont(name).catch(error => console.error(error))
      } catch (error) { worker.postMessage({ type: 'single-font-response', name, error: String(error) }) }
    }
  })
  // Every embedded Worker's bootstrap requires single-init first (see scripts/single-worker.mjs),
  // even the symbol search Worker, which never uses the MuPDF module it is handed.
  worker.postMessage({ type: 'single-init', module: __singleWasm })
  return worker
}

// Existing PDF annotations and dialogs may need a display font before a
// Worker requests it. Decoding occurs only when a BIZ UD element is displayed.
export function watchDisplayFonts(): void {
  const selector = '.text-editor,.annotation-text,.measurement-label,.measurement-draft text,.issue-editor,.header-footer-preview span'
  const inspect = (element: Element) => {
    for (const node of [element, ...element.querySelectorAll(selector)]) {
      if (!node.matches(selector)) continue
      const family = getComputedStyle(node).fontFamily
      if (family.includes('KaruBIZUD')) void ensureFont(family.includes('Mincho') ? 'BIZUDMincho' : 'BIZUDGothic').catch(error => console.error(error))
    }
  }
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') inspect(record.target as Element)
      else for (const node of record.addedNodes) if (node instanceof Element) inspect(node)
    }
  }).observe(document.getElementById('root')!, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] })
}
