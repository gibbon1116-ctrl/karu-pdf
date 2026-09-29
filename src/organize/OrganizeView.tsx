import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { RenderScheduler } from '../client/RenderScheduler'
import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationStore } from '../editor/AnnotationStore'
import { PDF_PICKER_TYPES } from '../editor/fileAccess'
import type { PageCard } from './OrganizeDraft'
import { OrganizeDraft } from './OrganizeDraft'
import {
  insertionIndex,
  parsePageRange,
  selectionForMode,
  type InsertPosition,
  type OrganizeSplitMode,
} from './organizeUtils'

const CARD_GAP = 16
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
  onLoadFiles(files: File[]): Promise<OrganizeSourceInfo[]>
  onDiscardSources(docIds: string[]): void
  onCopy(cards: readonly PageCard[]): void
  onPaste(beforeIndex: number): PageCard[]
  onApply(): void
  onCancel(): void
  onExtract(cardIds: string[], options: ExtractOptions): void
  onSplit(mode: OrganizeSplitMode): void
}

interface SourceChoice {
  info: OrganizeSourceInfo
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

function Menu({ label, children }: { label: string; children: React.ReactNode }) {
  return <details className="organize-menu">
    <summary role="button">{label}▼</summary>
    <div className="organize-menu-items" onClick={(event) => event.currentTarget.closest('details')?.removeAttribute('open')}>{children}</div>
  </details>
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

export function OrganizeView(props: Props) {
  useSyncExternalStore(props.draft.subscribe, props.draft.getSnapshot)
  const cards = props.draft.getCards()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<string | null>(null)
  const dragIdsRef = useRef<string[]>([])
  const fileModeRef = useRef<'insert' | 'replace'>('insert')
  const fixedDropIndexRef = useRef<number | null>(null)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [viewport, setViewport] = useState({ top: 0, height: 700, width: 900 })
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [displaySize, setDisplaySize] = useState<DisplaySize>('medium')
  const [sourceDialog, setSourceDialog] = useState<SourceDialogState | null>(null)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [dialogError, setDialogError] = useState('')
  const [position, setPosition] = useState<InsertPosition>('after')
  const [afterPage, setAfterPage] = useState(1)
  const [blankOpen, setBlankOpen] = useState(false)
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
  }, [props.draft.getSnapshot()])

