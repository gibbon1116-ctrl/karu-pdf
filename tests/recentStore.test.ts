import { afterEach, describe, expect, it, vi } from 'vitest'
import { documentViewId, loadViewPosition, prependRecentFile, removeRecentEntry, saveViewPosition } from '../src/editor/recentStore'
import type { PdfFileHandle } from '../src/editor/fileAccess'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

afterEach(() => vi.unstubAllGlobals())

describe('recentStore', () => {
  const handle = (id: number): PdfFileHandle => ({
    name: `file-${id}.pdf`,
    isSameEntry: async (other) => other.name === `file-${id}.pdf`,
  }) as PdfFileHandle

  it('文書ごとのページと倍率を保存して読み出す', () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    const id = documentViewId('sample.pdf', 1234)
    saveViewPosition(id, 3, 1.5, 100)
    expect(loadViewPosition(id)).toEqual({ page: 3, zoom: 1.5, updatedAt: 100 })
    expect(loadViewPosition(documentViewId('other.pdf', 1234))).toBeNull()
  })

  it('新しい50件だけを残す', () => {
    vi.stubGlobal('localStorage', new MemoryStorage())
    for (let index = 0; index < 55; index += 1) saveViewPosition(`doc-${index}`, index + 1, 1, index)
    for (let index = 0; index < 5; index += 1) expect(loadViewPosition(`doc-${index}`)).toBeNull()
    for (let index = 5; index < 55; index += 1) expect(loadViewPosition(`doc-${index}`)?.page).toBe(index + 1)
  })

  it('localStorageが例外を投げても落ちない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('利用不可') },
      setItem: () => { throw new Error('利用不可') },
    })
    expect(() => saveViewPosition('doc', 2, 1.5)).not.toThrow()
    expect(loadViewPosition('doc')).toBeNull()
  })

  it('最近使ったファイルを先頭へ追加し、重複を除き、10件に制限する', async () => {
    let entries = Array.from({ length: 10 }, (_, index) => ({ handle: handle(index), name: `file-${index}.pdf`, openedAt: index }))
    entries = await prependRecentFile(entries, { handle: handle(5), name: 'file-5.pdf', openedAt: 100 })
    expect(entries).toHaveLength(10)
    expect(entries[0]).toMatchObject({ name: 'file-5.pdf', openedAt: 100 })
    expect(entries.filter((entry) => entry.name === 'file-5.pdf')).toHaveLength(1)
    entries = await prependRecentFile(entries, { handle: handle(20), name: 'file-20.pdf', openedAt: 200 })
    expect(entries).toHaveLength(10)
    expect(entries[0].name).toBe('file-20.pdf')
  })

  it('指定した最近使ったファイルを削除する', async () => {
    const entries = [0, 1, 2].map((index) => ({ handle: handle(index), name: `file-${index}.pdf`, openedAt: index }))
    expect((await removeRecentEntry(entries, handle(1))).map((entry) => entry.name)).toEqual(['file-0.pdf', 'file-2.pdf'])
  })
})
