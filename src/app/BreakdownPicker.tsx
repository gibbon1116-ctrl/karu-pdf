import { useEffect, useMemo, useState, type JSX } from 'react'
import {
  BREAKDOWN_BOOKS,
  fixtureIdentity,
  type BreakdownBook,
  type CountFixture,
  type FixturePreset,
} from '../core/countFixtures'
import { breakdownEntries, kindForUnit, searchBreakdown, type BreakdownEntry } from '../core/breakdownMaster'
import type { CatalogItem, CatalogSelection } from '../core/catalog'
import CatalogChooser from './CatalogChooser'

type MasterModule = typeof import('../core/catalog')
type Hierarchy = {
  book: BreakdownBook
  section: string
  subject: string
  middle: string
}
type Target = {
  key: string
  entry: BreakdownEntry
  item: CatalogItem
}

const emptySelection: CatalogSelection = { options: [] }
const targetKey = (entry: BreakdownEntry, item: CatalogItem) => JSON.stringify([entry.key, item.key])
const typeKey = (entry: BreakdownEntry, index: number, type: string) => JSON.stringify([entry.key, index, type])
const unique = (values: readonly string[]) => [...new Set(values)]
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

function hierarchyFor(entry?: BreakdownEntry, book: BreakdownBook = '電気設備'): Hierarchy {
  return {
    book: entry?.book ?? book,
    section: entry?.section ?? '',
    subject: entry?.subject ?? '',
    middle: entry?.middle ?? '',
  }
}




