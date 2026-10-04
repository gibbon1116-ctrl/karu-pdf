import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { answerExternalLink, closeExternalSendAlert, getExternalSendRecords, getExternalSendState, installExternalSendGuard,
  installWorkerExternalSendGuard, isExternalUrl, receiveWorkerSendNotice, recordExternalSend, type SendNotice } from '../src/security/externalSend'

const page = { href: 'https://inside.example/app/index.html', origin: 'https://inside.example' }
const local = { href: 'file:///C:/app/karu.html', origin: 'null' }
type Scope = Parameters<typeof installExternalSendGuard>[0]
function fakeWindow() {
  const events = new Map<string, EventListener>()
  const nativeFetch = vi.fn(async () => new Response('internal'))
  const nativeOpen = vi.fn(), nativeSend = vi.fn(), nativeBeacon = vi.fn(() => true), nativePopup = vi.fn(() => null)
  const socket = vi.fn(), eventSource = vi.fn(), submit = vi.fn(), requestSubmit = vi.fn()
  class Xhr {}
  Object.assign(Xhr.prototype, { open: nativeOpen, send: nativeSend })
  class Form {
    action: string
    constructor(action: string) { this.action = action }
    getAttribute(name: string) { return name === 'action' ? this.action : null }
    submit() { submit() }
    requestSubmit() { requestSubmit() }
  }
  function Socket(...args: unknown[]) { socket(...args) }
  Object.assign(Socket, { OPEN: 1 })
  function Events(...args: unknown[]) { eventSource(...args) }
  const scope = {
    location: page, document: { baseURI: page.href }, fetch: nativeFetch, XMLHttpRequest: Xhr,
    navigator: { sendBeacon: nativeBeacon }, WebSocket: Socket, EventSource: Events, open: nativePopup, HTMLFormElement: Form,
    addEventListener: (name: string, listener: EventListener) => events.set(name, listener),
  } as unknown as Scope
  const notices: SendNotice[] = []
  installExternalSendGuard(scope, notice => notices.push(notice))
  return { scope, events, notices, nativeFetch, nativeOpen, nativeSend, nativeBeacon, nativePopup, socket, eventSource, submit, requestSubmit, Form }
}

describe('送り先の判定', () => {
  it('同じ配布元とローカル URL を通す', () => {
    for (const url of ['', '  ', '/fonts/a.ttf', '../a.wasm', '?v=1', '#page', page.origin + '/a',
      'blob:https://inside.example/123', 'data:text/plain,hello', 'about:blank']) expect(isExternalUrl(url, page)).toBe(false)
    for (const url of ['', './neighbor.txt', 'file:///C:/app/a.txt', 'blob:null/123', 'data:text/plain,x']) expect(isExternalUrl(url, local)).toBe(false)
  })
  it('別の配布元・外部アプリ・解決できない URL を止める', () => {
    for (const url of ['http://outside.example/a', 'https://outside.example/a', '//outside.example/a',
      'ws://outside.example/a', 'wss://outside.example/a', 'ftp://outside.example/a', 'mailto:secret@example.com',
      'tel:012345', 'custom-app:secret', 'javascript:alert(1)', 'https://[broken']) expect(isExternalUrl(url, page)).toBe(true)
    for (const url of ['http://inside.example/a', 'https://inside.example/a', 'ws://inside.example/a', 'wss://inside.example/a']) expect(isExternalUrl(url, local)).toBe(true)
    expect(isExternalUrl('./relative', { href: 'blob:null/123', origin: 'null' })).toBe(true)
  })
})

it('起動の見張りを App と Worker の資材読込より前に置く', () => {
  const main = readFileSync('src/main.tsx', 'utf8')
  // ES modules evaluate imports in order: the guard module, which installs itself in a
  // page, is the first import, so App's modules (static or dynamic) run after it.
  expect(main.split('\n').find(line => /^\s*(?:\/\*.*?\*\/)?\s*import\b/.test(line))).toContain("import './security/externalSend'")
  expect(readFileSync('src/security/externalSend.ts', 'utf8')).toMatch(/typeof window !== 'undefined'[\s\S]*installExternalSendGuard\(window\)/)
  for (const file of ['src/worker/pdf.worker.ts', 'src/worker/image.worker.ts']) {
    expect(readFileSync(file, 'utf8').split('\n')[0]).toContain("from '../security/externalSend'")
  }
})

