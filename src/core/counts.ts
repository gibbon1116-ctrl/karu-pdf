export interface CountMark { version: 1; id: string; group: string }
export function parseCount(raw: string | null): CountMark | null {
  try {
    if (!raw || raw.length > 400) return null
    const v = JSON.parse(raw) as CountMark
    return v.version === 1 && typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 80
      && typeof v.group === 'string' && v.group.trim().length > 0 && v.group.length <= 80 ? { version: 1, id: v.id, group: v.group } : null
  } catch { return null }
}
export function countSummary(items: readonly { pageIndex: number; count?: CountMark | null }[]): { group: string; pageIndex: number; total: number }[] {
  const totals = new Map<string, { group: string; pageIndex: number; total: number }>()
  for (const a of items) if (a.count) {
    const key = JSON.stringify([a.count.group, a.pageIndex]), previous = totals.get(key)
    if (previous) previous.total++
    else totals.set(key, { group: a.count.group, pageIndex: a.pageIndex, total: 1 })
  }
  return [...totals.values()].sort((a, b) => a.group.localeCompare(b.group, 'ja') || a.pageIndex - b.pageIndex)
}
