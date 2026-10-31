import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { findOutlineItem, flattenOutline, isOutlineDescendant, outlinePageLabel, type OutlineInsertPosition, type OutlineItem, type OutlineTarget, type OutlineView } from '../core/outlineModel'
import { OutlineDraft } from './OutlineDraft'
import type { DocumentSession } from './documentModel'
import './OutlinePanel.css'

interface Props {
  session: DocumentSession
  pool: PdfWorkerPool
  onOutlineNavigate(pageIndex: number, view: OutlineView | null): void
  getOutlineViewPoint(): { pageIndex: number; x: number; y: number } | null
  outlineOperation?: 'applying' | 'saving'
  onApplyOutline(): Promise<boolean>
  onOutlineChange(): void
  onOpenDrawingOutline?(): void
  onOpenTocOutline?(): void
}
interface PanelMemory { expanded: Set<string>; selectedId: string | null; scrollTop: number }
const memories = new WeakMap<DocumentSession, PanelMemory>()
const rememberedDrafts = new WeakSet<OutlineDraft>()
function panelMemory(session: DocumentSession, draft: OutlineDraft): PanelMemory {
  let memory = memories.get(session)
  if (!memory) {
    memory = { expanded: new Set(flattenOutline(draft.getItems() as OutlineItem[]).filter(({ item }) => item.open).map(({ item }) => item.id)), selectedId: null, scrollTop: 0 }
    memories.set(session, memory)
  }
  if (!rememberedDrafts.has(draft)) {
    rememberedDrafts.add(draft)
    const state = memory
    let previousItems = draft.getItems() as OutlineItem[], revision = draft.base.revision
    // Keep the ids in sync even if saving applies the draft while another tab is showing.
    // This subscription lives with the draft; neither weak collection retains a closed session.
    draft.subscribe(() => {
      const items = draft.getItems() as OutlineItem[]
      if (revision !== draft.base.revision) {
        const before = flattenOutline(previousItems), after = flattenOutline(items)
        const ids = new Map(before.map(({ item }, index) => [item.id, after[index]?.item.id]))
        state.selectedId = state.selectedId ? ids.get(state.selectedId) ?? null : null
        state.expanded = new Set([...state.expanded].map(id => ids.get(id)).filter((id): id is string => !!id))
      }
      previousItems = items; revision = draft.base.revision
    })
  }
  return memory
}
const ROW_HEIGHT = 26
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

function targetDescription(target: OutlineTarget): string {
  if (target.kind === 'external') return `外部リンク: ${target.uri}（かるPDFからは開きません）`
  if (target.kind === 'special') return `特殊な移動先（${target.action}）。この移動先は変更しません。`
  if (target.kind === 'broken') return `移動先が不明: ${target.reason}`
  if (target.kind === 'none') return '移動先なし'
  if (target.source === 'named') return `名前付きの移動先: ${target.name ?? ''}`
  const type = target.view?.type
  return !type || type === 'Fit' || type === 'FitB' ? 'ページ全体'
    : type === 'FitH' || type === 'FitBH' ? '幅に合わせる'
      : type === 'XYZ' ? '位置を指定' : type === 'FitR' ? '範囲を指定' : '高さに合わせる'
}

export default function OutlinePanel(props: Props) {
  const { session, pool } = props
  const [retry, setRetry] = useState(0)
  const [, redraw] = useState(0)
  const [error, setError] = useState('')
  const revision = session.pageRevision
  useEffect(() => {
    if (session.outlineDraft) return
    let alive = true
    setError('')
    void pool.getOutline(session.docId).then(snapshot => {
      if (!alive || !pool.hasDocument(session.docId) || session.pageRevision !== revision) return
      if (session.outlineDraft === null) session.outlineDraft = new OutlineDraft(snapshot)
      redraw(value => value + 1)
    }).catch(reason => { if (alive && session.pageRevision === revision) setError(message(reason)) })
    return () => { alive = false }
  }, [session, pool, revision, retry])
  if (!session.outlineDraft) return <div className="side-panel-message">
    {error ? <><p role="alert">目次を読み込めませんでした: {error}</p><button onClick={() => setRetry(value => value + 1)}>再試行</button></>
      : <p>目次を読み込んでいます…</p>}
  </div>
  return <OutlineEditor key={revision} {...props} draft={session.outlineDraft} />
}

