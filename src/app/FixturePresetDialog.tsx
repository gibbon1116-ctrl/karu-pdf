import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BreakdownPicker from './BreakdownPicker'
import CatalogChooser from './CatalogChooser'
import { breakdownEntries, kindForUnit, type BreakdownEntry } from '../core/breakdownMaster'
import type { CatalogItem, CatalogPosition, CatalogSelection } from '../core/catalog'
import { fixtureCode, fixtureIdentity, quantityMethod, quantityUnit, type FixturePreset, type CountFixture } from '../core/countFixtures'
import { CountMarker, QuantitySwatch } from '../editor/countMarkers'
import { createQuantityBreakdownOrder, quantityBreakdownRowKey } from './breakdownOutline'
import type { FixtureAppendOptions } from './fixtureAppend'
import { linkRuleAuto } from '../core/breakdown/linkRules'
import { fixtureLinkSources } from '../core/fixtureLink'

type Preset = FixturePreset
type MasterModule = typeof import('../core/catalog')
const isFixture = (item: Preset | CountFixture): item is CountFixture => 'style' in item
const identity = fixtureIdentity
const kindLabel = (f: Preset) => f.kind && f.kind !== 'count' ? `（${{ length: '長さ', area: '面積', volume: '体積' }[f.kind]}・${quantityUnit(f)}）` : f.kind === 'count' ? `（個数・${quantityUnit(f)}）` : ''
const positionStorageKey = 'karu-pdf:master-breakdown-position'
const emptySelection: CatalogSelection = { options: [] }
const unique = (values: readonly string[]) => [...new Set(values)]
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

function positionFor(entry: BreakdownEntry): CatalogPosition {
  return {
    book: entry.book,
    section: entry.section,
    subject: entry.subject,
    ...(entry.middle ? { middle: entry.middle } : {}),
  }
}

function initialItemPosition(
  master: MasterModule,
  item: CatalogItem,
  position?: CatalogPosition,
): CatalogPosition | undefined {
  return master.representativeBreakdownPosition(item)
    ?? (position ? { ...position, item: item.breakdownItem ?? item.name } : undefined)
}

function storedPosition(entries: readonly BreakdownEntry[]): CatalogPosition | undefined {
  try {
    const raw = localStorage.getItem(positionStorageKey)
    if (!raw) return undefined
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return undefined
    const candidate = value as Record<string, unknown>
    if (typeof candidate.book !== 'string'
      || typeof candidate.section !== 'string'
      || typeof candidate.subject !== 'string'
      || (candidate.middle !== undefined && typeof candidate.middle !== 'string')) return undefined
    const entry = entries.find(entry =>
      entry.book === candidate.book
      && entry.section === candidate.section
      && entry.subject === candidate.subject
      && (entry.middle ?? '') === (candidate.middle ?? ''),
    )
    return entry ? positionFor(entry) : undefined
  } catch {
    return undefined
  }
}