it('見張りのソースの監査承認は実際の出現数と一致する', () => {
  const source = readFileSync('src/security/externalSend.ts', 'utf8')
  const rules = JSON.parse(readFileSync('scripts/audit-allowlist.json', 'utf8')) as { file: string; string: string; maxOccurrences: number }[]
  for (const rule of rules.filter(rule => rule.file === 'src/security/externalSend.ts')) {
    expect(source.match(new RegExp(`\\b${rule.string}\\b`, 'g'))?.length).toBe(rule.maxOccurrences)
  }
})

describe('送信の見張り', () => {
  it('fetch の URL・Request を止め、内部の引数をそのまま渡す', async () => {
    const { scope, nativeFetch, notices } = fakeWindow()
    await expect(scope.fetch('https://outside.example/path?private=secret', { method: 'POST', body: 'secret' })).rejects.toBeInstanceOf(TypeError)
    await expect(scope.fetch(new Request('https://outside.example/secret'))).rejects.toBeInstanceOf(TypeError)
    expect(nativeFetch).not.toHaveBeenCalled()
    expect(notices).toEqual([{ kind: 'fetch', host: 'outside.example', count: 1 }, { kind: 'fetch', host: 'outside.example', count: 1 }])
    const init = { method: 'GET' }
    await scope.fetch('/fonts/a.ttf', init)
    expect(nativeFetch).toHaveBeenCalledWith('/fonts/a.ttf', init)
    await scope.fetch(new URL(page.origin + '/a.wasm'))
    await scope.fetch(new Request(page.origin + '/a.wasm'))
    expect(nativeFetch).toHaveBeenCalledTimes(3)
    installExternalSendGuard(scope)
    await expect(scope.fetch('https://outside.example/a')).rejects.toBeInstanceOf(TypeError)
    expect(notices).toHaveLength(3)
  })
  it('XHR・Beacon・WebSocket・EventSource の元の API を呼ばない', () => {
    const f = fakeWindow()
    const xhr = new f.scope.XMLHttpRequest!()
    xhr.open('POST', 'https://outside.example/secret')
    expect(() => xhr.send('secret')).toThrow(TypeError)
    expect(f.nativeOpen).not.toHaveBeenCalled(); expect(f.nativeSend).not.toHaveBeenCalled()
    expect(f.scope.navigator!.sendBeacon('https://outside.example/secret', 'secret')).toBe(false)
    expect(f.nativeBeacon).not.toHaveBeenCalled()
    expect(() => new f.scope.WebSocket!('wss://outside.example/secret')).toThrow(TypeError)
    expect(() => new f.scope.EventSource!('https://outside.example/secret')).toThrow(TypeError)
    expect(f.socket).not.toHaveBeenCalled(); expect(f.eventSource).not.toHaveBeenCalled()
    expect(f.notices.map(n => n.kind)).toEqual(['XHR', 'Beacon', 'WebSocket', 'EventSource'])
    xhr.open('GET', '/font', false); xhr.send()
    expect(f.nativeOpen).toHaveBeenCalledWith('GET', '/font', false, undefined, undefined)
    expect(f.nativeSend).toHaveBeenCalledTimes(1)
    expect(f.scope.navigator!.sendBeacon('/internal', 'x')).toBe(true)
    // Constructor prototypes and native static constants remain accessible.
    expect(f.scope.WebSocket!.OPEN).toBe(1)
    const socket = new f.scope.WebSocket!('data:text/plain,x')
    expect(socket).toBeInstanceOf(f.scope.WebSocket!)
    new f.scope.EventSource!(page.origin + '/events')
    expect(f.socket).toHaveBeenCalledTimes(1); expect(f.eventSource).toHaveBeenCalledTimes(1)
  })
  it('フォームのイベント・submit・requestSubmit・formaction を止める', () => {
    const f = fakeWindow(), outside = new f.Form('https://outside.example/post'), inside = new f.Form('/internal')
    outside.submit(); outside.requestSubmit()
    expect(f.submit).not.toHaveBeenCalled(); expect(f.requestSubmit).not.toHaveBeenCalled()
    const preventDefault = vi.fn(), stopImmediatePropagation = vi.fn()
    f.events.get('submit')!({ target: outside, submitter: null, preventDefault, stopImmediatePropagation } as unknown as Event)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    const override = { getAttribute: () => 'https://outside.example/override', form: inside, tagName: 'BUTTON', type: 'submit' }
    const form = inside as unknown as HTMLFormElement
    form.requestSubmit(override as unknown as HTMLElement)
    expect(f.requestSubmit).not.toHaveBeenCalled()
    f.events.get('submit')!({ target: inside, submitter: override, preventDefault, stopImmediatePropagation } as unknown as Event)
    expect(preventDefault).toHaveBeenCalledTimes(2)
    inside.submit(); inside.requestSubmit()
    expect(f.submit).toHaveBeenCalledTimes(1); expect(f.requestSubmit).toHaveBeenCalledTimes(1)
    expect(f.notices).toHaveLength(5)
  })
  it('CSP の強制遮断だけを記録し、パスや検索文字列を残さない', () => {
    const f = fakeWindow()
    f.events.get('securitypolicyviolation')!({ disposition: 'report', blockedURI: 'https://outside.example/secret' } as unknown as Event)
    expect(f.notices).toHaveLength(0)
    f.events.get('securitypolicyviolation')!({ disposition: 'enforce', blockedURI: 'https://outside.example/secret?document=private' } as unknown as Event)
    expect(f.notices).toEqual([{ kind: 'CSP で遮断', host: 'outside.example', count: 1 }])
  })
  it('空タブ・blob は通し、外部のタブは確認後だけ noopener で開く', () => {
    const f = fakeWindow()
    f.scope.open!('', '_blank'); f.scope.open!('blob:https://inside.example/123', '_blank')
    expect(f.nativePopup).toHaveBeenCalledTimes(2)
    expect(f.scope.open!('https://outside.example/private', '_self')).toBeNull()
    const link = getExternalSendState().links[0]
    expect(link.host).toBe('outside.example'); expect(f.nativePopup).toHaveBeenCalledTimes(2)
    answerExternalLink(link.id, false); expect(f.nativePopup).toHaveBeenCalledTimes(2)
    f.scope.open!('https://outside.example/private', '_blank', 'noopener=no')
    answerExternalLink(getExternalSendState().links[0].id, true)
    expect(f.nativePopup).toHaveBeenLastCalledWith('https://outside.example/private', '_blank', 'noopener,noreferrer')
    f.scope.open!('https://[broken', '_blank'); f.scope.open!('javascript:alert(1)', '_blank')
    expect(getExternalSendState().links).toHaveLength(0)
    expect(f.nativePopup).toHaveBeenCalledTimes(3)
    expect(f.notices.slice(-2).map(n => n.kind)).toEqual(['リンク', 'リンク'])
  })
  it('警告を集約し、閉じた後も本文を含まない試験記録を読める', () => {
    closeExternalSendAlert()
    const notice = { kind: 'fetch' as const, host: 'outside.example', count: 1 }
    recordExternalSend(notice); recordExternalSend(notice)
    expect(getExternalSendState().blocked).toEqual([{ ...notice, count: 2 }])
    expect(getExternalSendState().blockedCount).toBe(2)
    const records = getExternalSendRecords()
    closeExternalSendAlert()
    expect(getExternalSendState().blocked).toHaveLength(0)
    expect(records.slice(-2)).toEqual([notice, notice])
  })
  it('PDF・画像 Worker の fetch と CSP を主画面へ知らせ、重複を除く', async () => {
    closeExternalSendAlert()
    for (const source of ['pdf', 'image'] as const) {
      const f = fakeWindow(), postMessage = vi.fn()
      // Use a fresh scope because fakeWindow already installed the main guard.
      const fresh = { location: page, fetch: f.nativeFetch, addEventListener: (name: string, listener: EventListener) => f.events.set(name, listener), postMessage } as unknown as DedicatedWorkerGlobalScope
      installWorkerExternalSendGuard(fresh, source)
      await expect(fresh.fetch('https://outside.example/worker-secret')).rejects.toBeInstanceOf(TypeError)
      expect(f.nativeFetch).not.toHaveBeenCalled()
      f.events.get('securitypolicyviolation')!({ disposition: 'enforce', blockedURI: 'https://outside.example/image' } as unknown as Event)
      expect(postMessage).toHaveBeenCalledTimes(2)
      const message = postMessage.mock.calls[0][0]
      expect(message).toEqual({ type: 'karu-external-send', source, notice: { kind: 'fetch', host: 'outside.example', count: 1 } })
      const before = getExternalSendRecords().length
      expect(receiveWorkerSendNotice(message)).toBe(true); expect(receiveWorkerSendNotice(message)).toBe(true)
      expect(getExternalSendRecords()).toHaveLength(before + 1)
      await fresh.fetch('/font')
      expect(f.nativeFetch).toHaveBeenCalledTimes(1)
    }
    closeExternalSendAlert()
  })
})
