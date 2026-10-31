import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import { flattenOutline, validateOutlineItems, type OutlineItem } from '../core/outlineModel'
import { bodyPageEntries, buildTocOutline, detectPrintedPageNumber, detectTocPageRange, estimatePageOffset, inferTocShapeLevels, isDrawingList, locateDrawingNumbers, locateTocEntries, parseTocEntries, splitDrawingListTitle, tocLevelsByIndent, tocNeedsBodySearch, type TocBodyPage, type TocEntry, type TocPageText, type TocShapeInfo } from '../core/tocImport'
import type { DocumentSession } from './documentModel'
import type { OutlineDraft } from './OutlineDraft'
import './OutlinePanel.css'

export function OutlineFromTocDialog({ session, pool, draft, onClose, onChange }: {
  session: DocumentSession; pool: PdfWorkerPool; draft: OutlineDraft; onClose(): void; onChange(): void
}) {
  const ref = useRef<HTMLDialogElement>(null), generation = useRef(0), cache = useRef(new Map<number, TocPageText>())
  const pageCount = session.pageSizes.length
  const [first, setFirst] = useState(1), [last, setLast] = useState(Math.min(40, pageCount))
  const [loadedRange, setLoadedRange] = useState<{ first: number; last: number } | null>(null)
  const [entries, setEntries] = useState<TocEntry[]>([]), [shapes, setShapes] = useState<TocShapeInfo[]>([])
  const [method, setMethod] = useState<'shape' | 'indent'>('shape'), [offset, setOffset] = useState(0)
  const [pageMethod, setPageMethod] = useState<'printed' | 'body' | 'drawing'>('printed')
  const [bodyPages, setBodyPages] = useState<(number | null)[] | null>(null), [bodyMessage, setBodyMessage] = useState('')
  const [mapping, setMapping] = useState(''), [rangeMessage, setRangeMessage] = useState('')
  const [maxDepth, setMaxDepth] = useState(3), [includeLabel, setIncludeLabel] = useState(true)
  const [included, setIncluded] = useState(new Set<string>()), [titles, setTitles] = useState(new Map<string, string>())
  const [pageOverrides, setPageOverrides] = useState(new Map<string, number>())
  const [invalidPages, setInvalidPages] = useState(new Map<string, string>())
  const pageInputs = useRef(new Map<string, HTMLInputElement>()), lastClicked = useRef<number | null>(null)
  const drawingInitialized = useRef(false)
  const [mode, setMode] = useState<'append' | 'replace'>('append'), [error, setError] = useState('')
  const [busy, setBusy] = useState(true), [progress, setProgress] = useState(''), [noText, setNoText] = useState(false)
  const [scrollTop, setScrollTop] = useState(0), [editing, setEditing] = useState<{ id: string; value: string } | null>(null)
  useSyncExternalStore(draft.subscribe, draft.getSnapshot)
  const editable = !session.editRestriction && draft.base.editable && session.outlineDraft === draft
  const rangeChanged = !loadedRange || loadedRange.first !== first || loadedRange.last !== last
  const oldItems = flattenOutline(draft.getItems() as OutlineItem[])

  const close = () => { generation.current++; onClose() }
  async function searchBody(parsed: TocEntry[], to: number, token: number) {
    setBodyPages(null); setBodyMessage('')
    setProgress(`本文の文字を読み取っています（0 / ${pageCount - to - 1} ページ）`)
    const pages: TocBodyPage[] = []
    let unreadable = 0
    for (let from = to + 1; from < pageCount; from += 8) {
      if (token !== generation.current) return
      const indices = Array.from({ length: Math.min(8, pageCount - from) }, (_, i) => from + i)
      const missing = indices.filter(index => !cache.current.has(index))
      const read = missing.length ? await pool.pageTextBlocks(session.docId, missing) : []
      if (token !== generation.current) return
      // Keep only body strings after each batch, rather than retaining every
      // structured text block for the rest of the dialog's lifetime.
      const batch = new Map(read.map(page => [page.pageIndex, page]))
      for (const pageIndex of indices) {
        const page = cache.current.get(pageIndex) ?? batch.get(pageIndex)
        const body = page ? bodyPageEntries(page) : { pageIndex, lines: [] }
        if (!page || page.unreliable || !body.lines.length) unreadable++
        pages.push(body)
      }
      setProgress(`本文の文字を読み取っています（${pages.length} / ${pageCount - to - 1} ページ）`)
    }
    if (token !== generation.current) return
    if (!pages.length || unreadable >= pages.length * .5) {
      setBodyMessage('本文の文字を読み取れないため、見出しを探せません')
      return
    }
    // Lines shared by most pages stay searchable: a form title such as "（細目別内訳）"
    // heads most sheets, and the ordered match already picks the first sheet of a run.
    const found = locateTocEntries(parsed, pages, to + 1)
    setBodyPages(found)
    setBodyMessage(`本文から ${found.filter(page => page !== null).length} / ${parsed.length} 項目の位置が見つかりました（見つからない項目は、子項目のページを使うか、含めません）`)
  }
  async function searchDrawings(parsed: TocEntry[], start: number, token: number) {
    setBodyPages(null); setBodyMessage('')
    const pages: TocPageText[] = [], total = pageCount - start
    setProgress(`図面の文字を読み取っています（0 / ${total} ページ）`)
    for (let from = start; from < pageCount; from += 8) {
      if (token !== generation.current) return
      const indices = Array.from({ length: Math.min(8, pageCount - from) }, (_, i) => from + i)
      const missing = indices.filter(index => !cache.current.has(index))
      const read = missing.length ? await pool.pageTextBlocks(session.docId, missing) : []
      if (token !== generation.current) return
      const batch = new Map(read.map(page => [page.pageIndex, page]))
      for (const index of indices) {
        const page = cache.current.get(index) ?? batch.get(index)
        if (page) pages.push(page)
      }
      setProgress(`図面の文字を読み取っています（${Math.min(from + 8, pageCount) - start} / ${total} ページ）`)
    }
    if (token !== generation.current) return
    const drawings = parsed.flatMap(entry => {
      const row = splitDrawingListTitle(entry.title)
      return row ? [{ id: entry.id, ...row }] : []
    })
    const found = locateDrawingNumbers(drawings, pages, start), byId = new Map(drawings.map((row, i) => [row.id, found[i]]))
    setBodyPages(parsed.map(entry => byId.get(entry.id) ?? null))
    setBodyMessage(`図面番号から ${found.filter(page => page !== null).length} / ${drawings.length} 項目のページが見つかりました`)
  }
  async function estimatePrinted(to: number, token: number) {
    const end = Math.min(pageCount - 1, to + 12)
    for (let from = to + 1; from <= end; from += 8) {
      const missing = Array.from({ length: Math.min(8, end - from + 1) }, (_, i) => from + i).filter(i => !cache.current.has(i))
      if (token !== generation.current) return
      const read = missing.length ? await pool.pageTextBlocks(session.docId, missing) : []
      if (token !== generation.current) return
      read.forEach(page => cache.current.set(page.pageIndex, page))
    }
    if (token !== generation.current) return
    const samples = Array.from({ length: end - to }, (_, i) => cache.current.get(to + 1 + i)!).filter(Boolean)
    const estimate = estimatePageOffset(samples.map(page => ({ pageIndex: page.pageIndex, printed: detectPrintedPageNumber(page) })))
    setOffset(estimate?.offset ?? to)
    setMapping(estimate ? `${samples.length} ページ中 ${estimate.agreeing} ページで一致（番号を読めた標本 ${estimate.total} ページ・推定）` : '推定できませんでした。目次の次のページを印刷上の 1 ページとしています')
  }
  async function changePageMethod(next: 'printed' | 'body' | 'drawing') {
    const token = ++generation.current
    setPageMethod(next); setBusy(true); setError(''); setProgress(''); setBodyPages(null); setBodyMessage('')
    if (next === 'drawing' && !drawingInitialized.current) {
      drawingInitialized.current = true
      setIncluded(previous => new Set(entries.filter(entry => previous.has(entry.id) && splitDrawingListTitle(entry.title)).map(entry => entry.id)))
    }
    try {
      if (!loadedRange) return
      if (next === 'drawing') await searchDrawings(entries, loadedRange.first - 1, token)
      else if (next === 'body') await searchBody(entries, loadedRange.last - 1, token)
      else await estimatePrinted(loadedRange.last - 1, token)
    } catch (reason) { if (token === generation.current) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (token === generation.current) { setBusy(false); setProgress('') } }
  }
  const cancelSearch = () => {
    generation.current++; setBusy(false); setProgress(''); setBodyPages(null); setBodyMessage(pageMethod === 'drawing' ? '図面の読み取りを取り消しました' : '本文の読み取りを取り消しました')
  }
  async function load(automatic: boolean) {
    const token = ++generation.current
    setBusy(true); setError(''); setRangeMessage(''); setNoText(false); setEditing(null); setBodyPages(null); setBodyMessage('')
    const current = () => token === generation.current
    async function read(from: number, to: number) {
      const missing = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i).filter(i => !cache.current.has(i))
      for (let i = 0; i < missing.length; i += 8) {
        if (!current()) return false
        setProgress(`文字を読み取っています（${Math.min(i + 8, missing.length)} / ${missing.length} ページ）`)
        const pages = await pool.pageTextBlocks(session.docId, missing.slice(i, i + 8))
        if (!current()) return false
        pages.forEach(page => cache.current.set(page.pageIndex, page))
      }
      return current()
    }
    try {
      let from = first - 1, to = last - 1
      if (automatic) {
        if (!await read(0, Math.min(40, pageCount) - 1)) return
        const initial = [...cache.current.values()], range = detectTocPageRange(initial)
        if (!range) {
          setRangeMessage('目次ページが見つかりませんでした。範囲を入力してください')
          setNoText(!initial.some(page => page.lines.some(line => line.text.trim())))
          return
        }
        from = range.first; to = range.last; setFirst(from + 1); setLast(to + 1)
      }
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= pageCount) throw new Error('目次ページの範囲を正しく入力してください。')
      if (!await read(from, to)) return
      const selected = Array.from({ length: to - from + 1 }, (_, i) => cache.current.get(from + i)!)
      const parsed = parseTocEntries(selected), inferred = inferTocShapeLevels(parsed)
      const drawingList = isDrawingList(parsed), drawingRows = parsed.map(entry => splitDrawingListTitle(entry.title))
      drawingInitialized.current = drawingList
      const firstDrawing = drawingRows.findIndex(Boolean), lastDrawing = drawingRows.map(Boolean).lastIndexOf(true)
      // Leading titles do not nest a flat drawing list. Preserve inference when
      // headings are interspersed between drawings (e.g. separate disciplines).
      if (drawingList && drawingRows.slice(firstDrawing, lastDrawing + 1).every(Boolean)) inferred.forEach(shape => { shape.level = 1 })
      setLoadedRange({ first: from + 1, last: to + 1 })
      setEntries(parsed); setShapes(inferred); setIncluded(new Set(parsed.filter((_, i) => !drawingList || drawingRows[i]).map(e => e.id))); setTitles(new Map()); setScrollTop(0)
      setPageOverrides(new Map()); setInvalidPages(new Map()); lastClicked.current = null
      // A short contents list goes in whole; a long one (a 1,000-entry specification) starts at three levels.
      const deepest = Math.max(1, ...inferred.map(shape => shape.level ?? 1))
      setMaxDepth(parsed.length <= 300 ? deepest : Math.min(3, deepest))
      setNoText(!selected.some(page => page.lines.some(line => line.text.trim())))
      setOffset(to)
      setMapping('推定できませんでした。目次の次のページを印刷上の 1 ページとしています')
      const next = drawingList ? 'drawing' : tocNeedsBodySearch(parsed) ? 'body' : 'printed'
      setPageMethod(next)
      if (next === 'drawing') await searchDrawings(parsed, from, token)
      else if (next === 'body') await searchBody(parsed, to, token)
      else await estimatePrinted(to, token)
    } catch (reason) { if (current()) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (current()) { setBusy(false); setProgress('') } }
  }
  useEffect(() => {
    ref.current?.showModal()
    void load(true)
    return () => { generation.current++; cache.current.clear() }
  }, [session, pool])

  const namedEntries = useMemo(() => entries.map(entry => {
    const row = pageMethod === 'drawing' ? splitDrawingListTitle(entry.title) : null
    return row ? { ...entry, label: row.number, title: row.name } : entry
  }), [entries, pageMethod])
  const inferredLevels = useMemo(() => new Map(inferTocShapeLevels(entries).map(shape => [shape.shape, shape.level])), [entries])
  const levels = useMemo(() => {
    if (method === 'indent') return tocLevelsByIndent(entries, 8)
    const shapeLevels = new Map(shapes.map(shape => [shape.shape, shape.level]))
    return entries.map(entry => shapeLevels.get(entry.shape) ?? null)
  }, [entries, shapes, method])
  const eligible = useMemo(() => new Set(entries.filter((_, i) => levels[i] !== null && levels[i]! <= maxDepth).map(entry => entry.id)), [entries, levels, maxDepth])
  const resolvedPages = useMemo(() => entries.map((entry, i) => {
    // NaN keeps invalid explicit values unresolved instead of borrowing a child's page.
    if (invalidPages.has(entry.id)) return NaN
    if (pageOverrides.has(entry.id)) return pageOverrides.get(entry.id)!
    return pageMethod !== 'printed' ? bodyPages?.[i] ?? null : entry.printedNumber === null ? null : entry.printedNumber + offset
  }), [entries, pageMethod, bodyPages, offset, pageOverrides, invalidPages])
  const bodyPending = pageMethod !== 'printed' && bodyPages === null
  // Use neutral titles for page resolution, so an unfinished title edit cannot
  // break the preview. Resolve headings against the actually included children.
  const preview = useMemo(() => {
    const resolve = (depths: (number | null)[], selected: ReadonlySet<string>, depth: number) => {
      const result = buildTocOutline(entries, depths, { offset, pageCount, maxDepth: depth, includeLabel: false, included: selected, titles: new Map(entries.map(e => [e.id, '候補'])), pages: resolvedPages })
      const unresolved = new Set(result.unresolved), flat = flattenOutline(result.items), pages = new Map<string, number>()
      let index = 0
      entries.forEach((entry, i) => {
        if (depths[i] == null || depths[i]! > depth || !selected.has(entry.id) || unresolved.has(entry.id)) return
        const target = flat[index++]?.item.target
        if (target?.kind === 'page') pages.set(entry.id, target.pageIndex)
      })
      return { pages, count: flat.length, unresolved: unresolved.size }
    }
    const all = resolve(levels.map((level, i) => level ?? inferredLevels.get(entries[i].shape) ?? 1), new Set(entries.map(e => e.id)), 8)
    const selected = resolve(levels, included, maxDepth)
    return { all: all.pages, selected: selected.pages, count: selected.count, unresolved: selected.unresolved }
  }, [entries, levels, included, maxDepth, offset, pageCount, inferredLevels, resolvedPages])
  const titleError = useMemo(() => {
    try { buildTocOutline(namedEntries, levels, { offset, pageCount, maxDepth, includeLabel, included, titles, pages: resolvedPages }); return '' }
    catch (reason) { return reason instanceof Error ? reason.message : String(reason) }
  }, [namedEntries, levels, offset, pageCount, maxDepth, includeLabel, included, titles, resolvedPages])
  const insert = () => {
    if (!editable || busy || bodyPending || rangeChanged || editing || titleError || preview.unresolved || !preview.count) return
    try {
      const { items } = buildTocOutline(namedEntries, levels, { offset, pageCount, maxDepth, includeLabel, included, titles, pages: resolvedPages })
      const used = new Set(oldItems.map(({ item }) => item.id))
      let serial = 0
      for (const { item } of flattenOutline(items)) {
        let id: string
        do { id = `new:toc-${++serial}` } while (used.has(id))
        item.id = id; used.add(id)
      }
      const problems = validateOutlineItems(items, pageCount)
      if (problems.length) throw new Error(problems.join('、'))
      if (mode === 'replace') draft.replaceAll(items); else draft.append(items)
      onChange(); close()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const start = Math.max(0, Math.floor(scrollTop / 26) - 8), end = Math.min(entries.length, start + 36)
  const commitTitle = () => {
    if (!editing) return
    setTitles(previous => new Map(previous).set(editing.id, editing.value)); setEditing(null)
  }
  const includeAll = (checked: boolean) => setIncluded(previous => {
    const next = new Set(previous)
    for (const id of eligible) { if (checked) next.add(id); else next.delete(id) }
    return next
  })
  const selectEntry = (index: number, checked: boolean, shift: boolean) => {
    const anchor = shift && lastClicked.current !== null ? lastClicked.current : index
    lastClicked.current = index
    setIncluded(previous => {
      const next = new Set(previous)
      for (let i = Math.min(anchor, index); i <= Math.max(anchor, index); i++) {
        const id = entries[i].id
        if (eligible.has(id)) { if (checked) next.add(id); else next.delete(id) }
      }
      return next
    })
    if (checked && !preview.all.has(entries[index].id)) pageInputs.current.get(entries[index].id)?.focus()
  }
  const changePage = (id: string, input: HTMLInputElement) => {
    const value = input.value, page = input.valueAsNumber
    const invalid = input.validity.badInput || value !== '' && (!Number.isInteger(page) || page < 1 || page > pageCount)
    setInvalidPages(previous => {
      if (!invalid && !previous.has(id)) return previous
      const next = new Map(previous)
      if (invalid) next.set(id, value); else next.delete(id)
      return next
    })
    setPageOverrides(previous => {
      const next = new Map(previous)
      if (!invalid && value !== '') next.set(id, page - 1); else next.delete(id)
      return next
    })
  }
  return <dialog ref={ref} className="outline-dialog outline-toc-dialog" aria-labelledby="outline-toc-title" onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); close() }}>
    <h2 id="outline-toc-title">目次ページから作成</h2>
    <p>推定した範囲・段・ページの対応を確認してください。下書きに入れてもPDFにはまだ書き込みません。</p>
    {busy && <div><p role="status">{progress || '文字を読み取っています…'}</p><button onClick={() => {
      if (pageMethod !== 'printed') cancelSearch()
      else { generation.current++; setBusy(false); setProgress('読取りを取り消しました') }
    }}>読取りを取り消す</button></div>}
    {!busy && progress && <p role="status">{progress}</p>}
    <fieldset disabled={busy}><legend>目次ページの範囲</legend>
      <div className="toc-inline">目次ページ: <input aria-label="目次の開始ページ" type="number" min={1} max={pageCount} value={Number.isFinite(first) ? first : ''} onChange={e => setFirst(e.target.valueAsNumber)} /> 〜 <input aria-label="目次の終了ページ" type="number" min={1} max={pageCount} value={Number.isFinite(last) ? last : ''} onChange={e => setLast(e.target.valueAsNumber)} /> ページ <button onClick={() => void load(false)}>読み直す</button></div>
      {rangeMessage && <p>{rangeMessage}</p>}
      {loadedRange && rangeChanged && <p>範囲を変更したら「読み直す」を押してください。</p>}
    </fieldset>
    {noText && <p role="alert">このPDFの目次ページから文字を読み取れませんでした（画像のPDFには対応していません）</p>}
    <fieldset disabled={busy}><legend>見出しの形と段</legend>
      <label><input type="radio" name="toc-method" checked={method === 'shape'} onChange={() => setMethod('shape')} />見出しの形で決める（既定）</label>
      <label><input type="radio" name="toc-method" checked={method === 'indent'} onChange={() => setMethod('indent')} />字下げで決める</label>
      {method === 'shape' && <div className="outline-dialog-scroll"><table><thead><tr><th>形の例（推定）</th><th>件数</th><th>段</th></tr></thead><tbody>{shapes.map(shape => <tr key={shape.shape}><td>{shape.example}</td><td>{shape.count}</td><td><select aria-label={`${shape.shape}の段`} value={shape.level ?? ''} onChange={event => setShapes(previous => previous.map(item => item.shape === shape.shape ? { ...item, level: event.target.value ? Number(event.target.value) : null } : item))}>
        <option value="">入れない</option>{Array.from({ length: 8 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
      </select></td></tr>)}</tbody></table></div>}
    </fieldset>
    <fieldset disabled={busy}><legend>ページの対応</legend>
      <label><input type="radio" name="toc-page-method" checked={pageMethod === 'printed'} onChange={() => void changePageMethod('printed')} />目次のページ番号を使う</label>
      <label><input type="radio" name="toc-page-method" checked={pageMethod === 'body'} onChange={() => void changePageMethod('body')} />本文から見出しを探す</label>
      <label><input type="radio" name="toc-page-method" checked={pageMethod === 'drawing'} onChange={() => void changePageMethod('drawing')} />図面番号で探す</label>
      {pageMethod === 'printed' ? <><label className="toc-inline">印刷上の 1 ページ = PDF の <input aria-label="印刷上の1ページに対応するPDFページ" type="number" min={1} max={pageCount} value={Number.isFinite(offset) ? offset + 2 : ''} onChange={event => setOffset(event.target.valueAsNumber - 2)} /> ページ</label><p>{mapping}</p></> : <>
        {bodyMessage && <p role="status">{bodyMessage}</p>}
        {bodyPending && !busy && <button disabled={rangeChanged} onClick={() => void changePageMethod(pageMethod)}>{pageMethod === 'drawing' ? '図面を読み直す' : '本文を読み直す'}</button>}
      </>}
    </fieldset>
    <fieldset disabled={busy}><legend>入れる深さ</legend><label className="toc-inline"><select aria-label="入れる深さ" value={maxDepth} onChange={e => setMaxDepth(Number(e.target.value))}>{Array.from({ length: 8 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select> 段目まで</label>
      <label><input type="checkbox" checked={includeLabel} onChange={e => setIncludeLabel(e.target.checked)} />番号を名称に含める</label>
    </fieldset>
    <p>{entries.length.toLocaleString()} 件中 {preview.count.toLocaleString()} 件を入れます（深さ {maxDepth} 段目まで）</p>
    <div className="toc-inline"><button disabled={busy} onClick={() => includeAll(true)}>すべて含める</button><button disabled={busy} onClick={() => includeAll(false)}>すべて外す</button></div>
    <div role="table" aria-label="目次の候補" aria-rowcount={entries.length + 1}>
      <div role="row" className="toc-candidate-row toc-candidate-head"><span role="columnheader">含める</span><span role="columnheader">段</span><span role="columnheader">名称（ダブルクリックで編集）</span><span role="columnheader">印刷ページ</span><span role="columnheader">PDF ページ</span><span role="columnheader">状態</span></div>
      <div className="toc-candidate-scroll" onScroll={event => setScrollTop(event.currentTarget.scrollTop)}><div style={{ height: entries.length * 26, position: 'relative' }}>
        {namedEntries.slice(start, end).map((entry, index) => {
          const level = levels[start + index]
          const selectable = eligible.has(entry.id), active = included.has(entry.id) && selectable
          const page = active ? preview.selected.get(entry.id) : preview.all.get(entry.id)
          const title = titles.get(entry.id) ?? entry.title
          const reason = level === null ? 'この形は『入れない』に設定されています。見出しの形と段で変更できます' : level > maxDepth ? `入れる深さ（${maxDepth} 段目まで）の外です。深さを変えると入れられます` : undefined
          const status = invalidPages.has(entry.id) ? 'ページが範囲外' : level === null ? '入れない形' : !selectable ? '深さの外' : active && page === undefined ? 'ページ未設定' : ''
          return <div role="row" aria-rowindex={start + index + 2} key={entry.id} className="toc-candidate-row" style={{ position: 'absolute', top: (start + index) * 26, width: '100%' }}>
            <span role="cell"><input aria-label={`${entry.id}を含める`} type="checkbox" title={reason} disabled={busy || !selectable} checked={active} onChange={event => selectEntry(start + index, event.target.checked, 'shiftKey' in event.nativeEvent && event.nativeEvent.shiftKey === true)} /></span>
            <span role="cell">{level ?? '—'}</span><span role="cell" className="toc-title" style={{ paddingLeft: Math.max(0, (level ?? 1) - 1) * 12 }} onDoubleClick={() => setEditing({ id: entry.id, value: title })} title={title}>
              {editing?.id === entry.id ? <input autoFocus aria-label={`${entry.id}の名称`} value={editing.value} onChange={event => setEditing({ id: entry.id, value: event.target.value })} onBlur={commitTitle} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter') { event.preventDefault(); commitTitle() } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(null) } }} /> : `${includeLabel && entry.label ? entry.label + ' ' : ''}${title}`}
            </span><span role="cell">{pageMethod !== 'printed' ? '—' : entry.printed ?? '—'}</span><span role="cell">
              <span className="toc-page-value" aria-hidden="true">{page === undefined ? '不明' : page + 1}</span>
              <input ref={input => { if (input) pageInputs.current.set(entry.id, input); else pageInputs.current.delete(entry.id) }} aria-label={`${entry.id}のPDFページ`} type="number" min={1} max={pageCount} step={1} disabled={busy} aria-invalid={invalidPages.has(entry.id)} value={invalidPages.get(entry.id) ?? (page === undefined ? '' : page + 1)} onChange={event => changePage(entry.id, event.currentTarget)} />
            </span><span role="cell">{status}</span>
          </div>
        })}
      </div></div>
    </div>
    {!!oldItems.length && <fieldset disabled={busy}><legend>既存の目次の扱い</legend>
      <label><input type="radio" name="toc-outline-mode" checked={mode === 'append'} onChange={() => setMode('append')} />既存の目次の後ろに追加</label>
      <label><input type="radio" name="toc-outline-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />既存の目次を置き換える</label>
      {mode === 'replace' && <><p>次の既存の目次 {oldItems.length.toLocaleString()} 件を削除します。置き換え後も1回の「戻す」で元に戻せます。</p><ul className="outline-dialog-scroll">{oldItems.slice(0, 20).map(({ item, depth }) => <li key={item.id} style={{ marginLeft: depth * 12 }}>{item.title || '（名称なし）'}</li>)}</ul>{oldItems.length > 20 && <p>ほか {oldItems.length - 20} 件</p>}</>}
    </fieldset>}
    {(error || titleError) && <p role="alert">{error || titleError}</p>}
    {!!preview.unresolved && <p role="alert">ページが決まっていない項目が {preview.unresolved.toLocaleString()} 件あります。PDF ページを入力するか、チェックを外してください</p>}
    <div className="dialog-actions"><button className="outline-primary" disabled={!editable || busy || bodyPending || rangeChanged || !!editing || !!titleError || !!preview.unresolved || !preview.count} onClick={insert}>目次の下書きに入れる</button><button onClick={close}>キャンセル</button></div>
  </dialog>
}
