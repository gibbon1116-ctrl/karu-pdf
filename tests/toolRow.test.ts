import { describe, expect, it } from 'vitest'
import { DEFAULT_LAST_TOOLS, LAST_TOOLS_STORAGE_KEY, loadLastTools, saveLastTool } from '../src/app/ToolRow'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('ToolRowの最後に使った道具', () => {
  it('グループごとに保存して読み出す', () => {
    const storage = new MemoryStorage()
    saveLastTool('shape', 'circle', storage)
    saveLastTool('text', 'callout', storage)
    expect(loadLastTools(storage)).toEqual({ text: 'callout', shape: 'circle', pen: 'highlight', mark: 'textSelect' })
  })

  it('壊れた値と別グループの道具は既定値へ戻す', () => {
    const storage = new MemoryStorage()
    storage.setItem(LAST_TOOLS_STORAGE_KEY, JSON.stringify({ text: 'circle', shape: 'unknown', pen: 'ink' }))
    expect(loadLastTools(storage)).toEqual({ ...DEFAULT_LAST_TOOLS, pen: 'ink' })
  })

  it('Storageが例外を投げても操作を続ける', () => {
    const storage = {
      getItem: () => { throw new Error('read') },
      setItem: () => { throw new Error('write') },
    } as unknown as Storage
    expect(loadLastTools(storage)).toEqual(DEFAULT_LAST_TOOLS)
    expect(() => saveLastTool('shape', 'circle', storage)).not.toThrow()
  })
})
