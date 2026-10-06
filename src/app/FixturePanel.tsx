import { LocationInput } from './LocationInput'
import { lazy, Suspense, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { fixtureCode, nextCountStyle, quantityKind, QUANTITY_UNITS, type FixturePreset, type CountFixture } from '../core/countFixtures'
import { CountMarker, QuantitySwatch } from '../editor/countMarkers'
import { ensureSessionFixtures, FixtureUiContext, type DocumentSession } from './documentModel'
import QuantityBreakdown from './QuantityBreakdown'
import { floorFromDrawingName } from '../core/location'
import { annotationFilterLabel } from '../editor/annotationFilter'
import { groupFixtures, moveCategory, moveFixture, stepFixture } from './fixtureOrder'
const QuantityCsvExportDialog = lazy(() => import('./CsvExportDialog').then(m => ({ default: m.QuantityCsvExportDialog })))
const FixtureDialog = lazy(() => import('./FixtureDialog'))
const FixturePresetDialog = lazy(() => import('./FixturePresetDialog'))

export default function FixturePanel({ session, pool }: { session: DocumentSession; pool: PdfWorkerPool }) {
  const store = session.annotationStore, ui = useContext(FixtureUiContext)
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [breakdownId, setBreakdownId] = useState<string | null>(null), [csvOpen, setCsvOpen] = useState(false)
  const closeBreakdown = useRef(() => setBreakdownId(null)).current
  const [search, setSearch] = useState(''), [collapsed, setCollapsed] = useState(new Set<string>()), [error, setError] = useState('')
  const [dialog, setDialog] = useState<{ initial: CountFixture; editing: boolean; duplicate?: boolean } | null>(null)
  const dragging = useRef<{ kind: 'fixture' | 'category'; id: string } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ kind: 'fixture' | 'category'; id: string; side: 'before' | 'after' | 'inside' } | null>(null)
  const [status, setStatus] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [sampleHover, setSampleHover] = useState<{ fixture: CountFixture; left: number; top: number } | null>(null)
  const [preset, setPreset] = useState(false), [sources, setSources] = useState<Array<{ name: string; fixtures: CountFixture[] }> | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => { let alive = true; void ensureSessionFixtures(session, pool).catch(e => { if (alive) setError(String(e)) }); return () => { alive = false } }, [session, pool, session.pageRevision])
  const drawingStatus = useSyncExternalStore(session.subscribeDrawingScan, session.getDrawingScanSnapshot)
  useEffect(() => { void session.scanDrawingInfos(pool) }, [session, pool, session.pageRevision])
  const fixtures = useMemo(() => store.getCountFixtures(), [store, version])
  const index = store.quantityIndex()
  const locations = useMemo(() => index.locations(), [index])
  const inferredFloor = floorFromDrawingName(store.getDrawingInfo(session.view.page - 1)?.name ?? '')
  const selected = fixtures.find(f => f.id === store.selectedFixtureId), pageIndex = session.view.page - 1
  const total = (id: string) => index.total(id)
  const format = (f: CountFixture, n: number) => quantityKind(f) === 'count' ? String(n) : n.toFixed(2)
  const unit = (f: CountFixture) => (quantityKind(f) === 'count' ? '' : ' ') + QUANTITY_UNITS[quantityKind(f)]
  const pageTotal = (id: string) => index.byPage(id).get(pageIndex) ?? 0
  const groups = useMemo(() => groupFixtures(fixtures), [fixtures])
  const categories = useMemo(() => groups.map(g => ({ ...g, items: g.items.filter(f => `${fixtureCode(f)} ${f.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) })).filter(g => g.items.length), [groups, search])
  const canEdit = store.fixturesReady && !session.editRestriction && !busy
  const canReorder = canEdit && search.length === 0
  const reorderTitle = search.length ? '検索中は並べ替えできません' : 'ドラッグして並べ替え'
  const selectedItems = categories.find(g => g.category === selected?.category)?.items ?? []
  const selectedIndex = selectedItems.findIndex(f => f.id === selected?.id)
  const step = (direction: -1 | 1) => {
    if (!selected) return
    const neighbor = selectedItems[selectedIndex + direction]
    if (!neighbor) return
    // Keep hidden search results while moving past the adjacent visible item.
    const next = search.length ? moveFixture(fixtures, selected.id, direction === -1 ? { beforeId: neighbor.id } : { afterId: neighbor.id }) : stepFixture(fixtures, selected.id, direction)
    if (next) store.setCountFixtures(next)
  }
  const ownDrag = (event: DragEvent) => Boolean(dragging.current && event.dataTransfer.types.includes(dragging.current.kind === 'fixture' ? 'application/x-karu-fixture' : 'application/x-karu-category'))
  const startDrag = (event: DragEvent, kind: 'fixture' | 'category', id: string) => {
    if (!canReorder) { event.preventDefault(); return }
    dragging.current = { kind, id }
    event.dataTransfer.setData(kind === 'fixture' ? 'application/x-karu-fixture' : 'application/x-karu-category', id)
    event.dataTransfer.effectAllowed = 'move'
    setSampleHover(null); setDropTarget(null)
  }
  const endDrag = () => { dragging.current = null; setDropTarget(null) }
  const targetAt = (event: DragEvent<HTMLElement>, kind: 'fixture' | 'category', id: string) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const side = kind === 'category' && dragging.current?.kind === 'fixture' ? 'inside' : event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
    return { kind, id, side } as const
  }
  const dragOver = (event: DragEvent<HTMLElement>, kind: 'fixture' | 'category', id: string) => {
    if (!canReorder || !ownDrag(event)) return
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'
    const target = targetAt(event, kind, id)
    setDropTarget(previous => previous?.kind === target.kind && previous.id === target.id && previous.side === target.side ? previous : target)
  }
  const drop = (event: DragEvent<HTMLElement>, kind: 'fixture' | 'category', id: string) => {
    if (!canReorder || !ownDrag(event)) return
    event.preventDefault(); event.stopPropagation()
    const active = dragging.current!, target = targetAt(event, kind, id)
    const source = fixtures.find(f => f.id === active.id)
    const category = kind === 'category' ? id : fixtures.find(f => f.id === id)!.category
    let next: CountFixture[]
    if (active.kind === 'fixture') {
      next = moveFixture(fixtures, active.id, kind === 'category' ? { endOfCategory: category } : target.side === 'before' ? { beforeId: id } : { afterId: id })
    } else {
      const index = groups.findIndex(g => g.category === category)
      const before = groups[index + (target.side === 'after' ? 1 : 0)]?.category
      next = moveCategory(fixtures, active.id, before === undefined ? { end: true } : { beforeCategory: before })
    }
    const previous = groups.flatMap(g => g.items)
    if (next.some((f, i) => f.id !== previous[i]?.id || f.category !== previous[i]?.category)) {
      store.setCountFixtures(next)
      if (active.kind === 'fixture' && source?.category !== category) setStatus(`${source?.name}を分類「${category}」へ移しました（Ctrl+Z で戻せます）`)
      else setStatus('並び替えました（Ctrl+Z で戻せます）')
    }
    if (active.kind === 'fixture') { setSelectedCategory(null); store.selectFixture(active.id); ui?.select() }
    else setSelectedCategory(active.id)
    endDrag()
  }
  const dropClass = (kind: 'fixture' | 'category', id: string) => dropTarget?.kind === kind && dropTarget.id === id ? ` fixture-drop-${dropTarget.side}` : ''
  const nextOrder = fixtures.reduce((n, f) => Math.max(n, f.order + 1), 0)
  const saveFixture = (f: CountFixture) => { store.setCountFixtures(dialog?.editing ? fixtures.map(p => p.id === f.id ? f : p) : [...fixtures, f]); store.selectFixture(f.id); setDialog(null) }
  const addMany = (items: Array<FixturePreset | CountFixture>) => {
    const next = [...fixtures]
    let order = nextOrder
    for (const item of items) {
      if (next.some(f => f.name === item.name && f.code === item.code && (f.spec ?? '') === (item.spec ?? ''))) continue
      next.push({ ...item, id: crypto.randomUUID(), order: order++, ...(!('style' in item) && item.kind && item.kind !== 'count' ? { line: { width: 1.5 as const, dash: 'solid' as const } } : {}), style: 'style' in item ? structuredClone(item.style) : nextCountStyle(next) })
    }
    if (next.length !== fixtures.length) store.setCountFixtures(next)
  }
  const csv = async (value: string, name: string) => {
    const blob = new Blob([value], { type: 'text/csv;charset=utf-8' })
    if (window.showSaveFilePicker) { const handle = await window.showSaveFilePicker({ suggestedName: name }); const writable = await handle.createWritable(); await writable.write(blob); await writable.close() }
    else { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0) }
  }
  return <section className={`fixture-panel${store.drawingHidesCounts() ? ' drawing-hides-counts' : ''}`} aria-label="数量拾い" data-testid="fixture-panel">
    <div className="fixture-panel-controls">
    <h2>数量拾い</h2>
    <p aria-live="polite" data-testid="drawing-scan-status">{drawingStatus}</p>
    <button type="button" disabled={session.drawingScanning} onClick={() => void session.scanDrawingInfos(pool, true)}>図面番号・図面名称を読み直す</button>
    {store.drawingHidesCounts() && <div className="fixture-drawing-filter-warning" role="status">
      <p>書き込みタブの絞り込み（{annotationFilterLabel(store.annotationFilter)}）で、図面に数量拾いの印を出していません。</p>
      <button type="button" onClick={() => store.setDrawingFollowsFilter(false)}>図面への反映をやめる</button>
    </div>}
    {!store.fixturesReady && <p role="status">数量拾いを読み込んでいます…</p>}
    <p className="fixture-count-summary" aria-live="polite">{selected ? <>
      <span className="fixture-summary-name">{quantityKind(selected) === 'count' ? <svg className="fixture-swatch" viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...selected.style, size: 24, opacity: 1 }} showCode={false} /></svg> : <QuantitySwatch fixture={selected} />}<span title={`${fixtureCode(selected)} ${selected.name}`}>{fixtureCode(selected)} {selected.name}{'　'}</span></span>
      <span className="fixture-summary-totals"><span>表示中の図面（p.{session.view.page}）: <strong>{format(selected, pageTotal(selected.id))}</strong>{unit(selected)}</span>{' ／ '}<button disabled={total(selected.id) === 0} aria-label={`${fixtureCode(selected)} ${selected.name}の全図面の内訳`} onClick={() => setBreakdownId(selected.id)}>全図面: <strong>{format(selected, total(selected.id))}</strong>{unit(selected)}</button></span>
    </> : '数量拾いの一覧で項目を選んでください'}</p>
    {store.visibleCountTotal(pageIndex) > 1000 && <p role="status">印が多いため略号の表示を省略しています</p>}
    <div className="fixture-actions">
      <div className="fixture-action-row">
      <button disabled={!canEdit || fixtures.length >= 1000} onClick={() => setDialog({ editing: false, initial: { id: crypto.randomUUID(), name: '', code: '', category: selected?.category ?? groups[0]?.category ?? 'その他', style: nextCountStyle(fixtures), order: nextOrder } })}>項目を追加</button>
      <button disabled={!canEdit} onClick={() => setPreset(true)}>見本から追加</button>
      <button disabled={!canEdit || !selected || fixtures.length >= 1000} onClick={() => {
        if (!selected) return
        const proposed = nextCountStyle(fixtures)
        setDialog({ editing: false, duplicate: true, initial: { ...structuredClone(selected), id: crypto.randomUUID(), name: selected.spec ? selected.name : `${selected.name.slice(0, 74)} のコピー`, order: nextOrder, style: { ...selected.style, shape: proposed.shape, fill: proposed.fill, color: proposed.color } } })
      }}>複製</button>
      <button disabled={!canEdit || !selected} onClick={() => selected && setDialog({ editing: true, initial: structuredClone(selected) })}>編集</button>
      <button disabled={!canEdit || !selected} onClick={() => {
        if (!selected) return
        const { deleted, detached } = store.fixtureRemovalCounts(selected.id)
        const parts = [deleted ? `この項目の拾い ${deleted} 件を削除し` : '', detached ? `${detached} 件の経路からこの項目を外し` : ''].filter(Boolean)
        if (!window.confirm(parts.length ? `${parts.join('、')}ます。よろしいですか？` : `${selected.name}を削除しますか？`)) return
        store.setCountFixtures(fixtures.filter(f => f.id !== selected.id), [selected.id]); store.selectFixture(null)
      }}>削除</button>
      </div>
      <div className="fixture-action-row">
      <button disabled={!canEdit} onClick={() => {
        setBusy(true); setError('')
        void Promise.all((ui?.documents ?? []).filter(d => d !== session).map(async d => ({ name: d.name, fixtures: d.annotationStore.fixturesReady ? d.annotationStore.getCountFixtures() : await pool.getCountFixtures(d.docId) })))
          .then(list => setSources(list.filter(s => s.fixtures.length))).catch(e => setError(String(e))).finally(() => setBusy(false))
      }}>他のPDFから読み込む</button>
      <button disabled={!store.fixturesReady || busy} onClick={() => setCsvOpen(true)}>数量をCSVに書き出す</button>
      <button disabled={!canEdit || !selected || selectedIndex <= 0} title={selectedIndex === 0 ? '分類の先頭です。分類ごと動かすときは、分類の見出しをドラッグします' : undefined} onClick={() => step(-1)}>上へ</button>
      <button disabled={!canEdit || !selected || selectedIndex < 0 || selectedIndex === selectedItems.length - 1} title={selectedIndex === selectedItems.length - 1 ? '分類の末尾です。分類ごと動かすときは、分類の見出しをドラッグします' : undefined} onClick={() => step(1)}>下へ</button>
      </div>
    </div>
    <fieldset className="current-location"><legend>現在の場所</legend>
      <label>階<LocationInput value={store.currentFloor} label="現在の階" list="pickup-floors" commit={v => store.setCurrentLocation('floor', v)} /></label>
      {inferredFloor && !store.currentFloor && <small>（図面名から: {inferredFloor}）</small>}
      <label>部屋<LocationInput value={store.currentRoom} label="現在の部屋" list="pickup-rooms" commit={v => store.setCurrentLocation('room', v)} /></label>
      <datalist id="pickup-floors">{locations.floors.map(f => <option key={f} value={f} />)}</datalist>
      <datalist id="pickup-rooms">{locations.rooms.map(r => <option key={r} value={r} />)}</datalist>
    </fieldset>
    <label>名称・略号で検索<input type="search" value={search} onChange={e => setSearch(e.currentTarget.value)} /></label>
    <label><input type="checkbox" checked={store.onlySelectedFixture} onChange={e => store.setOnlySelectedFixture(e.currentTarget.checked)} />選択中の項目だけ表示</label>
    <label><input type="checkbox" checked={store.showQuantityValues} onChange={e => store.setShowQuantityValues(e.currentTarget.checked)} />図面に長さ・面積・体積の数値を表示</label>
    <button onClick={() => store.showAllFixtures()}>すべて表示</button>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
    </div>
    <div className="fixture-groups" onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null) }} onScroll={() => setSampleHover(null)}>
      <div className="fixture-list-heading"><span>表示</span><span>印</span><span>見本</span><span>略号</span><span>名称</span><span>この図面</span><span>全図面</span></div>
      {categories.map(({ category, items: list }) => <section key={category}>
      <div className={`fixture-category${selectedCategory === category ? ' selected' : ''}${dropClass('category', category)}`} onDragOver={event => dragOver(event, 'category', category)} onDrop={event => drop(event, 'category', category)}><button draggable={canReorder} title={reorderTitle} onDragStart={event => startDrag(event, 'category', category)} onDragEnd={endDrag} aria-expanded={!collapsed.has(category)} onClick={() => { setSelectedCategory(category); setCollapsed(previous => { const next = new Set(previous); if (next.has(category)) next.delete(category); else next.add(category); return next }) }}>{category}（{list.length}）</button>
        <button aria-label={`${category}の表示切替`} aria-pressed={list.every(f => store.isFixtureVisible(f.id))} onClick={() => store.setFixtureVisible(fixtures.filter(f => f.category === category).map(f => f.id), !list.every(f => store.isFixtureVisible(f.id)))}><Eye visible={list.every(f => store.isFixtureVisible(f.id))} /></button>
      </div>
      {!collapsed.has(category) && <ul>{list.map(f => <li key={f.id} className={(f.id === selected?.id ? 'selected' : '') + dropClass('fixture', f.id)} data-fixture-id={f.id} draggable={canReorder} title={reorderTitle}
        onDragStart={event => startDrag(event, 'fixture', f.id)} onDragEnd={endDrag} onDragOver={event => dragOver(event, 'fixture', f.id)} onDrop={event => drop(event, 'fixture', f.id)}
        onClick={event => { if (!(event.target as HTMLElement).closest('button')) { setSelectedCategory(null); store.selectFixture(f.id); ui?.select() } }}
        onMouseEnter={event => {
          if (dragging.current || !f.sample || quantityKind(f) !== 'count') return
          const rect = event.currentTarget.getBoundingClientRect()
          setSampleHover({ fixture: f, left: Math.max(8, Math.min(window.innerWidth - 176, rect.right + 8)), top: Math.max(8, Math.min(window.innerHeight - 176, rect.top)) })
        }} onMouseLeave={() => setSampleHover(null)}>
        <span className="fixture-grip" aria-hidden="true">⠿</span>
        <button aria-label={`${fixtureCode(f)} ${f.name}の表示切替`} aria-pressed={store.isFixtureVisible(f.id)} onClick={() => store.setFixtureVisible([f.id], !store.isFixtureVisible(f.id))}><Eye visible={store.isFixtureVisible(f.id)} /></button>
        <button className="fixture-row" aria-label={`${fixtureCode(f)} ${f.name}`.trim()} aria-pressed={f.id === selected?.id} onClick={() => { setSelectedCategory(null); store.selectFixture(f.id); ui?.select() }}>
          {quantityKind(f) === 'count' ? <svg className="fixture-swatch" viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...f.style, size: 24, opacity: 1 }} showCode={false} /></svg> : <QuantitySwatch fixture={f} />}
          <span className="fixture-sample-cell">{quantityKind(f) === 'count' && f.sample && <img className="fixture-sample-thumbnail" src={`data:image/png;base64,${f.sample.png}`} alt={`${f.name}の見本`} draggable={false} />}</span>
          <span className="fixture-row-code" title={f.code}>{f.code}{' '}</span><span className="fixture-row-name" title={f.name}>{f.name}{f.spec && <span className="fixture-row-spec"> {f.spec}</span>}{quantityKind(f) !== 'count' && <span className="fixture-row-unit">{QUANTITY_UNITS[quantityKind(f)]}</span>}</span><span className="fixture-row-count" title={`表示中の図面: ${format(f, pageTotal(f.id))}${unit(f)}`}>{format(f, pageTotal(f.id))}</span>
        </button>
        <button className="fixture-total-button fixture-row-count" disabled={total(f.id) === 0} aria-label={`${fixtureCode(f)} ${f.name}の全図面の内訳`} title={`全図面: ${format(f, total(f.id))}${unit(f)}`} onClick={() => setBreakdownId(f.id)}>{format(f, total(f.id))}</button>
      </li>)}</ul>}
    </section>)}</div>
    {breakdownId && fixtures.find(f => f.id === breakdownId) && <QuantityBreakdown key={breakdownId} fixture={fixtures.find(f => f.id === breakdownId)!} index={index} session={session} pool={pool} onClose={closeBreakdown} />}
    {!dialog && sampleHover?.fixture.sample && <div className="fixture-sample-hover" role="tooltip" style={{ left: sampleHover.left, top: sampleHover.top }}><img src={`data:image/png;base64,${sampleHover.fixture.sample.png}`} alt={`${sampleHover.fixture.name}の見本（拡大）`} /></div>}
    <Suspense fallback={<p>画面を開いています…</p>}>
      {csvOpen && <QuantityCsvExportDialog index={index} fixtures={fixtures} pdfName={session.name} pageIndex={pageIndex} onExport={csv} onClose={() => setCsvOpen(false)} />}
      {dialog && <FixtureDialog initial={dialog.initial} fixtures={fixtures} editing={dialog.editing} duplicate={dialog.duplicate} hasMarks={dialog.editing && store.fixtureMarkCount(dialog.initial.id) > 0} onSave={saveFixture} onClose={() => setDialog(null)} />}
      {preset && <FixturePresetDialog onAdd={addMany} onClose={() => setPreset(false)} />}
      {sources && <FixturePresetDialog sources={sources} onAdd={addMany} onClose={() => setSources(null)} />}
    </Suspense>
  </section>
}
function Eye({ visible }: { visible: boolean }) { return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12Q12 1 22 12Q12 23 2 12Z" fill="none" stroke="currentColor" /><circle cx="12" cy="12" r="3" fill="currentColor" />{!visible && <path d="M3 3L21 21" stroke="currentColor" strokeWidth="2" />}</svg> }
