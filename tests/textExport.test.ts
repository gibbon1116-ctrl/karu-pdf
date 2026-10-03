import { describe, expect, it, vi } from 'vitest'
import type { ExtractedPageText } from '../src/core/textExtract'
import { runTextExport, textExportCsvRow, type TextExportProgress } from '../src/app/textExport'

const page: ExtractedPageText = { bounds: [10, 20, 210, 320], rotation: 90, truncated: false, invalidPositions: 0, uncertainCharacters: false,
  lines: [{ line: 1, text: '=1+1,"機器"\n次行', rect: [0, 40, 80, 60], writingMode: 1, direction: [0, 1] }] }
const options = (signal: AbortSignal) => ({ name: '=設計図.pdf', drawing: '@図面番号', pages: [0, 1], format: 'csv' as const, signal,
  extract: async () => page, isIdle: () => true, lastActivity: () => -Infinity, onProgress: (_: TextExportProgress) => {},
})

describe('文字出力', () => {
  it('CSVの文字・名前・図面番号の数式誤認と引用改行を守り、座標の負値は数値にする', () => {
    const row = textExportCsvRow('=設計図.pdf', 0, '@図面番号', page, page.lines[0])
    expect(row).toContain("'=設計図.pdf,1,'@図面番号,1,\"'=1+1,\"\"機器\"\"\r\n次行\"")
    expect(row).toContain(',-3.528,7.056,28.222,7.056,70.556,105.833,90,縦,0,1,抽出')
  })
  it('UTF-8のCSVと文字なしのページを出力し、プレビューの保持数を制限する', async () => {
    const many = { ...page, lines: Array.from({ length: 110 }, (_, index) => ({ ...page.lines[0], line: index + 1 })) }
    const result = await runTextExport({ ...options(new AbortController().signal), extract: async index => index ? { ...page, lines: [] } : many })
    const bytes = new Uint8Array(await result.blob.arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([239, 187, 191])
    expect(await result.blob.text()).toContain('文字なし')
    expect(result.pages).toBe(2); expect(result.lines).toBe(110)
    expect(result.emptyPages).toBe(1); expect(result.preview).toHaveLength(50)
  })
  it('テキスト出力は元の文字を数式用に変更せず、ページと位置を残す', async () => {
    const result = await runTextExport({ ...options(new AbortController().signal), pages: [3], format: 'txt' })
    expect(await result.blob.text()).toContain('4ページ')
    expect(await result.blob.text()).toContain('[1: -3.528, 7.056mm] =1+1,"機器"')
  })
  it('取消後は次ページを要求せず、遅い結果を出力しない', async () => {
    const controller = new AbortController(), calls: number[] = []
    await expect(runTextExport({ ...options(controller.signal), extract: async index => { calls.push(index); controller.abort(); return page } })).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toEqual([0])
  })
  it('操作の短い切れ目では解析せず、最後の操作から1秒静止してから要求する', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    try {
      let lastActivity = performance.now()
      const extract = vi.fn(async () => page)
      const pending = runTextExport({ ...options(new AbortController().signal), pages: [0], extract, lastActivity: () => lastActivity })
      await vi.advanceTimersByTimeAsync(900)
      expect(extract).not.toHaveBeenCalled()
      lastActivity = performance.now()
      await vi.advanceTimersByTimeAsync(999)
      expect(extract).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(extract).toHaveBeenCalledExactlyOnceWith(0)
      await vi.runAllTimersAsync()
      expect((await pending).pages).toBe(1)
    } finally { vi.useRealTimers() }
  })
  it('静止待ちの取消は解析を要求せずに終了する', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    try {
      const controller = new AbortController(), extract = vi.fn(async () => page)
      const pending = runTextExport({ ...options(controller.signal), extract, lastActivity: () => performance.now() })
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      await vi.advanceTimersByTimeAsync(100)
      controller.abort()
      await rejected
      expect(extract).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })
  it('上限超過や解析失敗を文字なしとして保存しない', async () => {
    await expect(runTextExport({ ...options(new AbortController().signal), maxBytes: 10 })).rejects.toThrow('上限を超えました')
    await expect(runTextExport({ ...options(new AbortController().signal), extract: async () => { throw new Error('解析失敗') } })).rejects.toThrow('1ページの抽出に失敗しました: 解析失敗')
  })
  it('上限で全行を省略したページを文字なしと数えない', async () => {
    const result = await runTextExport({ ...options(new AbortController().signal), extract: async () => ({ ...page, lines: [], truncated: true }) })
    expect(result.emptyPages).toBe(0)
    expect(result.limitedPages).toBe(2)
    expect(await result.blob.text()).toContain('出力省略 / 上限あり')
    expect(await result.blob.text()).not.toContain('文字なし')
  })
})
