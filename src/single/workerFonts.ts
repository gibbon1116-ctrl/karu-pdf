import type { FontName } from '../core/fontMetrics'
const pending = new Map<FontName, Promise<Uint8Array>>()
export function requestEmbeddedFont(name: FontName): Promise<Uint8Array> {
  let promise = pending.get(name)
  if (!promise) {
    promise = new Promise((resolve, reject) => {
      const receive = (event: MessageEvent) => {
        if (event.data?.type !== 'single-font-response' || event.data.name !== name) return
        event.stopImmediatePropagation(); self.removeEventListener('message', receive)
        if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.bytes)
      }
      self.addEventListener('message', receive)
      self.postMessage({ type: 'single-font-request', name })
    })
    pending.set(name, promise)
  }
  return promise
}
