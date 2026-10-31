import fs from 'node:fs'
import { expect, it } from 'vitest'
import { createZip, extractZip, sha256, verifySums } from '../scripts/fixed-zip.mjs'

it('ZIP を展開して実バイトとハッシュを確認し、改ざんとパス逸脱を拒否する', () => {
  const dir = fs.mkdtempSync('scripts/.zip-test-')
  try {
    const payload = Buffer.from('fixed release\n'), entries = new Map([['assets/a.txt', payload], ['SHA256SUMS.txt', Buffer.from(`${sha256(payload)}  assets/a.txt\n`)]])
    const zip = createZip(entries), names = extractZip(zip, dir)
    expect(fs.readFileSync(`${dir}/assets/a.txt`)).toEqual(payload)
    expect(verifySums(dir, names)).toBe(1)
    fs.writeFileSync(`${dir}/assets/a.txt`, 'tampered'); expect(() => verifySums(dir, names)).toThrow('SHA-256 mismatch')
    const bad = Buffer.from(zip); bad[bad.length - 6] ^= 1
    expect(() => extractZip(bad, dir)).toThrow()
    expect(() => extractZip(createZip(new Map([['../escape.txt', payload]])), dir)).toThrow('Unsafe ZIP entry')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

it('SOURCE のソース ZIP をチェックサムに含め、必要なソースを展開できる', () => {
  const dir = fs.mkdtempSync('scripts/.source-zip-test-')
  try {
    const gitShort = '0123456789ab'
    const sourceName = 'SOURCE/karu-pdf-source-' + gitShort + '.zip'
    const sourceFiles = ['package.json', 'LICENSE', 'src/main.tsx']
    const sourceZip = createZip(new Map(sourceFiles.map(name => [name, fs.readFileSync(name)])))
    const entries = new Map([[sourceName, sourceZip]])
    entries.set('SHA256SUMS.txt', Buffer.from(sha256(sourceZip) + '  ' + sourceName + '\n'))
    const names = extractZip(createZip(entries), dir)
    expect(names.has(sourceName)).toBe(true)
    expect(verifySums(dir, names)).toBe(1)
    const sourceDir = dir + '/expanded-source'
    const sourceNames = extractZip(fs.readFileSync(dir + '/' + sourceName), sourceDir)
    for (const name of sourceFiles) {
      expect(sourceNames.has(name)).toBe(true)
      expect(fs.readFileSync(sourceDir + '/' + name)).toEqual(fs.readFileSync(name))
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

for (const [distribution, filename] of [
  ['fixed', 'release/karu-pdf-fixed-v1.11.1.zip'],
  ['single', 'release/karu-pdf-v1.11.1-single.zip'],
]) {
  it.skipIf(!fs.existsSync(filename))(distribution + ' の実配布 ZIP にビルドコミットのソースが同梱される', () => {
    const dir = fs.mkdtempSync('scripts/.release-source-test-')
    try {
      const names = extractZip(fs.readFileSync(filename), dir)
      verifySums(dir, names)
      const version = fs.readFileSync(dir + '/VERSION.txt', 'utf8')
      const commit = version.match(/^Git Commit: ([a-f0-9]{40,64})$/m)?.[1]
      expect(commit).toBeTruthy()
      const sourceName = 'SOURCE/karu-pdf-source-' + commit!.slice(0, 12) + '.zip'
      expect(names.has(sourceName)).toBe(true)
      expect(version).toContain('ソースコード: 同梱の SOURCE/ と ')
      const source = fs.readFileSync(dir + '/' + sourceName)
      // Git archives carry a commit comment after the ZIP end record.
      const end = source.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
      expect(end).toBeGreaterThanOrEqual(0)
      expect(end + 22 + source.readUInt16LE(end + 20)).toBe(source.length)
      expect(source.subarray(end + 22).toString('utf8')).toBe(commit)
      const sourceNames = new Set<string>()
      let cursor = source.readUInt32LE(end + 16)
      for (let i = 0; i < source.readUInt16LE(end + 10); i++) {
        expect(source.readUInt32LE(cursor)).toBe(0x02014b50)
        const length = source.readUInt16LE(cursor + 28)
        sourceNames.add(source.subarray(cursor + 46, cursor + 46 + length).toString('utf8'))
        cursor += 46 + length + source.readUInt16LE(cursor + 30) + source.readUInt16LE(cursor + 32)
      }
      expect(cursor).toBe(end)
      for (const name of ['package.json', 'LICENSE', 'src/main.tsx']) expect(sourceNames.has(name)).toBe(true)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
}
