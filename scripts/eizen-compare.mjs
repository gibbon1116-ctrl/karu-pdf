import fs from 'node:fs/promises'
import path from 'node:path'

const argument = name => {
  const index = process.argv.indexOf(name)
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`)
  return process.argv[index + 1]
}
const outputIndex = process.argv.indexOf('--output')
const outputPath = path.resolve(outputIndex < 0 ? 'bench-results/eizen/comparison.json' : argument('--output'))
const read = async names => Promise.all(names.split(',').map(async name => ({ path: name, data: JSON.parse(await fs.readFile(name, 'utf8')) })))
const before = await read(argument('--before'))
const after = await read(argument('--after'))
const network = await read(argument('--network-before'))
const all = [...before, ...after, ...network]
if (new Set(all.map(record => record.data.browser)).size !== 1) throw new Error('Browser versions differ')
if (new Set(all.map(record => JSON.stringify(record.data.conditions.viewport))).size !== 1) throw new Error('Viewports differ')
if (new Set(all.map(record => record.data.conditions.workers)).size !== 1) throw new Error('Worker counts differ')
if (new Set([...before, ...after].map(record => record.data.conditions.inputSamples ?? 40)).size !== 1) throw new Error('Input sample counts differ')
if (new Set([...before, ...after].map(record => record.data.conditions.timingOrigin ?? 'driver-call')).size !== 1) throw new Error('Timing origins differ')
for (const name of ['actionPage', 'openTracing', 'readyDefinition', 'saveTimingOrigin', 'harnessSha256']) {
  if (new Set([...before, ...after].map(record => record.data.conditions[name])).size !== 1) throw new Error(`${name} conditions differ`)
}
const hashes = new Map()
for (const record of all) for (const fixture of record.data.fixtures) {
  if (hashes.has(fixture.file) && hashes.get(fixture.file) !== fixture.sha256) throw new Error(`Fixture changed: ${fixture.file}`)
  hashes.set(fixture.file, fixture.sha256)
}
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = (sorted.length - 1) / 2
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2
}
const openOnly = process.argv.includes('--open-only')
const allMetrics = [
  ['PDFを開く（文書操作可能まで）', 'ms', row => row.open.readyMs],
  ['初表示（ファイル読込含む）', 'ms', row => row.open.firstMs],
  ['鮮明表示（ファイル読込含む）', 'ms', row => row.open.sharpMs],
  ['スクロール1500 cold フレームp95', 'ms', row => row.scroll1500Cold.frameP95Ms],
  ['スクロール1500 cached フレームp95', 'ms', row => row.scroll1500Cached.frameP95Ms],
  ['スクロール3000 フレームp95', 'ms', row => row.scroll3000.frameP95Ms],
  ['ページ移動→鮮明表示', 'ms', row => row.pageMove.elapsedMs],
  ['400%ズーム→鮮明表示', 'ms', row => row.zoom400.elapsedMs],
  ['250pxパン→鮮明表示', 'ms', row => row.pan250.elapsedMs],
  ['注釈ドラッグ フレームp95', 'ms', row => row.edit.drag.p95],
  ['文字入力 フレームp95', 'ms', row => row.edit.input.p95],
  ['PDF生成・保存処理', 'ms', row => row.save.generatedMs],
  ['初期取得本文量', 'bytes', row => row.resourceBytesComplete ? row.initialBytes : null, true],
  ['読込後 ブラウザprivate bytes', 'bytes', row => row.memory.afterOpen.privateBytes],
  ['読込後 メインJSヒープ（回収前・参考）', 'bytes', row => row.mainHeapAfterOpenBytes, false, false],
  ['操作・保存後 ブラウザprivate bytes', 'bytes', row => row.memory.afterOperations.privateBytes],
  ['文書終了後 ブラウザprivate bytes', 'bytes', row => row.memory.afterDocumentClose.privateBytes],
  ['操作・保存後 メインJS保持ヒープ（回収後）', 'bytes', row => row.mainRetainedHeapAfterOperationsBytes],
]
const openMetrics = new Set(['PDFを開く（文書操作可能まで）', '初表示（ファイル読込含む）', '鮮明表示（ファイル読込含む）', '初期取得本文量', '読込後 ブラウザprivate bytes', '読込後 メインJSヒープ（回収前・参考）'])
const metrics = openOnly ? allMetrics.filter(([name]) => openMetrics.has(name)) : allMetrics
const files = [...hashes.keys()]
const comparisons = []
for (const file of files) {
  const oldRows = before.flatMap(record => record.data.trials).filter(row => row.file === file)
  const newRows = after.flatMap(record => record.data.trials).filter(row => row.file === file)
  const networkRows = network.flatMap(record => record.data.trials).filter(row => row.file === file)
  for (const [metric, unit, get, networkMetric, gated = true] of metrics) {
    const oldValues = (networkMetric ? networkRows : oldRows).map(get).filter(value => typeof value === 'number' && Number.isFinite(value))
    const newValues = newRows.map(get).filter(value => typeof value === 'number' && Number.isFinite(value))
    const oldMedian = oldValues.length ? median(oldValues) : null
    const newMedian = newValues.length ? median(newValues) : null
    const deltaPct = oldMedian === null || newMedian === null ? null : oldMedian === 0 ? newMedian === 0 ? 0 : Infinity : (newMedian / oldMedian - 1) * 100
    const status = oldValues.length < 5 || newValues.length < 5 ? '測定不足' : !gated ? '参考・GC時点未統制' : deltaPct <= 5 ? '中央値5%以内' : '5%超過・要調査'
    comparisons.push({ file, metric, unit, gated, before: oldMedian, after: newMedian, deltaPct, status, samples: { before: oldValues, after: newValues } })
  }
}
const quality = files.map(file => {
  const oldRows = before.flatMap(record => record.data.trials).filter(row => row.file === file)
  const newRows = after.flatMap(record => record.data.trials).filter(row => row.file === file)
  return {
    file,
    feedbackMs: newRows.map(row => row.open.feedbackMs),
    whiteFrames: openOnly ? [] : ['scroll1500Cold', 'scroll1500Cached', 'scroll3000'].map(mode => ({ mode, before: oldRows.map(row => row[mode].blank), after: newRows.map(row => row[mode].blank) })),
    memoryAfterOperations: { before: oldRows.map(row => row.memory.afterOperations), after: newRows.map(row => row.memory.afterOperations) },
    memoryAfterDocumentClose: { before: oldRows.map(row => row.memory.afterDocumentClose), after: newRows.map(row => row.memory.afterDocumentClose) },
  }
})
const output = {
  timestamp: new Date().toISOString(), inputs: { before: before.map(record => record.path), after: after.map(record => record.path), network: network.map(record => record.path) },
  comparisons, quality,
  decision: comparisons.some(row => row.gated && row.status !== '中央値5%以内') ? '次の機能へ進む前に要調査' : '中央値比較5%以内。回収前ヒープ・白抜け・ばらつき・メモリ解放・未測定項目を別途確認',
  limitations: ['フレームp95は各試行のp95の中央値。', 'OSキャッシュと他アプリは制御していない。', '定点メモリはピークではない。', '保存先の上書きI/Oは未測定。ダウンロード完了時間は自動化の遅延を含むため5%判定に用いていない。'],
}
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, JSON.stringify(output, null, 2))
console.table(comparisons.map(row => ({ file: row.file, metric: row.metric, before: row.before?.toFixed(2), after: row.after?.toFixed(2), difference: Number.isFinite(row.deltaPct) ? `${row.deltaPct.toFixed(2)}%` : row.deltaPct, status: row.status })))
console.log(`${output.decision}\n${outputPath}`)
