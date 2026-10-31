import { useId, useMemo, useState, type JSX } from 'react'
import { fixtureIdentity, quantityUnit, type BreakdownPosition, type CountFixture, type FixturePreset } from '../core/countFixtures'
import type { CatalogItem, CatalogPosition, CatalogSelection } from '../core/catalog'
import { documentSummaryValues } from '../core/summaryValues'

const multipleLabels = new Set(['記号', '盤名称', '名称', '建具番号'])
const splitValues = (text: string) => [...new Set(text.split(/[、,，]/).map(value => value.trim()).filter(Boolean))]
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason)

function kindLabel(option: CatalogItem['options'][number]): string {
  if (option.kind && option.kind !== 'count') {
    return `（${{ length: '長さ', area: '面積', volume: '体積' }[option.kind]}・${quantityUnit(option)}）`
  }
  return option.kind === 'count' ? `（個数・${quantityUnit(option)}）` : ''
}

export default function CatalogChooser({
  item,
  selection,
  onChange,
  existing,
  fixtures,
  position,
  onEditPosition,
  onChangePosition,
  positionActive,
  catalog,
}: {
  item: CatalogItem
  selection: CatalogSelection
  onChange(selection: CatalogSelection): void
  /** 既存の項目の fixtureIdentity の集合（追加済みの表示用） */
  existing: ReadonlySet<string>
  /** この文書ですでに使った摘要の値を候補にする。 */
  fixtures?: readonly CountFixture[]
  position?: CatalogPosition
  /** 規格から選ぶ場合だけ、この品目を位置の欄の編集対象にする。 */
  onEditPosition?(): void
  /** 規格タブで、この品目が出る行の位置を選ぶ。 */
  onChangePosition?(position: BreakdownPosition): void
  positionActive?: boolean
  /** catalogPresets を使うため（遅延読込した catalog モジュール） */
  catalog: typeof import('../core/catalog')
}): JSX.Element {
  const summaryListId = useId()
  const documentValues = useMemo(() => new Map(item.slots.map(slot => [
    slot.label,
    documentSummaryValues(fixtures ?? [], slot.label, item.name),
  ])), [fixtures, item])
  const masterItem = item.key.startsWith('master:')
  const single = item.options.length === 1 && item.options[0].label === ''
  const canChoosePosition = onChangePosition !== undefined
  const positions = useMemo(
    () => canChoosePosition ? catalog.catalogItemPositions(item) : [],
    [catalog, item, canChoosePosition],
  )
  const selectedPosition = positions.findIndex(candidate =>
    candidate.book === position?.book
    && candidate.section === position?.section
    && candidate.subject === position?.subject
    && (candidate.middle ?? '') === (position?.middle ?? '')
    && candidate.item === (position?.item ?? item.breakdownItem ?? item.name),
  )
  const [extras, setExtras] = useState<Record<string, string>>(() =>
    Object.fromEntries(item.slots.map(slot => [
      slot.label,
      (selection.values?.[slot.label] ?? [])
        .filter(value => !slot.choices?.includes(value)).join('、'),
    ])),
  )

  const preview = useMemo(() => {
    let presets: FixturePreset[] = []
    let error: string | undefined
    try {
      presets = catalog.catalogPresets(item, selection, position)
    } catch (reason) {
      error = errorText(reason)
    }
    const seen = new Set(existing)
    const count = presets.filter(preset => {
      const key = fixtureIdentity(preset)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).length
    return { count, error }
  }, [catalog, item, selection, position, existing])

  const addedOptions = useMemo(() => {
    const added = new Set<string>()
    for (const option of item.options) {
      try {
        const presets = catalog.catalogPresets(item, {
          ...selection,
          options: [option.key],
        }, position)
        if (presets.length && presets.every(preset => existing.has(fixtureIdentity(preset)))) {
          added.add(option.key)
        }
      } catch {
        // 組合せの誤りは、この品目の件数の下に表示する。
      }
    }
    return added
  }, [catalog, item, selection, position, existing])

  const selectOptions = (keys: readonly string[], checked: boolean) => {
    const selected = new Set(selection.options)
    for (const key of keys) {
      if (checked) selected.add(key)
      else selected.delete(key)
    }
    onChange({ ...selection, options: [...selected] })
  }

  const setValues = (label: string, values: readonly string[]) => {
    onChange({
      ...selection,
      values: { ...selection.values, [label]: [...new Set(values)] },
    })
  }

  const selectedOptions = item.options.filter(option => selection.options.includes(option.key))
  const automaticLabels = item.slots.filter(slot =>
    !slot.condition && selectedOptions.some(option => option.summary?.[slot.label]?.trim()),
  ).map(slot => slot.label)
  // 連動と規格を同時に選ぶ場合は、連動の項目に必要な入力を残す。
  const hiddenLabels = new Set(automaticLabels.filter(label =>
    selectedOptions.every(option => option.summary?.[label]?.trim()),
  ))
  const grouped = item.field === '建築' && item.options.length > 20
    && item.options.some(option => option.summary !== undefined)
  const optionGroups = new Map<string, CatalogItem['options'][number][]>()
  if (!grouped && item.options.some(option => option.formerName !== undefined)) {
    optionGroups.set('', [])
  }
  for (const option of item.options) {
    const group = option.formerName ?? (grouped && option.convert !== undefined
      ? option.summary?.形状?.trim()
        || (option.spec ?? option.label).match(/^[^×\s-]+/)?.[0]
        || '規格'
      : '')
    const options = optionGroups.get(group) ?? []
    options.push(option)
    optionGroups.set(group, options)
  }

  const renderOption = (option: CatalogItem['options'][number]) => {
    const added = addedOptions.has(option.key)
    const label = single
      ? `${item.name}（${item.unit}）`
      : masterItem
        ? `${option.label} ${option.name}${kindLabel(option)}`
        : `${option.label} ${item.name}（${item.unit}）`
    return <label key={option.key}>
      <input type="checkbox"
        aria-label={label}
        checked={(masterItem && added) || selection.options.includes(option.key)}
        disabled={masterItem && added}
        onChange={event => selectOptions([option.key], event.currentTarget.checked)}
      />
      <span>
        {single ? `${item.name}（${item.unit}）` : <><strong>{option.label}</strong> {option.name}</>}
        {option.note && <small className="catalog-option-note"> {option.note}</small>}
        {added && <span className="quantity-master-added"> 追加済み</span>}
      </span>
    </label>
  }

  return <div className="catalog-chooser">
    {(!single || (onEditPosition && selection.options.length > 0)) && <p className="quantity-master-type-name">{item.name}（{item.unit}）</p>}
    {onEditPosition && selection.options.length > 0 && <p className="catalog-position-summary">
      <button type="button" aria-pressed={positionActive ?? false} onClick={onEditPosition}
        style={{ maxWidth: '100%', textAlign: 'left', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
        内訳書: {position
          ? [
            position.book,
            position.section,
            position.subject,
            ...(position.middle ? [position.middle] : []),
            position.item ?? item.breakdownItem ?? item.name,
          ].join(' › ')
          : '付けない'}
      </button>
    </p>}
    {onChangePosition && selection.options.length > 0 && positions.length >= 2 && <label>
      内訳書の行
      <select
        aria-label={`${item.name}の内訳書の行`}
        value={selectedPosition < 0 ? '' : String(selectedPosition)}
        onChange={event => {
          const value = event.currentTarget.value
          if (value === '') return
          const next = positions[Number(value)]
          if (next !== undefined) onChangePosition(next)
        }}
      >
        {selectedPosition < 0 && <option value="">
          {position ? '現在の位置（位置の欄で指定）' : '付けない'}
        </option>}
        {positions.map((candidate, index) => <option key={index} value={String(index)}>
          {[
            ...(candidate.section === '庁舎' ? [] : [candidate.section]),
            candidate.subject,
            ...(candidate.middle ? [candidate.middle] : []),
            candidate.item,
          ].join(' › ')}
        </option>)}
      </select>
    </label>}
    {item.options.length >= 2 && <div className="quantity-master-selection-actions">
      <button type="button" onClick={() => selectOptions(item.options.map(option => option.key), true)}>すべて選ぶ</button>
      <button type="button" onClick={() => selectOptions(item.options.map(option => option.key), false)}>選択を解除</button>
    </div>}
    <div className="catalog-options">
      {[...optionGroups].map(([group, options]) => group
        ? <div key={group} role="group" aria-label={`${group}の規格`}
          style={{ gridColumn: '1 / -1' }}>
          <h4>{group}（{options.length}）</h4>
          <div className="catalog-options">{options.map(renderOption)}</div>
        </div>
        : options.map(renderOption))}
    </div>
    {selection.options.length > 0 && item.slots.length > 0 && <div className="catalog-summary-fields">
      {automaticLabels.length > 0 && <p>
        {automaticLabels.join('・')}は規格から入ります
      </p>}
      {item.slots.map((slot, index) => {
        if (hiddenLabels.has(slot.label)) return null
        if (slot.condition) {
          const label = slot.label.endsWith('条件') ? slot.label : `${slot.label}条件`
          return <p key={index} className="catalog-condition">
            {label}の候補: {(slot.choices ?? []).join('・')}（拾うときに選びます）
          </p>
        }

        const choices = slot.choices ?? []
        const candidates = (documentValues.get(slot.label) ?? [])
          .filter(value => !choices.includes(value))
        const listId = `${summaryListId}-${encodeURIComponent(item.key)}-${index}-${encodeURIComponent(slot.label)}`
        // 候補があるときだけ datalist を付ける（list 属性があると欄が combobox になる）。
        const candidateList = candidates.length > 0 && <datalist id={listId}>
          {candidates.map(value => <option key={value} value={value} />)}
        </datalist>
        const listAttribute = candidates.length > 0 ? listId : undefined
        if (!choices.length) {
          return <label key={index} className="catalog-text-field">
            <span>{slot.label}</span>
            <input
              aria-label={`${item.name}の${slot.label}`}
              list={listAttribute}
              value={selection.text?.[slot.label] ?? ''}
              placeholder={multipleLabels.has(slot.label) ? '、で区切ると複数作ります' : undefined}
              onChange={event => onChange({
                ...selection,
                text: { ...selection.text, [slot.label]: event.currentTarget.value },
              })}
            />
            {candidateList}
            {candidates.length > 0 && <small>
              この文書で使った値: {candidates.slice(0, 5).join('・')}
            </small>}
          </label>
        }

        const values = selection.values?.[slot.label] ?? []
        const custom = values.filter(value => !choices.includes(value))
        return <fieldset key={index} className="catalog-slot" aria-label={`${item.name}の${slot.label}`}>
          <legend>{slot.label}</legend>
          <div className="quantity-master-selection-actions">
            <button type="button" onClick={() => setValues(slot.label, [...choices, ...custom])}>すべて選ぶ</button>
            <button type="button" onClick={() => {
              setExtras(previous => ({ ...previous, [slot.label]: '' }))
              setValues(slot.label, [])
            }}>選択を解除</button>
          </div>
          <div className="catalog-values">
            {choices.map(value => <label key={value}>
              <input type="checkbox"
                aria-label={`${item.name}の${slot.label} ${value}`}
                checked={values.includes(value)}
                onChange={event => {
                  const selected = new Set(values)
                  if (event.currentTarget.checked) selected.add(value)
                  else selected.delete(value)
                  setValues(slot.label, [
                    ...choices.filter(choice => selected.has(choice)),
                    ...custom,
                  ])
                }}
              />
              <span>{value}</span>
            </label>)}
          </div>
          <label className="catalog-text-field">
            <span>ほかの値</span>
            <input
              aria-label={`${item.name}の${slot.label}のほかの値`}
              list={listAttribute}
              placeholder="、で区切ると複数作ります"
              value={extras[slot.label] ?? custom.join('、')}
              onChange={event => {
                const text = event.currentTarget.value
                setExtras(previous => ({ ...previous, [slot.label]: text }))
                setValues(slot.label, [
                  ...choices.filter(value => values.includes(value)),
                  ...splitValues(text),
                ])
              }}
            />
            {candidateList}
          </label>
        </fieldset>
      })}
    </div>}
    {selection.options.length > 0 && <p className="catalog-count">この品目で {preview.count} 件追加</p>}
    {preview.error && <p role="alert">{preview.error}</p>}
  </div>
}
