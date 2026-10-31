import { useEffect, useState } from 'react'
import type { PdfWorkerPool, PoolStats } from '../client/PdfWorkerPool'
import type { BitmapCache } from '../viewer/BitmapCache'
import { getMetrics, type MetricsSnapshot } from './metrics'

interface Props {
  pool: PdfWorkerPool
  cache: BitmapCache
}

const format = (value: number | null) => value === null ? '—' : `${value.toFixed(1)} ms`

export function DebugPanel({ pool, cache }: Props) {
  const [metrics, setMetrics] = useState<MetricsSnapshot>(() => getMetrics())
  const [stats, setStats] = useState<PoolStats | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMetrics(getMetrics())
      void pool.stats().then(setStats).catch(() => undefined)
    }, 500)
    return () => window.clearInterval(timer)
  }, [pool])

  return (
    <aside className="debug-panel" data-testid="debug-panel">
      <strong>描画計測</strong>
      <span>開く: {format(metrics.open.latest)}</span>
      <span>鮮明に開く: {format(metrics.openSharp.latest)}</span>
      <span>描画 Worker 平均/p95: {format(metrics.renderWorker.average)} / {format(metrics.renderWorker.p95)}</span>
      <span>描画 往復 平均/p95: {format(metrics.renderRoundTrip.average)} / {format(metrics.renderRoundTrip.p95)}</span>
      <span>拡大確定: {format(metrics.zoomSettle.latest)}</span>
      <span>横移動確定: {format(metrics.panSettle.latest)}</span>
      <span>白抜け: {(metrics.blankFrames.ratio * 100).toFixed(2)}% / 最長 {metrics.blankFrames.longestMs.toFixed(1)} ms</span>
      <span>Worker キュー: {stats?.queueLength ?? 0}</span>
      <span>BitmapCache: {(cache.usedBytes / 1024 / 1024).toFixed(1)} MB</span>
      <span>DisplayList: {stats?.displayListCount ?? 0}</span>
      <span>Worker処理件数: {stats?.workers.map((worker) => worker.processedCount).join(' / ') ?? '0'}</span>
    </aside>
  )
}
