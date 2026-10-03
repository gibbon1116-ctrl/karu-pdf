import fs from 'node:fs/promises'
import mupdf from 'mupdf'

export const DRAWING_TEXTS = ['機器名称 照明器具 Ｅ－１２３', '=1+1 "quote",comma', '', '盤名称 電灯盤Ａ']
export const VERTICAL_DRAWING_TEXTS = ['電灯盤Ａ', '回路名Ｂ', '', '照明器具Ｃ']

export async function makeTextExtractFixture(options: { vertical?: boolean } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const font = new mupdf.Font('BIZUDGothic', new Uint8Array(await fs.readFile('public/fonts/BIZUDGothic-Regular.ttf')))
  const document = new mupdf.PDFDocument()
  try {
    const ref = document.addFont(font)
    try {
      if (options.vertical) { const encoding = document.newName('Identity-V'); try { ref.put('Encoding', encoding) } finally { encoding.destroy() } }
      for (let index = 0; index < DRAWING_TEXTS.length; index++) {
        const text = (options.vertical ? VERTICAL_DRAWING_TEXTS : DRAWING_TEXTS)[index]
        const encoded = [...text, ' '].map(char => font.encodeCharacter(char).toString(16).padStart(4, '0')).join('')
        const contents = text ? `BT /F1 12 Tf 40 180 Td <${encoded}> Tj ET` : '0 0 1 RG 10 10 m 200 200 l S'
        const page = document.addPage([0, 0, 400, 300], index === 3 ? 90 : 0, { Font: { F1: ref } }, contents)
        try { page.put('CropBox', [10, 20, 310, 220]); page.put('UserUnit', 2); document.insertPage(-1, page) }
        finally { page.destroy() }
      }
    } finally { ref.destroy() }
    document.subsetFonts()
    const saved = document.saveToBuffer('compress,garbage=4')
    try { return new Uint8Array(saved.asUint8Array()) } finally { saved.destroy() }
  } finally { document.destroy(); font.destroy() }
}
