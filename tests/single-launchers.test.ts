import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import mupdf from 'mupdf'
import { expect, it } from 'vitest'

const names = ['かるPDFを開く.cmd', 'デスクトップにショートカットを作る.cmd']
function node(code: string) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}

it('cmd は ASCII で、生成元と一致し、別プロファイルや ps1 を使わない', () => {
  node(`import fs from 'node:fs'; import assert from 'node:assert/strict'; import {createLaunchers} from './scripts/launchers/create-launchers.mjs';
    for(const [name,bytes] of createLaunchers()) assert.deepEqual(fs.readFileSync('scripts/launchers/'+name),bytes);`)
  for (const name of names) {
    const bytes = fs.readFileSync(path.join('scripts/launchers', name))
    expect(bytes.every(b => b < 128)).toBe(true)
    expect(bytes.toString()).toContain('-NoProfile -NonInteractive -WindowStyle Hidden -Command')
    expect(bytes.toString()).not.toMatch(/--user-data-dir|\.ps1|ExecutionPolicy/i)
  }
})

it.skipIf(process.platform !== 'win32')('日本語・空白の場所で実 cmd のドライランを確認し、版番号順に HTML を選ぶ', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'karu-launcher-'))
  const folder = path.join(temporary, "新しいフォルダー & (試験) ' %/karu pdf")
  try {
    fs.mkdirSync(folder, { recursive: true })
    for (const name of names) fs.copyFileSync(path.join('scripts/launchers', name), path.join(folder, name))
    for (const version of ['1.0.0', '1.2.0', '1.10.0']) fs.writeFileSync(path.join(folder, `karu-pdf-v${version}.html`), '<!doctype html>')
    fs.writeFileSync(path.join(folder, 'karu-pdf.ico'), '')
    const run = (name: string) => spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${path.join(folder, name)}""`], {
      windowsVerbatimArguments: true, encoding: 'utf8', env: { ...process.env, KARU_LAUNCHER_DRY_RUN: '1' }, timeout: 30_000,
    })
    const locations = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs')) | ConvertTo-Json -Compress"], { encoding: 'utf8' })
    expect(locations.status, locations.stderr).toBe(0)
    const expectedLocations: string[] = JSON.parse(locations.stdout)
    for (const name of names) {
      const result = run(name)
      expect(result.status, result.stderr || result.error?.message).toBe(0)
      const output = JSON.parse(result.stdout)
      console.log('LAUNCHER_DRY_RUN', result.stdout.trim())
      expect(output.url).toMatch(/^file:\/\/\/.+%E6%96%B0.+karu%20pdf\/karu-pdf-v1\.10\.0\.html$/)
      expect(path.resolve(fileURLToPath(output.url))).toBe(path.join(folder, 'karu-pdf-v1.10.0.html'))
      expect(output.browser).toMatch(/(?:msedge|chrome)\.exe$/i)
      expect(fs.statSync(output.browser).isFile()).toBe(true)
      expect(output.arguments).toBe(`--app="${output.url}"`)
      if (name === names[1]) {
        expect(output.shortcuts).toBeDefined()
        expect(output.shortcuts).toHaveLength(2)
        output.shortcuts.forEach((item: Record<string, string>, index: number) => {
          expect(item.path).toBe(path.join(expectedLocations[index], 'かるPDF.lnk'))
          expect(item.target).toBe(output.browser)
          expect(item.arguments).toBe(output.arguments)
          expect(path.resolve(item.workingDirectory)).toBe(folder)
          expect(item.icon).toBe(path.join(folder, 'karu-pdf.ico'))
          expect(item.description).toBe('かるPDF（固定・閉域版）')
        })
      }
    }
    for (const version of ['1.10.0', '1.0.0']) fs.unlinkSync(path.join(folder, `karu-pdf-v${version}.html`))
    expect(JSON.parse(run(names[0]).stdout).url).toContain('karu-pdf-v1.2.0.html')
    fs.unlinkSync(path.join(folder, 'karu-pdf-v1.2.0.html'))
    for (const name of names) {
      const result = run(name)
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout).error).toContain('HTML ファイルが見つかりません')
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
}, 120_000)

it('ICO は 16・32・48・256px の読める PNG を含む', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'karu-ico-')), file = path.join(temporary, 'icon.ico')
  try {
    node(`import fs from 'node:fs'; import {makeIco} from './scripts/make-ico.mjs'; fs.writeFileSync(${JSON.stringify(file)},makeIco());`)
    const bytes = fs.readFileSync(file)
    expect(bytes.readUInt16LE(0)).toBe(0); expect(bytes.readUInt16LE(2)).toBe(1); expect(bytes.readUInt16LE(4)).toBe(4)
    let offset = 70
    for (const [index, size] of [16, 32, 48, 256].entries()) {
      const entry = 6 + index * 16, length = bytes.readUInt32LE(entry + 8)
      expect(bytes[entry] || 256).toBe(size); expect(bytes[entry + 1] || 256).toBe(size)
      expect(bytes.readUInt32LE(entry + 12)).toBe(offset)
      const png = bytes.subarray(offset, offset + length)
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      const image = new mupdf.Image(png)
      try { expect(image.getWidth()).toBe(size); expect(image.getHeight()).toBe(size); const pixels = image.toPixmap(); try { expect(pixels.getPixels().some(b => b !== 0)).toBe(true) } finally { pixels.destroy() } }
      finally { image.destroy() }
      offset += length
    }
    expect(offset).toBe(bytes.length)
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})

it.skipIf(process.platform !== 'win32')('ZIP のローカル・中央ヘッダーは UTF-8 で、Expand-Archive でも日本語名が復元される', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'karu-zip-')), zip = path.join(temporary, 'launchers.zip'), destination = path.join(temporary, 'expanded')
  try {
    node(`import fs from 'node:fs'; import {createZip} from './scripts/fixed-zip.mjs';
      fs.writeFileSync(${JSON.stringify(zip)},createZip(new Map(${JSON.stringify(names)}.map(name=>[name,fs.readFileSync('scripts/launchers/'+name)]))));`)
    const bytes = fs.readFileSync(zip), end = bytes.length - 22
    let cursor = bytes.readUInt32LE(end + 16)
    for (const name of names) {
      expect(bytes.readUInt16LE(cursor + 8) & 0x800).toBe(0x800)
      const local = bytes.readUInt32LE(cursor + 42), length = bytes.readUInt16LE(cursor + 28)
      expect(bytes.readUInt16LE(local + 6) & 0x800).toBe(0x800)
      expect(bytes.subarray(cursor + 46, cursor + 46 + length).toString('utf8')).toBe(name)
      cursor += 46 + length
    }
    // PowerShell 7 can prepend its unsigned module to PSModulePath. Load the
    // signed Windows PowerShell module explicitly without changing policy.
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Archive') -ErrorAction Stop; Expand-Archive -LiteralPath $env:KARU_TEST_ZIP -DestinationPath $env:KARU_TEST_DEST -ErrorAction Stop"], { encoding: 'utf8', env: { ...process.env, KARU_TEST_ZIP: zip, KARU_TEST_DEST: destination } })
    expect(result.status, result.stderr).toBe(0)
    expect(fs.readdirSync(destination).sort()).toEqual([...names].sort())
    for (const name of names) expect(fs.readFileSync(path.join(destination, name))).toEqual(fs.readFileSync(path.join('scripts/launchers', name)))
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
}, 30_000) // PowerShell Expand-Archive can exceed 5 s while the full suite loads the machine.
