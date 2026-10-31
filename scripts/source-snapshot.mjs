import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const roots = ['src', 'scripts', 'public', 'launchers', '.github/workflows', 'index.html', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json', '.env.fixed', '.env.single']
export function sourceSnapshot(root = process.cwd()) {
  const files = []
  const visit = relative => {
    const absolute = path.join(root, relative)
    if (!fs.existsSync(absolute)) return
    if (fs.statSync(absolute).isDirectory()) for (const child of fs.readdirSync(absolute).sort()) visit(`${relative}/${child}`)
    else files.push({ path: relative, sha256: createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') })
  }
  roots.forEach(visit)
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  const sourceHash = createHash('sha256').update(JSON.stringify(files)).digest('hex')
  let sourceDirty = true
  try { sourceDirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...roots], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0 } catch { /* A build without Git is unverified. */ }
  return { sourceHash, sourceDirty, sourceFiles: files }
}

export function verifyBuildSource(build, root = process.cwd(), allowDirty = false) {
  const current = sourceSnapshot(root)
  if (!build.sourceHash || build.sourceHash !== current.sourceHash) throw new Error('Source differs from build. Rebuild before packaging.')
  if ((build.sourceDirty || current.sourceDirty) && !allowDirty) throw new Error('Uncommitted source cannot be released. Use --allow-dirty only for a clearly marked review package.')
  return current
}
