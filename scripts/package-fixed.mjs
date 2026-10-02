import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { CSP } from './fixed-policy.mjs'
import { walk } from './audit-network.mjs'
import { createZip, extractZip, sha256, verifySums } from './fixed-zip.mjs'

// Verify both working copy and HEAD; never change Git or the lockfile.
execFileSync('git', ['diff', '--quiet', '--', 'package-lock.json'], { stdio: ['ignore', 'pipe', 'pipe'] })
const lockBytes = fs.readFileSync('package-lock.json')
if (!lockBytes.equals(execFileSync('git', ['show', 'HEAD:package-lock.json'], { maxBuffer: 16 * 1024 * 1024 }))) throw new Error('Lockfile differs from HEAD')
const lock = JSON.parse(lockBytes), pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const build = JSON.parse(fs.readFileSync('dist-fixed/build-info.json', 'utf8'))
if (build.mode !== 'fixed' || !/^\d+\.\d+\.\d+-fixed$/.test(build.version)) throw new Error('Invalid fixed build metadata')
const runtime = new Set(build.runtimePackages)
// Resolve each edge using the lockfile's actual node_modules hierarchy.
function resolveDependency(from, name) {
  let current = from
  while (true) {
    const candidate = `${current ? current + '/' : ''}node_modules/${name}`
    if (lock.packages[candidate]) return candidate
    if (!current) return null
    const last = current.lastIndexOf('/node_modules/')
    current = last < 0 ? '' : current.slice(0, last)
  }
}
const required = new Set(), queue = Object.keys(pkg.dependencies || {}).map(name => resolveDependency('', name)).filter(Boolean)
while (queue.length) {
  const key = queue.pop(); if (required.has(key)) continue
  required.add(key)
  for (const name of Object.keys({ ...lock.packages[key].dependencies, ...lock.packages[key].optionalDependencies })) {
    const target = resolveDependency(key, name); if (target) queue.push(target)
  }
}
const components = [], dependencies = [], texts = []
for (const [key, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!key) continue
  const name = entry.name || key.split('node_modules/').at(-1)
  const manifestPath = path.join(key, 'package.json')
  const installed = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null
  if (installed && installed.version !== entry.version) throw new Error('Installed version differs from lock: ' + key)
  const bundled = runtime.has(name) && key === `node_modules/${name}`
  if (bundled && !installed) throw new Error('Missing bundled package: ' + name)
  const license = installed?.license || entry.license || 'UNKNOWN', ref = `npm:${key}@${entry.version}`
  components.push({ type: 'library', 'bom-ref': ref, name, version: entry.version, scope: required.has(key) || bundled ? 'required' : 'excluded',
    licenses: [{ license: { name: typeof license === 'string' ? license : JSON.stringify(license) } }],
    purl: `pkg:npm/${name.startsWith('@') ? '%40' + name.slice(1) : name}@${entry.version}`,
    properties: [{ name: 'karu:dependency', value: key === `node_modules/${name}` && (pkg.dependencies?.[name] || pkg.devDependencies?.[name]) ? 'direct' : 'indirect' }, { name: 'karu:bundled-runtime', value: String(bundled) }, { name: 'karu:lockfile-path', value: key }] })
  const dependsOn = Object.keys({ ...entry.dependencies, ...entry.optionalDependencies }).map(n => resolveDependency(key, n)).filter(Boolean).map(p => `npm:${p}@${lock.packages[p].version}`)
  dependencies.push({ ref, dependsOn })
  if (bundled) {
    const licenses = fs.readdirSync(key).filter(n => /^(?:licen[sc]e|copying)(?:\.|$)/i.test(n) && fs.statSync(path.join(key, n)).isFile())
    if (!licenses.length) throw new Error('Missing license text for ' + name)
    texts.push(`${name} ${entry.version}\nLicense: ${typeof license === 'string' ? license : JSON.stringify(license)}\n${licenses.map(n => fs.readFileSync(path.join(key, n), 'utf8')).join('\n')}\n`)
  }
}
for (const [name, fontFile, licenseFile] of [
  ['BIZ UD Gothic', 'BIZUDGothic-Regular.ttf', 'OFL-BIZUDGothic.txt'], ['BIZ UD Mincho', 'BIZUDMincho-Regular.ttf', 'OFL-BIZUDMincho.txt'],
]) {
  const bytes = fs.readFileSync(`public/fonts/${fontFile}`), hash = sha256(bytes), ref = `font:${fontFile}`
  // Font distribution has no npm version. Its exact bytes are its fixed version.
  components.push({ type: 'file', 'bom-ref': ref, name, version: `sha256:${hash}`, scope: 'required', licenses: [{ license: { id: 'OFL-1.1' } }], hashes: [{ alg: 'SHA-256', content: hash }], properties: [{ name: 'karu:bundled-runtime', value: 'true' }, { name: 'karu:dependency', value: 'direct' }] })
  dependencies.push({ ref, dependsOn: [] })
  texts.push(`${name}\nVersion: sha256:${hash}\nLicense: OFL-1.1\n${fs.readFileSync(`public/fonts/${licenseFile}`, 'utf8')}\n`)
}
const application = 'karu-pdf-fixed', rootRef = `application:${build.version}`
dependencies.unshift({ ref: rootRef, dependsOn: components.filter(c => c.properties.some(p => p.name === 'karu:bundled-runtime' && p.value === 'true')).map(c => c['bom-ref']) })
const sbom = { bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
  metadata: { timestamp: build.buildDate, component: { type: 'application', 'bom-ref': rootRef, name: application, version: build.version } }, components, dependencies }
