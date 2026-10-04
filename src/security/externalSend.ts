export type SendKind = 'fetch' | 'XHR' | 'Beacon' | 'WebSocket' | 'EventSource' | 'フォーム' | 'リンク' | 'CSP で遮断'
export interface SendNotice { kind: SendKind; host: string; count: number }
interface LinkNotice { id: number; host: string; open(): void }
interface AlertState { blocked: readonly SendNotice[]; blockedCount: number; links: readonly LinkNotice[] }
export interface WorkerSendNotice { type: 'karu-external-send'; source: 'pdf' | 'image'; notice: SendNotice }

const listeners = new Set<() => void>()
const history: SendNotice[] = []
let state: AlertState = { blocked: [], blockedCount: 0, links: [] }
let nextLink = 0
const installed = new WeakSet<object>()
const forwarded = new WeakSet<object>()
const kinds: readonly SendKind[] = ['fetch', 'XHR', 'Beacon', 'WebSocket', 'EventSource', 'フォーム', 'リンク', 'CSP で遮断']

export function isExternalUrl(value: string, page: Pick<Location, 'href' | 'origin'>): boolean {
  if (!value.trim()) return false
  try {
    const url = new URL(value, page.href)
    if (url.protocol === 'blob:' || url.protocol === 'data:' || url.href === 'about:blank') return false
    // A file:// page has origin "null" by the standard, but Chromium reports "file://".
    const pageUrl = new URL(page.href), filePage = pageUrl.protocol === 'file:' || page.origin === 'null'
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ws:' || url.protocol === 'wss:' || url.protocol === 'ftp:') {
      return filePage || url.origin !== page.origin
    }
    // Only files on the same machine or share as the page; another UNC host is another computer.
    return !(url.protocol === 'file:' && pageUrl.protocol === 'file:' && url.host === pageUrl.host)
  } catch { return true }
}

function destinationHost(value: string, page: Pick<Location, 'href' | 'origin'>): string {
  try {
    const url = new URL(value, page.href)
    return url.hostname || (['mailto:', 'tel:'].includes(url.protocol) ? `外部のアプリ（${url.protocol.slice(0, -1)}）` : '接続先を確認できません')
  } catch { return '接続先を確認できません' }
}

