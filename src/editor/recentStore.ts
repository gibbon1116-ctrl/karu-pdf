import type { PdfFileHandle } from './fileAccess'

const DATABASE_NAME = 'karu-pdf'
const HANDLE_STORE = 'handles'
const LAST_OPENED_KEY = 'lastOpened'
const VIEW_STORAGE_KEY = 'karu-pdf:view'
const MAX_VIEW_ENTRIES = 50

export interface LastOpenedFile {
  handle: PdfFileHandle
  name: string
  openedAt: number
}

export interface ViewPosition {
  page: number
  zoom: number
  updatedAt: number
}

type ViewPositionMap = Record<string, ViewPosition>

let lastOpenedMemory: LastOpenedFile | null = null

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) request.result.createObjectStore(HANDLE_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDBを開けませんでした。'))
    request.onblocked = () => reject(new Error('IndexedDBがほかの画面で使用中です。'))
  })
}

export async function saveLastOpenedHandle(handle: PdfFileHandle, name: string): Promise<void> {
  const value: LastOpenedFile = { handle, name, openedAt: Date.now() }
  lastOpenedMemory = value
  try {
    const database = await openDatabase()
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(HANDLE_STORE, 'readwrite')
        transaction.objectStore(HANDLE_STORE).put(value, LAST_OPENED_KEY)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('ファイルの場所を保存できませんでした。'))
        transaction.onabort = () => reject(transaction.error ?? new Error('ファイルの場所の保存が中断されました。'))
      })
    } finally {
      database.close()
    }
  } catch {
    // 記憶機能が使えない環境でも、PDFを開く通常の操作は続ける。
  }
}

export async function loadLastOpenedHandle(): Promise<LastOpenedFile | null> {
  if (lastOpenedMemory) return lastOpenedMemory
  try {
    const database = await openDatabase()
    try {
      const value = await new Promise<LastOpenedFile | undefined>((resolve, reject) => {
        const request = database.transaction(HANDLE_STORE, 'readonly').objectStore(HANDLE_STORE).get(LAST_OPENED_KEY)
        request.onsuccess = () => resolve(request.result as LastOpenedFile | undefined)
        request.onerror = () => reject(request.error ?? new Error('前回のファイルの場所を読めませんでした。'))
      })
      if (!value?.handle || typeof value.name !== 'string' || typeof value.openedAt !== 'number') return null
      lastOpenedMemory = value
      return value
    } finally {
      database.close()
    }
  } catch {
    return null
  }
}

export function documentViewId(fileName: string, byteLength: number): string {
  return `${fileName}\n${byteLength}`
}

function storageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function readViewPositions(storage: Storage): ViewPositionMap {
  try {
    const raw = storage.getItem(VIEW_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const positions: ViewPositionMap = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const candidate = value as Partial<ViewPosition>
      if (!Number.isInteger(candidate.page) || Number(candidate.page) < 1) continue
      if (!Number.isFinite(candidate.zoom) || Number(candidate.zoom) <= 0) continue
      if (!Number.isFinite(candidate.updatedAt)) continue
      positions[key] = {
        page: Number(candidate.page),
        zoom: Number(candidate.zoom),
        updatedAt: Number(candidate.updatedAt),
      }
    }
    return positions
  } catch {
    return {}
  }
}

export function saveViewPosition(documentId: string, page: number, zoom: number, now = Date.now()): void {
  try {
    const storage = storageOrNull()
    if (!storage || !documentId || !Number.isInteger(page) || page < 1 || !Number.isFinite(zoom) || zoom <= 0) return
    const positions = readViewPositions(storage)
    positions[documentId] = { page, zoom, updatedAt: now }
    const newest = Object.entries(positions)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_VIEW_ENTRIES)
    storage.setItem(VIEW_STORAGE_KEY, JSON.stringify(Object.fromEntries(newest)))
  } catch {
    // localStorageが使えなくても閲覧は続ける。
  }
}

export function loadViewPosition(documentId: string): ViewPosition | null {
  try {
    const storage = storageOrNull()
    if (!storage) return null
    return readViewPositions(storage)[documentId] ?? null
  } catch {
    return null
  }
}
