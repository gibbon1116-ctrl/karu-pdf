import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { DocumentSession } from './documentModel'

// Split-only preparation. Serialize changes to the pool's two-document display LRU,
// including rapid reference selections and React effect cleanup/remounts.
const preparations = new WeakMap<PdfWorkerPool, Promise<void>>()

export function prepareSplitDisplays(pool: PdfWorkerPool, left: DocumentSession, right: DocumentSession, cancelled: () => boolean): Promise<void> {
  const previous = preparations.get(pool) ?? Promise.resolve()
  const task = previous.catch(() => undefined).then(async () => {
    // MuPDF 1.28.1 cannot safely export an edited instance incrementally twice.
    // The existing full-save worker path rebases its primary document while
    // preserving object numbers and the page-organization backup. Prepare BOTH
    // panes before activate() can export an evicted display document.
    for (const session of new Set([left, right])) {
      if (cancelled()) return
      if (session.savedRevision === session.splitSnapshotRevision) continue
      const revision = session.savedRevision
      const snapshot = await pool.applyAndSave(session.docId, [], 'full')
      // Do not retain file bytes on the main thread or apply unsaved overlay edits.
      // Complete this reload even if cancelled, so existing display caches still
      // refer to the same document generation on the next mount.
      await pool.openSourceDisplays(session.docId, new Blob([new Uint8Array(snapshot.bytes)]))
      session.splitSnapshotRevision = revision
    }
    if (cancelled()) return
    await pool.activate(right.docId)
    if (!cancelled()) await pool.activate(left.docId)
  })
  preparations.set(pool, task)
  return task
}