function changed() { for (const listener of listeners) listener() }
export function subscribeExternalSend(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function getExternalSendState(): AlertState { return state }
export function getExternalSendRecords(): readonly SendNotice[] { return history.map(item => ({ ...item })) }
export function recordExternalSend(notice: SendNotice): void {
  history.push({ ...notice })
  if (history.length > 100) history.shift()
  const blocked = state.blocked.map(item => ({ ...item }))
  const previous = blocked.find(item => item.kind === notice.kind && item.host === notice.host)
  if (previous) previous.count += notice.count
  else {
    if (blocked.length === 100) blocked.shift()
    blocked.push({ ...notice })
  }
  state = { ...state, blocked, blockedCount: state.blockedCount + notice.count }
  changed()
}
export function closeExternalSendAlert(): void { state = { ...state, blocked: [], blockedCount: 0 }; changed() }
export function answerExternalLink(id: number, open: boolean): void {
  const link = state.links.find(item => item.id === id)
  state = { ...state, links: state.links.filter(item => item.id !== id) }
  changed()
  if (open) link?.open()
}
export function receiveWorkerSendNotice(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<WorkerSendNotice>
  if (message.type !== 'karu-external-send' || !message.notice || !kinds.includes(message.notice.kind)
    || typeof message.notice.host !== 'string' || message.notice.host.length > 255 || message.notice.count !== 1) return false
  if (!forwarded.has(value)) { forwarded.add(value); recordExternalSend(message.notice) }
  return true
}

type BrowserScope = Window & typeof globalThis
type GuardScope = Pick<BrowserScope, 'location' | 'fetch' | 'addEventListener'> & Partial<Pick<BrowserScope,
  'XMLHttpRequest' | 'WebSocket' | 'EventSource' | 'navigator' | 'open' | 'HTMLFormElement' | 'Worker' | 'document'>>

/** Only inspects destinations; never reads document bytes, request bodies or form fields. */
export function installExternalSendGuard(scope: GuardScope, report: (notice: SendNotice) => void = recordExternalSend): void {
  if (installed.has(scope)) return
  installed.add(scope)
  const page = scope.location
  const blocked = (kind: SendKind, url: string) => {
    if (!isExternalUrl(url, page)) return false
    report({ kind, host: destinationHost(url, page), count: 1 })
    return true
  }
  const error = () => new TypeError('外部への送信を止めました。')
  installFetchAndCsp(scope, report)
  if (scope.XMLHttpRequest) {
    const prototype = scope.XMLHttpRequest.prototype
    const originalOpen = prototype.open, originalSend = prototype.send
    const destinations = new WeakMap<XMLHttpRequest, string>()
    prototype.open = function(this: XMLHttpRequest, method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null) {
      destinations.delete(this)
      const destination = String(url)
      if (isExternalUrl(destination, page)) { destinations.set(this, destination); return }
      originalOpen.call(this, method, url, async, username, password)
    }
    prototype.send = function(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const url = destinations.get(this)
      if (url !== undefined && blocked('XHR', url)) throw error()
      return Reflect.apply(originalSend, this, [body])
    }
  }
  const navigator = scope.navigator
  if (navigator?.sendBeacon) {
    const original = navigator.sendBeacon
    navigator.sendBeacon = function(url, data) {
      if (blocked('Beacon', String(url))) return false
      return original.call(navigator, url, data)
    }
  }
  // A Proxy preserves native prototypes, static constants and new-only behavior.
  if (scope.WebSocket) scope.WebSocket = new Proxy(scope.WebSocket, { construct(target, args, newTarget) {
    if (blocked('WebSocket', String(args[0]))) throw error()
    return Reflect.construct(target, args, newTarget)
  } })
  if (scope.EventSource) scope.EventSource = new Proxy(scope.EventSource, { construct(target, args, newTarget) {
    if (blocked('EventSource', String(args[0]))) throw error()
    return Reflect.construct(target, args, newTarget)
  } })

  if (!scope.document) return
  const resolve = (url: string) => { try { return new URL(url, scope.document!.baseURI).href } catch { return url } }
  const formUrl = (form: HTMLFormElement, submitter?: HTMLElement | null) => {
    const action = submitter?.getAttribute('formaction') ?? form.getAttribute('action')
    return action?.trim() ? resolve(action) : page.href
  }
  const formPrototype = scope.HTMLFormElement?.prototype
  if (formPrototype) {
    const submit = formPrototype.submit, requestSubmit = formPrototype.requestSubmit
    formPrototype.submit = function() {
      if (blocked('フォーム', formUrl(this))) return
      return submit.call(this)
    }
    formPrototype.requestSubmit = function(submitter) {
      // Preserve native validation/errors for an invalid submitter.
      if (submitter && (!['BUTTON', 'INPUT'].includes(submitter.tagName) || !('form' in submitter)
        || submitter.form !== this || !['submit', 'image'].includes((submitter as HTMLInputElement).type))) return requestSubmit.call(this, submitter)
      if (blocked('フォーム', formUrl(this, submitter))) return
      return requestSubmit.call(this, submitter)
    }
    scope.addEventListener('submit', ((event: SubmitEvent) => {
      if (event.target instanceof scope.HTMLFormElement! && blocked('フォーム', formUrl(event.target, event.submitter))) {
        event.preventDefault(); event.stopImmediatePropagation()
      }
    }) as EventListener, true)
  }
  const originalOpen = scope.open
  if (originalOpen) {
    const confirm = (url: string, features = '') => {
      const destination = resolve(url)
      try { new URL(destination, page.href) } catch { blocked('リンク', destination); return }
      // Executable URLs cannot be approved as external navigation.
      if (/^\s*(?:javascript|vbscript):/i.test(destination)) { blocked('リンク', destination); return }
      if (state.links.length >= 20) return
      state = { ...state, links: [...state.links, { id: ++nextLink, host: destinationHost(destination, page), open: () => {
        const safeFeatures = features.split(',').filter(value => !/^\s*(?:noopener|noreferrer)(?:\s*=|\s*$)/i.test(value)).join(',')
        originalOpen.call(scope, destination, '_blank', `${safeFeatures ? safeFeatures + ',' : ''}noopener,noreferrer`)
      } }] }
      changed()
    }
    scope.open = function(url, target, features) {
      const destination = url === undefined ? '' : String(url)
      if (destination.trim() && isExternalUrl(resolve(destination), page)) { confirm(destination, features); return null }
      return originalOpen.call(scope, url, target, features)
    }
    const onLink = (event: MouseEvent) => {
      if (event.defaultPrevented || (event.type === 'click' ? event.button !== 0 : event.button !== 1)) return
      const anchor = event.composedPath().find(node => node instanceof Element && node.matches('a[href],area[href]')) as Element | undefined
      if (!anchor) return
      const destination = resolve(anchor.getAttribute('href') ?? '')
      if (isExternalUrl(destination, page)) {
        event.preventDefault(); event.stopImmediatePropagation(); confirm(destination)
      }
    }
    scope.addEventListener('click', onLink as EventListener, true)
    scope.addEventListener('auxclick', onLink as EventListener, true)
  }
  // Images use an unchanged client; collect their notices at Worker creation.
  // PDF notices are also received by PdfWorkerPool. The same message is counted once.
  if (scope.Worker) scope.Worker = new Proxy(scope.Worker, { construct(target, args, newTarget) {
    const worker = Reflect.construct(target, args, newTarget) as Worker
    worker.addEventListener('message', event => {
      if (receiveWorkerSendNotice(event.data) && event.data.source === 'image') event.stopImmediatePropagation()
    })
    return worker
  } })
}

function installFetchAndCsp(scope: Pick<GuardScope, 'location' | 'fetch' | 'addEventListener'>, report: (notice: SendNotice) => void): void {
  const original = scope.fetch
  scope.fetch = function(input, init) {
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (isExternalUrl(url, scope.location)) {
        report({ kind: 'fetch', host: destinationHost(url, scope.location), count: 1 })
        return Promise.reject(new TypeError('外部への送信を止めました。'))
      }
    } catch {
      report({ kind: 'fetch', host: '接続先を確認できません', count: 1 })
      return Promise.reject(new TypeError('外部への送信を止めました。'))
    }
    return original.call(scope, input, init)
  }
  scope.addEventListener('securitypolicyviolation', ((event: SecurityPolicyViolationEvent) => {
    if (event.disposition === 'enforce') report({ kind: 'CSP で遮断', host: destinationHost(event.blockedURI, scope.location), count: 1 })
  }) as EventListener)
}

const workerSources = new WeakMap<object, 'pdf' | 'image'>()
export function installWorkerExternalSendGuard(scope: DedicatedWorkerGlobalScope, source: 'pdf' | 'image'): void {
  workerSources.set(scope, source)
  if (installed.has(scope)) return
  installed.add(scope)
  installFetchAndCsp(scope as unknown as GuardScope, notice => {
    scope.postMessage({ type: 'karu-external-send', source: workerSources.get(scope)!, notice } satisfies WorkerSendNotice)
  })
}

// Evaluate before the other dependencies of the Worker entry point (WASM loaders).
if (typeof document === 'undefined' && typeof self !== 'undefined' && 'postMessage' in self && 'location' in self) {
  installWorkerExternalSendGuard(self as unknown as DedicatedWorkerGlobalScope, 'pdf')
}
