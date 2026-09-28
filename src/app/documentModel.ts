import type { PageSize } from '../core/mupdfDoc'
import { AnnotationStore } from '../editor/AnnotationStore'
import type { PdfFileHandle } from '../editor/fileAccess'

export const MAX_OPEN_DOCUMENTS = 8

export interface DocumentViewState {
  page: number
  zoom: number
  scrollLeft: number
  scrollTop: number
}

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
  readonly pageSizes: PageSize[]
  readonly annotationStore = new AnnotationStore()
  view: DocumentViewState
  fileOutdated = false
  fitOnFirstView: boolean
  restorePageOnFirstView: boolean

  constructor(init: DocumentSessionInit) {
    this.docId = init.docId
    this.name = init.name
    this.byteLength = init.byteLength
    this.handle = init.handle
    this.pageSizes = init.pageSizes
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
