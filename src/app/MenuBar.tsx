import { useEffect, useRef, useState } from 'react'
import { Dropdown, type DropdownItem } from '../ui/Dropdown'

interface Props {
  fileName: string | null
  dirty: boolean
  hasDocument: boolean
  saving: boolean
  organizing: boolean
  canUndo: boolean
  canRedo: boolean
  showThumbnails: boolean
  showFormat: boolean
  canUndoOrganize: boolean
  onOpen(): void
  onSave(): void
  onSaveAs(): void
  onSaveFinalized(): void
  onPrint(): void
  onCloseTab(): void
  onUndo(): void
  onRedo(): void
  onCut(): void
  onCopy(): void
  onPaste(): void
  onDuplicate(): void
  onClearSelection(): void
  onDeleteSelection(): void
  onToggleThumbnails(): void
  onToggleFormat(): void
  onZoomIn(): void
  onZoomOut(): void
  onFitWidth(): void
  onOrganize(): void
  onUndoOrganize(): void
  onHelp(): void
}

const separator = (): DropdownItem => ({ type: 'separator' })

export function MenuBar(props: Props) {
  const [aboutOpen, setAboutOpen] = useState(false)
  const aboutRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = aboutRef.current
    if (!dialog) return
    if (aboutOpen && !dialog.open) dialog.showModal()
    if (!aboutOpen && dialog.open) dialog.close()
  }, [aboutOpen])

  const unavailable = !props.hasDocument || props.saving || props.organizing
  const menus: Array<{ label: string; items: DropdownItem[] }> = [
    { label: 'ファイル', items: [
      { label: '開く', shortcut: 'Ctrl+O', onSelect: props.onOpen },
      { label: '上書き保存', shortcut: 'Ctrl+S', disabled: unavailable, onSelect: props.onSave },
      { label: '別名で保存', shortcut: 'Ctrl+Shift+S', disabled: unavailable, onSelect: props.onSaveAs },
      { label: '確定して別名で保存', disabled: unavailable, onSelect: props.onSaveFinalized },
      separator(),
      { label: '印刷', shortcut: 'Ctrl+P', disabled: unavailable, onSelect: props.onPrint },
      separator(),
      { label: 'タブを閉じる', shortcut: 'Ctrl+W', disabled: !props.hasDocument, onSelect: props.onCloseTab },
    ] },
    { label: '編集', items: [
      { label: '元に戻す', shortcut: 'Ctrl+Z', disabled: !props.canUndo, onSelect: props.onUndo },
      { label: 'やり直し', shortcut: 'Ctrl+Y', disabled: !props.canRedo, onSelect: props.onRedo },
      separator(),
      { label: '切り取り', shortcut: 'Ctrl+X', disabled: !props.hasDocument, onSelect: props.onCut },
      { label: 'コピー', shortcut: 'Ctrl+C', disabled: !props.hasDocument, onSelect: props.onCopy },
      { label: '貼り付け', shortcut: 'Ctrl+V', disabled: !props.hasDocument, onSelect: props.onPaste },
      { label: '複製', shortcut: 'Ctrl+D', disabled: !props.hasDocument, onSelect: props.onDuplicate },
      separator(),
      { label: '選択を外す', shortcut: 'Esc', disabled: !props.hasDocument, onSelect: props.onClearSelection },
      { label: '選んだ書き込みを削除', shortcut: 'Delete', disabled: !props.hasDocument, onSelect: props.onDeleteSelection },
    ] },
    { label: '表示', items: [
      { label: 'ページ一覧', checked: props.showThumbnails, onSelect: props.onToggleThumbnails },
      { label: '書式パネル', checked: props.showFormat, onSelect: props.onToggleFormat },
      separator(),
      { label: '拡大', disabled: !props.hasDocument, onSelect: props.onZoomIn },
      { label: '縮小', disabled: !props.hasDocument, onSelect: props.onZoomOut },
      { label: '幅に合わせる', disabled: !props.hasDocument, onSelect: props.onFitWidth },
    ] },
    { label: 'ページ', items: [
      { label: 'ページ整理', disabled: !props.hasDocument || props.organizing, onSelect: props.onOrganize },
      { label: 'ページ整理を元に戻す', disabled: !props.canUndoOrganize || props.organizing || props.saving, onSelect: props.onUndoOrganize },
    ] },
    { label: 'ヘルプ', items: [
      { label: '使い方', onSelect: props.onHelp },
      { label: 'このアプリについて', onSelect: () => setAboutOpen(true) },
    ] },
  ]

  return <>
    <header className="menu-bar" role="menubar" aria-label="アプリのメニュー">
      {menus.map((menu) => <Dropdown key={menu.label} label={`${menu.label}▼`} items={menu.items} menuBar>
        {menu.label}<span aria-hidden="true">▼</span>
      </Dropdown>)}
      <span className="menu-file-name" title={props.fileName ?? ''}>
        {props.fileName ?? 'PDF未選択'}{props.dirty && <span aria-label="未保存"> ●</span>}
      </span>
    </header>
    <dialog ref={aboutRef} className="about-dialog" aria-labelledby="about-title" onCancel={() => setAboutOpen(false)} onClose={() => setAboutOpen(false)}>
      <h1 id="about-title">かるPDFについて</h1>
      <p>版 1.0</p>
      <p>ライセンス: AGPL-3.0-or-later</p>
      <p>PDFはパソコンの外へ送信しません。</p>
      <div><button type="button" onClick={() => setAboutOpen(false)}>閉じる</button></div>
    </dialog>
  </>
}
