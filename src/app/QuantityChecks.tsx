import { useEffect, useState } from 'react'
import {
  CHECK_BASICS,
  type CheckRow,
} from '../core/breakdown/checkSheets'
import {
  QUANTITY_CHECK_VERDICT_TEXT,
  type QuantityCheckBasics,
  type QuantityCheckResult,
} from '../core/quantityChecks'
import type { QuantityCheckColumnData } from './quantityCheckColumn'
import type { AnnotationStore } from '../editor/AnnotationStore'
import type { DocumentSession } from './documentModel'
import './QuantityChecks.css'

const SHEETS: readonly CheckRow['sheet'][] = [
  '仮設', '土工', '地業', '躯体', '外部仕上', '内部仕上', '金属',
]

function format(value: number | undefined): string {
  return value === undefined ? '—' : value.toFixed(2)
}

function expectedText(result: QuantityCheckResult): string {
  const expected = result.expected
  if (!expected) return '—'
  if (expected.min !== undefined && expected.max !== undefined) {
    return `${format(expected.min)} 〜 ${format(expected.max)} ${result.group.unit}`
  }
  return `${format(expected.min ?? expected.max)} ${result.group.unit}`
}

function evidenceTitle(result: QuantityCheckResult): string {
  const lines = result.items.map(item =>
    `${item.code} ${item.name} ${format(item.total)} ${result.group.unit}`.trim(),
  )
  if (result.items.length && result.group.factor !== undefined
    && result.group.factor !== 1) {
    lines.push(`合計 × ${result.group.factor}`)
  }
  if (result.skippedUnits.length) {
    lines.push(`単位違いで加算しなかった項目：${result.skippedUnits.join('、')}`)
  }
  return lines.join('\n')
}

function BasicInput({ basis, value, suggestion, store, disabled }: {
  basis: typeof CHECK_BASICS[number]
  value: number | undefined
  suggestion: number | undefined
  store: AnnotationStore
  disabled: boolean
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setDraft(value === undefined ? '' : String(value))
    setInvalid(false)
  }, [value])

  const commit = () => {
    if (disabled) return
    const text = draft.trim()
    const next = text === '' ? undefined : Number(text)
    if (next !== undefined && (!Number.isFinite(next) || next < 0)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    store.setQuantityCheckBasic(basis.key, next)
    setDraft(next === undefined ? '' : String(next))
  }
  return <label className="quantity-check-basic">
    <span>{basis.label}</span>
    <span className="quantity-check-basic-value">
      <input
        type="number"
        min="0"
        step="any"
        aria-label={basis.label}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        value={draft}
        onChange={event => { setDraft(event.target.value); setInvalid(false) }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return
          const key = event.key.toLowerCase()
          if ((event.ctrlKey || event.metaKey) && !event.altKey
            && (key === 'z' || key === 'y')) {
            event.preventDefault()
            event.stopPropagation()
            if (disabled) return
            if (key === 'y' || event.shiftKey) store.redo()
            else store.undo()
            const restored = store.getQuantityChecks().values[basis.key]
            setDraft(restored === undefined ? '' : String(restored))
            setInvalid(false)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.blur()
          }
        }}
      />
      <span>{basis.unit}</span>
      {suggestion !== undefined && <button
        type="button"
        disabled={disabled}
        aria-label={`${basis.label}に拾いから ${suggestion} を入れる`}
        onClick={event => {
          event.preventDefault()
          store.setQuantityCheckBasic(basis.key, suggestion)
          setDraft(String(suggestion))
          setInvalid(false)
        }}
      >拾いから {suggestion}</button>}
    </span>
    {invalid && <small role="alert">0以上の有限の数を入力してください</small>}
  </label>
}

export default function QuantityChecks({ session, basics, calculations }: {
  session: DocumentSession
  basics: QuantityCheckBasics
  calculations: QuantityCheckColumnData | undefined
}) {
  const store = session.annotationStore
  const revision = session.pageRevision





  if (!store.quantityChecksReady || !calculations) {
    return <p className="quantity-checks" role="status">基本の値を読み込んでいます</p>
  }
  const { results, suggestions } = calculations
  const ok = results.filter(result => result.verdict === 'ok').length
  const out = results.filter(result => result.verdict === 'out').length
  const judged = ok + out
  const disabled = !!session.editRestriction

  return <div className="quantity-checks">
    <section aria-label="基本の値">
      <h3>基本の値</h3>
      <div className="quantity-check-basics">
        {CHECK_BASICS.map(basis => <BasicInput
          key={`${session.docId}:${revision}:${basis.key}`}
          basis={basis}
          value={basics.values[basis.key]}
          suggestion={suggestions[basis.key]}
          store={store}
          disabled={disabled}
        />)}
      </div>
    </section>
    {calculations.error
      ? <p role="alert">{calculations.error}</p>
      : <>
        <p className="quantity-check-summary" role="status">
          判定 {results.length} 行: OK {ok}・範囲外 {out}・判定できない {results.length - judged}
        </p>
        {SHEETS.map(sheet => <section key={sheet} aria-label={`${sheet}のチェックシート`}>
          <h3>{sheet}</h3>
          <table aria-label={`${sheet}の数量チェック`}>
            <thead><tr>
              {['名称', '内訳数量', 'チェック項目', 'チェック数量', '判定', '確認事項'].map(
                heading => <th key={heading} scope="col">{heading}</th>,
              )}
            </tr></thead>
            <tbody>
              {results.filter(result => result.row.sheet === sheet).map(result =>
                <tr
                  key={result.row.id}
                  data-check-row={result.row.id}
                  className={result.verdict === 'out' ? 'quantity-check-out' : undefined}
                >
                  <th scope="row">{result.group.label}</th>
                  <td title={evidenceTitle(result)}>
                    {result.quantity === undefined
                      ? '—'
                      : `${format(result.quantity)} ${result.group.unit}`}
                  </td>
                  <td>{result.row.operator} {result.row.basisText}</td>
                  <td>{expectedText(result)}</td>
                  <td>{QUANTITY_CHECK_VERDICT_TEXT[result.verdict]}</td>
                  <td>{result.row.note ?? ''}</td>
                </tr>,
              )}
            </tbody>
          </table>
        </section>)}
      </>}
  </div>
}
