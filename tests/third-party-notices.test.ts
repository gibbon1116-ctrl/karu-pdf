import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { thirdPartyNotices } from '../scripts/third-party-notices.mjs'

const runtimePackages = ['mupdf', 'react', 'react-dom', 'scheduler', 'workbox-core', 'workbox-precaching', 'workbox-routing', 'workbox-strategies', 'workbox-window']

it('同梱する npm・MuPDF 内蔵ライブラリ・フォントの全文を決定的な順序で生成する', () => {
  const text = thirdPartyNotices({ runtimePackages })
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
  for (const name of runtimePackages) {
    const entry = lock.packages['node_modules/' + name]
    expect(text).toContain(name + ' ' + entry.version + '\nLicense: ' + entry.license + '\n')
  }
  expect(text).toContain('License: MIT\n')
  expect(text).toContain('License: AGPL-3.0-or-later\n')
  expect(text).toContain('MuPDF bundled third-party components\n' + fs.readFileSync('licenses/mupdf-thirdparty.txt', 'utf8'))
  expect(text.indexOf('MuPDF bundled third-party components')).toBeGreaterThan(text.indexOf('mupdf '))
  expect(text.indexOf('MuPDF bundled third-party components')).toBeLessThan(text.indexOf('react '))
  for (const name of ['BIZ UD Gothic', 'BIZ UD Mincho']) {
    expect(text).toMatch(new RegExp(name + '\\nVersion: sha256:[a-f0-9]{64}\\nLicense: OFL-1.1\\n'))
  }
  expect(thirdPartyNotices({ runtimePackages })).toBe(text)
  expect(thirdPartyNotices({ runtimePackages: [...runtimePackages].reverse() })).toBe(text)
})

function withPackage(callback: (root: string, directory: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'third-party-notices-'))
  try {
    const directory = path.join(root, 'node_modules/example')
    fs.mkdirSync(directory, { recursive: true })
    fs.mkdirSync(path.join(root, 'licenses'))
    fs.writeFileSync(path.join(root, 'licenses/mupdf-thirdparty.txt'), 'Bundled components\n')
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/example': { version: '1.0.0', license: 'MIT' } } }))
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '1.0.0', license: 'MIT' }))
    callback(root, directory)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

it('ライセンスファイルの無いパッケージを拒否する', () => {
  withPackage(root => expect(() => thirdPartyNotices({ runtimePackages: ['example'], root })).toThrow('Missing license text for example'))
})

it('インストールされた版と lockfile の不一致を拒否する', () => {
  withPackage((root, directory) => {
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version: '2.0.0', license: 'MIT' }))
    expect(() => thirdPartyNotices({ runtimePackages: ['example'], root })).toThrow('Installed version differs from lock')
  })
})

it('MuPDF の第三者ライセンス資料が無ければ拒否する', () => {
  withPackage(root => {
    fs.unlinkSync(path.join(root, 'licenses/mupdf-thirdparty.txt'))
    expect(() => thirdPartyNotices({ runtimePackages: ['example'], root })).toThrow()
  })
})