type DropMarker = { id: string; side: 'before' | 'after' | 'child'; depth: number; invalid: boolean }
interface RowProps {
  item: OutlineItem; depth: number; expanded: boolean; selected: boolean; disabled: boolean
  marker: DropMarker | null
  onSelect(id: string, navigate?: boolean): void
  onToggle(id: string): void
  onRename(): void
  onDragStart(event: DragEvent, id: string): void
  onDragOver(event: DragEvent, id: string): void
  onDrop(event: DragEvent, id: string): void
  onDragEnd(): void
}
const OutlineRow = memo(function OutlineRow(props: RowProps) {
  const { item, depth, marker } = props
  const color = item.style.color
  const readableColor = color && color.every(Number.isFinite) && .2126 * color[0] + .7152 * color[1] + .0722 * color[2] < .75
    ? `rgb(${color.map(value => Math.round(Math.max(0, Math.min(1, value)) * 255)).join(',')})` : undefined
  return <div role="treeitem" aria-level={depth + 1} aria-expanded={item.children.length ? props.expanded : undefined}
    aria-selected={props.selected} data-outline-id={item.id} tabIndex={-1}
    className={`outline-row${props.selected ? ' selected' : ''}${marker?.invalid ? ' drop-invalid' : ''}`}
    style={{ paddingLeft: Math.min(depth, 12) * 12 + 4 }} draggable={!props.disabled}
    onClick={() => props.onSelect(item.id, true)} onDoubleClick={props.onRename}
    onDragStart={event => props.onDragStart(event, item.id)} onDragOver={event => props.onDragOver(event, item.id)}
    onDrop={event => props.onDrop(event, item.id)} onDragEnd={props.onDragEnd}>
    {marker && !marker.invalid && <span className={`outline-drop-line ${marker.side}`} style={{ left: Math.min(marker.depth, 12) * 12 + 4 }} />}
    {item.children.length ? <button type="button" className="outline-toggle" aria-label={`${item.title}を${props.expanded ? '閉じる' : '開く'}`}
      onClick={event => { event.stopPropagation(); props.onToggle(item.id) }}>{props.expanded ? '▾' : '▸'}</button> : <span className="outline-toggle" />}
    <span className="outline-title" title={`${item.title} — ${item.target.kind === 'page' ? `p.${outlinePageLabel(item.target)} ` : ''}${targetDescription(item.target)}`}
      style={{ fontWeight: item.style.bold ? 700 : undefined, fontStyle: item.style.italic ? 'italic' : undefined, color: readableColor }}>{item.title}</span>
    <span className="outline-page-label">{item.target.kind === 'page' ? `p.${outlinePageLabel(item.target)}` : outlinePageLabel(item.target)}</span>
  </div>
})

function DeleteDialog({ onDelete, onClose, disabled }: { onDelete(mode: 'withChildren' | 'keepChildren'): void; onClose(): void; disabled: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])
  return <dialog ref={ref} className="outline-delete-dialog" aria-label="目次の削除" onCancel={event => { event.preventDefault(); onClose() }}>
    <p>この目次には子項目があります。削除する方法を選んでください。</p>
    <button disabled={disabled} onClick={() => onDelete('withChildren')}>子項目も含めて削除</button>
    <button disabled={disabled} onClick={() => onDelete('keepChildren')}>子項目を残して削除（上の階層へ移す）</button>
    <button onClick={onClose}>キャンセル</button>
  </dialog>
}

