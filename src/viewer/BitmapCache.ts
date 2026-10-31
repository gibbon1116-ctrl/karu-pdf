export interface ClosableBitmap {
  width: number
  height: number
  close(): void
}

interface Entry<T extends ClosableBitmap> {
  bitmap: T
  bytes: number
}

export class BitmapCache<T extends ClosableBitmap = ImageBitmap> {
  private readonly entries = new Map<string, Entry<T>>()
  private bytes = 0

  constructor(readonly maxBytes = 512 * 1024 * 1024) {}

  get usedBytes(): number {
    return this.bytes
  }

  get size(): number {
    return this.entries.size
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.bitmap
  }

  set(key: string, bitmap: T): void {
    const existing = this.entries.get(key)
    if (existing) {
      existing.bitmap.close()
      this.bytes -= existing.bytes
      this.entries.delete(key)
    }
    const bytes = bitmap.width * bitmap.height * 4
    this.entries.set(key, { bitmap, bytes })
    this.bytes += bytes
    this.evict()
  }

  clear(): void {
    for (const { bitmap } of this.entries.values()) bitmap.close()
    this.entries.clear()
    this.bytes = 0
  }

  private evict(): void {
    while (this.bytes > this.maxBytes && this.entries.size > 0) {
      const oldestKey = this.entries.keys().next().value as string
      const entry = this.entries.get(oldestKey)
      if (!entry) return
      entry.bitmap.close()
      this.bytes -= entry.bytes
      this.entries.delete(oldestKey)
    }
  }
}
