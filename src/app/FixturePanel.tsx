import { lazy, Suspense, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { nextCountStyle, quantityKind, QUANTITY_UNITS, type FixturePreset, type CountFixture } from '../core/countFixtures'
import { CountMarker, QuantitySwatch } from '../editor/countMarkers'
import { ensureSessionFixtures, FixtureUiContext, type DocumentSession } from './documentModel'
import { createCountCsv } from './annotationCsv'
import { annotationFilterLabel } from '../editor/annotationFilter'
const FixtureDialog = lazy(() => import('./FixtureDialog'))
const FixturePresetDialog = lazy(() => import('./FixturePresetDialog'))

export default function FixturePanel({ session, pool }: { session: DocumentSession; pool: PdfWorkerPool }) {
  const store = session.annotationStore, ui = useContext(FixtureUiContext)
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [search, setSearch] = useState(''), [collapsed, setCollapsed] = useState(new Set<string>()), [error, setError] = useState('')
  const [dialog, setDialog] = useState<{ initial: CountFixture; editing: boolean } | null>(null)
  const [sampleHover, setSampleHover] = useState<{ fixture: CountFixture; left: number; top: number } | null>(null)
  const [preset, setPreset] = useState(false), [sources, setSources] = useState<Array<{ name: string; fixtures: CountFixture[] }> | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => { let alive = true; void ensureSessionFixtures(session, pool).catch(e => { if (alive) setError(String(e)) }); return () => { alive = false } }, [session, pool, session.pageRevision])
  const fixtures = useMemo(() => store.getCountFixtures(), [store, version])
  const totals = useMemo(() => store.countTotals(), [store, version])
  const selected = fixtures.find(f => f.id === store.selectedFixtureId), pageIndex = session.view.page - 1
  const total = (id: string) => [...(totals.get(id)?.values() ?? [])].reduce((n, m) => n + m, 0)
  const format = (f: CountFixture, n: number) => quantityKind(f) === 'count' ? String(n) : n.toFixed(2)
  const unit = (f: CountFixture) => (quantityKind(f) === 'count' ? '' : ' ') + QUANTITY_UNITS[quantityKind(f)]
  const pageTotal = (id: string) => totals.get(id)?.get(pageIndex) ?? 0
  const categories = new Map<string, CountFixture[]>()
  for (const f of fixtures) if (`${f.code} ${f.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) categories.set(f.category, [...(categories.get(f.category) ?? []), f])
  const canEdit = store.fixturesReady && !session.editRestriction && !busy
  const nextOrder = fixtures.reduce((n, f) => Math.max(n, f.order + 1), 0)
  const saveFixture = (f: CountFixture) => { store.setCountFixtures(dialog?.editing ? fixtures.map(p => p.id === f.id ? f : p) : [...fixtures, f]); store.selectFixture(f.id); setDialog(null) }
  const addMany = (items: Array<FixturePreset | CountFixture>) => {
    const next = [...fixtures]
    let order = nextOrder
    for (const item of items) {
      if (next.some(f => f.name === item.name && f.code === item.code)) continue
      next.push({ ...item, id: crypto.randomUUID(), order: order++, ...(!('style' in item) && item.kind && item.kind !== 'count' ? { line: { width: 1.5 as const, dash: 'solid' as const } } : {}), style: 'style' in item ? structuredClone(item.style) : nextCountStyle(next) })
    }
    if (next.length !== fixtures.length) store.setCountFixtures(next)
  }
  const csv = async () => {
    const annotations = session.pageSizes.flatMap((_, i) => store.getPageAnnotations(i)), value = createCountCsv(annotations, fixtures, pageIndex)
    const blob = new Blob([value], { type: 'text/csv;charset=utf-8' }), name = session.name.replace(/\.pdf$/i, '') + '_数量.csv'
    if (window.showSaveFilePicker) { const handle = await window.showSaveFilePicker({ suggestedName: name }); const writable = await handle.createWritable(); await writable.write(blob); await writable.close() }
    else { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0) }
  }
  return <section className={`fixture-panel${store.drawingHidesCounts() ? ' drawing-hides-counts' : ''}`} aria-label="数量拾い" data-testid="fixture-panel">
    <div className="fixture-panel-controls">
    <h2>数量拾い</h2>
    {store.drawingHidesCounts() && <div className="fixture-drawing-filter-warning" role="status">
      <p>書き込みタブの絞り込み（{annotationFilterLabel(store.annotationFilter)}）で、図面に数量拾いの印を出していません。</p>
      <button type="button" onClick={() => store.setDrawingFollowsFilter(false)}>図面への反映をやめる</button>
    </div>}
    {!store.fixturesReady && <p role="status">数量拾いを読み込んでいます…</p>}
    <p className="fixture-count-summary" aria-live="polite">{selected ? <>
      <span className="fixture-summary-name">{quantityKind(selected) === 'count' ? <svg className="fixture-swatch" viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...selected.style, size: 24, opacity: 1 }} showCode={false} /></svg> : <QuantitySwatch fixture={selected} />}<span title={`${selected.code} ${selected.name}`}>{selected.code} {selected.name}{'　'}</span></span>
      <span className="fixture-summary-totals"><span>表示中の図面（p.{session.view.page}）: <strong>{format(selected, pageTotal(selected.id))}</strong>{unit(selected)}</span>{' ／ '}<span>全図面: <strong>{format(selected, total(selected.id))}</strong>{unit(selected)}</span></span>
    </> : '数量拾いの一覧で項目を選んでください'}</p>
    {store.visibleCountTotal(pageIndex) > 1000 && <p role="status">印が多いため略号の表示を省略しています</p>}
    <div className="fixture-actions">
      <div className="fixture-action-row">
      <button disabled={!canEdit || fixtures.length >= 1000} onClick={() => setDialog({ editing: false, initial: { id: crypto.randomUUID(), name: '', code: '', category: selected?.category ?? 'その他', style: nextCountStyle(fixtures), order: nextOrder } })}>項目を追加</button>
      <button disabled={!canEdit} onClick={() => setPreset(true)}>見本から追加</button>
      <button disabled={!canEdit || !selected || fixtures.length >= 1000} onClick={() => {
        if (!selected) return
        const proposed = nextCountStyle(fixtures)
        setDialog({ editing: false, initial: { ...structuredClone(selected), id: crypto.randomUUID(), name: `${selected.name.slice(0, 74)} のコピー`, order: nextOrder, style: { ...selected.style, shape: proposed.shape, fill: proposed.fill, color: proposed.color } } })
      }}>複製</button>
      <button disabled={!canEdit || !selected} onClick={() => selected && setDialog({ editing: true, initial: structuredClone(selected) })}>編集</button>
      <button disabled={!canEdit || !selected} onClick={() => {
        if (!selected) return
        const n = store.fixtureMarkCount(selected.id)
        if (!window.confirm(n ? `この項目の拾い ${n} 件も削除します。よろしいですか？` : `${selected.name}を削除しますか？`)) return
        store.setCountFixtures(fixtures.filter(f => f.id !== selected.id), [selected.id]); store.selectFixture(null)
      }}>削除</button>
      </div>
      <div className="fixture-action-row">
      <button disabled={!canEdit} onClick={() => {
        setBusy(true); setError('')
        void Promise.all((ui?.documents ?? []).filter(d => d !== session).map(async d => ({ name: d.name, fixtures: d.annotationStore.fixturesReady ? d.annotationStore.getCountFixtures() : await pool.getCountFixtures(d.docId) })))
          .then(list => setSources(list.filter(s => s.fixtures.length))).catch(e => setError(String(e))).finally(() => setBusy(false))
      }}>他のPDFから読み込む</button>
      <button disabled={!store.fixturesReady || busy} onClick={() => { setBusy(true); void csv().catch(e => { if (!(e instanceof DOMException && e.name === 'AbortError')) setError(String(e)) }).finally(() => setBusy(false)) }}>数量をCSVに書き出す</button>
      <button disabled={!canEdit || !selected || fixtures[0]?.id === selected.id} onClick={() => {
        if (!selected) return; const next = [...fixtures], index = next.findIndex(f => f.id === selected.id); [next[index - 1], next[index]] = [next[index], next[index - 1]]; store.setCountFixtures(next.map((f, order) => ({ ...f, order })))
      }}>上へ</button>
      <button disabled={!canEdit || !selected || fixtures.at(-1)?.id === selected.id} onClick={() => {
        if (!selected) return; const next = [...fixtures], index = next.findIndex(f => f.id === selected.id); [next[index + 1], next[index]] = [next[index], next[index + 1]]; store.setCountFixtures(next.map((f, order) => ({ ...f, order })))
      }}>下へ</button>
      </div>
    </div>
    <label>名称・略号で検索<input type="search" value={search} onChange={e => setSearch(e.currentTarget.value)} /></label>
    <label><input type="checkbox" checked={store.onlySelectedFixture} onChange={e => store.setOnlySelectedFixture(e.currentTarget.checked)} />選択中の項目だけ表示</label>
    <button onClick={() => store.showAllFixtures()}>すべて表示</button>
    {error && <p role="alert">{error}</p>}
    </div>
    <div className="fixture-groups" onScroll={() => setSampleHover(null)}>
      <div className="fixture-list-heading"><span>表示</span><span>印</span><span>見本</span><span>略号</span><span>名称</span><span>この図面</span><span>全図面</span></div>
      {[...categories].map(([category, list]) => <section key={category}>
      <div className="fixture-category"><button aria-expanded={!collapsed.has(category)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(category)) next.delete(category); else next.add(category); return next })}>{category}（{list.length}）</button>
        <button aria-label={`${category}の表示切替`} aria-pressed={list.every(f => store.isFixtureVisible(f.id))} onClick={() => store.setFixtureVisible(fixtures.filter(f => f.category === category).map(f => f.id), !list.every(f => store.isFixtureVisible(f.id)))}><Eye visible={list.every(f => store.isFixtureVisible(f.id))} /></button>
      </div>
      {!collapsed.has(category) && <ul>{list.map(f => <li key={f.id} className={f.id === selected?.id ? 'selected' : ''} data-fixture-id={f.id}
        onMouseEnter={event => {
          if (!f.sample || quantityKind(f) !== 'count') return
          const rect = event.currentTarget.getBoundingClientRect()
          setSampleHover({ fixture: f, left: Math.max(8, Math.min(window.innerWidth - 176, rect.right + 8)), top: Math.max(8, Math.min(window.innerHeight - 176, rect.top)) })
        }} onMouseLeave={() => setSampleHover(null)}>
        <button aria-label={`${f.code} ${f.name}の表示切替`} aria-pressed={store.isFixtureVisible(f.id)} onClick={() => store.setFixtureVisible([f.id], !store.isFixtureVisible(f.id))}><Eye visible={store.isFixtureVisible(f.id)} /></button>
        <button className="fixture-row" aria-label={`${f.code} ${f.name}`.trim()} aria-pressed={f.id === selected?.id} onClick={() => { store.selectFixture(f.id); ui?.select() }}>
          {quantityKind(f) === 'count' ? <svg className="fixture-swatch" viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...f.style, size: 24, opacity: 1 }} showCode={false} /></svg> : <QuantitySwatch fixture={f} />}
          <span className="fixture-sample-cell">{quantityKind(f) === 'count' && f.sample && <img className="fixture-sample-thumbnail" src={`data:image/png;base64,${f.sample.png}`} alt={`${f.name}の見本`} />}</span>
          <span className="fixture-row-code" title={f.code}>{f.code}{' '}</span><span className="fixture-row-name" title={f.name}>{f.name}{quantityKind(f) !== 'count' && <span className="fixture-row-unit">{QUANTITY_UNITS[quantityKind(f)]}</span>}</span><span className="fixture-row-count" title={`表示中の図面: ${format(f, pageTotal(f.id))}${unit(f)}`}>{format(f, pageTotal(f.id))}</span><span className="fixture-row-count" title={`全図面: ${format(f, total(f.id))}${unit(f)}`}>{format(f, total(f.id))}</span>
        </button>
      </li>)}</ul>}
    </section>)}</div>
    {!dialog && sampleHover?.fixture.sample && <div className="fixture-sample-hover" role="tooltip" style={{ left: sampleHover.left, top: sampleHover.top }}><img src={`data:image/png;base64,${sampleHover.fixture.sample.png}`} alt={`${sampleHover.fixture.name}の見本（拡大）`} /></div>}
    <Suspense fallback={<p>画面を開いています…</p>}>
      {dialog && <FixtureDialog initial={dialog.initial} fixtures={fixtures} editing={dialog.editing} hasMarks={dialog.editing && store.fixtureMarkCount(dialog.initial.id) > 0} onSave={saveFixture} onClose={() => setDialog(null)} />}
      {preset && <FixturePresetDialog onAdd={addMany} onClose={() => setPreset(false)} />}
      {sources && <FixturePresetDialog sources={sources} onAdd={addMany} onClose={() => setSources(null)} />}
    </Suspense>
  </section>
}
function Eye({ visible }: { visible: boolean }) { return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12Q12 1 22 12Q12 23 2 12Z" fill="none" stroke="currentColor" /><circle cx="12" cy="12" r="3" fill="currentColor" />{!visible && <path d="M3 3L21 21" stroke="currentColor" strokeWidth="2" />}</svg> }
