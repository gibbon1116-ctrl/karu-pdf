import { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  onClose(): void
}

export function HelpDialog({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog ref={dialogRef} className="help-dialog" aria-labelledby="help-title" onCancel={onClose} onClose={onClose}>
      <div className="help-dialog-header">
        <h1 id="help-title">かるPDFの使い方</h1>
        <button type="button" aria-label="使い方を閉じる" onClick={onClose}>×</button>
      </div>
      <div className="help-dialog-body">
        <section>
          <h2>開く・保存・確定保存・印刷</h2>
          <ul>
            <li>「開く」または <kbd>Ctrl</kbd>+<kbd>O</kbd> でPDFを開きます。複数のPDFはタブで切り替えます。</li>
            <li>「上書き保存」は元のファイルへ保存します。ブラウザから書き込みの許可を求められることがあります。</li>
            <li>「別名で保存」は編集できる書き込みを残したPDFを新しい名前で保存します。</li>
            <li>「確定して別名で保存」は書き込みをページへ焼き付けます。確定版の書き込みは後から編集できません。</li>
            <li>「印刷」または <kbd>Ctrl</kbd>+<kbd>P</kbd> でPDFを新しいタブに開き、そのタブの印刷ボタンから印刷します。</li>
          </ul>
        </section>
        <section>
          <h2>書き込みの道具とキー</h2>
          <p>選択（V）、文字（T）、線（L）、矢印（A）、四角（R）、丸（O）、蛍光ペン（H）、手書き（P）、白塗り（W）を使えます。右の「書式」で色・太さ・文字サイズ・書体を変えます。</p>
          <p><kbd>Esc</kbd> で選択を外します。<kbd>Ctrl</kbd>+<kbd>Z</kbd> で元に戻し、<kbd>Ctrl</kbd>+<kbd>Y</kbd> でやり直します。</p>
        </section>
        <section>
          <h2>ページ整理</h2>
          <p>ページの並べ替え、回転、削除、白紙の挿入、抽出、分割、ほかのPDFの追加ができます。「適用」を押すまで元の並びは変わりません。</p>
          <p>ほかのPDFから追加したページでは、しおり・リンク・フォームは移りません。</p>
        </section>
        <section>
          <h2>アプリとして使う</h2>
          <p>EdgeまたはChromeのメニューから「アプリをインストール」を選びます。インストール後は、エクスプローラーのPDFの「プログラムから開く」で「かるPDF」を選べます。</p>
          <p>対応ブラウザは最新版のEdgeとChromeです。初回表示後はオフラインでも使えます。</p>
        </section>
        <section>
          <h2>データの扱い</h2>
          <p>PDFはパソコンの外へ送信しません。自動保存はしないため、必要なときに保存してください。</p>
        </section>
      </div>
      <div className="help-dialog-actions"><button type="button" onClick={onClose}>閉じる</button></div>
    </dialog>
  )
}
