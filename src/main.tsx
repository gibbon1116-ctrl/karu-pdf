/* @pages:start */import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './app/ErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary fallback={(_error, reset) => (
    <main className="app-error" role="alert">
      <p>アプリの表示で問題が起きました。開いている文書と書き込みは保持されています。</p>
      <button type="button" onClick={reset}>表示し直す</button>
    </main>
  )}>
    <App />
  </ErrorBoundary>,
)
/* @pages:end *//* @fixed:start */
import { blocksFixedStartup } from './fixed/security'
const root = document.getElementById('root')!
if (blocksFixedStartup(location.hostname)) {
  root.textContent = '固定・閉域版を GitHub Pages から実行することはできません。管理された内部サーバーから起動してください。'
} else {
  // Do not evaluate App (which creates Workers) before the hostname check.
  void Promise.all([import('react-dom/client'), import('./App'), import('./app/ErrorBoundary')]).then(([{ createRoot }, { default: App }, { ErrorBoundary }]) => {
    createRoot(root).render(<ErrorBoundary fallback={(_error, reset) => <main role="alert"><p>表示中に問題が起きました。</p><button onClick={reset}>表示し直す</button></main>}><App /></ErrorBoundary>)
  })
}
/* @fixed:end *//* @single:start */
import { createRoot as createSingleRoot } from 'react-dom/client'
import SingleApp from './App'
import { ErrorBoundary as SingleBoundary } from './app/ErrorBoundary'
import { watchDisplayFonts } from './single/runtime'
watchDisplayFonts()
createSingleRoot(document.getElementById('root')!).render(<SingleBoundary fallback={(_error, reset) => <main role="alert"><p>表示中に問題が起きました。</p><button onClick={reset}>表示し直す</button></main>}><SingleApp /></SingleBoundary>)
/* @single:end */
