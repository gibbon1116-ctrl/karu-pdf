import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationEdit } from '../core/annotations'
import type { SaveMode } from '../core/save'
import { createContext } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
export const FixtureUiContext = createContext<{ documents: readonly DocumentSession[]; select(): void; edit(id: string): void; open(): void } | null>(null)
export async function ensureSessionFixtures(session: DocumentSession, pool: PdfWorkerPool): Promise<void> {
  await session.annotationStore.ensureCountFixtures(() => pool.getCountFixtures(session.docId), async () => {
    for (let i = 0; i < session.pageSizes.length; i++) await session.annotationStore.ensurePageLoaded(i, () => pool.listAnnotations(session.docId, i))
  })
}
import { AnnotationStore } from '../editor/AnnotationStore'
import type { PdfFileHandle } from '../editor/fileAccess'
import { ViewHistory } from '../viewer/ViewHistory'

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

export type SidePanelTab = 'pages' | 'search' | 'annotations' | 'fixtures'

export function normalizeSidePanelTab(value: unknown): SidePanelTab {
  return value === 'search' || value === 'annotations' || value === 'fixtures' ? value : 'pages'
}

export interface DocumentSessionInit {
  editRestriction?: string | null
  docId: string
  name: string
  byteLength: number
  handle: PdfFileHandle | null
  pageSizes: PageSize[]
  view?: Partial<DocumentViewState>
}

export class DocumentSession {
  readonly editRestriction: string | null
  readonly viewHistory = new ViewHistory()
  readonly docId: string
  private fileIdentity: DocumentIdentity
  pageSizes: PageSize[]
  readonly annotationStore = new AnnotationStore()
  view: DocumentViewState
  fileOutdated = false
  private _sidePanelTab: SidePanelTab = 'pages'
  canUndoOrganize = false
  pageRevision = 0
  // Rendering-only generation for saved annotations (the editable overlay stays independent).
  savedRevision = 0
  splitSnapshotRevision = 0
  readonly savedPageRevisions = new Map<number, number>()
  fitOnFirstView: boolean
  restorePageOnFirstView: boolean
  incrementalSaveCount = 0
  incrementalGrowth = 0
  private lastSavedByteLength: number
  private lastFullByteLength: number

  constructor(init: DocumentSessionInit) {
    this.editRestriction = init.editRestriction ?? null
    this.docId = init.docId
    this.fileIdentity = { name: init.name, byteLength: init.byteLength, handle: init.handle }
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

  get name(): string { return this.fileIdentity.name }
  get byteLength(): number { return this.fileIdentity.byteLength }
  get handle(): PdfFileHandle | null { return this.fileIdentity.handle }

  // Call only after the destination stream has closed successfully. The Worker,
  // edits, history and view continue to belong to the same in-memory document.
  rebindToFile(handle: PdfFileHandle, name: string, byteLength: number): void {
    this.fileIdentity = { handle, name, byteLength }
  }

  get sidePanelTab(): SidePanelTab { return this._sidePanelTab }

  set sidePanelTab(value: SidePanelTab | string) {
    this._sidePanelTab = normalizeSidePanelTab(value)
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

  recordSavedRendering(edits: readonly AnnotationEdit[], errors: readonly { editIndex: number }[]): void {
    const failed = new Set(errors.map(error => error.editIndex))
    const pages = new Set(edits.flatMap((edit, index) => !failed.has(index) && edit.kind !== 'setPageScale' && edit.kind !== 'setCountFixtures' ? [edit.pageIndex] : []))
    this.savedRevision += 1
    for (const page of pages) this.savedPageRevisions.set(page, this.savedRevision)
  }

  updateAfterPageLayout(pageSizes: PageSize[], canUndoOrganize: boolean, scales?: import('../core/measure').PageScale[] | (import('../core/measure').PageScale | null)[]): void {
    this.viewHistory.clear()
    this.savedPageRevisions.clear()
    this.savedRevision = 0
    this.splitSnapshotRevision = 0
    this.pageSizes = pageSizes
    this.canUndoOrganize = canUndoOrganize
    this.pageRevision += 1
    this.annotationStore.reset(true)
    if (scales) this.annotationStore.loadScales(scales)
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
  // Names and lengths cannot identify a revised drawing. Without a file
  // handle open a separate tab instead of reading/hash-copying large PDFs.
  return false
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