function OutlineEditor(props: Props & { draft: OutlineDraft }) {
  const { draft, session, pool, onOutlineChange, onOutlineNavigate } = props
  const version = useSyncExternalStore(draft.subscribe, draft.getSnapshot)
  const [memory] = useState(() => panelMemory(session, draft))
  const [, redraw] = useState(0)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [pageNumber, setPageNumber] = useState('1')
  const [addPage, setAddPage] = useState('1')
  const [focusName, setFocusName] = useState(0)
  const [height, setHeight] = useState(300)
  const [scrollTop, setScrollTop] = useState(memory.scrollTop)
  const [marker, setMarker] = useState<DropMarker | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const dragging = useRef<string | null>(null)
  const alive = useRef(true)
  const pointSequence = useRef(0)
  const items = draft.getItems() as OutlineItem[]
  const selected = memory.selectedId ? findOutlineItem(items, memory.selectedId)?.item ?? null : null
  const applying = busy || props.outlineOperation === 'applying'
  const disabled = busy || !!props.outlineOperation || !draft.base.editable || !!session.editRestriction
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const rows: Array<{ item: OutlineItem; depth: number }> = []
  const visit = (list: OutlineItem[], depth: number) => {
    for (const item of list) { rows.push({ item, depth }); if (memory.expanded.has(item.id)) visit(item.children, depth + 1) }
  }
  visit(items, 0)
  // The App only shows whether a draft is pending, so re-render it only when that flips.
  useEffect(() => {
    let pending = draft.isChanged()
    return draft.subscribe(() => { if (draft.isChanged() !== pending) { pending = !pending; onOutlineChange() } })
  }, [draft, onOutlineChange])
  useEffect(() => { alive.current = true; return () => { alive.current = false; pointSequence.current++ } }, [])
  useEffect(() => { pointSequence.current++ }, [selected?.id, version])
  useEffect(() => { setName(selected?.title ?? ''); setPageNumber(String(selected?.target.kind === 'page' ? selected.target.pageIndex + 1 : session.view.page)) }, [selected?.id, selected?.title, selected?.target, session])
  useLayoutEffect(() => {
    const element = treeRef.current
    if (!element) return
    element.scrollTop = memory.scrollTop
    const observer = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.observe(element)
    setHeight(element.clientHeight)
    return () => observer.disconnect()
  }, [memory])
  useEffect(() => {
    if (!focusName) return
    const frame = requestAnimationFrame(() => { nameRef.current?.focus(); nameRef.current?.select() })
    return () => cancelAnimationFrame(frame)
  }, [focusName])
  const run = (action: () => void) => {
    if (disabled || busyRef.current) return
    try { action(); setError('') } catch (reason) { setError(message(reason)) }
  }
  const select = useCallback((id: string, navigate = false) => {
    memory.selectedId = id
    redraw(value => value + 1)
    if (navigate) {
      const item = findOutlineItem(draft.getItems() as OutlineItem[], id)?.item
      if (item?.target.kind === 'page') onOutlineNavigate(item.target.pageIndex, item.target.view)
    }
  }, [draft, memory, onOutlineNavigate])
  const toggle = useCallback((id: string) => {
    if (memory.expanded.has(id)) memory.expanded.delete(id); else memory.expanded.add(id)
    redraw(value => value + 1)
  }, [memory])
  const renameFocus = useCallback(() => setFocusName(value => value + 1), [])
  const add = (position: OutlineInsertPosition, pageIndex = session.view.page - 1) => run(() => {
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= session.pageSizes.length) throw new Error('存在するページ番号を入力してください。')
    const id = draft.add(position, { target: { kind: 'page', pageIndex, view: null, source: 'dest' } })
    if (position.kind === 'child') memory.expanded.add(position.id)
    select(id); renameFocus()
  })
  const requestDelete = () => {
    if (!selected || disabled) return
    if (selected.children.length) setDeleteId(selected.id)
    else run(() => draft.remove(selected.id, 'withChildren'))
  }
  const commitName = () => {
    if (!selected || disabled || name === selected.title) return
    try { draft.rename(selected.id, name); setName(findOutlineItem(draft.getItems() as OutlineItem[], selected.id)!.item.title); setError('') }
    catch (reason) { setName(selected.title); setError(message(reason)) }
  }
  const setPageTarget = (pageIndex: number, replaceLocked = false) => run(() => {
    if (!selected) return
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= session.pageSizes.length) throw new Error('存在するページ番号を入力してください。')
    draft.setTarget(selected.id, { kind: 'page', pageIndex, view: selected.target.kind === 'page' ? selected.target.view : null, source: 'dest' }, { replaceLocked })
  })
  const setCurrentPosition = async () => {
    if (!selected || disabled || busyRef.current) return
    const point = props.getOutlineViewPoint()
    if (!point) { setError('表示位置を取得できませんでした。'); return }
    const sequence = ++pointSequence.current, currentVersion = draft.getSnapshot(), revision = session.pageRevision
    try {
      const pdf = await pool.outlinePagePoint(session.docId, point.pageIndex, point.x, point.y, true)
      if (!alive.current || sequence !== pointSequence.current || disabledRef.current || currentVersion !== draft.getSnapshot()
        || session.outlineDraft !== draft || session.pageRevision !== revision || !pool.hasDocument(session.docId)) return
      draft.setTarget(selected.id, { kind: 'page', pageIndex: point.pageIndex, view: { type: 'XYZ', params: [pdf.x, pdf.y, null] }, source: 'dest' })
      setError('')
    } catch (reason) { if (alive.current && sequence === pointSequence.current) setError(message(reason)) }
  }
  const apply = async () => {
    if (disabled || busyRef.current) return
    busyRef.current = true; pointSequence.current++; setBusy(true)
    try { await props.onApplyOutline() } catch (reason) { if (alive.current) setError(message(reason)) }
    finally { busyRef.current = false; if (alive.current) setBusy(false) }
  }
  const dropLocation = useCallback((event: DragEvent, id: string): DropMarker => {
    const found = findOutlineItem(draft.getItems() as OutlineItem[], id)!
    const box = event.currentTarget.getBoundingClientRect(), fraction = (event.clientY - box.top) / box.height
    const side = fraction < .25 ? 'before' : fraction > .75 ? 'after' : 'child'
    return { id, side, depth: found.depth + (side === 'child' ? 1 : 0),
      invalid: !dragging.current || isOutlineDescendant(draft.getItems() as OutlineItem[], dragging.current, id) }
  }, [draft])
  const dragStart = useCallback((event: DragEvent, id: string) => {
    if (disabled || busyRef.current) { event.preventDefault(); return }
    dragging.current = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-karu-outline', id)
  }, [disabled])
  const dragOver = useCallback((event: DragEvent, id: string) => {
    if (!dragging.current || disabled) return
    event.preventDefault(); event.stopPropagation()
    const next = dropLocation(event, id)
    event.dataTransfer.dropEffect = next.invalid ? 'none' : 'move'
    setMarker(current => current?.id === next.id && current.side === next.side && current.invalid === next.invalid ? current : next)
  }, [disabled, dropLocation])
  const dragEnd = useCallback(() => { dragging.current = null; setMarker(null) }, [])
  const drop = useCallback((event: DragEvent, id: string) => {
    event.preventDefault(); event.stopPropagation()
    const location = dropLocation(event, id), sourceId = dragging.current
    dragEnd()
    if (!sourceId || location.invalid || disabled || busyRef.current) return
    const list = draft.getItems() as OutlineItem[], target = findOutlineItem(list, id)!, source = findOutlineItem(list, sourceId)!
    const parentId = location.side === 'child' ? id : target.parent?.id ?? null
    let index = location.side === 'child' ? target.item.children.length : target.index + (location.side === 'after' ? 1 : 0)
    if ((source.parent?.id ?? null) === parentId && source.index < index) index--
    try { draft.move(sourceId, { parentId, index }); if (location.side === 'child') memory.expanded.add(id); setError('') }
    catch (reason) { setError(message(reason)) }
  }, [disabled, draft, dropLocation, dragEnd, memory])
  const keyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('dialog')) { event.stopPropagation(); return }
    if (event.nativeEvent.isComposing || (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return
    const key = event.key.toLowerCase(), control = event.ctrlKey || event.metaKey
    let action: (() => void) | undefined
    if (control && (key === 'y' || key === 'z' && event.shiftKey)) action = () => run(() => draft.redo())
    else if (control && key === 'z') action = () => run(() => draft.undo())
    else if (!control && !event.altKey) {
      if (key === 'delete') action = requestDelete
      else if (key === 'f2') action = () => { if (!disabled) renameFocus() }
      else if (key === 'enter') action = () => { if (selected) select(selected.id, true) }
      else if (key === 'arrowleft' || key === 'arrowright') action = () => {
        if (selected) { if (key === 'arrowleft') memory.expanded.delete(selected.id); else memory.expanded.add(selected.id); redraw(value => value + 1) }
      }
      else if (key === 'arrowup' || key === 'arrowdown') action = () => {
        const index = rows.findIndex(({ item }) => item.id === selected?.id)
        const nextIndex = index < 0 ? 0 : Math.max(0, Math.min(rows.length - 1, index + (key === 'arrowup' ? -1 : 1)))
        const next = rows[nextIndex]
        if (!next) return
        select(next.item.id)
        const element = treeRef.current
        if (element) {
          if (nextIndex * ROW_HEIGHT < element.scrollTop) element.scrollTop = nextIndex * ROW_HEIGHT
          else if ((nextIndex + 1) * ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = (nextIndex + 1) * ROW_HEIGHT - element.clientHeight
        }
      }
    }
    if (action) { event.preventDefault(); event.stopPropagation(); action() }
  }
  const button = (label: string, text: string, action: () => void, unavailable = false) => <button type="button" title={label} aria-label={label} disabled={disabled || unavailable} onClick={action}>{text}</button>
  const start = rows.length > 200 ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 30) : 0
  const end = rows.length > 200 ? Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 30) : rows.length
  const locked = selected?.target.kind === 'external' || selected?.target.kind === 'special'
  return <section className="outline-panel" data-testid="outline-panel" aria-label="目次の編集" aria-busy={applying} onKeyDown={keyDown}>
    <div className="outline-toolbar">
      {button('追加', '＋追加', () => add(selected ? { kind: 'after', id: selected.id } : { kind: 'end' }))}
      <details className="outline-add-menu"><summary>追加の方法▼</summary><div>
        {(['before', 'after', 'child', 'end'] as const).map((kind, index) => <button key={kind} disabled={disabled || kind !== 'end' && !selected}
          onClick={event => { add(kind === 'end' ? { kind } : { kind, id: selected!.id }); event.currentTarget.closest('details')?.removeAttribute('open') }}>{['前に追加', '後に追加', '子として追加', '末尾に追加'][index]}</button>)}
        <label>追加するページ番号<input type="number" min={1} max={session.pageSizes.length} value={addPage} disabled={disabled} onChange={event => setAddPage(event.target.value)} onKeyDown={event => {
          if (event.nativeEvent.isComposing || !['Enter', 'Escape'].includes(event.key)) return
          event.preventDefault(); event.stopPropagation()
          if (event.key === 'Enter') add({ kind: 'end' }, addPage.trim() ? Number(addPage) - 1 : -1)
          else { setAddPage('1'); event.currentTarget.closest('details')?.removeAttribute('open') }
        }} /></label>
        <button disabled={disabled} onClick={() => add({ kind: 'end' }, addPage.trim() ? Number(addPage) - 1 : -1)}>ページ番号を指定して追加</button>
      </div></details>
      {button('名称変更', '名称変更', renameFocus, !selected)}
      {button('削除', '削除', requestDelete, !selected)}
      {button('上へ移動', '↑', () => run(() => { if (selected) draft.moveUp(selected.id) }), !selected)}
      {button('下へ移動', '↓', () => run(() => { if (selected) draft.moveDown(selected.id) }), !selected)}
      {button('階層を上げる', '←階層', () => run(() => { if (selected) draft.outdent(selected.id) }), !selected)}
      {button('階層を下げる', '階層→', () => run(() => {
        if (selected) { draft.indent(selected.id); const parent = findOutlineItem(draft.getItems() as OutlineItem[], selected.id)?.parent; if (parent) memory.expanded.add(parent.id) }
      }), !selected)}
      {button('目次の操作を元に戻す', '↶ 戻す', () => run(() => draft.undo()), !draft.canUndo())}
      {button('目次の操作をやり直す', '↷ やり直し', () => run(() => draft.redo()), !draft.canRedo())}
    </div>
    <div className="outline-tree" ref={treeRef} role="tree" aria-label="目次" tabIndex={0}
      onScroll={event => { memory.scrollTop = event.currentTarget.scrollTop; setScrollTop(memory.scrollTop) }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMarker(null) }}>
      {!rows.length ? <div className="outline-empty"><p>目次がありません</p>{button('表示中のページで目次を作成', '表示中のページで目次を作成', () => add({ kind: 'end' }))}</div>
        : <><div role="presentation" style={{ height: start * ROW_HEIGHT }} />{rows.slice(start, end).map(({ item, depth }) => <OutlineRow key={item.id}
          item={item} depth={depth} expanded={memory.expanded.has(item.id)} selected={selected?.id === item.id} disabled={disabled}
          marker={marker?.id === item.id ? marker : null} onSelect={select} onToggle={toggle} onRename={renameFocus}
          onDragStart={dragStart} onDragOver={dragOver} onDrop={drop} onDragEnd={dragEnd} />)}<div role="presentation" style={{ height: (rows.length - end) * ROW_HEIGHT }} /></>}
    </div>
    <div className="outline-editor">
      {!draft.base.editable && <p role="alert">この目次は構造に問題があるため、表示だけできます: {draft.base.problems.join('、')}</p>}
      {draft.base.editable && draft.base.problems.length > 0 && <small>{draft.base.problems.join('、')}</small>}
      {session.editRestriction && <p>編集が制限されたPDFのため、目次は表示だけできます。</p>}
      {selected && <>
        <label>名称<input ref={nameRef} value={name} disabled={disabled} onChange={event => setName(event.target.value)} onBlur={commitName}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || !['Enter', 'Escape'].includes(event.key)) return
            event.preventDefault(); event.stopPropagation()
            if (event.key === 'Enter') commitName(); else { setName(selected.title); setError('') }
          }} /></label>
        <p className="outline-target-description">{targetDescription(selected.target)}</p>
        {locked ? button('ページへの移動に置き換える', 'ページへの移動に置き換える', () => {
          if (window.confirm(selected.target.kind === 'special' ? '特殊な移動先を消して、ページへの移動に置き換えますか？' : '外部リンクを消して、ページへの移動に置き換えますか？')) setPageTarget(session.view.page - 1, true)
        }) : <>
          <label>移動先のページ番号<input type="number" min={1} max={session.pageSizes.length} value={pageNumber} disabled={disabled}
            onChange={event => setPageNumber(event.target.value)} onKeyDown={event => {
              if (event.nativeEvent.isComposing || !['Enter', 'Escape'].includes(event.key)) return
              event.preventDefault(); event.stopPropagation()
              if (event.key === 'Enter') setPageTarget(pageNumber.trim() ? Number(pageNumber) - 1 : -1)
              else setPageNumber(String(selected.target.kind === 'page' ? selected.target.pageIndex + 1 : session.view.page))
            }} /></label>
          <div className="outline-target-actions">
            {button('設定', '設定', () => setPageTarget(pageNumber.trim() ? Number(pageNumber) - 1 : -1))}
            {button('表示中のページにする', '表示中のページにする', () => setPageTarget(session.view.page - 1))}
            {button('今の表示位置にする', '今の表示位置にする', () => void setCurrentPosition())}
            <button disabled={selected.target.kind !== 'page' || applying} onClick={() => select(selected.id, true)}>この目次へ移動</button>
          </div>
        </>}
        {selected.children.length > 0 && <label className="outline-open-setting"><input type="checkbox" checked={selected.open} disabled={disabled}
          onChange={event => run(() => draft.setOpen(selected.id, event.target.checked))} />PDFを開いたときに子項目を表示する</label>}
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
    <div className="outline-footer">
      {applying ? <p role="status">目次を反映しています…</p> : draft.isChanged() && <>
        <p>未反映の変更があります</p>
        <button className="outline-primary" disabled={disabled} onClick={() => void apply()}>目次を反映</button>
        {button('変更を破棄', '変更を破棄', () => { if (window.confirm('反映していない目次の変更を破棄しますか？')) run(() => draft.discard()) })}
      </>}
      {props.onOpenDrawingOutline && button('図面情報から目次を作成', '図面情報から目次を作成', props.onOpenDrawingOutline)}
      {props.onOpenTocOutline && draft.base.editable && !session.editRestriction && button('目次ページから作成', '目次ページから作成', props.onOpenTocOutline)}
    </div>
    {deleteId && <DeleteDialog disabled={disabled} onClose={() => setDeleteId(null)} onDelete={mode => { run(() => draft.remove(deleteId, mode)); setDeleteId(null) }} />}
  </section>
}
