import fs from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { createServer } from 'vite'

const manifest = JSON.parse(await fs.readFile(process.argv[2], 'utf8'))
const server = await createServer({ configFile: false, root: process.cwd(), server: { middlewareMode: true, watch: null }, appType: 'custom' })
try {
  const { openDocument } = await server.ssrLoadModule('/src/core/mupdfDoc.ts')
  const { readDocumentMetadata } = await server.ssrLoadModule('/src/core/documentMetadata.ts')
  const { readDocumentDrawingInfos } = await server.ssrLoadModule('/src/core/drawingInfo.ts')
  const { readDocumentScaleMetadata } = await server.ssrLoadModule('/src/core/measure.ts')
  const { readDocumentRoomMetadata } = await server.ssrLoadModule('/src/core/rooms.ts')
  const results = []
  for (const file of manifest) {
    const bytes = new Uint8Array(await fs.readFile(file.path))
    const old = openDocument(bytes), next = openDocument(bytes, false)
    try {
      const doc = old.document.asPDF()
      const expected = { pageSizes: old.pageSizes, pageDrawingInfos: readDocumentDrawingInfos(doc), ...readDocumentScaleMetadata(doc), ...readDocumentRoomMetadata(doc) }
      const { sizesMs, ...actual } = readDocumentMetadata(next.document.asPDF())
      const fields = Object.fromEntries(Object.keys(expected).map(key => [key, isDeepStrictEqual(actual[key], expected[key])]))
      const result = { id: file.id, pageCount: old.pageCount, fields, equal: Object.values(fields).every(Boolean) }
      results.push(result)
      console.log(JSON.stringify(result))
    } finally { old.document.destroy(); next.document.destroy() }
  }
  await fs.writeFile(process.argv[3], JSON.stringify(results, null, 2))
  if (results.some(result => !result.equal)) process.exitCode = 1
} finally { await server.close() }
