import { lazy, Suspense, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { nextCountStyle, type CountFixture } from '../core/countFixtures'
import { CountMarker } from '../editor/countMarkers'
import { ensureSessionFixtures, FixtureUiContext, type DocumentSession } from './documentModel'
import { createCountCsv } from './annotationCsv'
const FixtureDialog = lazy(() => import('./FixtureDialog'))
const FixturePresetDialog = lazy(() => import('./FixturePresetDialog'))

export default function FixturePanel({ session, pool }: { session: DocumentSession; pool: PdfWorkerPool }) {
  const store = session.annotationStore, ui = useContext(FixtureUiContext)
  const version = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [search, setSearch] = useState(''), [collapsed, setCollapsed] = useState(new Set<string>()), [error, setError] = useState('')
  const [dialog, setDialog] = useState<{ initial: CountFixture; editing: boolean } | null>(null)
  const [preset, setPreset] = useState(false), [sources, setSources] = useState<Array<{ name: string; fixtures: CountFixture[] }> | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => { let alive = true; void ensureSessionFixtures(session, pool).catch(e => { if (alive) setError(String(e)) }); return () => { alive = false } }, [session, pool])
  const fixtures = useMemo(() => store.getCountFixtures(), [store, version])
  const totals = useMemo(() => store.countTotals(), [store, version])
  const selected = fixtures.find(f => f.id === store.selectedFixtureId), pageIndex = session.view.page - 1
  const total = (id: string) => [...(totals.get(id)?.values() ?? [])].reduce((n, m) => n + m, 0)
  const pageTotal = (id: string) => totals.get(id)?.get(pageIndex) ?? 0
  const categories = new Map<string, CountFixture[]>()
  for (const f of fixtures) if (`${f.code} ${f.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) categories.set(f.category, [...(categories.get(f.category) ?? []), f])
  const canEdit = store.fixturesReady && !session.editRestriction && !busy
  const nextOrder = fixtures.reduce((n, f) => Math.max(n, f.order + 1), 0)
  const saveFixture = (f: CountFixture) => { store.setCountFixtures(dialog?.editing ? fixtures.map(p => p.id === f.id ? f : p) : [...fixtures, f]); store.selectFixture(f.id); setDialog(null) }
  const addMany = (items: Array<{ name: string; code: string; category: string } | CountFixture>) => {
    const next = [...fixtures]
    let order = nextOrder
    for (const item of items) {
      if (next.some(f => f.name === item.name && f.code === item.code)) continue
      next.push({ ...item, id: crypto.randomUUID(), order: order++, style: 'style' in item ? structuredClone(item.style) : nextCountStyle(next) })
    }
    if (next.length !== fixtures.length) store.setCountFixtures(next)
  }
  const csv = async () => {
    const annotations = session.pageSizes.flatMap((_, i) => store.getPageAnnotations(i)), value = createCountCsv(annotations, fixtures, pageIndex)
    const blob = new Blob([value], { type: 'text/csv;charset=utf-8' }), name = session.name.replace(/\.pdf$/i, '') + '_個数.csv'
    if (window.showSaveFilePicker) { const handle = await window.showSaveFilePicker({ suggestedName: name }); const writable = await handle.createWritable(); await writable.write(blob); await writable.close() }
    else { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 0) }
  }
  return <section className="fixture-panel" aria-label="器具リスト" data-testid="fixture-panel">
    <div className="fixture-panel-controls">
    <h2>器具リスト</h2>
    {!store.fixturesReady && <p role="status">器具と個数を読み込んでいます…</p>}
    <p className="fixture-count-summary" aria-live="polite">{selected ? <>
      <span className="fixture-summary-name"><svg className="fixture-swatch" viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...selected.style, size: 24, opacity: 1 }} showCode={false} /></svg><span title={`${selected.code} ${selected.name}`}>{selected.code} {selected.name}{'　'}</span></span>
      <span className="fixture-summary-totals"><span>表示中の図面（p.{session.view.page}）: <strong>{pageTotal(selected.id)}</strong>個</span>{' ／ '}<span>全図面: <strong>{total(selected.id)}</strong>個</span></span>
    </> : '器具リストで器具を選んでください'}</p>
    {store.visibleCountTotal(pageIndex) > 1000 && <p role="status">印が多いため略号の表示を省略しています</p>}
    <div className="fixture-actions">
      <div className="fixture-action-row">
      <button disabled={!canEdit || fixtures.length >= 1000} onClick={() => setDialog({ editing: false, initial: { id: crypto.randomUUID(), name: '', code: '', category: selected?.category ?? 'その他', style: nextCountStyle(fixtures), order: nextOrder } })}>器具を追加</button>
      <button disabled={!canEdit} onClick={() => setPreset(true)}>見本から追加</button>
      <button disabled={!canEdit || !selected || fixtures.length >= 1000} onClick={() => selected && setDialog({ editing: false, initial: { ...structuredClone(selected), id: crypto.randomUUID(), name: `${selected.name.slice(0, 74)} のコピー`, order: nextOrder } })}>複製</button>
      <button disabled={!canEdit || !selected} onClick={() => selected && setDialog({ editing: true, initial: structuredClone(selected) })}>編集</button>
      <button disabled={!canEdit || !selected} onClick={() => {
        if (!selected) return
        const n = total(selected.id)
        if (!window.confirm(n ? `この器具の印 ${n} 個も削除します。よろしいですか？` : `${selected.name}を削除しますか？`)) return
        store.setCountFixtures(fixtures.filter(f => f.id !== selected.id), [selected.id]); store.selectFixture(null)
      }}>削除</button>
      </div>
      <div className="fixture-action-row">
      <button disabled={!canEdit} onClick={() => {
        setBusy(true); setError('')
        void Promise.all((ui?.documents ?? []).filter(d => d !== session).map(async d => ({ name: d.name, fixtures: d.annotationStore.fixturesReady ? d.annotationStore.getCountFixtures() : await pool.getCountFixtures(d.docId) })))
          .then(list => setSources(list.filter(s => s.fixtures.length))).catch(e => setError(String(e))).finally(() => setBusy(false))
      }}>他のPDFから読み込む</button>
      <button disabled={!store.fixturesReady || busy} onClick={() => { setBusy(true); void csv().catch(e => { if (!(e instanceof DOMException && e.name === 'AbortError')) setError(String(e)) }).finally(() => setBusy(false)) }}>個数をCSVに書き出す</button>
      <button disabled={!canEdit || !selected || fixtures[0]?.id === selected.id} onClick={() => {
        if (!selected) return; const next = [...fixtures], index = next.findIndex(f => f.id === selected.id); [next[index - 1], next[index]] = [next[index], next[index - 1]]; store.setCountFixtures(next.map((f, order) => ({ ...f, order })))
      }}>上へ</button>
      <button disabled={!canEdit || !selected || fixtures.at(-1)?.id === selected.id} onClick={() => {
        if (!selected) return; const next = [...fixtures], index = next.findIndex(f => f.id === selected.id); [next[index + 1], next[index]] = [next[index], next[index + 1]]; store.setCountFixtures(next.map((f, order) => ({ ...f, order })))
      }}>下へ</button>
      </div>
    </div>
    <label>名称・略号で検索<input type="search" value={search} onChange={e => setSearch(e.currentTarget.value)} /></label>
    <label><input type="checkbox" checked={store.onlySelectedFixture} onChange={e => store.setOnlySelectedFixture(e.currentTarget.checked)} />選択中の器具だけ表示</label>
    <button onClick={() => store.showAllFixtures()}>すべて表示</button>
    {error && <p role="alert">{error}</p>}
    </div>
    <div className="fixture-groups">
      <div className="fixture-list-heading"><span>表示</span><span>印</span><span>略号</span><span>器具名称</span><span>この図面</span><span>全図面</span></div>
      {[...categories].map(([category, list]) => <section key={category}>
      <div className="fixture-category"><button aria-expanded={!collapsed.has(category)} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(category)) next.delete(category); else next.add(category); return next })}>{category}（{list.length}）</button>
        <button aria-label={`${category}の表示切替`} aria-pressed={list.every(f => store.isFixtureVisible(f.id))} onClick={() => store.setFixtureVisible(fixtures.filter(f => f.category === category).map(f => f.id), !list.every(f => store.isFixtureVisible(f.id)))}><Eye visible={list.every(f => store.isFixtureVisible(f.id))} /></button>
      </div>
      {!collapsed.has(category) && <ul>{list.map(f => <li key={f.id} className={f.id === selected?.id ? 'selected' : ''} data-fixture-id={f.id}>
        <button aria-label={`${f.code} ${f.name}の表示切替`} aria-pressed={store.isFixtureVisible(f.id)} onClick={() => store.setFixtureVisible([f.id], !store.isFixtureVisible(f.id))}><Eye visible={store.isFixtureVisible(f.id)} /></button>
        <button className="fixture-row" aria-label={`${f.code} ${f.name}`.trim()} aria-pressed={f.id === selected?.id} onClick={() => { store.selectFixture(f.id); ui?.select() }}>
          <svg className="fixture-swatch" viewBox="-14 -14 28 28" aria-hidden="true"><CountMarker style={{ ...f.style, size: 24, opacity: 1 }} showCode={false} /></svg>
          <span className="fixture-row-code" title={f.code}>{f.code}{' '}</span><span className="fixture-row-name" title={f.name}>{f.name}</span><span className="fixture-row-count" title={`表示中の図面: ${pageTotal(f.id)}個`}>{pageTotal(f.id)}</span><span className="fixture-row-count" title={`全図面: ${total(f.id)}個`}>{total(f.id)}</span>
        </button>
      </li>)}</ul>}
    </section>)}</div>
    <Suspense fallback={<p>画面を開いています…</p>}>
      {dialog && <FixtureDialog initial={dialog.initial} fixtures={fixtures} editing={dialog.editing} onSave={saveFixture} onClose={() => setDialog(null)} />}
      {preset && <FixturePresetDialog onAdd={addMany} onClose={() => setPreset(false)} />}
      {sources && <FixturePresetDialog sources={sources} onAdd={addMany} onClose={() => setSources(null)} />}
    </Suspense>
  </section>
}
function Eye({ visible }: { visible: boolean }) { return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12Q12 1 22 12Q12 23 2 12Z" fill="none" stroke="currentColor" /><circle cx="12" cy="12" r="3" fill="currentColor" />{!visible && <path d="M3 3L21 21" stroke="currentColor" strokeWidth="2" />}</svg> }
