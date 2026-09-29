import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { RenderScheduler } from '../client/RenderScheduler'
import type { PageSize } from '../core/mupdfDoc'
import type { AnnotationStore } from '../editor/AnnotationStore'
import { PDF_PICKER_TYPES } from '../editor/fileAccess'
import type { PageCard } from './OrganizeDraft'
import { OrganizeDraft } from './OrganizeDraft'

const CARD_WIDTH = 160
const CARD_GAP = 16
const ROW_HEIGHT = 230

export interface OrganizeSourceInfo {
  docId: string
  name: string
  pageSizes: PageSize[]
}

interface Props {
  docId: string
  draft: OrganizeDraft
  pageSizes: readonly PageSize[]
  sources: ReadonlyMap<string, OrganizeSourceInfo>
  scheduler: RenderScheduler
  annotationStore: AnnotationStore
  busy: boolean
  onAddFiles(files: File[], beforeIndex: number): Promise<void>
  onApply(): void
  onCancel(): void
  onExtract(cardIds: string[]): void
  onSplit(cardIds: string[]): void
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

function OrganizeThumbnail({ card, targetDocId, targetSizes, sources, scheduler, annotationStore }: {
  card: PageCard
  targetDocId: string
  targetSizes: readonly PageSize[]
  sources: ReadonlyMap<string, OrganizeSourceInfo>
  scheduler: RenderScheduler
  annotationStore: AnnotationStore
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
  const availableWidth = 136
  const availableHeight = 174
  const shownWidth = turned ? pageSize.height : pageSize.width
  const shownHeight = turned ? pageSize.width : pageSize.height
  const cssScale = Math.min(availableWidth / shownWidth, availableHeight / shownHeight)

  useEffect(() => {
    if (!page) return
    const params = {
      docId: page.docId,
      pageIndex: page.pageIndex,
      renderScale: scale,
      deviceRect: null,
      excludeAnnotObjNums: excluded,
    }
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
  return <canvas
    ref={canvasRef}
    className="organize-thumbnail"
    style={{
      width: pageSize.width * cssScale,
      height: pageSize.height * cssScale,
      transform: `rotate(${card.rotation}deg)`,
    }}
  />
}

export function OrganizeView(props: Props) {
  useSyncExternalStore(props.draft.subscribe, props.draft.getSnapshot)
  const cards = props.draft.getCards()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<string | null>(null)
  const dragIdsRef = useRef<string[]>([])
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [viewport, setViewport] = useState({ top: 0, height: 700, width: 900 })
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const columns = Math.max(1, Math.floor((viewport.width - CARD_GAP) / (CARD_WIDTH + CARD_GAP)))
  const rowCount = Math.ceil(cards.length / columns)
  const startRow = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - 2)
  const endRow = Math.min(rowCount, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + 2)
  const visible = cards.slice(startRow * columns, endRow * columns)
  const selectedIds = useMemo(() => [...selection].filter((id) => cards.some((card) => card.id === id)), [cards, selection])

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
      if (next.has(card.id)) next.delete(card.id)
      else next.add(card.id)
      setSelection(next)
    } else {
      setSelection(new Set([card.id]))
    }
  }

  const insertionAfterSelection = () => {
    if (selectedIds.length === 0) return cards.length
    return Math.max(...selectedIds.map((id) => cards.findIndex((card) => card.id === id))) + 1
  }

  const addFiles = async (files: File[], beforeIndex: number) => {
    const pdfs = files.filter((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
    if (pdfs.length > 0) await props.onAddFiles(pdfs, beforeIndex)
  }

  const pickSources = async () => {
    if (window.showOpenFilePicker) {
      const handles = await window.showOpenFilePicker({ id: 'karu-pdf-organize-add', multiple: true, types: PDF_PICKER_TYPES })
      await addFiles(await Promise.all(handles.map((handle) => handle.getFile())), insertionAfterSelection())
      return
    }
    document.querySelector<HTMLInputElement>('[data-testid="organize-file-input"]')?.click()
  }

  const insertBlank = () => {
    const at = insertionAfterSelection()
    const previous = cards[at - 1]
    const size = previous ? cardPageSize(previous, props.docId, props.pageSizes, props.sources) : { width: 595, height: 842 }
    const created = props.draft.insertBlank(at, size.width, size.height)
    setSelection(new Set([created.id]))
  }

  return <section className="organize-view" data-testid="organize-view">
    <header className="organize-toolbar">
      <strong>ページ整理</strong>
      <button type="button" disabled={props.busy || selectedIds.length === 0} onClick={() => props.draft.rotate(selectedIds, -90)}>左に回転</button>
      <button type="button" disabled={props.busy || selectedIds.length === 0} onClick={() => props.draft.rotate(selectedIds, 90)}>右に回転</button>
      <button type="button" disabled={props.busy || selectedIds.length === 0 || selectedIds.length === cards.length} onClick={() => props.draft.delete(selectedIds)}>削除</button>
      <button type="button" disabled={props.busy} onClick={insertBlank}>白紙を挿入</button>
      <button
        type="button"
        disabled={props.busy}
        title="追加したPDFのしおり・リンク・フォームは引き継がれません。"
        onClick={() => void pickSources()}
      >他のPDFを追加</button>
      <button type="button" disabled={props.busy || selectedIds.length === 0} onClick={() => props.onExtract(selectedIds)}>抽出</button>
      <button type="button" disabled={props.busy || cards.length < 2} onClick={() => props.onSplit(selectedIds)}>分割</button>
      <span className="toolbar-separator" />
      <button type="button" disabled={props.busy || !props.draft.canUndo()} onClick={() => props.draft.undo()}>元に戻す</button>
      <button type="button" disabled={props.busy || !props.draft.canRedo()} onClick={() => props.draft.redo()}>やり直し</button>
      <span className="toolbar-separator" />
      <button type="button" disabled={props.busy || !props.draft.isChanged()} onClick={props.onApply}>適用</button>
      <button type="button" disabled={props.busy} onClick={props.onCancel}>やめる</button>
      {props.busy && <span role="status">ページを組み立てています…</span>}
    </header>
    <input
      hidden multiple type="file" accept="application/pdf,.pdf" data-testid="organize-file-input"
      onChange={(event) => {
        const files = [...(event.currentTarget.files ?? [])]
        void addFiles(files, insertionAfterSelection())
        event.currentTarget.value = ''
      }}
    />
    <div
      ref={scrollerRef}
      className="organize-grid-scroller"
      tabIndex={0}
      onScroll={(event) => {
        // currentTarget はイベントの処理が終わると null になる。更新関数は後で
        // 実行されることがあるため、値はここで読んでおく。
        const { scrollTop, clientHeight } = event.currentTarget
        setViewport((current) => ({ ...current, top: scrollTop, height: clientHeight }))
      }}
      onKeyDown={(event) => {
        const key = event.key.toLowerCase()
        if ((event.ctrlKey || event.metaKey) && key === 'a') { event.preventDefault(); setSelection(new Set(cards.map((card) => card.id))); return }
        if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
          event.preventDefault()
          if (key === 'y' || event.shiftKey) props.draft.redo(); else props.draft.undo()
          return
        }
        if (event.key === 'Delete' && selectedIds.length > 0 && selectedIds.length < cards.length) { event.preventDefault(); props.draft.delete(selectedIds); return }
        if (event.key === 'Escape') { event.preventDefault(); props.onCancel() }
      }}
      onDragOver={(event) => { event.preventDefault(); if (dropIndex === null) setDropIndex(cards.length) }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null) }}
      onDrop={(event) => {
        event.preventDefault()
        const at = dropIndex ?? cards.length
        if (event.dataTransfer.files.length > 0) void addFiles([...event.dataTransfer.files], at)
        else if (dragIdsRef.current.length > 0) props.draft.move(dragIdsRef.current, at)
        dragIdsRef.current = []
        setDropIndex(null)
      }}
    >
      <div className="organize-grid" style={{ height: rowCount * ROW_HEIGHT + CARD_GAP }}>
        {visible.map((card) => {
          const index = cards.findIndex((item) => item.id === card.id)
          const row = Math.floor(index / columns)
          const column = index % columns
          return <button
            type="button"
            key={card.id}
            draggable={!props.busy}
            data-testid={`organize-card-${index}`}
            className={`organize-card${selection.has(card.id) ? ' selected' : ''}`}
            style={{ left: CARD_GAP + column * (CARD_WIDTH + CARD_GAP), top: CARD_GAP + row * ROW_HEIGHT }}
            onClick={(event) => choose(card, event)}
            onDragStart={(event) => {
              const ids = selection.has(card.id) ? selectedIds : [card.id]
              if (!selection.has(card.id)) setSelection(new Set(ids))
              dragIdsRef.current = ids
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('application/x-karu-pages', ids.join(','))
            }}
            onDragOver={(event) => {
              event.preventDefault()
              const box = event.currentTarget.getBoundingClientRect()
              setDropIndex(index + (event.clientX > box.left + box.width / 2 ? 1 : 0))
            }}
          >
            {dropIndex === index && <span className="organize-drop-marker" />}
            <span className="organize-thumbnail-stage">
              <OrganizeThumbnail
                card={card}
                targetDocId={props.docId}
                targetSizes={props.pageSizes}
                sources={props.sources}
                scheduler={props.scheduler}
                annotationStore={props.annotationStore}
              />
            </span>
            <span>{cardLabel(card, index, props.docId, props.sources)}</span>
          </button>
        })}
        {dropIndex === cards.length && <span className="organize-drop-marker end" style={{ top: CARD_GAP + Math.max(0, rowCount - 1) * ROW_HEIGHT, left: CARD_GAP + (cards.length % columns) * (CARD_WIDTH + CARD_GAP) - 8 }} />}
      </div>
    </div>
  </section>
}