export default function FixturePresetDialog({ sources, fixtures = [], initialQuery, onAdd, onClose }: { sources?: Array<{ name: string; fixtures: CountFixture[] }>; fixtures?: readonly CountFixture[]; initialQuery?: string; onAdd(items: Array<Preset | CountFixture>, options?: FixtureAppendOptions): void; onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null), searchInput = useRef<HTMLInputElement>(null)
  const [field, setField] = useState('0'), [unchecked, setUnchecked] = useState(new Set<number>()), [error, setError] = useState('')
  const [tab, setTab] = useState<'spec' | 'breakdown'>('spec'), [master, setMaster] = useState<MasterModule | null>(null), [loadError, setLoadError] = useState(''), [retry, setRetry] = useState(0)
  const [breakdownResult, setBreakdownResult] = useState<{ presets: FixturePreset[]; error?: string }>({ presets: [] })
  const [addedNotice, setAddedNotice] = useState('')
  const [query, setQuery] = useState(initialQuery ?? ''), [masterField, setMasterField] = useState('電気設備'), [category, setCategory] = useState('電線'), [type, setType] = useState('IV')
  const [selected, setSelected] = useState<Record<string, CatalogSelection>>({})
  const [itemPositions, setItemPositions] = useState<Record<string, CatalogPosition | undefined>>({})
  const [positionOrder, setPositionOrder] = useState<string[]>([])
  const [fallbackPosition, setPosition] = useState<CatalogPosition | undefined>()
  const activeItem = positionOrder[positionOrder.length - 1]
  const position = activeItem === undefined ? fallbackPosition : itemPositions[activeItem]
  const specTab = !sources && tab === 'spec'
  const breakdownTab = !sources && tab === 'breakdown'
  const onBreakdownChange = useCallback((result: { presets: FixturePreset[]; error?: string }) => {
    setBreakdownResult(previous => JSON.stringify(previous) === JSON.stringify(result) ? previous : result)
    setError('')
  }, [])
  useEffect(() => { dialog.current?.showModal(); if (!sources) searchInput.current?.focus() }, [sources])
  useEffect(() => {
    if (specTab) searchInput.current?.focus()
  }, [specTab])
  useEffect(() => {
    if (sources || master) return
    let alive = true
    setLoadError('')
    void import('../core/catalog').then(module => {
      if (!alive) return
      setPosition(storedPosition(breakdownEntries()))
      setMaster(module)
    }).catch(reason => { if (alive) setLoadError(String(reason)) })
    return () => { alive = false }
  }, [sources, master, retry])
  const entries = useMemo(() => master?.catalogItems() ?? [], [master])
  const positions = useMemo(() => master ? breakdownEntries() : [], [master])
  const appendOrder = useMemo(() => createQuantityBreakdownOrder(positions), [positions])
  const existing = useMemo(() => new Set(fixtures.map(identity)), [fixtures])
  const specResult = useMemo(() => {
    const presets: FixturePreset[] = []
    let error: string | undefined
    if (master) {
      for (const item of entries) {
        const selection = selected[item.key]
        if (!selection) continue
        try {
          presets.push(...master.catalogPresets(item, selection, itemPositions[item.key]))
        } catch (reason) {
          error ??= errorText(reason)
        }
      }
    }
    const seen = new Set(existing)
    return {
      error,
      presets: presets.filter(preset => {
        const key = identity(preset)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      }),
    }
  }, [master, entries, selected, itemPositions, existing])
  const chosen = specResult.presets
  const chosenBreakdown = useMemo(() => {
    const seen = new Set(existing)
    return breakdownResult.presets.filter(preset => {
      const key = identity(preset)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [breakdownResult.presets, existing])
  // Everything checked in either tab is added together (利用者の要望: チェックしたものをすべて追加).
  const combined = useMemo(() => {
    const seen = new Set<string>()
    return [...chosen, ...chosenBreakdown].filter(preset => {
      const key = identity(preset)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [chosen, chosenBreakdown])
  const combinedError = specResult.error ?? breakdownResult.error
  const result = useMemo(() => {
    const results = master?.searchCatalog(query, Number.MAX_SAFE_INTEGER).results ?? []
    const total = results.reduce((count, result) => count + result.options.length, 0)
    let remaining = 200
    const visible = results.flatMap(({ item, options }) => {
      const shown = options.slice(0, remaining)
      remaining -= shown.length
      return shown.length ? [{ ...item, options: shown }] : []
    })
    return { visible, total, shown: 200 - remaining }
  }, [master, query])
  const fields = useMemo(() => unique(entries.map(item => item.field)), [entries])
  const categories = useMemo(() => unique(entries.filter(item => item.field === masterField).map(item => item.category)), [entries, masterField])
  const types = useMemo(() => unique(entries.filter(item => item.field === masterField && item.category === category).map(item => item.type)), [entries, masterField, category])
  const typeEntries = useMemo(() => entries.filter(item => item.field === masterField && item.category === category && item.type === type), [entries, masterField, category, type])
  const searching = Boolean(query.trim()), visible = searching ? result.visible : typeEntries
  const items = sources?.[Number(field)]?.fixtures ?? []
  const books = unique(positions.map(entry => entry.book))
  const bookEntries = positions.filter(entry => entry.book === position?.book)
  const sections = unique(bookEntries.map(entry => entry.section))
  const sectionEntries = bookEntries.filter(entry => entry.section === position?.section)
  const subjects = unique(sectionEntries.map(entry => entry.subject))
  const subjectEntries = sectionEntries.filter(entry => entry.subject === position?.subject)
  const middles = unique(subjectEntries.map(entry => entry.middle ?? ''))
  const choosePosition = (entry?: BreakdownEntry) => {
    const next = entry ? positionFor(entry) : undefined
    setPosition(next)
    if (activeItem !== undefined) {
      const item = entries.find(candidate => candidate.key === activeItem)
      const itemPosition = next ? {
        ...next,
        ...(item !== undefined ? {
          item: itemPositions[activeItem]?.item
            ?? master?.representativeBreakdownPosition(item)?.item
            ?? item.breakdownItem
            ?? item.name,
        } : {}),
      } : undefined
      setItemPositions(previous => ({ ...previous, [activeItem]: itemPosition }))
    }
    // 手で変えた欄の値だけを保存する。自動選択や編集対象の切替では保存しない。
    try {
      if (next) localStorage.setItem(positionStorageKey, JSON.stringify(next))
      else localStorage.removeItem(positionStorageKey)
    } catch {
      // 位置の保存が使えなくても選択・追加はできる。
    }
    setError('')
  }
  const selectItem = (key: string, selection: CatalogSelection) => {
    const previousSelection = selected[key] ?? emptySelection
    if (!selection.options.length) {
      setItemPositions(previous => {
        const next = { ...previous }
        delete next[key]
        return next
      })
      setPositionOrder(previous => previous.filter(candidate => candidate !== key))
    } else {
      if (!previousSelection.options.length) {
        const item = entries.find(candidate => candidate.key === key)
        if (master && item) {
          const next = initialItemPosition(master, item, position)
          setItemPositions(previous => ({ ...previous, [key]: next }))
        }
      }
      // 摘要の編集やチェック解除では、位置の欄で直す品目を変えない。
      if (selection.options.some(option => !previousSelection.options.includes(option))) {
        setPositionOrder(previous => [...previous.filter(candidate => candidate !== key), key])
      }
    }
    setSelected(previous => ({ ...previous, [key]: selection }))
    setError('')
  }
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
      <button role="tab" id="quantity-master-breakdown-tab" aria-selected={tab === 'breakdown'} aria-controls="quantity-master-breakdown-panel" onClick={() => { setTab('breakdown'); setError('') }}>内訳書から選ぶ</button>
    </div>}
    {!sources ? <>
    <div role="tabpanel" id="quantity-master-spec-panel" aria-labelledby="quantity-master-spec-tab" hidden={!specTab}>
      {master && <fieldset className="catalog-position" aria-label="内訳書の位置">
        <legend>内訳書の位置</legend>
        <label>編<select aria-label="位置の編" value={position?.book ?? ''}
          onChange={event => choosePosition(positions.find(entry => entry.book === event.currentTarget.value))}>
          <option value="">付けない</option>
          {books.map(book => <option key={book} value={book}>{book}</option>)}
        </select></label>
        <label>種目<select aria-label="位置の種目" value={position?.section ?? ''} disabled={!position}
          onChange={event => choosePosition(bookEntries.find(entry => entry.section === event.currentTarget.value))}>
          {!position && <option value="">—</option>}
          {sections.map(section => <option key={section} value={section}>{section}</option>)}
        </select></label>
        <label>科目<select aria-label="位置の科目" value={position?.subject ?? ''} disabled={!position}
          onChange={event => choosePosition(sectionEntries.find(entry => entry.subject === event.currentTarget.value))}>
          {!position && <option value="">—</option>}
          {subjects.map(subject => <option key={subject} value={subject}>{subject}</option>)}
        </select></label>
        <label>中科目<select aria-label="位置の中科目" value={position?.middle ?? ''} disabled={!position}
          onChange={event => choosePosition(subjectEntries.find(entry => (entry.middle ?? '') === event.currentTarget.value))}>
          {!position && <option value="">—</option>}
          {middles.map(middle => <option key={middle} value={middle}>{middle || '（中科目なし）'}</option>)}
        </select></label>
      </fieldset>}
      <label className="quantity-master-search">検索<input ref={searchInput} aria-label="標準マスタを検索" type="search" value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="例: 60、PF22、400x250、分電盤" /></label>
      {!master && !loadError && <p role="status">標準マスタを読み込んでいます…</p>}
      {loadError && <><p role="alert">標準マスタを読み込めませんでした: {loadError}</p><button onClick={() => setRetry(n => n + 1)}>もう一度読み込む</button></>}
      {master && <div className={`quantity-master-browser${searching ? ' quantity-master-search-results' : ''}`}>
        {!searching && <>
          <div className="quantity-master-navigation" role="group" aria-label="標準マスタの分野"><h3>分野</h3>{fields.map(f => <button key={f} aria-pressed={f === masterField} onClick={() => changeField(f)}>{f}</button>)}</div>
          <div className="quantity-master-navigation" role="group" aria-label="標準マスタの分類"><h3>分類</h3>{categories.map(c => <button key={c} aria-pressed={c === category} onClick={() => changeCategory(c)}>{c}</button>)}</div>
          <div className="quantity-master-navigation" role="group" aria-label="標準マスタの種類"><h3>種類</h3>{types.map(t => <button key={t} aria-pressed={t === type} onClick={() => setType(t)}>{t}（{entries.filter(item => item.field === masterField && item.category === category && item.type === t).reduce((count, item) => count + item.options.length, 0)}件）</button>)}</div>
        </>}
        <div className="quantity-master-specs">
          <h3>{searching ? `検索結果（${result.total}件）` : `${type}の規格`}</h3>
          <div className="fixture-presets">{visible.map(item => <CatalogChooser
            key={item.key}
            item={item}
            selection={selected[item.key] ?? emptySelection}
            onChange={selection => selectItem(item.key, selection)}
            existing={existing}
            fixtures={fixtures}
            position={selected[item.key]?.options.length
              ? itemPositions[item.key]
              : initialItemPosition(master, item, position)}
            onChangePosition={next => {
              setItemPositions(previous => ({ ...previous, [item.key]: { ...next } }))
              setPositionOrder(previous => [
                ...previous.filter(key => key !== item.key),
                item.key,
              ])
              setError('')
            }}
            onEditPosition={() => setPositionOrder(previous => [
              ...previous.filter(key => key !== item.key),
              item.key,
            ])}
            positionActive={activeItem === item.key}
            catalog={master}
          />)}</div>
          {searching && result.total === 0 && <p>該当する項目がありません。</p>}
          {searching && result.total > result.shown && <p>ほか {result.total - result.shown} 件。言葉を足して絞り込んでください</p>}
        </div>
      </div>}
    </div>
    <div role="tabpanel" id="quantity-master-breakdown-panel" aria-labelledby="quantity-master-breakdown-tab" hidden={!breakdownTab}>
      {master && <BreakdownPicker fixtures={fixtures} onChange={onBreakdownChange} />}
      {!master && !loadError && <p role="status">内訳書のマスタを読み込んでいます…</p>}
      {loadError && <><p role="alert">標準マスタを読み込めませんでした: {loadError}</p><button onClick={() => setRetry(n => n + 1)}>もう一度読み込む</button></>}
    </div>
    </> : <div>
      <label>PDF<select aria-label="読込元PDF" value={field} onChange={e => { setField(e.currentTarget.value); setUnchecked(new Set()); setError('') }}>
        {sources.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
      </select></label>
      {!items?.length && <p>数量拾いを持つPDFがありません。</p>}
      <div className="fixture-presets">{items?.map((f, i) => <label key={i}><input type="checkbox" checked={!unchecked.has(i)} onChange={e => { const checked = e.currentTarget.checked; setUnchecked(previous => { const next = new Set(previous); if (checked) next.delete(i); else next.add(i); return next }) }} />
        {isFixture(f) && (!f.kind || f.kind === 'count') && <svg className="fixture-swatch" viewBox="-16 -16 32 32" aria-hidden="true"><CountMarker style={f.style} showCode={false} /></svg>}{isFixture(f) && f.kind && f.kind !== 'count' && <QuantitySwatch fixture={f} />}{f.category}／{fixtureCode(f)} {f.name}{kindLabel(f)}
      </label>)}</div>
    </div>}
    {error && <p role="alert">{error}</p>}
    {addedNotice && <p role="status">{addedNotice}</p>}
    <div className="dialog-actions"><button onClick={onClose}>閉じる</button><button disabled={sources ? !items.some((_, i) => !unchecked.has(i)) : combined.length === 0 || Boolean(combinedError)} onClick={async () => {
      try {
        const selectedItems = sources ? items.filter((_, i) => !unchecked.has(i)) : combined
        const linkedNames: string[] = []
        let rcGuidance = ''
        if (sources) onAdd(selectedItems)
        else {
          const { fixtureFromPreset } = await import('../core/quantityMaster')
          const available = [...fixtures]
          const additions = selectedItems.map(item => {
            const fixture = fixtureFromPreset(item, available)
            available.push(fixture)
            return fixture
          })
          // 今回追加する項目をすべて揃えてから、自動の元の有無を判定する。
          for (const fixture of additions) {
            const rule = master!.catalogLinkRuleForPreset(fixture)
            if (rule) {
              if (rule.kind === 'rc' || rule.kind === 'shape'
                || rule.kind === 'crossing' || rule.kind === 'steel') {
                // 質量を出す鉄骨の規則は細目の単位が t なので常に連動の項目にする。
                // 単位の判定は内訳書の細目の単位で行う（quantityUnit は表示用の m³ などを返す）。
                const unsupportedUnit = (rule.kind === 'steel' && rule.steel?.output === 'mass')
                  || entries.some(entry =>
                  kindForUnit(entry.unit) === undefined
                  && entry.options.some(option =>
                    option.name === fixture.name
                    && (option.kind ?? 'count') === (fixture.kind ?? 'count')
                    && (option.method ?? 'click') === (fixture.method ?? 'click')
                    && (option.spec ?? '') === (fixture.spec ?? '')
                    && (!option.code || option.code === fixture.code)),
                )
                let hasSource: boolean
                if (rule.kind === 'crossing') {
                  const words = rule.crossing?.barrierNameIncludes ?? []
                  hasSource = words.length > 0 && available.some(original =>
                    original.id !== fixture.id && !original.link
                    && ['polyline', 'polygon', 'polygonDepth'].includes(quantityMethod(original))
                    && words.some(word => original.name.includes(word)))
                } else if (rule.kind === 'steel') {
                  hasSource = available.some(original =>
                    original.id !== fixture.id && !original.link && original.steel !== undefined)
                } else {
                  const hasAutoCondition = Object.values(rule.auto)
                    .some(value => value !== undefined)
                  hasSource = hasAutoCondition && fixtureLinkSources(available, {
                    ...fixture,
                    link: { kind: rule.kind, sources: [], auto: rule.auto },
                  }).length > 0
                }
                if (!unsupportedUnit && !hasSource) continue
              }
              const carryClass = fixture.summary?.some(field =>
                field.label.trim() === '区分' && field.value.trim() === '容積品')
                ? 'bulky' as const : 'heavy' as const
              fixture.link = {
                kind: rule.waste ? 'mass' : rule.kind,
                sources: [],
                ...(linkRuleAuto(rule) !== undefined ? { auto: linkRuleAuto(rule) } : {}),
                ...(rule.factor !== undefined ? { factor: rule.factor } : {}),
                ...(rule.kind === 'rc' && rule.rc !== undefined ? { rc: { ...rule.rc } } : {}),
                ...(rule.kind === 'shape' && rule.shape !== undefined ? { shape: { ...rule.shape } } : {}),
                ...(rule.kind === 'crossing' && rule.crossing !== undefined ? {
                  crossing: {
                    ...rule.crossing,
                    ...(rule.crossing.barrierItemIds !== undefined
                      ? { barrierItemIds: [...rule.crossing.barrierItemIds] } : {}),
                    ...(rule.crossing.barrierNameIncludes !== undefined
                      ? { barrierNameIncludes: [...rule.crossing.barrierNameIncludes] } : {}),
                  },
                } : {}),
                ...(rule.kind === 'steel' && rule.steel !== undefined ? {
                  steel: { ...rule.steel },
                } : {}),
                ...(rule.kind === 'carry' ? { carry: { class: carryClass } } : {}),
              }
              delete fixture.convert
              delete fixture.rc
              delete fixture.steel
              linkedNames.push(fixture.name + (rule.kind === 'carry'
                ? `（${carryClass === 'bulky' ? '容積品' : '重量品'}）` : ''))
            }
          }
          const rcLinkedNames = unique(additions
            .filter(fixture => fixture.link?.kind === 'rc')
            .map(fixture => fixture.name))
          if (rcLinkedNames.length && !available.some(fixture =>
            !fixture.link && fixture.rc !== undefined)) {
            rcGuidance = `${rcLinkedNames.join('、')}は RC 部材の項目から計算します。コンクリートの項目を開き「RC 部材」で配筋を入れてください。`
          }
          onAdd(additions, {
            rank: fixture => fixture.breakdown
              ? appendOrder.rows.get(quantityBreakdownRowKey(fixture.breakdown))?.index
              : undefined,
          })
        }
        if (linkedNames.length) {
          setAddedNotice(`連動の規則を付けました: ${unique(linkedNames).join('、')}${rcGuidance ? ` ${rcGuidance}` : ''}`)
          setSelected({})
          setItemPositions({})
          setPositionOrder([])
        } else onClose()
      } catch (reason) { setError(String(reason)) }
    }}>{sources ? '選んだ項目を追加' : `選んだ項目を追加（${combined.length}件）`}</button></div>
  </dialog>
}
