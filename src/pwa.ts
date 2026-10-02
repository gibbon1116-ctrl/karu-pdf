/* @server:start */import { registerSW } from 'virtual:pwa-register'/* @server:end */

export interface PwaRegistrationCallbacks {
  onNeedRefresh(): void
  onOfflineReady(): void
}

export function registerPwa(callbacks: PwaRegistrationCallbacks): (reloadPage?: boolean) => Promise<void> {
/* @single:start */  if (__singleWasm) return async () => undefined
/* @single:end *//* @server:start */  return registerSW({
    immediate: true,
    onNeedRefresh: callbacks.onNeedRefresh,
    onOfflineReady: callbacks.onOfflineReady,
  })/* @server:end */
}
