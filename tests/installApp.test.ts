import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInstallAppStore, desktopBrowser, DESKTOP_PROMPT_SEEN_KEY, INSTALLED_VIA_APP_KEY, type InstallPromptEvent } from '../src/app/installApp'

class FakeWindow extends EventTarget {
  location = { protocol: 'https:' }
  marks = new Map<string, string>()
  storageThrows = false
  get localStorage() {
    if (this.storageThrows) throw new Error('storage unavailable')
    return {
      getItem: (key: string) => this.marks.get(key) ?? null,
      setItem: (key: string, value: string) => { this.marks.set(key, value) },
    }
  }
  modes = new Map<string, EventTarget & { matches: boolean }>()
  matchMedia = (query: string) => {
    if (!this.modes.has(query)) this.modes.set(query, Object.assign(new EventTarget(), { matches: false }))
    return this.modes.get(query)! as MediaQueryList
  }
  setMode(mode: string, matches = true) {
    const media = this.matchMedia(`(display-mode: ${mode})`)
    Object.assign(media, { matches })
    media.dispatchEvent(new Event('change'))
  }
}

const stores: ReturnType<typeof createInstallAppStore>[] = []
function makeStore(host = new FakeWindow(), single = false) {
  const store = createInstallAppStore(host as unknown as Window, single)
  stores.push(store)
  return { host, store }
}
function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const prompt = vi.fn(async () => undefined)
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt, userChoice: Promise.resolve({ outcome }),
  }) satisfies InstallPromptEvent
  return { event, prompt }
}
afterEach(() => {
  stores.splice(0).forEach(store => store.dispose())
  vi.unstubAllGlobals()
})

