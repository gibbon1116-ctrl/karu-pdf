import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mupdf from 'mupdf'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'test-data')
const smallPath = path.join(outputDir, 'sample-small.pdf')
const heavyPath = path.join(outputDir, 'heavy-300p.pdf')
const A4 = [0, 0, 595, 842]
const A1_LANDSCAPE = [0, 0, 2384, 1684]
const SAVE_OPTIONS = 'compress,compress-images,garbage=4'

function copySavedBuffer(buffer) {
  try {
    return new Uint8Array(buffer.asUint8Array())
  } finally {
    buffer.destroy()
  }
}

function addPage(document, mediabox, rotate, resources, contents) {
  const pageObject = document.addPage(mediabox, rotate, resources, contents)
  try {
    document.insertPage(-1, pageObject)
  } finally {
    pageObject.destroy()
  }
}

function createHelvetica(document) {
  const font = new mupdf.Font('Helvetica')
  try {
    return document.addSimpleFont(font)
  } finally {
    font.destroy()
  }
}

function addSampleAnnotations(document) {
  const page = document.loadPage(0)
  try {
    const freeText = page.createAnnotation('FreeText')
    try {
      freeText.setRect([72, 72, 260, 118])
      freeText.setContents('Existing note')
      freeText.setDefaultAppearance('Helv', 14, [0, 0, 0])
      freeText.update()
    } finally {
      freeText.destroy()
    }

    const square = page.createAnnotation('Square')
    try {
      square.setRect([72, 145, 260, 225])
      square.setColor([1, 0, 0])
      square.setBorderWidth(1)
      square.update()
    } finally {
      square.destroy()
    }

    const highlight = page.createAnnotation('Highlight')
    try {
      highlight.setQuadPoints([[72, 260, 275, 260, 72, 282, 275, 282]])
      highlight.setColor([1, 1, 0])
      highlight.update()
    } finally {
      highlight.destroy()
    }
  } finally {
    page.destroy()
  }
}

export async function makeSmallPdf(destination = smallPath) {
  const document = new mupdf.PDFDocument()
  const helvetica = createHelvetica(document)
  try {
    for (let index = 0; index < 5; index += 1) {
      const contents = `BT /F1 24 Tf 72 760 Td (Sample page ${index + 1}) Tj ET\n` +
        '0.85 0.9 1 rg 72 620 450 100 re f\n0 0 0 RG 1 w 72 620 450 100 re S\n'
      addPage(document, A4, index === 4 ? 90 : 0, { Font: { F1: helvetica, Helv: helvetica } }, contents)
    }
    addSampleAnnotations(document)
    const bytes = copySavedBuffer(document.saveToBuffer(SAVE_OPTIONS))
    await fs.writeFile(destination, bytes)
    return bytes.length
  } finally {
    helvetica.destroy()
    document.destroy()
  }
}

function makeScanJpeg(pageNumber) {
  const width = 1654
  const height = 2339
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, width, height], false)
  try {
    const pixels = pixmap.getPixels()
    let random = (0x7f4a7c15 ^ Math.imul(pageNumber, 0x9e3779b1)) >>> 0
    for (let y = 0; y < height; y += 1) {
      const shade = 238 + Math.round(6 * Math.sin((y + pageNumber * 17) / 113))
      for (let x = 0; x < width; x += 1) {
        random ^= random << 13
        random ^= random >>> 17
        random ^= random << 5
        const grain = ((random >>> 24) % 15) - 7
        const band = ((x + pageNumber * 13) % 401 < 2 || (y + pageNumber * 7) % 557 < 2) ? -24 : 0
        pixels[y * width + x] = Math.max(0, Math.min(255, shade + grain + band))
      }
    }
    return new Uint8Array(pixmap.asJPEG(60))
  } finally {
    pixmap.destroy()
  }
}

function vectorDrawing(pageNumber) {
  const chunks = ['q\n']
  let random = (0x9e3779b9 ^ pageNumber) >>> 0
  for (let index = 0; index < 150_000; index += 1) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    const x = random % 2360
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0
    const y = random % 1660
    const dx = 3 + (random % 29)
    const dy = ((random >>> 8) % 19) - 9
    if (index % 5000 === 0) chunks.push(`${(index % 3) * 0.2} ${(index % 5) * 0.12} 0.55 RG ${(index % 4) + 0.25} w\n`)
    chunks.push(`${x} ${y} m ${Math.min(2384, x + dx)} ${Math.max(0, Math.min(1684, y + dy))} l S\n`)
  }
  chunks.push('0 0 0 rg BT /F1 8 Tf\n')
  for (let index = 0; index < 2_000; index += 1) {
    const x = 20 + (index * 97) % 2300
    const y = 20 + (index * 53) % 1620
    chunks.push(`1 0 0 1 ${x} ${y} Tm (P${pageNumber}-${index}) Tj\n`)
  }
  chunks.push('ET\n0.65 G 0.5 w\n')
  for (let group = 0; group < 8; group += 1) {
    const x0 = 80 + group * 270
    for (let line = 0; line < 80; line += 1) {
      chunks.push(`${x0 + line * 3} 200 m ${x0 + line * 3 + 220} 520 l S\n`)
    }
  }
  chunks.push('Q\n')
  return chunks.join('')
}

export async function makeHeavyPdf(destination = heavyPath) {
  const started = performance.now()
  const document = new mupdf.PDFDocument()
  const helvetica = createHelvetica(document)
  const scanImageObjectNumbers = new Set()
  try {
    for (let pageNumber = 1; pageNumber <= 300; pageNumber += 1) {
      if (pageNumber % 6 === 0) {
        addPage(document, A1_LANDSCAPE, 0, { Font: { F1: helvetica } }, vectorDrawing(pageNumber))
      } else {
        const jpeg = makeScanJpeg(pageNumber)
        const image = new mupdf.Image(jpeg)
        const imageRef = document.addImage(image)
        image.destroy()
        try {
          scanImageObjectNumbers.add(imageRef.asIndirect())
          const contents = 'q 595 0 0 842 0 0 cm /Scan Do Q\n' +
            `BT /F1 11 Tf 36 810 Td (Scanned document page ${pageNumber}) Tj 0 -16 Td (Benchmark sample - local processing only) Tj ET\n`
          addPage(document, A4, 0, { XObject: { Scan: imageRef }, Font: { F1: helvetica } }, contents)
        } finally {
          imageRef.destroy()
        }
      }
      if (pageNumber % 25 === 0) console.log(`  ${pageNumber}/300 ページ生成`)
    }

    console.log(`A4画像オブジェクト: ${scanImageObjectNumbers.size}/250 個が別オブジェクト`)
    if (scanImageObjectNumbers.size !== 250) throw new Error('A4画像がページごとに別オブジェクトになっていません。')
    const bytes = copySavedBuffer(document.saveToBuffer(SAVE_OPTIONS))
    await fs.writeFile(destination, bytes)
    console.log(`heavy-300p.pdf: ${(bytes.length / 1024 / 1024).toFixed(1)} MB, ${((performance.now() - started) / 1000).toFixed(1)} 秒`)
    return bytes.length
  } finally {
    helvetica.destroy()
    document.destroy()
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })
  const started = performance.now()
  const smallBytes = await makeSmallPdf()
  console.log(`sample-small.pdf: ${(smallBytes / 1024).toFixed(1)} KB`)
  await makeHeavyPdf()
  console.log(`全体の生成時間: ${((performance.now() - started) / 1000).toFixed(1)} 秒`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
