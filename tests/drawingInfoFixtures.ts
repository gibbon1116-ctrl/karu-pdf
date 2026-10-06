import fs from 'node:fs/promises'
import mupdf from 'mupdf'

export async function makeDrawingInfoPdf(count = 3): Promise<Uint8Array> {
  const font = new mupdf.Font('BIZUDGothic', new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  const doc = new mupdf.PDFDocument(), ref = doc.addFont(font)
  try {
    for (let i = 0; i < count; i++) {
      const encoded = (s: string) => [...s].map(c => font.encodeCharacter(c).toString(16).padStart(4, '0')).join('')
      const contents = `BT /F1 12 Tf 240 60 Td <${encoded(`図面番号 E-${101 + i}`)}> Tj 0 -22 Td <${encoded(`図面名称 ${i + 1}階 電灯設備平面図`)}> Tj ET`
      const page = doc.addPage([0, 0, 500, 500], 0, { Font: { F1: ref } }, contents)
      try { doc.insertPage(-1, page) } finally { page.destroy() }
    }
    doc.subsetFonts()
    const buffer = doc.saveToBuffer('compress,garbage=4')
    try { return new Uint8Array(buffer.asUint8Array()) } finally { buffer.destroy() }
  } finally { ref.destroy(); doc.destroy(); font.destroy() }
}