describe('アプリのインストール状態', () => {
  it('モジュールを読み込んだ時点でイベントを受け取り、購読前でも保持する', async () => {
    const host = new FakeWindow()
    vi.stubGlobal('window', host)
    vi.resetModules()
    const module = await import('../src/app/installApp')
    const { event } = installEvent()
    host.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(module.getSnapshot().canInstall).toBe(true)
    expect(await module.promptInstall()).toBe('accepted')
  })

  it.each(['accepted', 'dismissed'] as const)('prompt を1回だけ呼び、%s を返す', async outcome => {
    const { host, store } = makeStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    const before = store.getSnapshot()
    expect(store.getSnapshot()).toBe(before)
    const { event, prompt } = installEvent(outcome)
    host.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(store.getSnapshot().canInstall).toBe(true)
    const result = store.promptInstall()
    expect(store.getSnapshot()).toMatchObject({ canInstall: false, prompting: true })
    expect(await store.promptInstall()).toBe('unavailable')
    expect(await result).toBe(outcome)
    expect(await store.promptInstall()).toBe('unavailable')
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot().installed).toBe(false)
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    listener.mockClear()
    host.dispatchEvent(new Event('appinstalled'))
    expect(listener).not.toHaveBeenCalled()
  })

  it('取消し後は新しいイベントが届けば再試行できる', async () => {
    const { host, store } = makeStore()
    host.dispatchEvent(installEvent('dismissed').event)
    await store.promptInstall()
    const next = installEvent()
    host.dispatchEvent(next.event)
    expect(await store.promptInstall()).toBe('accepted')
    expect(next.prompt).toHaveBeenCalledTimes(1)
  })

  it('userChoice が決まるまで結果を返さず、appinstalled が先に届いても完了状態を保つ', async () => {
    const { host, store } = makeStore()
    let choose!: (choice: { outcome: 'accepted' }) => void
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => undefined),
      userChoice: new Promise<{ outcome: 'accepted' }>(resolve => { choose = resolve }),
    })
    host.dispatchEvent(event)
    const finished = vi.fn()
    const result = store.promptInstall().then(outcome => { finished(outcome); return outcome })
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    expect(store.getSnapshot().prompting).toBe(true)
    host.dispatchEvent(new Event('appinstalled'))
    choose({ outcome: 'accepted' })
    expect(await result).toBe('accepted')
    expect(store.getSnapshot()).toMatchObject({ installed: true, canInstall: false, prompting: false })
  })

  it('appinstalled で印を保存し、インストール可能状態を消す', () => {
    const { host, store } = makeStore()
    host.dispatchEvent(installEvent().event)
    host.dispatchEvent(new Event('appinstalled'))
    expect(store.getSnapshot()).toMatchObject({ installed: true, canInstall: false })
    expect(host.marks.get(INSTALLED_VIA_APP_KEY)).toBe('1')
    host.setMode('standalone')
    expect(store.getSnapshot().showDesktopPrompt).toBe(false)
    expect(host.marks.get(DESKTOP_PROMPT_SEEN_KEY)).toBe('1')
  })

  it.each(['standalone', 'window-controls-overlay', 'minimal-ui'])('%s をアプリの窓と判定し、最初だけ問いかける', mode => {
    const host = new FakeWindow()
    host.setMode(mode)
    const { store } = makeStore(host)
    expect(store.getSnapshot()).toMatchObject({ appWindow: true, showDesktopPrompt: true })
    host.dispatchEvent(installEvent().event)
    expect(store.getSnapshot().canInstall).toBe(false)
    store.dismissDesktopPrompt()
    expect(store.getSnapshot().showDesktopPrompt).toBe(false)
    expect(host.marks.get(DESKTOP_PROMPT_SEEN_KEY)).toBe('1')
    expect(makeStore(host).store.getSnapshot().showDesktopPrompt).toBe(false)
  })

  it.each([DESKTOP_PROMPT_SEEN_KEY, INSTALLED_VIA_APP_KEY])('%s の印があれば問いかけを抑止する', key => {
    const host = new FakeWindow()
    host.setMode('standalone')
    host.marks.set(key, '1')
    expect(makeStore(host).store.getSnapshot().showDesktopPrompt).toBe(false)
    expect(host.marks.get(DESKTOP_PROMPT_SEEN_KEY)).toBe('1')
  })

  it('タブでは問いかけず、表示モードの変更を購読する', () => {
    const { host, store } = makeStore()
    expect(store.getSnapshot().showDesktopPrompt).toBe(false)
    host.setMode('standalone')
    expect(store.getSnapshot().showDesktopPrompt).toBe(true)
    host.setMode('standalone', false)
    expect(store.getSnapshot()).toMatchObject({ appWindow: false, showDesktopPrompt: false })
  })

  it('別の窓で保存した印でも問いかけを抑止する', () => {
    const { host, store } = makeStore()
    host.setMode('standalone')
    host.marks.set(INSTALLED_VIA_APP_KEY, '1')
    host.dispatchEvent(new Event('storage'))
    expect(store.getSnapshot().showDesktopPrompt).toBe(false)
    expect(host.marks.get(DESKTOP_PROMPT_SEEN_KEY)).toBe('1')
  })

  it('localStorage の取得が例外でも状態更新と問いかけの消去ができる', () => {
    const host = new FakeWindow()
    host.storageThrows = true
    host.setMode('standalone')
    const { store } = makeStore(host)
    expect(store.getSnapshot().showDesktopPrompt).toBe(true)
    expect(() => store.dismissDesktopPrompt()).not.toThrow()
    expect(store.getSnapshot().showDesktopPrompt).toBe(false)
    expect(() => host.dispatchEvent(new Event('appinstalled'))).not.toThrow()
    expect(store.getSnapshot().installed).toBe(true)
  })

  it('localStorage の読み書きメソッドが例外でも止まらない', () => {
    const host = new FakeWindow()
    Object.defineProperty(host, 'localStorage', { value: {
      getItem() { throw new Error('read blocked') },
      setItem() { throw new Error('write blocked') },
    } })
    const { store } = makeStore(host)
    host.dispatchEvent(new Event('appinstalled'))
    expect(store.getSnapshot().installed).toBe(true)
    expect(() => store.dismissDesktopPrompt()).not.toThrow()
  })

  it('prompt が失敗してもイベントを使い回さずエラーを状態に返す', async () => {
    const { host, store } = makeStore()
    const { event, prompt } = installEvent()
    prompt.mockRejectedValueOnce(new Error('blocked'))
    host.dispatchEvent(event)
    expect(await store.promptInstall()).toBe('failed')
    expect(store.getSnapshot()).toMatchObject({ canInstall: false, prompting: false })
    expect(store.getSnapshot().error).toContain('インストール画面を開けませんでした')
    expect(await store.promptInstall()).toBe('unavailable')
    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it.each(['file', 'single'])('%s 配布ではイベントを横取りせず、案内しない', distribution => {
    const host = new FakeWindow()
    if (distribution === 'file') host.location.protocol = 'file:'
    host.setMode('standalone')
    const { store } = makeStore(host, distribution === 'single')
    const { event, prompt } = installEvent()
    host.dispatchEvent(event)
    host.dispatchEvent(new Event('appinstalled'))
    expect(event.defaultPrevented).toBe(false)
    expect(store.getSnapshot()).toMatchObject({ supported: false, canInstall: false, showDesktopPrompt: false, installed: false })
    expect(prompt).not.toHaveBeenCalled()
    expect(host.marks.size).toBe(0)
  })
})

describe('デスクトップ手順のブラウザー判定', () => {
  it('Edge を優先し、Chrome と判別できるときだけ Chrome にする', () => {
    const nav = (...brands: string[]) => ({ userAgentData: { brands: brands.map(brand => ({ brand })) } })
    expect(desktopBrowser(nav('Chromium', 'Google Chrome', 'Microsoft Edge'))).toBe('edge')
    expect(desktopBrowser(nav('Chromium', 'Google Chrome'))).toBe('chrome')
    expect(desktopBrowser(nav('Chromium', 'Not A Brand'))).toBe('edge')
    expect(desktopBrowser({})).toBe('edge')
  })
})
