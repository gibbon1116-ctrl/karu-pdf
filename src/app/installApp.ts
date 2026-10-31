export const INSTALLED_VIA_APP_KEY = 'karu-pdf:installed-via-app'
export const DESKTOP_PROMPT_SEEN_KEY = 'karu-pdf:desktop-prompt-seen'

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface InstallAppSnapshot {
  supported: boolean
  appWindow: boolean
  canInstall: boolean
  installed: boolean
  prompting: boolean
  showDesktopPrompt: boolean
  error: string | null
}

export type InstallResult = 'accepted' | 'dismissed' | 'unavailable' | 'failed'
type InstallWindow = Pick<Window, 'location' | 'localStorage' | 'matchMedia' | 'addEventListener' | 'removeEventListener'>
const displayModes = ['standalone', 'window-controls-overlay', 'minimal-ui']

// Only event listeners and local flags are needed; no document processing.
export function createInstallAppStore(host?: InstallWindow, single = false) {
  const supported = !!host && !single && host.location.protocol !== 'file:'
  const listeners = new Set<() => void>()
  const modes: MediaQueryList[] = []
  if (host && supported && typeof host.matchMedia === 'function') {
    for (const mode of displayModes) modes.push(host.matchMedia(`(display-mode: ${mode})`))
  }
  const readMark = (key: string): boolean => {
    try { return !!host?.localStorage.getItem(key) } catch { return false }
  }
  const writeMark = (key: string): void => {
    try { host?.localStorage.setItem(key, '1') } catch { /* Memory still works for this window. */ }
  }
  let seen = supported && readMark(DESKTOP_PROMPT_SEEN_KEY)
  let installedViaApp = supported && readMark(INSTALLED_VIA_APP_KEY)
  let pending: InstallPromptEvent | null = null
  let installed = false
  let prompting = false
  let error: string | null = null
  let snapshot: InstallAppSnapshot

  const update = () => {
    const appWindow = modes.some(mode => mode.matches)
    if (appWindow && installedViaApp && !seen) {
      seen = true
      writeMark(DESKTOP_PROMPT_SEEN_KEY)
    }
    const next: InstallAppSnapshot = {
      supported, appWindow, installed, prompting, error,
      canInstall: supported && !appWindow && !installed && !!pending && !prompting,
      showDesktopPrompt: supported && appWindow && !seen && !installedViaApp,
    }
    if (snapshot && (Object.keys(next) as Array<keyof InstallAppSnapshot>).every(key => next[key] === snapshot[key])) return
    snapshot = next
    listeners.forEach(listener => listener())
  }
  const beforeInstall = (event: Event) => {
    const candidate = event as InstallPromptEvent
    if (typeof candidate.prompt !== 'function' || !candidate.userChoice) return
    event.preventDefault()
    if (installed || prompting) return
    pending = candidate
    error = null
    update()
  }
  const appInstalled = () => {
    pending = null
    installed = true
    installedViaApp = true
    error = null
    writeMark(INSTALLED_VIA_APP_KEY)
    update()
  }
  const storageChanged = () => {
    seen = seen || readMark(DESKTOP_PROMPT_SEEN_KEY)
    installedViaApp = installedViaApp || readMark(INSTALLED_VIA_APP_KEY)
    update()
  }
  if (host && supported) {
    host.addEventListener('beforeinstallprompt', beforeInstall)
    host.addEventListener('appinstalled', appInstalled)
    host.addEventListener('storage', storageChanged)
    modes.forEach(mode => mode.addEventListener('change', update))
  }
  update()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async promptInstall(): Promise<InstallResult> {
      if (!snapshot.canInstall || !pending) return 'unavailable'
      const event = pending
      pending = null // One call per browser event, including cancellation.
      prompting = true
      error = null
      update()
      try {
        await event.prompt()
        return (await event.userChoice).outcome
      } catch {
        error = 'インストール画面を開けませんでした。ブラウザーのメニューからアプリをインストールできます。'
        return 'failed'
      } finally {
        prompting = false
        update()
      }
    },
    dismissDesktopPrompt() {
      seen = true
      writeMark(DESKTOP_PROMPT_SEEN_KEY)
      update()
    },
    dispose() {
      if (host && supported) {
        host.removeEventListener('beforeinstallprompt', beforeInstall)
        host.removeEventListener('appinstalled', appInstalled)
        host.removeEventListener('storage', storageChanged)
        modes.forEach(mode => mode.removeEventListener('change', update))
      }
      listeners.clear()
    },
  }
}

// Listen during module evaluation, retaining events before React's first render.
const store = createInstallAppStore(typeof window === 'undefined' ? undefined : window, import.meta.env.MODE === 'single')
export const subscribe = store.subscribe
export const getSnapshot = store.getSnapshot
export const promptInstall = store.promptInstall
export const dismissDesktopPrompt = store.dismissDesktopPrompt

export function desktopBrowser(nav: { userAgentData?: { brands: readonly { brand: string }[] } }): 'edge' | 'chrome' {
  const brands = nav.userAgentData?.brands ?? []
  if (brands.some(({ brand }) => /Microsoft Edge/i.test(brand))) return 'edge'
  return brands.some(({ brand }) => /Google Chrome/i.test(brand)) ? 'chrome' : 'edge'
}
