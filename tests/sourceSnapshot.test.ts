import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { sourceSnapshot, verifyBuildSource } from '../scripts/source-snapshot.mjs'

it('未コミット検証版を明示し、ビルド後の変更・追加・削除を包装前に拒否する', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karu-source-'))
  try {
    fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'original')
    const build = sourceSnapshot(root)
    expect(() => verifyBuildSource(build, root)).toThrow('Uncommitted')
    expect(() => verifyBuildSource(build, root, true)).not.toThrow()
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'changed')
    expect(() => verifyBuildSource(build, root, true)).toThrow('Source differs')
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'original')
    fs.writeFileSync(path.join(root, 'src', 'new.ts'), 'new')
    expect(() => verifyBuildSource(build, root, true)).toThrow('Source differs')
    fs.unlinkSync(path.join(root, 'src', 'new.ts')); fs.unlinkSync(path.join(root, 'src', 'app.ts'))
    expect(() => verifyBuildSource(build, root, true)).toThrow('Source differs')
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
