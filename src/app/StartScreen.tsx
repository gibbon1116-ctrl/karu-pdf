import type { RecentFile } from '../editor/recentStore'
import { InstallAppSection } from './InstallAppUi'
/* @single:start */
import { LauncherHint } from '../single/LauncherHint'
/* @single:end */

interface Props {
  recent: readonly RecentFile[]
  onOpen(): void
  onOpenRecent(item: RecentFile): void
  onRemoveRecent(item: RecentFile): void
  onHelp(): void
}

export function StartScreen({ recent, onOpen, onOpenRecent, onRemoveRecent, onHelp }: Props) {
  return (
    <section className="start-screen" data-testid="start-screen">
      <div className="start-primary">
        <h1>かるPDF</h1>
        <button type="button" className="start-open" onClick={onOpen}>PDF を開く</button>
        <button type="button" className="start-help-button" onClick={onHelp}>使い方</button>
        <p>ここにファイルをドラッグ＆ドロップ</p>
        {/* @single:start */}
        <LauncherHint />
        {/* @single:end */}
        <InstallAppSection />
      </div>
      <section className="recent-files" aria-label="最近使ったファイル">
        <h2>最近使ったファイル</h2>
        {recent.length === 0 ? <p>最近開いたファイルはありません。</p> : (
          <ul>
            {recent.map((item, index) => (
              <li key={`${item.name}-${item.openedAt}-${index}`}>
                <button type="button" className="recent-open" onClick={() => onOpenRecent(item)}>
                  <span>{item.name}</span>
                  <time dateTime={new Date(item.openedAt).toISOString()}>{new Date(item.openedAt).toLocaleString('ja-JP')}</time>
                </button>
                <button type="button" className="recent-remove" aria-label={`${item.name}を一覧から消す`} title="一覧から消す" onClick={() => onRemoveRecent(item)}>×</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="start-help">
        <h2>使い方</h2>
        <ol>
          <li>「PDF を開く」かドラッグ＆ドロップでファイルを開きます。</li>
          <li>左のページ一覧で、見たいページへ移動します。</li>
          <li>「文字」「四角」を選び、PDF 上へ書き込みます。</li>
          <li>右の書式で色・太さ・文字の大きさを変えます。</li>
          <li>上書き保存、または別名で保存します。</li>
        </ol>
      </section>
    </section>
  )
}
