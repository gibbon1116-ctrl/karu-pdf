import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export function thirdPartyNotices({ runtimePackages, root = process.cwd() }) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const mupdfThirdParty = fs.readFileSync(path.join(root, 'licenses/mupdf-thirdparty.txt'), 'utf8')
  const texts = []
  for (const name of [...new Set(runtimePackages)].sort()) {
    const key = `node_modules/${name}`, entry = lock.packages[key]
    if (!entry) throw new Error('Missing bundled package in lock: ' + name)
    const directory = path.join(root, key)
    const installed = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
    if (installed.version !== entry.version) throw new Error('Installed version differs from lock: ' + key)
    const licenses = fs.readdirSync(directory).filter(n => /^(?:licen[sc]e|copying)/i.test(n) && fs.statSync(path.join(directory, n)).isFile()).sort()
    if (!licenses.length) throw new Error('Missing license text for ' + name)
    const license = installed.license || entry.license || 'UNKNOWN'
    texts.push(`${name} ${entry.version}\nLicense: ${typeof license === 'string' ? license : JSON.stringify(license)}\n${licenses.map(n => fs.readFileSync(path.join(directory, n), 'utf8')).join('\n')}\n`)
    if (name === 'mupdf') texts.push(`MuPDF bundled third-party components\n${mupdfThirdParty}\n`)
  }
  for (const [name, fontFile, licenseFile] of [
    ['BIZ UD Gothic', 'BIZUDGothic-Regular.ttf', 'OFL-BIZUDGothic.txt'], ['BIZ UD Mincho', 'BIZUDMincho-Regular.ttf', 'OFL-BIZUDMincho.txt'],
  ]) {
    const hash = createHash('sha256').update(fs.readFileSync(path.join(root, 'public/fonts', fontFile))).digest('hex')
    texts.push(`${name}\nVersion: sha256:${hash}\nLicense: OFL-1.1\n${fs.readFileSync(path.join(root, 'public/fonts', licenseFile), 'utf8')}\n`)
  }
  return texts.join('\n' + '='.repeat(72) + '\n\n')
}
