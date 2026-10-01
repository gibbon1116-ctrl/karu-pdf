import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { RenderScheduler } from '../client/RenderScheduler'
import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationStore } from '../editor/AnnotationStore'
import { Dropdown, type DropdownItem } from '../ui/Dropdown'
import { PDF_PICKER_TYPES } from '../editor/fileAccess'
import { ImagesToPdfDialog } from '../app/ImagesToPdfDialog'
import { IMAGE_ACCEPT, isImageFile, pickImages } from '../app/imageFiles'
import type { PageCard } from './OrganizeDraft'
import { OrganizeDraft } from './OrganizeDraft'
import { nextPreviewZoom, OrganizePagePreview, PREVIEW_ZOOM_STEPS } from './OrganizePreview'
import {
  describePaperSize,
  insertionIndex,
  keyboardSelection,
  moveFocusIndex,
  parsePageRange,
  selectionForMode,
  type OrganizeMoveKey,
  type InsertPosition,
  type OrganizeSplitMode,
} from './organizeUtils'

const CARD_GAP = 16
const PREVIEW_WIDTH_KEY = 'karu-pdf:organize-preview-width'
const PREVIEW_VISIBLE_KEY = 'karu-pdf:organize-preview-visible'
const MIN_PREVIEW_WIDTH = 240
const MAX_PREVIEW_WIDTH = 640
const DISPLAY_SIZES = {
  small: { cardWidth: 120, rowHeight: 184, stageWidth: 100, stageHeight: 140 },
  medium: { cardWidth: 160, rowHeight: 230, stageWidth: 140, stageHeight: 180 },
  large: { cardWidth: 220, rowHeight: 306, stageWidth: 200, stageHeight: 252 },
} as const

type DisplaySize = keyof typeof DISPLAY_SIZES

export interface OrganizeSourceInfo {
  docId: string
  name: string
  pageSizes: PageSize[]
  temporary?: boolean
}

export interface ExtractOptions {
  removeFromDraft: boolean
  onePerFile: boolean
}

interface Props {
  docId: string
  draft: OrganizeDraft
  pageSizes: readonly PageSize[]
  sources: ReadonlyMap<string, OrganizeSourceInfo>
  scheduler: RenderScheduler
  annotationStore: AnnotationStore
  busy: boolean
  onLoadFile(file: File): Promise<OrganizeSourceInfo>
  onImageDrop(files: File[]): void
  onPrepareSources(docIds: string[]): void
  onDiscardSources(docIds: string[]): void
  onCopy(cards: readonly PageCard[]): void
  onPaste(beforeIndex: number): PageCard[]
  onApply(): void
  onCancel(): void
  onExtract(cardIds: string[], options: ExtractOptions): void
  onSplit(mode: OrganizeSplitMode): void
}

interface SourceChoice {
  key: string
  name: string
  status: 'loading' | 'ready' | 'error'
  info?: OrganizeSourceInfo
  error?: string
  range: string
  all: boolean
}

interface SourceDialogState {
  mode: 'insert' | 'replace'
  entries: SourceChoice[]
  fixedIndex: number | null
}

function cardPageSize(card: PageCard, targetDocId: string, targetSizes: readonly PageSize[], sources: ReadonlyMap<string, OrganizeSourceInfo>): PageSize {
  if (card.source.kind === 'blank') return { width: card.source.width, height: card.source.height }
  const sizes = card.source.docId === targetDocId ? targetSizes : sources.get(card.source.docId)?.pageSizes
  return sizes?.[card.source.pageIndex] ?? { width: 595, height: 842 }
}

function cardLabel(card: PageCard, index: number, targetDocId: string, sources: ReadonlyMap<string, OrganizeSourceInfo>): string {
  if (card.source.kind === 'blank') return '白紙'
  if (card.source.docId === targetDocId) return String(index + 1)
  const name = sources.get(card.source.docId)?.name.replace(/\.pdf$/i, '') ?? '追加'
  return `${name.slice(0, 8)}-${card.source.pageIndex + 1}`
}

function cardOrigin(card: PageCard, targetDocId: string, sources: ReadonlyMap<string, OrganizeSourceInfo>): string {
  if (card.source.kind === 'blank') return '白紙'
  if (card.source.docId === targetDocId) return `元の文書 ${card.source.pageIndex + 1}ページ`
  return `${sources.get(card.source.docId)?.name ?? '追加したPDF'} ${card.source.pageIndex + 1}ページ`
}

function storedPreviewWidth(): number {
  try {
    const stored = localStorage.getItem(PREVIEW_WIDTH_KEY)
    if (stored === null) return 360
    const value = Number(stored)
    return Number.isFinite(value) ? Math.max(MIN_PREVIEW_WIDTH, Math.min(MAX_PREVIEW_WIDTH, value)) : 360
  } catch { return 360 }
}

function storedPreviewVisible(): boolean {
  try { return localStorage.getItem(PREVIEW_VISIBLE_KEY) !== 'false' } catch { return true }
}

function storePreviewSetting(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* 表示の操作は続ける。 */ }
}

function Dialog({ title, children, onCancel, testId }: {
  title: string
  children: React.ReactNode
  onCancel(): void
  testId: string
}) {
  return <div className="organize-dialog-backdrop" role="presentation">
    <section className="organize-dialog" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <header><h2>{title}</h2><button type="button" aria-label="閉じる" onClick={onCancel}>×</button></header>
      {children}
    </section>
  </div>
}

