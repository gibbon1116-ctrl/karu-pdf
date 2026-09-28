import type { PdfWorkerPool } from '../client/PdfWorkerPool'
import type { RGB } from '../core/annotations'
import type { FontName } from '../core/fontMetrics'
import type { EditorTool } from '../editor/AnnotationLayer'
import type { AnnotationStore, EditableAnnotation, Kind } from '../editor/AnnotationStore'
import { updateToolFormat, type FormatDefaults, type FormatTool } from '../editor/formatDefaults'

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
const HIGHLIGHT_COLORS = [
  { name: '黄', value: [1, 0.9, 0] as RGB, css: '#ffe600' },
  { name: '緑', value: [0.35, 0.9, 0.3] as RGB, css: '#59e64d' },
  { name: '水色', value: [0.25, 0.8, 1] as RGB, css: '#40ccff' },
  { name: '桃', value: [1, 0.45, 0.65] as RGB, css: '#ff73a6' },
]
const WIDTHS = [0.5, 1, 1.5, 2, 3, 5]
const HIGHLIGHT_WIDTHS = [6, 9, 12, 18]
const FONT_SIZES = [8, 9, 10.5, 12, 14, 18, 24, 36]

function sameColor(left: readonly number[], right: readonly number[]): boolean {
  return left.every((value, index) => Math.abs(value - right[index]) < 0.001)
}

interface Props {
  selected: EditableAnnotation | null
  tool: EditorTool
  store: AnnotationStore
  pool: PdfWorkerPool
  defaults: FormatDefaults
  onDefaultsChange(value: FormatDefaults): void
}

function formatTool(kind: Kind | EditorTool): FormatTool | null {
  if (kind === 'select') return null
  return kind === 'freetext' ? 'text' : kind
}

export function FormatPanel({ selected, tool, store, pool, defaults, onDefaultsChange }: Props) {
  const activeSelection = tool === 'select' ? selected : null
  // 選択ツールで何も選んでいないときは、従来どおり次の文字の書式を見せる。
  const target = formatTool(activeSelection?.kind ?? (tool === 'select' ? 'text' : tool))
  const values = activeSelection ?? (target ? defaults[target] : null)
  const showColor = target !== null && target !== 'whiteout'
  const showWidth = target !== null && target !== 'text' && target !== 'whiteout'
  const showText = target === 'text'
  const colorChoices = target === 'highlight' ? HIGHLIGHT_COLORS : COLORS
  const widths = target === 'highlight' ? HIGHLIGHT_WIDTHS : WIDTHS

  const changeDefault = (changes: Parameters<typeof updateToolFormat>[2]) => {
    if (target) onDefaultsChange(updateToolFormat(defaults, target, changes))
  }

  const changeColor = (next: RGB) => {
    if (activeSelection) store.update(activeSelection.id, { color: next })
    else changeDefault({ color: next })
  }

  const changeBorderWidth = (next: number) => {
    if (activeSelection) store.update(activeSelection.id, { borderWidth: next })
    else changeDefault({ borderWidth: next })
  }

  const changeText = async (changes: { fontSize?: number; font?: FontName }) => {
    if (!activeSelection || activeSelection.kind !== 'freetext') {
      changeDefault(changes)
      return
    }
    const fontSize = changes.fontSize ?? activeSelection.fontSize
    const font = changes.font ?? activeSelection.font
    const width = activeSelection.rect[2] - activeSelection.rect[0]
    const layout = await pool.layoutText(activeSelection.text, fontSize, width, font)
    store.update(activeSelection.id, {
      ...changes,
      layout,
      rect: [activeSelection.rect[0], activeSelection.rect[1], activeSelection.rect[2], activeSelection.rect[1] + layout.height],
    })
  }

  return <aside className="format-panel" aria-label="書式" data-testid="format-panel">
    <h2>書式</h2>
    {!target && <p>道具または書き込みを選んでください。</p>}
    {showColor && values && <fieldset>
      <legend>色</legend>
      <div className="color-grid">
        {colorChoices.map((item) => <button key={item.name} type="button" title={item.name} aria-label={item.name} aria-pressed={sameColor(values.color, item.value)} className={sameColor(values.color, item.value) ? 'selected' : ''} onClick={() => changeColor(item.value)}><span style={{ background: item.css }} /></button>)}
      </div>
    </fieldset>}
    {showWidth && values && <label>
      線の太さ
      <select aria-label="線の太さ" value={values.borderWidth} onChange={(event) => changeBorderWidth(Number(event.currentTarget.value))}>
        {widths.map((value) => <option key={value} value={value}>{value} pt</option>)}
      </select>
    </label>}
    {showText && values && <>
      <label>
        文字の大きさ
        <select aria-label="文字の大きさ" value={values.fontSize} onChange={(event) => void changeText({ fontSize: Number(event.currentTarget.value) })}>
          {FONT_SIZES.map((value) => <option key={value} value={value}>{value} pt</option>)}
        </select>
      </label>
      <label>
        書体
        <select aria-label="書体" value={values.font} onChange={(event) => void changeText({ font: event.currentTarget.value as FontName })}>
          <option value="BIZUDGothic">ゴシック</option>
          <option value="BIZUDMincho">明朝</option>
        </select>
      </label>
    </>}
    {target && <p className="format-target">{activeSelection ? '選択中の書き込み' : '次に作る書き込み'}</p>}
  </aside>
}