const npmVersion = process.env.npm_config_user_agent?.match(/npm\/([^ ]+)/)?.[1]
  || execFileSync(process.execPath, [process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), '--version'], { encoding: 'utf8' }).trim()
const versionText = `Application: かるPDF\nDistribution: Fixed / Closed Network\nVersion: ${build.version}\nBuild Date: ${build.buildDate}\nGit Commit: ${build.gitCommit}\nNode Version: ${process.version}\nnpm Version: ${npmVersion}\nnpm lockfile hash: ${sha256(lockBytes)}\nBuild mode: ${build.mode}\nBase path: ${build.base}\nCSP: ${CSP}\n`
const entries = new Map(walk('dist-fixed').map(p => [p.slice('dist-fixed/'.length), fs.readFileSync(p)]))
entries.set('LICENSE', fs.readFileSync('LICENSE'))
entries.set('THIRD_PARTY_LICENSES', Buffer.from(texts.join('\n' + '='.repeat(72) + '\n\n')))
entries.set('VERSION.txt', Buffer.from(versionText)); entries.set('SBOM.cdx.json', Buffer.from(JSON.stringify(sbom, null, 2) + '\n'))
entries.set('SHA256SUMS.txt', Buffer.from([...entries].sort(([a], [b]) => a.localeCompare(b)).map(([name, bytes]) => `${sha256(bytes)}  ${name}`).join('\n') + '\n'))
fs.mkdirSync('release', { recursive: true })
const filename = `karu-pdf-fixed-v${build.version.replace(/-fixed$/, '')}.zip`, zipPath = path.join('release', filename)
// Build and verify before replacing an existing release.
const zip = createZip(entries), temporary = fs.mkdtempSync(path.resolve('release', '.verify-'))
try {
  const names = extractZip(zip, temporary), checked = verifySums(temporary, names)
  for (const [name, original] of entries) if (!fs.readFileSync(path.join(temporary, name)).equals(original)) throw new Error('ZIP roundtrip differs: ' + name)
  fs.writeFileSync(zipPath, zip)
  const actualHash = sha256(fs.readFileSync(zipPath))
  fs.writeFileSync(zipPath + '.sha256', `${actualHash}  ${filename}\n`)
  console.log(`ZIP extracted and verified: ${names.size} files, ${checked} SHA-256 entries; checksum manifest covered by ZIP hash`)
  console.log(`ZIP SHA-256: ${actualHash}\nLockfile SHA-256: ${sha256(lockBytes)}`)
  console.log(`SBOM: ${components.length} components; bundled runtime: ${components.filter(c => c.properties.some(p => p.name === 'karu:bundled-runtime' && p.value === 'true')).map(c => c.name).join(', ')}`)
} finally { fs.rmSync(temporary, { recursive: true, force: true }) }