function PositionFields({ position, setPosition, afterPage, setAfterPage, selectedCount, disabled = false }: {
  position: InsertPosition
  setPosition(value: InsertPosition): void
  afterPage: number
  setAfterPage(value: number): void
  selectedCount: number
  disabled?: boolean
}) {
  return <fieldset disabled={disabled} className="organize-position-fields">
    <legend>挿入する位置</legend>
    {([
      ['start', '先頭'], ['end', '末尾'], ['before', '選んだページの前'], ['after', '選んだページの後'],
    ] as const).map(([value, label]) => <label key={value}>
      <input type="radio" name="insert-position" checked={position === value} onChange={() => setPosition(value)} />{label}
    </label>)}
    <label>
      <input type="radio" name="insert-position" checked={position === 'afterPage'} onChange={() => setPosition('afterPage')} />
      ページ番号を指定
      <input aria-label="何ページ目の後" type="number" min={0} value={afterPage} onChange={(event) => setAfterPage(Number(event.target.value))} />ページの後
    </label>
    {selectedCount === 0 && (position === 'before' || position === 'after') && <small>ページが選ばれていないため末尾に挿入します。</small>}
  </fieldset>
}

function OrganizeThumbnail({ card, targetDocId, targetSizes, sources, scheduler, annotationStore, stageWidth, stageHeight }: {
  card: PageCard
  targetDocId: string
  targetSizes: readonly PageSize[]
  sources: ReadonlyMap<string, OrganizeSourceInfo>
  scheduler: RenderScheduler
  annotationStore: AnnotationStore
  stageWidth: number
  stageHeight: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageSize = cardPageSize(card, targetDocId, targetSizes, sources)
  const isBlank = card.source.kind === 'blank'
  const page = card.source.kind === 'page' ? card.source : null
  const scale = 512 / Math.max(pageSize.width, pageSize.height)
  const excluded = page?.docId === targetDocId ? annotationStore.touchedObjNums(page.pageIndex) : []
  const baseKey = page ? `${page.pageIndex}:${scale.toFixed(6)}:full:x=${excluded.join('.')}` : ''
  const key = page?.docId === targetDocId ? baseKey : `source:${page?.docId}:${baseKey}`
  const turned = card.rotation === 90 || card.rotation === 270
  const shownWidth = turned ? pageSize.height : pageSize.width
  const shownHeight = turned ? pageSize.width : pageSize.height
  const cssScale = Math.min((stageWidth - 4) / shownWidth, (stageHeight - 6) / shownHeight)

  useEffect(() => {
    if (!page) return
    const params = { docId: page.docId, pageIndex: page.pageIndex, renderScale: scale, deviceRect: null, excludeAnnotObjNums: excluded }
    const draw = (bitmap: ImageBitmap) => {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0)
    }
    if (scheduler.has(key)) return scheduler.want(key, params, 3, draw)
    let release: (() => void) | undefined
    const timer = window.setTimeout(() => { release = scheduler.want(key, params, 3, draw) }, 250)
    return () => { window.clearTimeout(timer); release?.() }
  }, [excluded.join('.'), key, page?.docId, page?.pageIndex, scale, scheduler])

  if (isBlank) return <div className="organize-blank" style={{ width: shownWidth * cssScale, height: shownHeight * cssScale }} />
  return <canvas ref={canvasRef} className="organize-thumbnail" style={{
    width: pageSize.width * cssScale,
    height: pageSize.height * cssScale,
    transform: `rotate(${card.rotation}deg)`,
  }} />
}

function PreviewZoomControls({ zoom, onZoomChange, label }: { zoom: number; onZoomChange(value: number): void; label: string }) {
  const percent = Math.round(zoom * 100)
  const items: DropdownItem[] = PREVIEW_ZOOM_STEPS.map((value) => ({
    label: `${Math.round(value * 100)}%`,
    checked: value === zoom,
    onSelect: () => onZoomChange(value),
  }))
  return <div className="organize-preview-zoom">
    <button type="button" aria-label={`${label}を縮小`} disabled={zoom <= PREVIEW_ZOOM_STEPS[0]} onClick={() => onZoomChange(nextPreviewZoom(zoom, -1))}>−</button>
    <Dropdown label={`${percent}%`} items={items} buttonClassName="organize-preview-zoom-value" />
    <button type="button" aria-label={`${label}を拡大`} disabled={zoom >= PREVIEW_ZOOM_STEPS.at(-1)!} onClick={() => onZoomChange(nextPreviewZoom(zoom, 1))}>＋</button>
    <button type="button" aria-label={`${label}を幅に合わせる`} onClick={() => onZoomChange(1)}>幅</button>
  </div>
}

