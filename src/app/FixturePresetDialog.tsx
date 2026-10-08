import { useEffect, useMemo, useRef, useState } from 'react'
import { fixtureCode, FIXTURE_PRESETS, QUANTITY_UNITS, type FixturePreset, type CountFixture } from '../core/countFixtures'
import { CountMarker, QuantitySwatch } from '../editor/countMarkers'

type Preset = FixturePreset
type MasterModule = typeof import('../core/quantityMaster')
const isFixture = (item: Preset | CountFixture): item is CountFixture => 'style' in item
const identity = (f: Preset) => JSON.stringify([f.code, f.spec ?? '', f.name])
const kindLabel = (f: Preset) => f.kind && f.kind !== 'count' ? `（${{ length: '長さ', area: '面積', volume: '体積' }[f.kind]}・${QUANTITY_UNITS[f.kind]}）` : ''

export default function FixturePresetDialog({ sources, fixtures = [], onAdd, onClose }: { sources?: Array<{ name: string; fixtures: CountFixture[] }>; fixtures?: readonly CountFixture[]; onAdd(items: Array<Preset | CountFixture>): void; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), searchInput = useRef<HTMLInputElement>(null)
  const [field, setField] = useState(sources ? '0' : '電気設備'), [unchecked, setUnchecked] = useState(new Set<number>()), [error, setError] = useState('')
  const [tab, setTab] = useState<'spec' | 'bundle'>('spec'), [master, setMaster] = useState<MasterModule | null>(null), [loadError, setLoadError] = useState(''), [retry, setRetry] = useState(0)
  const [query, setQuery] = useState(''), [masterField, setMasterField] = useState('電気設備'), [category, setCategory] = useState('電線'), [type, setType] = useState('IV'), [selected, setSelected] = useState(new Set<string>())
  const specTab = !sources && tab === 'spec'
  useEffect(() => { dialog.current?.showModal(); if (!sources) searchInput.current?.focus() }, [sources])
  useEffect(() => {
    if (!specTab) return
    searchInput.current?.focus()
    let alive = true
    setLoadError('')
    void import('../core/quantityMaster').then(m => { if (alive) setMaster(m) }).catch(reason => { if (alive) setLoadError(String(reason)) })
    return () => { alive = false }
  }, [specTab, retry])
  const entries = useMemo(() => master?.masterEntries() ?? [], [master])
  const existing = useMemo(() => new Set(fixtures.map(identity)), [fixtures])
  const chosen = useMemo(() => entries.filter(f => selected.has(f.key) && !existing.has(identity(f))), [entries, selected, existing])
  const result = useMemo(() => master?.searchQuantityMaster(query) ?? { entries: [], total: 0 }, [master, query])
  const fields = useMemo(() => [...new Set(entries.map(f => f.field))], [entries])
  const categories = useMemo(() => [...new Set(entries.filter(f => f.field === masterField).map(f => f.category))], [entries, masterField])
  const types = useMemo(() => [...new Set(entries.filter(f => f.field === masterField && f.category === category).map(f => f.type))], [entries, masterField, category])
  const typeEntries = useMemo(() => entries.filter(f => f.field === masterField && f.category === category && f.type === type), [entries, masterField, category, type])
  const searching = Boolean(query.trim()), visible = searching ? result.entries : typeEntries
  const items = sources ? sources[Number(field)]?.fixtures ?? [] : FIXTURE_PRESETS[field]
  const selectEntries = (keys: readonly string[], checked: boolean) => setSelected(previous => {
    const next = new Set(previous)
    for (const key of keys) { if (checked) next.add(key); else next.delete(key) }
    return next
  })
  const changeField = (next: string) => {
    const first = entries.find(f => f.field === next)
    setMasterField(next); setCategory(first?.category ?? ''); setType(first?.type ?? '')
  }
  const changeCategory = (next: string) => {
    setCategory(next); setType(entries.find(f => f.field === masterField && f.category === next)?.type ?? '')
  }
  return <dialog ref={dialog} className={`fixture-dialog${sources ? '' : ' quantity-master-dialog'}`} aria-label={sources ? '他のPDFから読み込む' : '標準マスタから追加'} onCancel={onClose}>
    <h2>{sources ? '他のPDFから読み込む' : '標準マスタから追加'}</h2>
    {!sources && <div className="quantity-master-tabs" role="tablist" aria-label="標準マスタの選び方">
      <button role="tab" id="quantity-master-spec-tab" aria-selected={tab === 'spec'} aria-controls="quantity-master-spec-panel" onClick={() => { setTab('spec'); setError('') }}>規格から選ぶ</button>
      <button role="tab" id="quantity-master-bundle-tab" aria-selected={tab === 'bundle'} aria-controls="quantity-master-bundle-panel" onClick={() => { setTab('bundle'); setError('') }}>分野の一式</button>
    </div>}
    {specTab ? <div role="tabpanel" id="quantity-master-spec-panel" aria-labelledby="quantity-master-spec-tab">
      <label className="quantity-master-search">検索<input ref={searchInput} aria-label="標準マスタを検索" type="search" value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="例: 60、PF22、400x250" /></label>
      {!master && !loadError && <p role="status">標準マスタを読み込んでいます…</p>}
      {loadError && <><p role="alert">標準マスタを読み込めませんでした: {loadError}</p><button onClick={() => setRetry(n => n + 1)}>もう一度読み込む</button></>}
      {master && <div className={`quantity-master-browser${searching ? ' quantity-master-search-results' : ''}`}>
        {!searching && <>
          <div className="quantity-master-navigation" role="group" aria-label="標準マスタの分野"><h3>分野</h3>{fields.map(f => <button key={f} aria-pressed={f === masterField} onClick={() => changeField(f)}>{f}</button>)}</div>
          <div className="quantity-master-navigation" role="group" aria-label="標準マスタの分類"><h3>分類</h3>{categories.map(c => <button key={c} aria-pressed={c === category} onClick={() => changeCategory(c)}>{c}</button>)}</div>
          <div className="quantity-master-navigation" role="group" aria-label="標準マスタの種類"><h3>種類</h3>{types.map(t => <button key={t} aria-pressed={t === type} onClick={() => setType(t)}>{t}（{entries.filter(f => f.field === masterField && f.category === category && f.type === t).length}件）</button>)}</div>
        </>}
        <div className="quantity-master-specs">
          <h3>{searching ? `検索結果（${result.total}件）` : `${type}の規格`}</h3>
          {!searching && visible[0] && <p className="quantity-master-type-name">{visible[0].name}{kindLabel(visible[0])}{visible[0].kind === 'count' ? '（個数・個）' : ''}</p>}
          {!searching && <div className="quantity-master-selection-actions"><button onClick={() => selectEntries(visible.filter(f => !existing.has(identity(f))).map(f => f.key), true)}>すべて選ぶ</button><button onClick={() => selectEntries(visible.map(f => f.key), false)}>選択を解除</button></div>}
          <div className="fixture-presets">{visible.map(f => {
            const added = existing.has(identity(f))
            return <label key={f.key}><input type="checkbox" checked={added || selected.has(f.key)} disabled={added} onChange={e => selectEntries([f.key], e.currentTarget.checked)} />
              <span><strong>{fixtureCode(f)}</strong> <span className={searching ? undefined : 'visually-hidden'}>{f.name}{kindLabel(f)}{f.kind === 'count' ? '（個数・個）' : ''}</span>{added && <span className="quantity-master-added"> 追加済み</span>}</span>
            </label>
          })}</div>
          {searching && result.total === 0 && <p>該当する項目がありません。</p>}
          {searching && result.total > result.entries.length && <p>ほか {result.total - result.entries.length} 件。言葉を足して絞り込んでください</p>}
        </div>
      </div>}
    </div> : <div {...(!sources ? { role: 'tabpanel', id: 'quantity-master-bundle-panel', 'aria-labelledby': 'quantity-master-bundle-tab' } : {})}>
      <label>{sources ? 'PDF' : '分野'}<select aria-label={sources ? '読込元PDF' : '見本の分野'} value={field} onChange={e => { setField(e.currentTarget.value); setUnchecked(new Set()); setError('') }}>
        {sources ? sources.map((s, i) => <option key={i} value={i}>{s.name}</option>) : Object.keys(FIXTURE_PRESETS).map(s => <option key={s}>{s}</option>)}
      </select></label>
      {!items?.length && <p>数量拾いを持つPDFがありません。</p>}
      <div className="fixture-presets">{items?.map((f, i) => <label key={i}><input type="checkbox" checked={!unchecked.has(i)} onChange={e => { const checked = e.currentTarget.checked; setUnchecked(previous => { const next = new Set(previous); if (checked) next.delete(i); else next.add(i); return next }) }} />
        {isFixture(f) && (!f.kind || f.kind === 'count') && <svg className="fixture-swatch" viewBox="-16 -16 32 32" aria-hidden="true"><CountMarker style={f.style} showCode={false} /></svg>}{isFixture(f) && f.kind && f.kind !== 'count' && <QuantitySwatch fixture={f} />}{f.category}／{fixtureCode(f)} {f.name}{kindLabel(f)}
      </label>)}</div>
    </div>}
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button onClick={onClose}>閉じる</button><button disabled={specTab ? chosen.length === 0 : !items?.some((_, i) => !unchecked.has(i))} onClick={async () => {
      try {
        const selectedItems = specTab ? chosen : items.filter((_, i) => !unchecked.has(i))
        if (sources) onAdd(selectedItems)
        else {
          const m = master ?? await import('../core/quantityMaster')
          const available = [...fixtures], additions = selectedItems.map(item => { const f = m.fixtureFromPreset(item, available); available.push(f); return f })
          onAdd(additions)
        }
        onClose()
      } catch (reason) { setError(String(reason)) }
    }}>{specTab ? `選んだ項目を追加（${chosen.length}件）` : '選んだ項目を追加'}</button></div>
  </dialog>
}