export default function BreakdownPicker({ fixtures, onChange }: {
  fixtures: readonly CountFixture[]
  /** 選択が変わるたびに、作る予定の項目（重複を含む）と誤りを渡す */
  onChange(result: { presets: FixturePreset[]; error?: string }): void
}): JSX.Element {
  const [master, setMaster] = useState<MasterModule | null>(null)
  const [loadError, setLoadError] = useState(''), [retry, setRetry] = useState(0)
  const [query, setQuery] = useState('')
  const [hierarchy, setHierarchy] = useState<Hierarchy>(() => hierarchyFor())
  const [selected, setSelected] = useState<Record<string, CatalogSelection>>({})
  const [expandedRows, setExpandedRows] = useState(new Set<string>())
  const [expandedTypes, setExpandedTypes] = useState(new Set<string>())

  useEffect(() => {
    let alive = true
    setLoadError('')
    void import('../core/catalog').then(module => {
      if (!alive) return
      setHierarchy(hierarchyFor(breakdownEntries()[0]))
      setMaster(module)
    }).catch(reason => {
      if (alive) setLoadError(errorText(reason))
    })
    return () => { alive = false }
  }, [retry])

  const entries = useMemo(() => master ? breakdownEntries() : [], [master])
  const existing = useMemo(() => new Set(fixtures.map(fixtureIdentity)), [fixtures])
  const books = useMemo(() => new Set(entries.map(entry => entry.book)), [entries])
  const bookEntries = useMemo(() => entries.filter(entry => entry.book === hierarchy.book), [entries, hierarchy.book])
  const sections = useMemo(() => unique(bookEntries.map(entry => entry.section)), [bookEntries])
  const sectionEntries = useMemo(() => bookEntries.filter(entry => entry.section === hierarchy.section), [bookEntries, hierarchy.section])
  const subjects = useMemo(() => unique(sectionEntries.map(entry => entry.subject)), [sectionEntries])
  const subjectEntries = useMemo(() => sectionEntries.filter(entry => entry.subject === hierarchy.subject), [sectionEntries, hierarchy.subject])
  const middles = useMemo(() => unique(subjectEntries.map(entry => entry.middle ?? '')), [subjectEntries])
  const groupEntries = useMemo(() => subjectEntries.filter(entry => (entry.middle ?? '') === hierarchy.middle), [subjectEntries, hierarchy.middle])
  const searching = Boolean(query.trim())
  const result = useMemo(() => master ? searchBreakdown(query) : { entries: [], total: 0 }, [master, query])
  const visible = searching ? result.entries : groupEntries

  const targets = useMemo(() => {
    const next: Target[] = []
    if (!master) return next
    const seen = new Set<string>()
    for (const entry of entries) {
      for (const item of master.catalogItemsForBreakdownRow(entry)) {
        const key = targetKey(entry, item)
        if (seen.has(key)) continue
        seen.add(key)
        next.push({ key, entry, item })
      }
    }
    return next
  }, [entries, master])
  const targetsByKey = useMemo(() => new Map(targets.map(target => [target.key, target])), [targets])

  const planned = useMemo(() => {
    const presets: FixturePreset[] = []
    let error: string | undefined
    if (!master) return { presets, error: loadError || undefined }

    for (const target of targets) {
      const selection = selected[target.key]
      if (!selection) continue
      const { entry, item } = target
      try {
        presets.push(...master.catalogPresets(item, selection, {
          book: entry.book,
          section: entry.section,
          subject: entry.subject,
          ...(entry.middle ? { middle: entry.middle } : {}),
          item: entry.row.name,
        }))
      } catch (reason) {
        error ??= errorText(reason)
      }
    }
    return { presets, error }
  }, [master, loadError, targets, selected])

  useEffect(() => {
    onChange({
      presets: planned.presets,
      ...(planned.error ? { error: planned.error } : {}),
    })
  }, [planned, onChange])

  const select = (key: string, selection: CatalogSelection) => setSelected(previous => ({
    ...previous,
    [key]: selection,
  }))
  const toggleRow = (key: string) => setExpandedRows(previous => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const toggleType = (key: string) => setExpandedTypes(previous => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const chooser = (entry: BreakdownEntry, item: CatalogItem) => {
    const target = targetsByKey.get(targetKey(entry, item))
    if (!target || !master) return null
    const selection = selected[target.key] ?? emptySelection
    const defaultSymbol = target.item.defaultSymbolFromCode
      && target.item.slots.some(slot =>
        slot.label === '記号' && !slot.condition && !slot.choices?.length,
      )
      ? target.item.options[0]?.code
      : undefined
    return <CatalogChooser
      key={target.key}
      item={target.item}
      selection={defaultSymbol
        ? { ...selection, text: { 記号: defaultSymbol, ...selection.text } }
        : selection}
      onChange={selection => select(target.key, selection)}
      existing={existing}
      position={{
        book: entry.book,
        section: entry.section,
        subject: entry.subject,
        ...(entry.middle ? { middle: entry.middle } : {}),
        item: entry.row.name,
      }}
      catalog={master}
    />
  }
  const name = (entry: BreakdownEntry) => <>
    {entry.row.name}
    {entry.row.renovation && <span title="改修工事の際に必要となる項目の例">※</span>}
  </>

  const detail = (entry: BreakdownEntry, index: number) => {
    const template = entry.details[index]
    const items = master!.catalogItemsForBreakdownRow({ ...entry, details: [template] })
    const key = JSON.stringify([entry.key, index])
    if (!items.length && !template.master && !template.variants && !kindForUnit(template.unit)) {
      return <div className="breakdown-detail" key={key}>
        <label className="breakdown-disabled">
          <input type="checkbox" disabled aria-label={`${template.name}（${template.unit}）`} />
          <span>{template.name}（{template.unit}） （連動で計算する予定）</span>
        </label>
      </div>
    }
    if (!template.master) {
      return <div className="breakdown-detail" key={key}>
        {items.map(item => chooser(entry, item))}
      </div>
    }
    const types = unique(items.map(item => item.type))
    return <div className="breakdown-detail" key={key}>
      <h4>{template.name}（{template.unit}）</h4>
      <div className="breakdown-master-types">
        {types.map(type => {
          const key = typeKey(entry, index, type)
          const expanded = expandedTypes.has(key)
          return <div key={type}>
            <button type="button"
              aria-label={`${template.name}の種類 ${type}`}
              aria-expanded={expanded}
              onClick={() => toggleType(key)}
            >{type}</button>
            {expanded && <div className="breakdown-master-specs">
              {items.filter(item => item.type === type).map(item => chooser(entry, item))}
            </div>}
          </div>
        })}
      </div>
    </div>
  }




  return <>
    <label className="quantity-master-search">検索
      <input type="search"
        aria-label="内訳書を検索"
        placeholder="例: 電灯分岐 分電盤、感知器、電線管"
        value={query}
        onChange={event => setQuery(event.currentTarget.value)}
      />
    </label>
    {!master && !loadError && <p role="status">内訳書のマスタを読み込んでいます…</p>}
    {loadError && <>
      <p role="alert">内訳書のマスタを読み込めませんでした: {loadError}</p>
      <button type="button" onClick={() => setRetry(value => value + 1)}>もう一度読み込む</button>
    </>}
    {master && <div className={`quantity-master-browser breakdown-browser${searching ? ' quantity-master-search-results' : ''}`}>
      {!searching && <>
        <div className="quantity-master-navigation" role="group" aria-label="内訳書の編">
          <h3>編</h3>
          {BREAKDOWN_BOOKS.map(book => <button type="button" key={book}
            disabled={!books.has(book)}
            title={books.has(book) ? undefined : '準備中'}
            aria-pressed={hierarchy.book === book}
            onClick={() => setHierarchy(hierarchyFor(entries.find(entry => entry.book === book), book))}
          >{book}</button>)}
        </div>
        <div className="quantity-master-navigation" role="group" aria-label="内訳書の種目">
          <h3>種目</h3>
          {sections.map(section => <button type="button" key={section}
            aria-pressed={hierarchy.section === section}
            onClick={() => setHierarchy(hierarchyFor(bookEntries.find(entry => entry.section === section), hierarchy.book))}
          >{section}</button>)}
        </div>
        <div className="quantity-master-navigation" role="group" aria-label="内訳書の科目">
          <h3>科目</h3>
          {subjects.map(subject => <button type="button" key={subject}
            aria-pressed={hierarchy.subject === subject}
            onClick={() => setHierarchy(hierarchyFor(sectionEntries.find(entry => entry.subject === subject), hierarchy.book))}
          >{subject}</button>)}
        </div>
        <div className="quantity-master-navigation" role="group" aria-label="内訳書の中科目">
          <h3>中科目</h3>
          {middles.length === 1 && middles[0] === ''
            ? <p>（中科目なし）</p>
            : middles.map(middle => <button type="button" key={middle}
              aria-pressed={hierarchy.middle === middle}
              onClick={() => setHierarchy(previous => ({ ...previous, middle }))}
            >{middle || '（中科目なし）'}</button>)}
        </div>
      </>}
      <div className="quantity-master-specs">
        <h3>{searching ? `検索結果（${result.total}件）` : `${hierarchy.middle || hierarchy.subject}の細目`}</h3>
        <div className="fixture-presets">
          {visible.map(entry => {
            const row = entry.row
            const items = master.catalogItemsForBreakdownRow(entry)
            const rowMasters = row.separate
              ? []
              : items.filter(item => item.key.startsWith('master:'))
            return <div className="breakdown-row" key={entry.key}>
              {searching && <small className="breakdown-location">
                {entry.subject}／{entry.middle ? `${entry.middle}／` : ''}
              </small>}
              {/* 拾えない単位（t など）でも連動の規則がある細目は品目があり、連動の項目として追加できる */}
              {!row.separate && items.length ? <>
                {rowMasters.length > 0 && <>
                  <div className="breakdown-row-heading">
                    <span>{name(entry)}</span><span>{row.unit}</span>
                    <button type="button"
                      aria-expanded={expandedRows.has(entry.key)}
                      onClick={() => toggleRow(entry.key)}
                    >器具を選ぶ（{rowMasters.length}）</button>
                  </div>
                  {expandedRows.has(entry.key) && <div className="breakdown-master-types">
                    {rowMasters.map(item => {
                      const key = typeKey(entry, -1, item.type)
                      const expanded = expandedTypes.has(key)
                      return <div key={item.key}>
                        <button type="button"
                          aria-label={`${entry.row.name}の種類 ${item.type}`}
                          aria-expanded={expanded}
                          onClick={() => toggleType(key)}
                        >{item.type} {item.name}</button>
                        {expanded && <div className="breakdown-master-specs">
                          {chooser(entry, item)}
                        </div>}
                      </div>
                    })}
                  </div>}
                </>}
                {!rowMasters.length && row.renovation
                  && <span title="改修工事の際に必要となる項目の例">※</span>}
                {items.filter(item => !item.key.startsWith('master:')).map(item => chooser(entry, item))}
              </> : row.separate && entry.details.length > 0 ? <>
                <div className="breakdown-row-heading">
                  <span>{name(entry)}</span><span>1式 別紙明細</span>
                  <button type="button"
                    aria-expanded={expandedRows.has(entry.key)}
                    onClick={() => toggleRow(entry.key)}
                  >明細を選ぶ（{entry.details.length}）</button>
                </div>
                {expandedRows.has(entry.key) && entry.details.map((_, index) => detail(entry, index))}
              </> : row.separate ? <p className="breakdown-disabled">
                {name(entry)} 1式（数量なし）
              </p> : <p className="breakdown-disabled">
                {name(entry)}（{row.unit}） （拾えない単位）
              </p>}
            </div>
          })}
        </div>
        {searching && result.total === 0 && <p>該当する細目がありません。</p>}
        {searching && result.total > result.entries.length && <p>
          ほか {result.total - result.entries.length} 件。言葉を足して絞り込んでください
        </p>}
      </div>
    </div>}

  </>
}
