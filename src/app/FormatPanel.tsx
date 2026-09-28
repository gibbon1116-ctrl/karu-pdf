import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { RGB } from '../core/annotations'
import type { AnnotationStore, EditableAnnotation } from '../editor/AnnotationStore'
import type { FormatDefaults } from '../editor/formatDefaults'

const COLORS: Array<{ name: string; value: RGB; css: string }> = [
  { name: '赤', value: [1, 0, 0], css: '#e00000' },
  { name: '青', value: [0, 0.25, 1], css: '#064fe6' },
  { name: '黒', value: [0, 0, 0], css: '#111' },
  { name: '緑', value: [0, 0.55, 0.1], css: '#008c1a' },
  { name: '橙', value: [1, 0.45, 0], css: '#ff7300' },
  { name: '紫', value: [0.55, 0.1, 0.7], css: '#8c1ab3' },
  { name: '黄', value: [1, 0.9, 0], css: '#ffe600' },
  { name: '白', value: [1, 1, 1], css: '#fff' },
]
const WIDTHS = [0.5, 1, 1.5, 2, 3, 5]
const FONT_SIZES = [8, 9, 10.5, 12, 14, 18, 24, 36]

function sameColor(left: readonly number[], right: readonly number[]): boolean {
  return left.every((value, index) => Math.abs(value - right[index]) < 0.001)
}

interface Props {
  selected: EditableAnnotation | null
  store: AnnotationStore
  pool: PdfWorkerPool
  defaults: FormatDefaults
  onDefaultsChange(value: FormatDefaults): void
}

export function FormatPanel({ selected, store, pool, defaults, onDefaultsChange }: Props) {
  const color = selected?.color ?? defaults.color
  const borderWidth = selected?.kind === 'square' ? selected.borderWidth : defaults.borderWidth
  const fontSize = selected?.kind === 'freetext' ? selected.fontSize : defaults.fontSize

  const changeColor = (next: RGB) => {
    if (selected) store.update(selected.id, { color: next })
    else onDefaultsChange({ ...defaults, color: [...next] })
  }

  const changeBorderWidth = (next: number) => {
    if (selected?.kind === 'square') store.update(selected.id, { borderWidth: next })
    else onDefaultsChange({ ...defaults, borderWidth: next })
  }

  const changeFontSize = async (next: number) => {
    if (selected?.kind === 'freetext') {
      const width = selected.rect[2] - selected.rect[0]
      const layout = await pool.layoutText(selected.text, next, width)
      store.update(selected.id, {
        fontSize: next,
        layout,
        rect: [selected.rect[0], selected.rect[1], selected.rect[2], selected.rect[1] + layout.height],
      })
    } else {
      onDefaultsChange({ ...defaults, fontSize: next })
    }
  }

  return (
    <aside className="format-panel" aria-label="書式" data-testid="format-panel">
      <h2>書式</h2>
      <fieldset>
        <legend>色</legend>
        <div className="color-grid">
          {COLORS.map((item) => (
            <button
              key={item.name}
              type="button"
              title={item.name}
              aria-label={item.name}
              aria-pressed={sameColor(color, item.value)}
              className={sameColor(color, item.value) ? 'selected' : ''}
              onClick={() => changeColor(item.value)}
            ><span style={{ background: item.css }} /></button>
          ))}
        </div>
      </fieldset>
      <label>
        線の太さ
        <select
          aria-label="線の太さ"
          value={borderWidth}
          disabled={Boolean(selected && selected.kind !== 'square')}
          onChange={(event) => changeBorderWidth(Number(event.currentTarget.value))}
        >
          {WIDTHS.map((value) => <option key={value} value={value}>{value} pt</option>)}
        </select>
      </label>
      <label>
        文字の大きさ
        <select
          aria-label="文字の大きさ"
          value={fontSize}
          disabled={Boolean(selected && selected.kind !== 'freetext')}
          onChange={(event) => void changeFontSize(Number(event.currentTarget.value))}
        >
          {FONT_SIZES.map((value) => <option key={value} value={value}>{value} pt</option>)}
        </select>
      </label>
      <p className="format-target">{selected ? '選択中の書き込み' : '次に作る書き込み'}</p>
    </aside>
  )
}
