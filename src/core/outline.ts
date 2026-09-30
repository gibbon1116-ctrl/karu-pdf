import type { Document } from 'mupdf'

export interface OutlineEntry {
  title: string
  pageIndex: number | null
  x: number | null
  y: number | null
  open: boolean
  children: OutlineEntry[]
}

interface MuPdfOutlineEntry {
  title?: string
  uri?: string
  page?: number
  open: boolean
  down?: MuPdfOutlineEntry[]
}

export function loadOutline(document: Document): OutlineEntry[] {
  const entries = document.loadOutline() as MuPdfOutlineEntry[] | null
  const convert = (entry: MuPdfOutlineEntry): OutlineEntry => {
    let pageIndex = Number.isInteger(entry.page) ? entry.page! : null
    let x: number | null = null
    let y: number | null = null
    if (entry.uri) {
      try {
        const destination = document.resolveLinkDestination(entry.uri)
        if (Number.isInteger(destination.page)) pageIndex = destination.page
        if (Number.isFinite(destination.x)) x = destination.x
        if (Number.isFinite(destination.y)) y = destination.y
      } catch {
        // 外部リンクなど、ページ位置に解決できない項目も題名は表示する。
      }
    }
    return {
      title: entry.title?.trim() || '（題名なし）',
      pageIndex,
      x,
      y,
      open: entry.open,
      children: (entry.down ?? []).map(convert),
    }
  }
  return (entries ?? []).map(convert)
}
