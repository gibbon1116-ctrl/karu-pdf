export interface ReviewCursor { id: string; order: string[]; position: number; count: number }

function nextPosition(current: readonly string[], cursor: ReviewCursor | null): number {
  if (!cursor) return 0
  const position = current.indexOf(cursor.id)
  if (position !== -1) return (position + 1) % current.length
  const previous = cursor.order.indexOf(cursor.id), remaining = new Set(current)
  if (previous !== -1) {
    for (let i = previous + 1; i < cursor.order.length; i++) {
      if (remaining.has(cursor.order[i])) return current.indexOf(cursor.order[i])
    }
  }
  return 0
}

/** Advance in today's order, using the last reviewed order if the pickup was deleted. */
export function nextReview(current: readonly string[], cursor: ReviewCursor | null): ReviewCursor | null {
  if (!current.length) return null
  const position = nextPosition(current, cursor)
  return { id: current[position], position: position + 1, count: current.length, order: [...current] }
}

/** Update the counter without advancing or losing the deleted pickup's successors. */
export function refreshReview(current: readonly string[], cursor: ReviewCursor): ReviewCursor {
  const position = current.indexOf(cursor.id)
  return { ...cursor, position: position === -1 ? (current.length ? nextPosition(current, cursor) : 0) : position + 1,
    count: current.length }
}

/** Read only the requested entries, keeping the existing page/top/left/id order. */
export function reviewOrder(entries: readonly { annotationId: string }[],
  get: (id: string) => { id: string; pageIndex: number; rect: readonly number[]; deleted?: boolean } | undefined): string[] {
  return [...new Set(entries.map(e => e.annotationId))].map(get).filter(a => a !== undefined).filter(a => !a.deleted)
    .sort((a, b) => a.pageIndex - b.pageIndex || a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0] || a.id.localeCompare(b.id))
    .map(a => a.id)
}
