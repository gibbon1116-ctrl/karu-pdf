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
          <p>選択（V）、文字（T）、吹き出し（C）、線（L）、矢印（A）、四角（R）、丸（O）、記号（S）、蛍光ペン（H）、手書き（P）を使えます。右の「書式」で色・太さ・文字サイズ・書体を変えます。</p>
          <p>記号は12種類と大きさを選べ、続けて置けます。やめるときは <kbd>Esc</kbd> か「選択」です。文字や吹き出しの入力中は、書式の「記号を挿入」からカーソル位置に記号を入れられます。</p>
          <p>四角と丸は塗り・枠線・透明度を選べます。四角の「白塗りにする」は上に白い四角を重ねる機能で、下の文字やデータはファイルに残ります。</p>
          <p>文字と吹き出しには背景色と枠線を付けられ、文字と背景・枠の透明度を別々に選べます。吹き出しは指摘する点から文字枠までドラッグしてください。</p>
          <p>蛍光ペンと手書きは、<kbd>Ctrl</kbd>を押しながら描くと直線になり、<kbd>Ctrl</kbd>+<kbd>Shift</kbd>で45度刻みに揃います。蛍光ペンは1本描くと選択へ戻り、手書きは続けて描けます。</p>
          <p>選択中に <kbd>Shift</kbd> を押しながらクリックすると、複数の書き込みを選べます。何もない所から囲むようにドラッグしてもまとめて選べます。<kbd>Ctrl</kbd>+<kbd>C</kbd>／<kbd>X</kbd>／<kbd>V</kbd> でコピー・切り取り・貼り付け、<kbd>Ctrl</kbd>+<kbd>D</kbd> で複製します。</p>
          <p>「文字に印」（M）では、「文字を選択」で PDF の文字を選んでコピーし、「文字ハイライト」「文字に下線」「文字に取り消し線」で選んだ文字だけに印を付けられます。</p>
          <p>書き込みを選んで方向キーを押すと1pt、<kbd>Shift</kbd>+方向キーでは10ptずつ動かせます。文字への印は文字に結び付いているため動かせません。</p>
          <p><kbd>Esc</kbd> で選択を外します。<kbd>Ctrl</kbd>+<kbd>Z</kbd> で元に戻し、<kbd>Ctrl</kbd>+<kbd>Y</kbd> でやり直します。</p>
        </section>
        <section>
          <h2>雲マークと指摘</h2>
          <p>図形▼の「雲（四角）」はドラッグで囲みます。「雲（多角形）」はクリックで点を足し、ダブルクリックか Enter で閉じます。Backspace で最後の点を消し、Esc で中止、Shift で45度刻みに揃えます。書式で色・太さ・塗り・透明度・雲の大きさを選べます。</p>
          <p>文字▼の「指摘」（N）は、クリックで文書全体の通し番号の印を置き、内容を入力します。Ctrl+Enter または欄の外のクリックで確定し、Esc では入力を取り消して印を残します。続けて置けます。道具をやめるときは Esc です。印のダブルクリックで内容を直せます。</p>
          <p>指摘は書式で色・大きさ・状態を変えます。対応済は灰色とチェックになります。左の「書き込み」を「指摘」で絞り込むと番号順に表示され、状態を変更できます。「指摘一覧を CSV に書き出す」で Excel 用の一覧を作れます。「番号を振り直す」はページ・上・左の順に番号を付け直し、Ctrl+Z で戻せます。削除では欠番を残し、コピーには新しい番号を付けます。</p>
        </section>
        <section>
          <h2>ページ整理</h2>
          <p>ページの並べ替え、回転、削除、白紙の挿入、抽出、分割、ほかのPDFの追加ができます。「適用」を押すまで元の並びは変わりません。</p>
          <p>ほかのPDFから追加したページでは、しおり・リンク・フォームは移りません。</p>
        </section>
        <section>
          <h2>ページ番号・ヘッダー・フッター</h2>
          <p>ページ▼の「ページ番号・ヘッダー・フッター…」で、上下6か所にページ番号、総ページ数、日付、ファイル名を入れられます。内容として書き込むため提出用の書類にも使え、かるPDFで付けたものは後から付け直し・削除できます。</p>
          <p>ページを並べ替えた後に番号を振り直すときは、同じ画面で［適用］を押してください。</p>
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
