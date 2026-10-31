import type { DeviceRect } from '../worker/protocol'

export type DetailStage = 'visible' | 'full'

export interface DetailRequestPlan {
  key: string
  stage: DetailStage
  region: DeviceRect
  delayMs: number
}

export interface DetailRequest extends DetailRequestPlan {
  generation: number
}

export type DetailSyncEvent = 'schedule' | 'apply' | 'clear' | 'recover'

type Timer = ReturnType<typeof setTimeout>
type Schedule = (callback: () => void, delayMs: number) => Timer
type Cancel = (timer: Timer) => void

export class DetailRequestSync {
  private desired: DetailRequestPlan | null = null
  private timer: Timer | null = null
  private generation = 0
  private disposed = false

  constructor(
    private readonly onChange: (request: DetailRequest | null) => void,
    private readonly onEvent: (event: DetailSyncEvent, request: DetailRequestPlan | null) => void = () => undefined,
    private readonly schedule: Schedule = (callback, delayMs) => setTimeout(callback, delayMs),
    private readonly cancel: Cancel = (timer) => clearTimeout(timer),
  ) {}

  get desiredKey(): string | null {
    return this.desired?.key ?? null
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  sync(next: DetailRequestPlan | null): void {
    if (this.disposed) return
    if (this.desired?.key === next?.key) return
    this.desired = next
    this.cancelTimer()
    if (!next) {
      this.onEvent('clear', null)
      this.onChange(null)
      return
    }
    if (next.delayMs <= 0) {
      this.apply(next, 'apply')
      return
    }
    this.onEvent('schedule', next)
    this.timer = this.schedule(() => {
      this.timer = null
      if (this.desired?.key === next.key) this.apply(next, 'apply')
    }, next.delayMs)
  }

  recover(): boolean {
    if (this.disposed || !this.desired) return false
    const desired = this.desired
    this.cancelTimer()
    this.apply(desired, 'recover')
    return true
  }

  dispose(): void {
    this.disposed = true
    this.cancelTimer()
    this.desired = null
  }

  private apply(request: DetailRequestPlan, event: 'apply' | 'recover'): void {
    this.generation += 1
    this.onEvent(event, request)
    this.onChange({ ...request, generation: this.generation })
  }

  private cancelTimer(): void {
    if (this.timer === null) return
    this.cancel(this.timer)
    this.timer = null
  }
}

let recoveryCount = 0
const recoveryListeners = new Set<() => void>()

export function recordDetailRecovery(): void {
  recoveryCount += 1
  for (const listener of recoveryListeners) listener()
}

export function getDetailRecoveryCount(): number {
  return recoveryCount
}

export function subscribeDetailRecovery(listener: () => void): () => void {
  recoveryListeners.add(listener)
  return () => recoveryListeners.delete(listener)
}
