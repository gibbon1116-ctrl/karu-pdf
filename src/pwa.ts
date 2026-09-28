import { registerSW } from 'virtual:pwa-register'

export interface PwaRegistrationCallbacks {
  onNeedRefresh(): void
  onOfflineReady(): void
}

export function registerPwa(callbacks: PwaRegistrationCallbacks): (reloadPage?: boolean) => Promise<void> {
  return registerSW({
    immediate: true,
    onNeedRefresh: callbacks.onNeedRefresh,
    onOfflineReady: callbacks.onOfflineReady,
  })
}
