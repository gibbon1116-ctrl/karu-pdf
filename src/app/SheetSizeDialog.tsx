import { useEffect, useRef } from 'react'
import type { PageSize } from '../core/mupdfDoc'

export function sheetSize(size: PageSize): { name: string; orientation: string; width: number; height: number } {
  const width = size.width * 25.4 / 72, height = size.height * 25.4 / 72
  const short = Math.min(width, height), long = Math.max(width, height)
  const standards = [['A0', 841, 1189], ['A1', 594, 841], ['A2', 420, 594], ['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210]] as const
  const name = standards.find(([, w, h]) => Math.abs(w - short) <= 1 && Math.abs(h - long) <= 1)?.[0] ?? 'その他'
  return { name, orientation: width > height ? '横' : '縦', width, height }
}

export function SheetSizeDialog({ sizes, onPage, onClose }: { sizes: readonly PageSize[]; onPage(index: number): void; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  const rows = sizes.map(sheetSize)
  const summary = new Map<string, number>()
  rows.forEach(row => { const key = `${row.name} ${row.orientation}`; summary.set(key, (summary.get(key) ?? 0) + 1) })
  return <dialog ref={ref} className="utility-dialog" aria-label="用紙サイズ一覧" onCancel={onClose}>
    <h1>用紙サイズ一覧</h1>
    <p>{[...summary].map(([key, count]) => `${key}: ${count}ページ`).join(' / ')}</p>
    <p>PDFの表示領域の寸法です。規格判定は±1mmの目安で、印刷縮尺とは異なります。</p>
    <div className="utility-scroll"><table><thead><tr><th>ページ</th><th>用紙</th><th>向き</th><th>幅 × 高さ (mm)</th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={index}><td><button onClick={() => { onClose(); onPage(index) }}>{index + 1}</button></td><td>{row.name}</td><td>{row.orientation}</td><td>{row.width.toFixed(1)} × {row.height.toFixed(1)}</td></tr>)}
    </tbody></table></div><button onClick={onClose}>閉じる</button>
  </dialog>
}
