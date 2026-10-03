import type { ExtractedPageText, ExtractedTextLine } from '../core/textExtract'
import { quote } from './annotationCsv'

export type TextExportFormat = 'csv' | 'txt'
export const TEXT_EXPORT_MAX_BYTES = 32 * 1024 * 1024
export const TEXT_EXPORT_QUIET_MS = 1000
export const TEXT_EXPORT_HEADER = ['ファイル', 'ページ', '図面番号（利用者指定）', '行ID', '文字', 'X(mm)', 'Y(mm)', '幅(mm)', '高さ(mm)', '用紙幅(mm)', '用紙高さ(mm)', 'ページ回転', '書字方向', '方向X', '方向Y', '抽出状況']
const mm = (value: number) => Number((value * 25.4 / 72).toFixed(3))

export function pageTextStatus(page: ExtractedPageText): string {
  return [page.lines.length ? '抽出' : page.truncated || page.invalidPositions ? '出力省略' : '文字なし', page.truncated ? '上限あり' : '', page.uncertainCharacters ? '読取不明文字の可能性' : '', page.invalidPositions ? '位置不明の行を省略' : ''].filter(Boolean).join(' / ')
}

export function textExportCsvRow(name: string, pageIndex: number, drawing: string, page: ExtractedPageText, line?: ExtractedTextLine): string {
  const [x0, y0, x1, y1] = page.bounds
  return [name, pageIndex + 1, drawing, line?.line ?? '', line?.text ?? '',
    line ? mm(line.rect[0] - x0) : '', line ? mm(line.rect[1] - y0) : '',
    line ? mm(line.rect[2] - line.rect[0]) : '', line ? mm(line.rect[3] - line.rect[1]) : '',
    mm(x1 - x0), mm(y1 - y0), page.rotation, line ? line.writingMode === 1 ? '縦' : '横' : '',
    line?.direction[0] ?? '', line?.direction[1] ?? '', pageTextStatus(page),
  ].map(quote).join(',') + '\r\n'
}

export interface TextExportProgress { completed: number; total: number; lines: number; paused: boolean }
export interface TextExportResult {
  blob: Blob
  bytes: number
  pages: number
  lines: number
  emptyPages: number
  limitedPages: number
  uncertainPages: number
  preview: Array<{ page: number; text: string }>
}

function cancelled(): DOMException { return new DOMException('文字抽出を中止しました。', 'AbortError') }
function yieldTask(signal: AbortSignal, ms = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(cancelled()); return }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(cancelled()) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function runTextExport(options: {
  name: string
  drawing: string
  pages: readonly number[]
  format: TextExportFormat
  signal: AbortSignal
  extract(page: number): Promise<ExtractedPageText>
  isIdle(): boolean
  lastActivity(): number
  onProgress(progress: TextExportProgress): void
  maxBytes?: number
}): Promise<TextExportResult> {
  const { signal, pages, format } = options
  const parts: Uint8Array<ArrayBuffer>[] = []
  const encoder = new TextEncoder()
  const result: Omit<TextExportResult, 'blob'> = { bytes: 0, pages: 0, lines: 0, emptyPages: 0, limitedPages: 0, uncertainPages: 0, preview: [] }
  const maxBytes = Math.min(TEXT_EXPORT_MAX_BYTES, options.maxBytes ?? TEXT_EXPORT_MAX_BYTES)
  let paused = false
  const progress = () => options.onProgress({ completed: result.pages, total: pages.length, lines: result.lines, paused })
  const check = () => { if (signal.aborted) throw cancelled() }
  const quiet = async () => {
    check()
    while (!options.isIdle() || performance.now() - options.lastActivity() < TEXT_EXPORT_QUIET_MS) {
      if (!paused) { paused = true; progress() }
      await yieldTask(signal, 50)
    }
    if (paused) { paused = false; progress() }
    check()
  }
  const append = (text: string) => {
    const bytes = encoder.encode(text)
    if (result.bytes + bytes.length > maxBytes) throw new Error('出力が32MiBの上限を超えました。ページ範囲を分けて抽出してください。')
    result.bytes += bytes.length; parts.push(bytes)
  }
  if (format === 'csv') append('\uFEFF' + TEXT_EXPORT_HEADER.map(quote).join(',') + '\r\n')
  else append(`ファイル: ${options.name}\r\n図面番号（利用者指定）: ${options.drawing}\r\n位置は表示ページの左上からのmmです。\r\n`)
  progress()
  for (const pageIndex of pages) {
    await quiet()
    let page: ExtractedPageText
    try { page = await options.extract(pageIndex) }
    catch (error) { check(); throw new Error(`${pageIndex + 1}ページの抽出に失敗しました: ${error instanceof Error ? error.message : String(error)}`) }
    await quiet()
    if (format === 'txt') append(`\r\n--- ${pageIndex + 1}ページ (${pageTextStatus(page)}) ---\r\n`)
    if (!page.lines.length && format === 'csv') append(textExportCsvRow(options.name, pageIndex, options.drawing, page))
    let batch: string[] = []
    for (let index = 0; index < page.lines.length; index++) {
      const line = page.lines[index]
      batch.push(format === 'csv' ? textExportCsvRow(options.name, pageIndex, options.drawing, page, line)
        : `[${line.line}: ${mm(line.rect[0] - page.bounds[0])}, ${mm(line.rect[1] - page.bounds[1])}mm] ${line.text}\r\n`)
      if (result.preview.length < 50) result.preview.push({ page: pageIndex + 1, text: line.text.slice(0, 160) })
      if (batch.length === 100 || index === page.lines.length - 1) {
        append(batch.join('')); batch = []
        await yieldTask(signal)
        await quiet()
      }
    }
    result.pages++; result.lines += page.lines.length
    if (!page.lines.length && !page.truncated && !page.invalidPositions) result.emptyPages++
    if (page.truncated || page.invalidPositions) result.limitedPages++
    if (page.uncertainCharacters) result.uncertainPages++
    progress()
    await yieldTask(signal)
  }
  check()
  return { ...result, blob: new Blob(parts, { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' }) }
}
