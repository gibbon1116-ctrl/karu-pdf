export class TextSelectionQueue<T, R> {
  private frame = 0
  private inFlight = false
  private queued: { input: T; deliver(value: R): void; fail(reason: unknown): void } | null = null
  private disposed = false

  constructor(
    private readonly run: (input: T) => Promise<R>,
    private readonly requestFrame: (callback: FrameRequestCallback) => number = (callback) => requestAnimationFrame(callback),
    private readonly cancelFrame: (handle: number) => void = (handle) => cancelAnimationFrame(handle),
  ) {}

  request(input: T, deliver: (value: R) => void): void {
    if (this.disposed) return
    this.queued = { input, deliver, fail: () => undefined }
    this.schedule()
  }

  finish(input: T): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      if (this.disposed) { reject(new Error('文字選択の問い合わせは終了しました。')); return }
      this.queued = { input, deliver: resolve, fail: reject }
      this.schedule()
    })
  }

  dispose(): void {
    this.disposed = true
    this.queued = null
    if (this.frame) this.cancelFrame(this.frame)
    this.frame = 0
  }

  private schedule(): void {
    if (this.disposed || this.inFlight || this.frame || !this.queued) return
    this.frame = this.requestFrame(() => {
      this.frame = 0
      const item = this.queued
      this.queued = null
      if (!item || this.disposed) return
      this.inFlight = true
      void this.run(item.input).then((value) => {
        if (!this.disposed) item.deliver(value)
      }, (reason) => {
        if (!this.disposed) item.fail(reason)
      }).finally(() => {
        this.inFlight = false
        this.schedule()
      })
    })
  }
}
