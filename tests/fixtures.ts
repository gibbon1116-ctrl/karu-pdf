import fs from 'node:fs/promises'
import path from 'node:path'

export const samplePath = path.resolve('test-data/sample-small.pdf')

// test-data/ は Git に含めないため、CI では最初に使うテストが生成する。
// テストファイルは並列に動くので、一時ファイルへ書いてから rename し、
// 書きかけのファイルを別のテストが読まないようにする。
export async function ensureSamplePdf(): Promise<string> {
  try {
    await fs.access(samplePath)
    return samplePath
  } catch {
    await fs.mkdir(path.dirname(samplePath), { recursive: true })
    const temporaryPath = `${samplePath}.${process.pid}.${Date.now()}.tmp`
    // @ts-expect-error The executable generator intentionally has no separate declaration file.
    const { makeSmallPdf } = await import('../scripts/make-test-pdf.mjs')
    await makeSmallPdf(temporaryPath)
    try {
      await fs.rename(temporaryPath, samplePath)
    } catch (error) {
      // Windows では、別のテストが先に作って開いているファイルは置き換えられない。
      // その場合は先に作られたものを使う。
      await fs.rm(temporaryPath, { force: true })
      try {
        await fs.access(samplePath)
      } catch {
        throw error
      }
    }
    return samplePath
  }
}