  const choose = (card: PageCard, event: React.MouseEvent) => {
    const index = cards.findIndex((item) => item.id === card.id)
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

  const currentInsertionIndex = () => insertionIndex(position, cards, selectedIds, afterPage)

  const loadFiles = async (files: File[], mode: 'insert' | 'replace', fixedIndex: number | null, append = false) => {
    const pdfs = files.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    if (pdfs.length === 0) return
    setSourceLoading(true)
    setDialogError('')
    try {
      const infos = await props.onLoadFiles(pdfs)
      const choices = infos.map((info) => ({ info, range: '', all: true }))
      setSourceDialog((current) => ({
        mode,
        fixedIndex,
        entries: append && current ? [...current.entries, ...choices] : choices,
      }))
      setPosition(mode === 'replace' ? 'after' : 'after')
      setAfterPage(Math.max(0, cards.length))
    } catch (reason) {
      setDialogError(reason instanceof Error ? reason.message : String(reason))
    } finally { setSourceLoading(false) }
  }

  const pickFiles = async (mode: 'insert' | 'replace', append = false) => {
    fileModeRef.current = mode
    fixedDropIndexRef.current = null
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({ id: `karu-pdf-organize-${mode}`, multiple: mode === 'insert', types: PDF_PICKER_TYPES })
        await loadFiles(await Promise.all(handles.map((handle) => handle.getFile())), mode, null, append)
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) setDialogError(reason instanceof Error ? reason.message : String(reason))
      }
      return
    }
    document.querySelector<HTMLInputElement>('[data-testid="organize-file-input"]')?.click()
  }

  const cancelSourceDialog = () => {
    if (sourceDialog) props.onDiscardSources(sourceDialog.entries.map((entry) => entry.info.docId))
    setSourceDialog(null)
    setDialogError('')
  }

  const confirmSourceDialog = () => {
    if (!sourceDialog) return
    const pageCards: PageCard[] = []
    for (const entry of sourceDialog.entries) {
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
    if (sourceDialog.mode === 'replace') {
      if (selectedIds.length === 0) { setDialogError('置き換えるページを選んでください。'); return }
      if (selectedIds.length !== pageCards.length && !window.confirm(`選んだ ${selectedIds.length} ページを、${pageCards.length} ページで置き換えます。`)) return
      const inserted = props.draft.replace(selectedIds, pageCards)
      setSelection(new Set(inserted.map((card) => card.id)))
    } else {
      const at = sourceDialog.fixedIndex ?? currentInsertionIndex()
      const inserted = props.draft.paste(at, pageCards)
      setSelection(new Set(inserted.map((card) => card.id)))
    }
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
    setBlankOpen(false)
    setDialogError('')
  }

  const paste = () => {
    try {
      const inserted = props.onPaste(insertionIndex('after', cards, selectedIds, cards.length))
      setSelection(new Set(inserted.map((card) => card.id)))
      setDialogError('')
    } catch (reason) { setDialogError(reason instanceof Error ? reason.message : String(reason)) }
  }

  const openPageSelection = () => { setPageSelectionValue(''); setDialogError(''); setPageSelectionOpen(true) }
  const confirmPageSelection = () => {
    const parsed = parsePageRange(pageSelectionValue, cards.length)
    if (parsed.error) { setDialogError(parsed.error); return }
    setSelection(new Set(parsed.pages.map((index) => cards[index].id)))
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
      <Menu label="挿入">
        <button type="button" title="複数のPDFをまとめて選べます" disabled={props.busy || sourceLoading} onClick={() => void pickFiles('insert')}>他のPDFから（複数選択可）</button>
        <button type="button" disabled={props.busy} onClick={() => { setPosition('after'); setBlankOpen(true); setDialogError('') }}>白紙のページ</button>
        <button type="button" disabled={props.busy} onClick={paste}>クリップボードのページを貼り付け</button>
      </Menu>
      <Menu label="回転">
        <button type="button" disabled={props.busy || selectedIds.length === 0} onClick={() => props.draft.rotate(selectedIds, -90)}>左に90°</button>
        <button type="button" disabled={props.busy || selectedIds.length === 0} onClick={() => props.draft.rotate(selectedIds, 90)}>右に90°</button>
        <button type="button" disabled={props.busy || selectedIds.length === 0} onClick={() => props.draft.rotate(selectedIds, 180)}>180°</button>
      </Menu>
      <button type="button" disabled={props.busy || selectedIds.length === 0 || selectedIds.length === cards.length} onClick={() => props.draft.delete(selectedIds)}>削除</button>
      <button type="button" disabled={props.busy || selectedIds.length === 0} onClick={() => {
        const created = props.draft.duplicate(selectedIds); setSelection(new Set(created.map((card) => card.id)))
      }}>複製</button>
      <button type="button" disabled={props.busy || selectedIds.length === 0 || sourceLoading} onClick={() => void pickFiles('replace')}>置換</button>
      <button type="button" disabled={props.busy || selectedIds.length === 0} onClick={() => { setExtractOpen(true); setDialogError('') }}>抽出</button>
      <button type="button" disabled={props.busy || cards.length < 2} onClick={() => { setSplitOpen(true); setDialogError('') }}>分割</button>
      <Menu label="並び">
        <button type="button" disabled={props.busy || cards.length < 2} onClick={() => props.draft.reverse(selectedIds)}>逆順にする</button>
      </Menu>
      <Menu label="選択">
        <button type="button" onClick={() => setSelection(new Set(selectionForMode(cards, selectedIds, 'all')))}>すべて選ぶ</button>
        <button type="button" onClick={() => setSelection(new Set(selectionForMode(cards, selectedIds, 'invert')))}>選択を反転</button>
        <button type="button" onClick={() => setSelection(new Set(selectionForMode(cards, selectedIds, 'odd')))}>奇数ページ</button>
        <button type="button" onClick={() => setSelection(new Set(selectionForMode(cards, selectedIds, 'even')))}>偶数ページ</button>
        <button type="button" onClick={openPageSelection}>ページ番号で選ぶ</button>
      </Menu>
      <label className="organize-display-size">表示の大きさ
        <select value={displaySize} onChange={(event) => setDisplaySize(event.target.value as DisplaySize)}>
          <option value="small">小</option><option value="medium">中</option><option value="large">大</option>
        </select>
      </label>
      <span className="organize-toolbar-spacer" />
      <button type="button" disabled={props.busy || !props.draft.canUndo()} onClick={() => props.draft.undo()}>元に戻す</button>
      <button type="button" disabled={props.busy || !props.draft.canRedo()} onClick={() => props.draft.redo()}>やり直す</button>
      <button type="button" disabled={props.busy || !props.draft.isChanged()} onClick={props.onApply}>適用</button>
      <button type="button" disabled={props.busy} onClick={props.onCancel}>やめる</button>
      {props.busy && <span role="status">ページを組み立てています…</span>}
    </header>
    <input hidden multiple type="file" accept="application/pdf,.pdf" data-testid="organize-file-input" onChange={(event) => {
      const files = [...(event.currentTarget.files ?? [])]
      void loadFiles(files, fileModeRef.current, fixedDropIndexRef.current)
      event.currentTarget.value = ''
    }} />
    {dialogError && !sourceDialog && !blankOpen && !pageSelectionOpen && <p className="organize-inline-error" role="alert">{dialogError}</p>}
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
        if (event.key === 'Escape') { event.preventDefault(); props.onCancel() }
      }}
      onDragOver={(event) => { event.preventDefault(); if (dropIndex === null) setDropIndex(cards.length) }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null) }}
      onDrop={(event) => {
        event.preventDefault()
        const at = dropIndex ?? cards.length
        if (event.dataTransfer.files.length > 0) void loadFiles([...event.dataTransfer.files], 'insert', at)
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
            className={`organize-card${selection.has(card.id) ? ' selected' : ''}`}
            style={{
              left: CARD_GAP + column * (metrics.cardWidth + CARD_GAP), top: CARD_GAP + row * metrics.rowHeight,
              width: metrics.cardWidth, height: metrics.rowHeight - CARD_GAP,
              gridTemplateRows: `${metrics.stageHeight}px 24px`,
            }}
            onClick={(event) => choose(card, event)}
            onDragStart={(event) => {
              const ids = selection.has(card.id) ? selectedIds : [card.id]
              if (!selection.has(card.id)) setSelection(new Set(ids))
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
    <footer className="organize-footer">選択: {selectedIds.length}ページ ／ 全{cards.length}ページ（下書き）</footer>

    {sourceDialog && <Dialog title={sourceDialog.mode === 'replace' ? 'ページを置換' : '他のPDFから挿入'} onCancel={cancelSourceDialog} testId="organize-source-dialog">
      <div className="organize-dialog-body">
        <p>選んだファイル（［↑］［↓］で挿入順を変更できます）</p>
        <ol className="organize-source-list">
          {sourceDialog.entries.map((entry, index) => <li key={entry.info.docId} draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', String(index))}
            onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
              event.preventDefault(); const from = Number(event.dataTransfer.getData('text/plain'))
              if (!Number.isInteger(from) || from === index) return
              setSourceDialog((current) => {
                if (!current) return current
                const entries = [...current.entries]; const [moved] = entries.splice(from, 1); entries.splice(index, 0, moved)
                return { ...current, entries }
              })
            }}>
            <span><strong>{entry.info.name}</strong>（{entry.info.pageSizes.length}ページ）</span>
            <button type="button" aria-label={`${entry.info.name}を上へ`} disabled={index === 0} onClick={() => setSourceDialog((current) => {
              if (!current) return current; const entries = [...current.entries]; [entries[index - 1], entries[index]] = [entries[index], entries[index - 1]]; return { ...current, entries }
            })}>↑</button>
            <button type="button" aria-label={`${entry.info.name}を下へ`} disabled={index === sourceDialog.entries.length - 1} onClick={() => setSourceDialog((current) => {
              if (!current) return current; const entries = [...current.entries]; [entries[index], entries[index + 1]] = [entries[index + 1], entries[index]]; return { ...current, entries }
            })}>↓</button>
            <button type="button" aria-label={`${entry.info.name}を外す`} onClick={() => {
              props.onDiscardSources([entry.info.docId])
              setSourceDialog((current) => current ? { ...current, entries: current.entries.filter((_, itemIndex) => itemIndex !== index) } : current)
            }}>×</button>
            <label><input type="radio" name={`range-${entry.info.docId}`} checked={entry.all} onChange={() => setSourceDialog((current) => current ? { ...current, entries: current.entries.map((item, itemIndex) => itemIndex === index ? { ...item, all: true } : item) } : current)} />すべて</label>
            <label><input type="radio" name={`range-${entry.info.docId}`} checked={!entry.all} onChange={() => setSourceDialog((current) => current ? { ...current, entries: current.entries.map((item, itemIndex) => itemIndex === index ? { ...item, all: false } : item) } : current)} />範囲
              <input aria-label={`${entry.info.name}のページ範囲`} placeholder="例: 1-3,5" value={entry.range} onChange={(event) => {
                const range = event.target.value
                setSourceDialog((current) => current ? { ...current, entries: current.entries.map((item, itemIndex) => itemIndex === index ? { ...item, range, all: false } : item) } : current)
              }} />
            </label>
          </li>)}
        </ol>
        <button type="button" disabled={sourceLoading} onClick={() => void pickFiles(sourceDialog.mode, true)}>ファイルを追加</button>
        {sourceDialog.mode === 'insert' && sourceDialog.fixedIndex === null && <PositionFields position={position} setPosition={setPosition} afterPage={afterPage} setAfterPage={setAfterPage} selectedCount={selectedIds.length} />}
        {sourceDialog.fixedIndex !== null && <p>ドロップした位置へ挿入します。</p>}
        <p className="organize-note">追加したPDFのしおり・リンク・フォームは引き継がれません。</p>
        {dialogError && <p className="organize-dialog-error" role="alert">{dialogError}</p>}
      </div>
      <footer><button type="button" onClick={cancelSourceDialog}>キャンセル</button><button type="button" disabled={sourceDialog.entries.length === 0} onClick={confirmSourceDialog}>{sourceDialog.mode === 'replace' ? '置換' : '挿入'}</button></footer>
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
