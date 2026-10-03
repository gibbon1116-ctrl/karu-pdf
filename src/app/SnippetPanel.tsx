import { useState } from 'react'
import { insertIntoActiveTextEditor } from '../editor/TextEditor'
import { BUILTIN_SNIPPETS, loadSnippets, saveSnippets } from '../editor/snippets'

// Session-only registrations survive closing and reopening the text editor.
let sessionCustom: ReturnType<typeof loadSnippets> | null = null
let sessionRemember: boolean | null = null

export function SnippetPanel() {
  const [custom, setCustom] = useState(() => sessionCustom ??= loadSnippets())
  const [remember, setRemember] = useState(() => sessionRemember ??= loadSnippets().length > 0)
  const [choice, setChoice] = useState(0), [label, setLabel] = useState(''), [text, setText] = useState(''), [error, setError] = useState('')
  const items = [...BUILTIN_SNIPPETS, ...custom]
  const persist = (next: typeof custom, enabled = remember) => {
    sessionCustom = next; sessionRemember = enabled
    setCustom(next)
    try { saveSnippets(next, enabled); setError('') } catch { setError('このブラウザでは定型文を記憶できません。今回の編集では使えます。') }
  }
  return <fieldset data-text-symbol="snippet"><legend>定型文</legend>
    <select aria-label="挿入する定型文" value={choice} onChange={event => setChoice(Number(event.target.value))}>
      {items.map((item, index) => <option key={index} value={index}>{item.label}</option>)}
    </select>
    <button type="button" onPointerDown={event => event.preventDefault()} onClick={() => insertIntoActiveTextEditor(items[choice]?.text ?? '')}>挿入</button>
    <details><summary>定型文を登録・整理</summary>
      <label>名前<input aria-label="定型文の名前" value={label} maxLength={80} onChange={event => setLabel(event.target.value)} /></label>
      <label>本文<textarea aria-label="定型文の本文" value={text} maxLength={500} onChange={event => setText(event.target.value)} /></label>
      <button disabled={!label.trim() || !text.trim() || items.length >= 20} onClick={() => { persist([...custom, { label: label.trim(), text }]); setLabel(''); setText('') }}>登録</button>
      <label><input type="checkbox" checked={remember} onChange={event => { setRemember(event.target.checked); persist(custom, event.target.checked) }} />このPCに登録した定型文を記憶する</label>
      <p>登録は最大20件（標準を含む）、本文は500文字までです。</p>
      <button disabled={choice < BUILTIN_SNIPPETS.length} onClick={() => { persist(custom.filter((_item, index) => index !== choice - BUILTIN_SNIPPETS.length)); setChoice(0) }}>選んだ登録を削除</button>
      <button disabled={!custom.length} onClick={() => { persist([]); setChoice(0) }}>登録と保存情報をすべて削除</button>
    </details>{error && <p role="alert">{error}</p>}
  </fieldset>
}
