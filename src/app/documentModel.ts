import type { PageSize } from '../core/mupdfDoc'
import type { SaveMode } from '../core/save'
import { AnnotationStore } from '../editor/AnnotationStore'
import type { PdfFileHandle } from '../editor/fileAccess'

export const MAX_OPEN_DOCUMENTS = 8
export const MAX_INCREMENTAL_SAVES = 5
export const MAX_INCREMENTAL_GROWTH = 2 * 1024 * 1024
const MAX_RELATIVE_INCREMENTAL_GROWTH = 0.5

export interface DocumentViewState {
  page: number
  zoom: number
  scrollLeft: number
  scrollTop: number
}

export type SidePanelTab = 'pages' | 'outline' | 'search' | 'annotations'

export interface DocumentSessionInit {
  docId: string
  name: string
  byteLength: number
  handle: PdfFileHandle | null
  pageSizes: PageSize[]
  view?: Partial<DocumentViewState>
}

export class DocumentSession {
  readonly docId: string
  readonly name: string
  readonly byteLength: number
  handle: PdfFileHandle | null
  pageSizes: PageSize[]
  readonly annotationStore = new AnnotationStore()
  view: DocumentViewState
  fileOutdated = false
  sidePanelTab: SidePanelTab = 'pages'
  canUndoOrganize = false
  pageRevision = 0
  fitOnFirstView: boolean
  restorePageOnFirstView: boolean
  incrementalSaveCount = 0
  incrementalGrowth = 0
  private lastSavedByteLength: number
  private lastFullByteLength: number

  constructor(init: DocumentSessionInit) {
    this.docId = init.docId
    this.name = init.name
    this.byteLength = init.byteLength
    this.handle = init.handle
    this.pageSizes = init.pageSizes
    this.lastSavedByteLength = init.byteLength
    this.lastFullByteLength = init.byteLength
    this.fitOnFirstView = init.view === undefined
    this.restorePageOnFirstView = init.view !== undefined && init.view.scrollTop === undefined
    this.view = {
      page: init.view?.page ?? 1,
      zoom: init.view?.zoom ?? 1,
      scrollLeft: init.view?.scrollLeft ?? 0,
      scrollTop: init.view?.scrollTop ?? 0,
    }
  }

  get dirty(): boolean {
    return this.annotationStore.isDirty() || this.fileOutdated
  }

  nextSaveMode(): SaveMode {
    return this.incrementalSaveCount > MAX_INCREMENTAL_SAVES
      || this.incrementalGrowth > MAX_INCREMENTAL_GROWTH
      // 小さいPDFでも、増分だけで元サイズの半分を超えたら肥大化を抑える。
      || this.incrementalGrowth > this.lastFullByteLength * MAX_RELATIVE_INCREMENTAL_GROWTH
      ? 'full'
      : 'incremental'
  }

  recordSave(mode: SaveMode, byteLength: number): void {
    if (mode === 'full') {
      this.incrementalSaveCount = 0
      this.incrementalGrowth = 0
      this.lastFullByteLength = byteLength
    } else {
      this.incrementalSaveCount += 1
      this.incrementalGrowth += Math.max(0, byteLength - this.lastSavedByteLength)
    }
    this.lastSavedByteLength = byteLength
  }

  updateAfterPageLayout(pageSizes: PageSize[], canUndoOrganize: boolean): void {
    this.pageSizes = pageSizes
    this.canUndoOrganize = canUndoOrganize
    this.pageRevision += 1
    this.annotationStore.reset()
    this.view.page = Math.min(Math.max(1, this.view.page), pageSizes.length)
    this.view.scrollLeft = 0
    this.view.scrollTop = 0
    this.restorePageOnFirstView = true
    this.fileOutdated = true
  }
}

export interface DocumentIdentity {
  handle: PdfFileHandle | null
  name: string
  byteLength: number
}

export async function isSameDocument(session: DocumentSession, candidate: DocumentIdentity): Promise<boolean> {
  if (session.handle && candidate.handle && session.handle.isSameEntry) {
    try {
      return await session.handle.isSameEntry(candidate.handle)
    } catch {
      // 権限やブラウザ側の都合で比較できないときは、下の安全な代替判定を使う。
    }
  }
  if (session.handle || candidate.handle) return session.handle === candidate.handle
  return session.name === candidate.name && session.byteLength === candidate.byteLength
}

export class DocumentTabsModel {
  private sessions: DocumentSession[] = []
  private activeId: string | null = null

  list(): readonly DocumentSession[] {
    return this.sessions
  }

  get activeDocId(): string | null {
    return this.activeId
  }

  get active(): DocumentSession | null {
    return this.sessions.find((session) => session.docId === this.activeId) ?? null
  }

  async findDuplicate(identity: DocumentIdentity): Promise<DocumentSession | null> {
    for (const session of this.sessions) {
      if (await isSameDocument(session, identity)) return session
    }
    return null
  }

  add(session: DocumentSession): void {
    if (this.sessions.length >= MAX_OPEN_DOCUMENTS) {
      throw new Error('同時に開けるのは8ファイルまでです')
    }
    this.sessions = [...this.sessions, session]
    this.activeId = session.docId
  }

  activate(docId: string): boolean {
    if (!this.sessions.some((session) => session.docId === docId)) return false
    this.activeId = docId
    return true
  }

  close(docId: string): DocumentSession | null {
    const index = this.sessions.findIndex((session) => session.docId === docId)
    if (index < 0) return null
    const [removed] = this.sessions.splice(index, 1)
    this.sessions = [...this.sessions]
    if (this.activeId === docId) {
      this.activeId = this.sessions[Math.min(index, this.sessions.length - 1)]?.docId ?? null
    }
    return removed
  }
}

let fallbackSequence = 0

export function createDocId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  fallbackSequence += 1
  return `doc-${Date.now().toString(36)}-${fallbackSequence.toString(36)}`
}
