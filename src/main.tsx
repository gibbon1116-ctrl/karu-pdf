import { createRoot } from 'react-dom/client'
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