export function OrganizeView(props: Props) {
  const draftVersion = useSyncExternalStore(props.draft.subscribe, props.draft.getSnapshot)
  const cards = props.draft.getCards()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const lightboxRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<string | null>(null)
  const focusIndexRef = useRef(0)
  const dragIdsRef = useRef<string[]>([])
  const fileModeRef = useRef<'insert' | 'replace'>('insert')
  const fixedDropIndexRef = useRef<number | null>(null)
  const nextSourceKeyRef = useRef(1)
  const dismissedSourceKeysRef = useRef(new Set<string>())
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 700, width: 900 })
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [displaySize, setDisplaySize] = useState<DisplaySize>('medium')
  const [sourceDialog, setSourceDialog] = useState<SourceDialogState | null>(null)
  const [dialogError, setDialogError] = useState('')
  const [position, setPosition] = useState<InsertPosition>('after')
  const [afterPage, setAfterPage] = useState(1)
  const [blankOpen, setBlankOpen] = useState(false)
  const [imageFiles, setImageFiles] = useState<File[] | null>(null)
  const imageInsertionRef = useRef(0)
  const [blankCount, setBlankCount] = useState(1)
  const [blankSize, setBlankSize] = useState<'same' | 'a4' | 'a3' | 'b4' | 'b5'>('same')
  const [blankOrientation, setBlankOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [pageSelectionOpen, setPageSelectionOpen] = useState(false)
  const [pageSelectionValue, setPageSelectionValue] = useState('')
  const [extractOpen, setExtractOpen] = useState(false)
  const [extractRemove, setExtractRemove] = useState(false)
  const [extractSingles, setExtractSingles] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitKind, setSplitKind] = useState<'before' | 'every' | 'single' | 'equal'>('before')
  const [splitNumber, setSplitNumber] = useState(2)
  const [previewVisible, setPreviewVisible] = useState(storedPreviewVisible)
  const [previewWidth, setPreviewWidth] = useState(storedPreviewWidth)
  const [previewZoom, setPreviewZoom] = useState(1)
  const [expandedOpen, setExpandedOpen] = useState(false)
  const [expandedZoom, setExpandedZoom] = useState(1)
  const metrics = DISPLAY_SIZES[displaySize]
  const columns = Math.max(1, Math.floor((viewport.width - CARD_GAP) / (metrics.cardWidth + CARD_GAP)))
  const rowCount = Math.ceil(cards.length / columns)
  const startRow = Math.max(0, Math.floor(viewport.top / metrics.rowHeight) - 2)
  const endRow = Math.min(rowCount, Math.ceil((viewport.top + viewport.height) / metrics.rowHeight) + 2)
  const visible = cards.slice(startRow * columns, endRow * columns)
  const selectedIds = useMemo(() => [...selection].filter((id) => cards.some((card) => card.id === id)), [cards, selection])
  const selectedCards = useMemo(() => {
    const wanted = new Set(selectedIds)
    return cards.filter((card) => wanted.has(card.id))
  }, [cards, selectedIds])
  const focusedIndex = focusedId ? cards.findIndex((card) => card.id === focusedId) : -1
  const focusedCard = focusedIndex >= 0 ? cards[focusedIndex] : null
  const focusedPageSize = focusedCard ? cardPageSize(focusedCard, props.docId, props.pageSizes, props.sources) : null

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const update = () => setViewport({ top: scroller.scrollTop, height: scroller.clientHeight, width: scroller.clientWidth })
    const resize = new ResizeObserver(update)
    resize.observe(scroller)
    update()
    return () => resize.disconnect()
  }, [])

  useEffect(() => {
    setSelection((current) => new Set([...current].filter((id) => cards.some((card) => card.id === id))))
    setFocusedId((current) => {
      if (current && cards.some((card) => card.id === current)) return current
      if (cards.length === 0) { setExpandedOpen(false); return null }
      const next = cards[Math.min(focusIndexRef.current, cards.length - 1)]
      focusIndexRef.current = cards.indexOf(next)
      return next.id
    })
  }, [draftVersion])

  useEffect(() => {
    if (focusedIndex < 0) return
    focusIndexRef.current = focusedIndex
    const scroller = scrollerRef.current
    if (!scroller) return
    const row = Math.floor(focusedIndex / columns)
    const top = CARD_GAP + row * metrics.rowHeight
    const bottom = top + metrics.rowHeight
    if (top < scroller.scrollTop) scroller.scrollTop = Math.max(0, top - CARD_GAP)
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight
  }, [columns, focusedIndex, metrics.rowHeight])

  useEffect(() => {
    if (!expandedOpen) return
    setExpandedZoom(1)
    requestAnimationFrame(() => lightboxRef.current?.focus())
  }, [expandedOpen])

  useEffect(() => {
    if (!expandedOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (!['Escape', ' ', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Escape' || event.key === ' ') setExpandedOpen(false)
      else {
        const current = focusedId ? cards.findIndex((card) => card.id === focusedId) : -1
        if (current < 0) return
        const next = Math.max(0, Math.min(cards.length - 1, current + (event.key === 'ArrowLeft' ? -1 : 1)))
        const card = cards[next]
        focusIndexRef.current = next
        setFocusedId(card.id)
        anchorRef.current = card.id
        setSelection(new Set([card.id]))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [cards, expandedOpen, focusedId])

  const choose = (card: PageCard, event: React.MouseEvent) => {
    const index = cards.findIndex((item) => item.id === card.id)
    setFocusedId(card.id)
    focusIndexRef.current = index
    if (event.shiftKey && anchorRef.current) {
      const anchor = cards.findIndex((item) => item.id === anchorRef.current)
      if (anchor >= 0) {
        const [start, end] = [anchor, index].sort((a, b) => a - b)
        const range = cards.slice(start, end + 1).map((item) => item.id)
        setSelection(new Set(event.ctrlKey ? [...selection, ...range] : range))
        return
      }
    }
    anchorRef.current = card.id
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selection)
      if (next.has(card.id)) next.delete(card.id); else next.add(card.id)
      setSelection(next)
    } else setSelection(new Set([card.id]))
  }

  const startPreviewResize = (event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = previewWidth
    const move = (pointerEvent: PointerEvent) => setPreviewWidth(Math.max(MIN_PREVIEW_WIDTH, Math.min(MAX_PREVIEW_WIDTH, startWidth + startX - pointerEvent.clientX)))
    const stop = (pointerEvent: PointerEvent) => {
      move(pointerEvent)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      const width = Math.max(MIN_PREVIEW_WIDTH, Math.min(MAX_PREVIEW_WIDTH, startWidth + startX - pointerEvent.clientX))
      storePreviewSetting(PREVIEW_WIDTH_KEY, String(width))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const currentInsertionIndex = () => insertionIndex(position, cards, selectedIds, afterPage)

  const pickImageFiles = async () => {
    imageInsertionRef.current = insertionIndex('after', cards, selectedIds, cards.length)
    try {
      const files = await pickImages(() => document.querySelector<HTMLInputElement>('[data-testid="organize-image-input"]')?.click())
      if (files.length) setImageFiles(files)
    } catch (reason) { if (!(reason instanceof DOMException && reason.name === 'AbortError')) setDialogError(String(reason)) }
  }

  const loadFiles = (files: File[], mode: 'insert' | 'replace', fixedIndex: number | null, append = false) => {
    if (files.length === 0) return
    const pending = files.map((file) => ({
      file,
      entry: {
        key: `pending-${nextSourceKeyRef.current++}`,
        name: file.name,
        status: 'loading' as const,
        range: '',
        all: true,
      },
    }))
    setDialogError('')
    setSourceDialog((current) => ({
      mode,
      fixedIndex,
      entries: append && current ? [...current.entries, ...pending.map((item) => item.entry)] : pending.map((item) => item.entry),
    }))
    setPosition('after')
    setAfterPage(Math.max(0, cards.length))
    for (const item of pending) {
      void props.onLoadFile(item.file).then((info) => {
        if (dismissedSourceKeysRef.current.delete(item.entry.key)) {
          props.onDiscardSources([info.docId])
          return
        }
        setSourceDialog((current) => current ? {
          ...current,
          entries: current.entries.map((entry) => entry.key === item.entry.key
            ? { ...entry, status: 'ready', info, name: info.name }
            : entry),
        } : current)
      }).catch((reason) => {
        if (dismissedSourceKeysRef.current.delete(item.entry.key)) return
        setSourceDialog((current) => current ? {
          ...current,
          entries: current.entries.map((entry) => entry.key === item.entry.key
            ? { ...entry, status: 'error', error: reason instanceof Error ? reason.message : String(reason) }
            : entry),
        } : current)
      })
    }
  }

  const pickFiles = async (mode: 'insert' | 'replace', append = false) => {
    fileModeRef.current = mode
    fixedDropIndexRef.current = null
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({ id: `karu-pdf-organize-${mode}`, multiple: mode === 'insert', types: PDF_PICKER_TYPES })
        loadFiles(await Promise.all(handles.map((handle) => handle.getFile())), mode, null, append)
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setDialogError(reason instanceof Error ? reason.message : String(reason))
      }
      return
    }
    document.querySelector<HTMLInputElement>('[data-testid="organize-file-input"]')?.click()
  }

  const cancelSourceDialog = () => {
    if (sourceDialog) {
      const loaded = sourceDialog.entries.flatMap((entry) => entry.info ? [entry.info.docId] : [])
      sourceDialog.entries.filter((entry) => entry.status === 'loading').forEach((entry) => dismissedSourceKeysRef.current.add(entry.key))
      props.onDiscardSources(loaded)
    }
    setSourceDialog(null)
    setDialogError('')
  }

  const confirmSourceDialog = () => {
    if (!sourceDialog) return
    const pageCards: PageCard[] = []
    for (const entry of sourceDialog.entries) {
      if (entry.status !== 'ready' || !entry.info) continue
      const parsed = entry.all
        ? { pages: entry.info.pageSizes.map((_, index) => index), error: null }
        : parsePageRange(entry.range, entry.info.pageSizes.length)
      if (parsed.error) { setDialogError(`${entry.info.name}: ${parsed.error}`); return }
      for (const pageIndex of parsed.pages) pageCards.push({
        id: `source-choice-${entry.info.docId}-${pageIndex}`,
        source: { kind: 'page', docId: entry.info.docId, pageIndex },
        rotation: 0,
      })
    }
    if (pageCards.length === 0) { setDialogError('挿入するページがありません。'); return }
    const sourceIds = [...new Set(pageCards.flatMap((card) => card.source.kind === 'page' ? [card.source.docId] : []))]
    if (sourceDialog.mode === 'replace') {
      if (selectedIds.length === 0) { setDialogError('置き換えるページを選んでください。'); return }
      if (selectedIds.length !== pageCards.length && !window.confirm(`選んだ ${selectedIds.length} ページを、${pageCards.length} ページで置き換えます。`)) return
      const inserted = props.draft.replace(selectedIds, pageCards)
      setSelection(new Set(inserted.map((card) => card.id)))
      if (inserted[0]) { setFocusedId(inserted[0].id); anchorRef.current = inserted[0].id }
    } else {
      const at = sourceDialog.fixedIndex ?? currentInsertionIndex()
      const inserted = props.draft.paste(at, pageCards)
      setSelection(new Set(inserted.map((card) => card.id)))
      if (inserted[0]) { setFocusedId(inserted[0].id); anchorRef.current = inserted[0].id }
    }
    props.onPrepareSources(sourceIds)
    setSourceDialog(null)
    setDialogError('')
  }

  const confirmBlank = () => {
    if (!Number.isInteger(blankCount) || blankCount < 1 || blankCount > 100) { setDialogError('枚数は1〜100で指定してください。'); return }
    const at = currentInsertionIndex()
    const previous = cards[at - 1]
    const sizes = {
      a4: { width: 595.28, height: 841.89 }, a3: { width: 841.89, height: 1190.55 },
      b4: { width: 728.5, height: 1031.8 }, b5: { width: 515.9, height: 728.5 },
    }
    const base = blankSize === 'same'
      ? (previous ? cardPageSize(previous, props.docId, props.pageSizes, props.sources) : sizes.a4)
      : sizes[blankSize]
    const short = Math.min(base.width, base.height)
    const long = Math.max(base.width, base.height)
    const size = blankOrientation === 'portrait' ? { width: short, height: long } : { width: long, height: short }
    const inserted = props.draft.insertBlanks(at, blankCount, size.width, size.height)
    setSelection(new Set(inserted.map((card) => card.id)))
    if (inserted[0]) { setFocusedId(inserted[0].id); anchorRef.current = inserted[0].id }
    setBlankOpen(false)
    setDialogError('')
  }

  const paste = () => {
    try {
      const inserted = props.onPaste(insertionIndex('after', cards, selectedIds, cards.length))
      setSelection(new Set(inserted.map((card) => card.id)))
      if (inserted[0]) { setFocusedId(inserted[0].id); anchorRef.current = inserted[0].id }
      setDialogError('')
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const openPageSelection = () => { setPageSelectionValue(''); setDialogError(''); setPageSelectionOpen(true) }
  const confirmPageSelection = () => {
    const parsed = parsePageRange(pageSelectionValue, cards.length)
    if (parsed.error) { setDialogError(parsed.error); return }
    setSelection(new Set(parsed.pages.map((index) => cards[index].id)))
    if (parsed.pages[0] !== undefined) {
      setFocusedId(cards[parsed.pages[0]].id)
      anchorRef.current = cards[parsed.pages[0]].id
    }
    setPageSelectionOpen(false)
    setDialogError('')
  }

  const doSplit = () => {
    const mode: OrganizeSplitMode = splitKind === 'before'
      ? { kind: 'before', cardIds: selectedIds }
      : splitKind === 'single'
        ? { kind: 'single' }
        : splitKind === 'equal'
          ? { kind: 'equal', files: splitNumber }
          : { kind: 'every', count: splitNumber }
    props.onSplit(mode)
    setSplitOpen(false)
  }

  return <section className="organize-view" data-testid="organize-view">
    <header className="organize-toolbar">
      <strong>ページ整理</strong>
      <Dropdown label="挿入▼" items={[
        { label: '他のPDFから（複数選択可）', disabled: props.busy, onSelect: () => void pickFiles('insert') },
        { label: '画像を挿入…', disabled: props.busy, onSelect: () => void pickImageFiles() },
        { label: '白紙のページ', disabled: props.busy, onSelect: () => { setPosition('after'); setBlankOpen(true); setDialogError('') } },
        { label: 'クリップボードのページを貼り付け', disabled: props.busy, onSelect: paste },
      ] satisfies DropdownItem[]} />
      <Dropdown label="回転▼" items={[
        { label: '左に90°', disabled: props.busy || selectedIds.length === 0, onSelect: () => props.draft.rotate(selectedIds, -90) },
        { label: '右に90°', disabled: props.busy || selectedIds.length === 0, onSelect: () => props.draft.rotate(selectedIds, 90) },
        { label: '180°', disabled: props.busy || selectedIds.length === 0, onSelect: () => props.draft.rotate(selectedIds, 180) },
      ] satisfies DropdownItem[]} />
      <button type="button" disabled={props.busy || selectedIds.length === 0 || selectedIds.length === cards.length} onClick={() => props.draft.delete(selectedIds)}>削除</button>
      <button type="button" disabled={props.busy || selectedIds.length === 0} onClick={() => {
        const created = props.draft.duplicate(selectedIds); setSelection(new Set(created.map((card) => card.id)))
        if (created[0]) { setFocusedId(created[0].id); anchorRef.current = created[0].id }
      }}>複製</button>
      <button type="button" disabled={props.busy || selectedIds.length === 0} onClick={() => void pickFiles('replace')}>置換</button>
      <button type="button" disabled={props.busy || selectedIds.length === 0} onClick={() => { setExtractOpen(true); setDialogError('') }}>抽出</button>
      <button type="button" disabled={props.busy || cards.length < 2} onClick={() => { setSplitOpen(true); setDialogError('') }}>分割</button>
      <Dropdown label="並び▼" items={[
        { label: '逆順にする', disabled: props.busy || cards.length < 2, onSelect: () => props.draft.reverse(selectedIds) },
      ]} />
      <Dropdown label="選択▼" items={[
        { label: 'すべて選ぶ', onSelect: () => setSelection(new Set(selectionForMode(cards, selectedIds, 'all'))) },
        { label: '選択を反転', onSelect: () => setSelection(new Set(selectionForMode(cards, selectedIds, 'invert'))) },
        { label: '奇数ページ', onSelect: () => setSelection(new Set(selectionForMode(cards, selectedIds, 'odd'))) },
        { label: '偶数ページ', onSelect: () => setSelection(new Set(selectionForMode(cards, selectedIds, 'even'))) },
        { label: 'ページ番号で選ぶ', onSelect: openPageSelection },
      ]} />
      <label className="organize-preview-toggle">
        <input type="checkbox" checked={previewVisible} onChange={(event) => {
          setPreviewVisible(event.target.checked)
          storePreviewSetting(PREVIEW_VISIBLE_KEY, String(event.target.checked))
        }} />プレビュー
      </label>
      <label className="organize-display-size">表示の大きさ
        <select value={displaySize} onChange={(event) => setDisplaySize(event.target.value as DisplaySize)}>
          <option value="small">小</option><option value="medium">中</option><option value="large">大</option>
        </select>
      </label>
      <span className="organize-toolbar-spacer" />
      <button type="button" disabled={props.busy || !props.draft.canUndo()} onClick={() => props.draft.undo()}>↶ 戻す</button>
      <button type="button" disabled={props.busy || !props.draft.canRedo()} onClick={() => props.draft.redo()}>↷ やり直し</button>
      <button type="button" disabled={props.busy || !props.draft.isChanged()} onClick={props.onApply}>適用</button>
      <button type="button" disabled={props.busy} onClick={props.onCancel}>やめる</button>
      {props.busy && <span role="status">ページを組み立てています…</span>}
    </header>
    <input hidden multiple type="file" accept="application/pdf,.pdf" data-testid="organize-file-input" onChange={(event) => {
      const files = [...(event.currentTarget.files ?? [])]
      void loadFiles(files, fileModeRef.current, fixedDropIndexRef.current)
      event.currentTarget.value = ''
    }} />
    <input hidden multiple type="file" accept={IMAGE_ACCEPT} data-testid="organize-image-input" onChange={event => {
      const files = [...event.currentTarget.files ?? []]
      if (files.length) setImageFiles(files)
      event.currentTarget.value = ''
    }} />
    {imageFiles && <ImagesToPdfDialog files={imageFiles} mode="insert" onClose={() => setImageFiles(null)} onComplete={async (bytes, name, signal) => {
      const info = await props.onLoadFile(new File([new Uint8Array(bytes)], name, { type: 'application/pdf' }))
      if (signal.aborted) { props.onDiscardSources([info.docId]); return }
      const inserted = props.draft.insertPages(imageInsertionRef.current, info.docId, info.pageSizes)
      setSelection(new Set(inserted.map(card => card.id)))
      if (inserted[0]) { setFocusedId(inserted[0].id); anchorRef.current = inserted[0].id }
      props.onPrepareSources([info.docId])
    }} />}
    {dialogError && !sourceDialog && !blankOpen && !pageSelectionOpen && <p className="organize-inline-error" role="alert">{dialogError}</p>}
    <div className="organize-content">
    <div ref={scrollerRef} className="organize-grid-scroller" tabIndex={0}
      onScroll={(event) => {
        const { scrollTop, clientHeight } = event.currentTarget
        setViewport((current) => ({ ...current, top: scrollTop, height: clientHeight }))
      }}
      onKeyDown={(event) => {
        const key = event.key.toLowerCase()
        if ((event.ctrlKey || event.metaKey) && key === 'a') { event.preventDefault(); setSelection(new Set(cards.map((card) => card.id))); return }
        if ((event.ctrlKey || event.metaKey) && key === 'd') {
          event.preventDefault(); const created = props.draft.duplicate(selectedIds); setSelection(new Set(created.map((card) => card.id))); return
        }
        if ((event.ctrlKey || event.metaKey) && key === 'c') { event.preventDefault(); props.onCopy(selectedCards); return }
        if ((event.ctrlKey || event.metaKey) && key === 'v') { event.preventDefault(); paste(); return }
        if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
          event.preventDefault(); if (key === 'y' || event.shiftKey) props.draft.redo(); else props.draft.undo(); return
        }
        if (event.key === 'Delete' && selectedIds.length > 0 && selectedIds.length < cards.length) { event.preventDefault(); props.draft.delete(selectedIds); return }
        if (event.key === ' ' || event.code === 'Space') {
          event.preventDefault()
          if (event.ctrlKey || event.metaKey) {
            if (!focusedCard) return
            const next = new Set(selection)
            if (next.has(focusedCard.id)) next.delete(focusedCard.id); else next.add(focusedCard.id)
            setSelection(next)
          } else if (focusedCard) setExpandedOpen(true)
          return
        }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
          event.preventDefault()
          const current = focusedIndex >= 0 ? focusedIndex : Math.max(0, cards.findIndex((card) => selection.has(card.id)))
          const pageRows = Math.max(1, Math.floor(viewport.height / metrics.rowHeight))
          const next = moveFocusIndex(current, event.key as OrganizeMoveKey, cards.length, columns, pageRows)
          if (next < 0) return
          const anchor = anchorRef.current ? cards.findIndex((card) => card.id === anchorRef.current) : current
          const selectedIndexes = cards.map((card, index) => selection.has(card.id) ? index : -1).filter((index) => index >= 0)
          const result = keyboardSelection(selectedIndexes, anchor, next, event.shiftKey, event.ctrlKey || event.metaKey)
          setFocusedId(cards[next].id)
          focusIndexRef.current = next
          setSelection(new Set(result.selection.map((index) => cards[index].id)))
          anchorRef.current = cards[result.anchor]?.id ?? cards[next].id
          return
        }
        if (event.key === 'Escape') { event.preventDefault(); props.onCancel() }
      }}
      onDragOver={(event) => { event.preventDefault(); if (dropIndex === null) setDropIndex(cards.length) }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null) }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const at = dropIndex ?? cards.length
        if (event.dataTransfer.files.length > 0) {
          const files = [...event.dataTransfer.files], images = files.filter(isImageFile)
          void loadFiles(files.filter(file => /\.pdf$/i.test(file.name) || file.type === 'application/pdf'), 'insert', at)
          if (images.length) props.onImageDrop(images)
        }
        else if (dragIdsRef.current.length > 0) props.draft.move(dragIdsRef.current, at)
        dragIdsRef.current = []
        setDropIndex(null)
      }}
    >
      <div className="organize-grid" style={{ height: rowCount * metrics.rowHeight + CARD_GAP }}>
        {visible.map((card) => {
          const index = cards.findIndex((item) => item.id === card.id)
          const row = Math.floor(index / columns)
          const column = index % columns
          return <button type="button" key={card.id} draggable={!props.busy} data-testid={`organize-card-${index}`}
            className={`organize-card${selection.has(card.id) ? ' selected' : ''}${focusedId === card.id ? ' focused' : ''}`}
            style={{
              left: CARD_GAP + column * (metrics.cardWidth + CARD_GAP), top: CARD_GAP + row * metrics.rowHeight,
              width: metrics.cardWidth, height: metrics.rowHeight - CARD_GAP,
              gridTemplateRows: `${metrics.stageHeight}px 24px`,
            }}
            onClick={(event) => choose(card, event)}
            onDoubleClick={() => { setFocusedId(card.id); setExpandedOpen(true) }}
            onDragStart={(event) => {
              const ids = selection.has(card.id) ? selectedIds : [card.id]
              if (!selection.has(card.id)) setSelection(new Set(ids))
              setFocusedId(card.id)
              dragIdsRef.current = ids
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('application/x-karu-pages', ids.join(','))
            }}
            onDragOver={(event) => {
              event.preventDefault(); const box = event.currentTarget.getBoundingClientRect()
              setDropIndex(index + (event.clientX > box.left + box.width / 2 ? 1 : 0))
            }}>
            {dropIndex === index && <span className="organize-drop-marker" />}
            <span className="organize-thumbnail-stage" style={{ width: metrics.stageWidth, height: metrics.stageHeight }}>
              <OrganizeThumbnail card={card} targetDocId={props.docId} targetSizes={props.pageSizes} sources={props.sources}
                scheduler={props.scheduler} annotationStore={props.annotationStore} stageWidth={metrics.stageWidth} stageHeight={metrics.stageHeight} />
            </span>
            <span>{cardLabel(card, index, props.docId, props.sources)}</span>
          </button>
        })}
        {dropIndex === cards.length && <span className="organize-drop-marker end" style={{
          top: CARD_GAP + Math.max(0, rowCount - 1) * metrics.rowHeight,
          left: CARD_GAP + (cards.length % columns) * (metrics.cardWidth + CARD_GAP) - 8,
          height: metrics.rowHeight - CARD_GAP,
        }} />}
      </div>
    </div>
    {previewVisible && <>
      <div className="organize-preview-resizer" role="separator" aria-label="プレビューの幅を変更" aria-orientation="vertical" onPointerDown={startPreviewResize} />
      <aside className="organize-preview-pane" style={{ width: previewWidth }} aria-label="プレビュー" data-testid="organize-preview-pane">
        <header className="organize-preview-header">
          <h2>プレビュー</h2>
          <PreviewZoomControls zoom={previewZoom} onZoomChange={setPreviewZoom} label="プレビュー" />
        </header>
        {focusedCard && focusedPageSize ? <>
          <OrganizePagePreview card={focusedCard} pageSize={focusedPageSize} targetDocId={props.docId} scheduler={props.scheduler}
            annotationStore={props.annotationStore} fit="width" zoom={previewZoom} onZoomChange={setPreviewZoom} debounceMs={150} testId="organize-preview-canvas" />
          <div className="organize-preview-info">
            <strong data-testid="organize-preview-position">{focusedIndex + 1} / {cards.length}</strong>
            <span>{cardOrigin(focusedCard, props.docId, props.sources)}</span>
            <span>{describePaperSize(focusedPageSize.width, focusedPageSize.height, focusedCard.rotation)}</span>
          </div>
        </> : <p className="organize-preview-empty">ページを選ぶと、ここに大きく表示します。</p>}
      </aside>
    </>}
    </div>
    <footer className="organize-footer">選択: {selectedIds.length}ページ ／ 全{cards.length}ページ（下書き）</footer>

    {expandedOpen && focusedCard && focusedPageSize && <div ref={lightboxRef} className="organize-lightbox" role="dialog" aria-modal="true" aria-label="拡大プレビュー" tabIndex={-1}
      onPointerDown={(event) => { if (event.target === event.currentTarget) setExpandedOpen(false) }}
    >
      <header>
        <strong>{focusedIndex + 1} / {cards.length}</strong>
        <span>{cardOrigin(focusedCard, props.docId, props.sources)}</span>
        <PreviewZoomControls zoom={expandedZoom} onZoomChange={setExpandedZoom} label="拡大プレビュー" />
        <button type="button" aria-label="拡大プレビューを閉じる" onClick={() => setExpandedOpen(false)}>×</button>
      </header>
      <div className="organize-lightbox-stage">
        <OrganizePagePreview card={focusedCard} pageSize={focusedPageSize} targetDocId={props.docId} scheduler={props.scheduler}
          annotationStore={props.annotationStore} fit="contain" zoom={expandedZoom} onZoomChange={setExpandedZoom}
          onBackgroundClick={() => setExpandedOpen(false)} testId="organize-lightbox-canvas" />
      </div>
      <footer>{describePaperSize(focusedPageSize.width, focusedPageSize.height, focusedCard.rotation)}　　Ctrl＋ホイールまたは［＋］［−］で拡大</footer>
    </div>}

    {sourceDialog && <Dialog title={sourceDialog.mode === 'replace' ? 'ページを置換' : '他のPDFから挿入'} onCancel={cancelSourceDialog} testId="organize-source-dialog">
      <div className="organize-dialog-body">
        <p>選んだファイル（［↑］［↓］で挿入順を変更できます）</p>
        <ol className="organize-source-list">
          {sourceDialog.entries.map((entry, index) => <li key={entry.key} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
            onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
              event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain'))
              if (!Number.isInteger(from) || from === index) return
              setSourceDialog((current) => {
                if (!current) return current
                const entries = [...current.entries]; const [moved] = entries.splice(from, 1); entries.splice(index, 0, moved)
                return { ...current, entries }
              })
            }}>
            <span><strong>{entry.name}</strong>（<span data-testid="organize-source-page-status">{entry.status === 'loading' ? '確認中…' : entry.status === 'ready' ? `${entry.info!.pageSizes.length}ページ` : '対象外'}</span>）</span>
            <button type="button" aria-label={`${entry.name}を上へ`} disabled={index === 0} onClick={() => setSourceDialog((current) => {
              if (!current) return current; const entries = [...current.entries]; [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]]; return { ...current, entries }
            })}>↑</button>
            <button type="button" aria-label={`${entry.name}を下へ`} disabled={index === sourceDialog.entries.length - 1} onClick={() => setSourceDialog((current) => {
              if (!current) return current; const entries = [...current.entries]; [entries[index], entries[index + 1]] = [entries[index + 1], entries[index]]; return { ...current, entries }
            })}>↓</button>
            <button type="button" aria-label={`${entry.name}を外す`} onClick={() => {
              if (entry.info) props.onDiscardSources([entry.info.docId])
              else if (entry.status === 'loading') dismissedSourceKeysRef.current.add(entry.key)
              setSourceDialog((current) => current ? { ...current, entries: current.entries.filter((_, itemIndex) => itemIndex !== index) } : current)
            }}>×</button>
            <label><input type="radio" name={`range-${entry.key}`} disabled={entry.status === 'error'} checked={entry.all} onChange={() => setSourceDialog((current) => current ? { ...current, entries: current.entries.map((item, itemIndex) => itemIndex === index ? { ...item, all: true } : item) } : current)} />すべて</label>
            <label><input type="radio" name={`range-${entry.key}`} disabled={entry.status === 'error'} checked={!entry.all} onChange={() => setSourceDialog((current) => current ? { ...current, entries: current.entries.map((item, itemIndex) => itemIndex === index ? { ...item, all: false } : item) } : current)} />範囲
              <input aria-label={`${entry.name}のページ範囲`} disabled={entry.status === 'error'} placeholder="例: 1-3,5" value={entry.range} onChange={(event) => {
                const range = event.target.value
                setSourceDialog((current) => current ? { ...current, entries: current.entries.map((item, itemIndex) => itemIndex === index ? { ...item, range, all: false } : item) } : current)
              }} />
            </label>
            {entry.status === 'error' && <p className="organize-dialog-error" role="alert">{entry.error}</p>}
          </li>)}
        </ol>
        <button type="button" onClick={() => void pickFiles(sourceDialog.mode, true)}>ファイルを追加</button>
        {sourceDialog.mode === 'insert' && sourceDialog.fixedIndex === null && <PositionFields position={position} setPosition={setPosition} afterPage={afterPage} setAfterPage={setAfterPage} selectedCount={selectedIds.length} />}
        {sourceDialog.fixedIndex !== null && <p>ドロップした位置へ挿入します。</p>}
        <p className="organize-note">追加したPDFのしおり・リンク・フォームは引き継がれません。</p>
        {dialogError && <p className="organize-dialog-error" role="alert">{dialogError}</p>}
      </div>
      <footer><button type="button" onClick={cancelSourceDialog}>キャンセル</button><button type="button" disabled={sourceDialog.entries.some((entry) => entry.status === 'loading') || !sourceDialog.entries.some((entry) => entry.status === 'ready')} onClick={confirmSourceDialog}>{sourceDialog.mode === 'replace' ? '置換' : '挿入'}</button></footer>
    </Dialog>}

    {blankOpen && <Dialog title="白紙のページを挿入" onCancel={() => setBlankOpen(false)} testId="organize-blank-dialog">
      <div className="organize-dialog-body organize-form-grid">
        <label>枚数<input aria-label="白紙の枚数" type="number" min={1} max={100} value={blankCount} onChange={(event) => setBlankCount(Number(event.target.value))} /></label>
        <label>大きさ<select aria-label="白紙の大きさ" value={blankSize} onChange={(event) => setBlankSize(event.target.value as typeof blankSize)}>
          <option value="same">直前のページと同じ</option><option value="a4">A4</option><option value="a3">A3</option><option value="b4">B4</option><option value="b5">B5</option>
        </select></label>
        <label>向き<select aria-label="白紙の向き" value={blankOrientation} onChange={(event) => setBlankOrientation(event.target.value as typeof blankOrientation)}>
          <option value="portrait">縦</option><option value="landscape">横</option>
        </select></label>
        <PositionFields position={position} setPosition={setPosition} afterPage={afterPage} setAfterPage={setAfterPage} selectedCount={selectedIds.length} />
        {dialogError && <p className="organize-dialog-error" role="alert">{dialogError}</p>}
      </div>
      <footer><button type="button" onClick={() => setBlankOpen(false)}>キャンセル</button><button type="button" onClick={confirmBlank}>挿入</button></footer>
    </Dialog>}

    {pageSelectionOpen && <Dialog title="ページ番号で選ぶ" onCancel={() => setPageSelectionOpen(false)} testId="organize-page-selection-dialog">
      <div className="organize-dialog-body"><label>ページ番号<input autoFocus aria-label="選ぶページ番号" placeholder="1-3, 5, 8-10" value={pageSelectionValue} onChange={(event) => setPageSelectionValue(event.target.value)} /></label>
        {dialogError && <p className="organize-dialog-error" role="alert">{dialogError}</p>}</div>
      <footer><button type="button" onClick={() => setPageSelectionOpen(false)}>キャンセル</button><button type="button" onClick={confirmPageSelection}>選択</button></footer>
    </Dialog>}

    {extractOpen && <Dialog title="ページを抽出" onCancel={() => setExtractOpen(false)} testId="organize-extract-dialog">
      <div className="organize-dialog-body">
        <p>{selectedIds.length}ページを抽出します。</p>
        <label><input type="checkbox" checked={extractRemove} onChange={(event) => setExtractRemove(event.target.checked)} />抽出したページを元の文書から削除する</label>
        <label><input type="checkbox" checked={extractSingles} onChange={(event) => setExtractSingles(event.target.checked)} />1ページずつ別のファイルにする</label>
      </div>
      <footer><button type="button" onClick={() => setExtractOpen(false)}>キャンセル</button><button type="button" onClick={() => {
        props.onExtract(selectedIds, { removeFromDraft: extractRemove, onePerFile: extractSingles }); setExtractOpen(false)
      }}>抽出</button></footer>
    </Dialog>}

    {splitOpen && <Dialog title="ページを分割" onCancel={() => setSplitOpen(false)} testId="organize-split-dialog">
      <div className="organize-dialog-body organize-choice-list">
        {([
          ['before', '選んだ位置で区切る'], ['every', 'Nページごと'], ['single', '1ページずつ'], ['equal', 'ファイル数を指定して均等に分ける'],
        ] as const).map(([value, label]) => <label key={value}><input type="radio" name="split-kind" checked={splitKind === value} onChange={() => setSplitKind(value)} />{label}</label>)}
        {(splitKind === 'every' || splitKind === 'equal') && <label>{splitKind === 'every' ? 'ページ数' : 'ファイル数'}<input aria-label="分割する数" type="number" min={1} value={splitNumber} onChange={(event) => setSplitNumber(Number(event.target.value))} /></label>}
      </div>
      <footer><button type="button" onClick={() => setSplitOpen(false)}>キャンセル</button><button type="button" onClick={doSplit}>分割</button></footer>
    </Dialog>}
  </section>
}
