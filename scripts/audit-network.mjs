import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
export function walk(root) {
  return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e => e.isDirectory() ? walk(path.join(root, e.name)) : [path.join(root, e.name).replaceAll('\\', '/')])
}
// License texts, README, development documents and tests are not executable
// runtime inputs; scanning them would confuse attribution URLs with requests.
const textFile = /\.(?:[cm]?[jt]sx?|css|html|svg|webmanifest|json)$/i
const pattern = /https?:\/\/[^\s"'`<>\\)]+|(?<=["'`(=:\s])\/\/(?:[\w-]+\.)+[\w-]+[^\s"'`<>\\)]*|\bfetch\s*\(|\b(?:XMLHttpRequest|WebSocket|sendBeacon|EventSource|RTCPeerConnection)\b|\bimportScripts\s*\(|\b(?:google-analytics|googletagmanager|sentry|mixpanel|segment|jsdelivr|unpkg|cdnjs|github\.io|github\.com|githubusercontent|googleapis|gstatic)\b/gi
function matchesFile(file, glob) {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*')
  return new RegExp(`^${escaped}$`).test(file)
}
export function auditFiles(files, allowlist = []) {
  const violations = [], inventory = [], counts = new Map()
  for (const file of files) {
    if (!textFile.test(file) || /(?:^|\/)(?:LICENSE|OFL-|THIRD_PARTY_LICENSES)/i.test(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(pattern)) {
      const finding = { file, string: match[0], line: source.slice(0, match.index).split('\n').length, context: source.slice(Math.max(0, match.index - 65), match.index + match[0].length + 65).replaceAll('\n', ' ') }
      inventory.push(finding)
      const rule = allowlist.find(r => r.reason && r.string === match[0] && matchesFile(file, r.file))
      const key = rule ? `${file}:${allowlist.indexOf(rule)}` : ''
      const count = (counts.get(key) || 0) + 1; counts.set(key, count)
      if (!rule || (rule.maxOccurrences && count > rule.maxOccurrences)) violations.push(finding)
    }
  }
  return { violations, inventory }
}
export function runAudit(args = process.argv.slice(2)) {
  const dist = args.includes('--dist')
  const fixtures = args.filter(a => a.startsWith('--file=')).map(a => a.slice(7))
  const files = fixtures.length ? fixtures : dist ? walk('dist-fixed') : [...walk('src'), ...walk('public'), 'index.html', 'vite.config.ts']
  const allowlist = JSON.parse(fs.readFileSync(args.find(a => a.startsWith('--allowlist='))?.slice(12) || 'scripts/audit-allowlist.json', 'utf8'))
  const result = auditFiles(files, allowlist)
  for (const item of result.violations) console.error(`${item.file}:${item.line} ${JSON.stringify(item.string)}\n  ${item.context}`)
  console.log(`Network audit (${dist ? 'dist-fixed' : 'source'}): ${result.inventory.length} findings, ${result.violations.length} unapproved`)
  return result.violations.length ? 1 : 0
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = runAudit()
