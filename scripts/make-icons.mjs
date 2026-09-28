import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mupdf from 'mupdf'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fontPath = path.join(root, 'public', 'fonts', 'BIZUDGothic-Regular.ttf')
const outputDirectory = path.join(root, 'public', 'icons')

async function makeIcon(size, fontBytes) {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, size, size], false)
  const font = new mupdf.Font('BIZUDGothic', fontBytes)
  const text = new mupdf.Text()
  let device
  try {
    const pixels = pixmap.getPixels()
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const offset = (y * size + x) * 3
        const distance = Math.hypot(x - size / 2, y - size / 2) / (size * 0.72)
        pixels[offset] = Math.round(23 + 15 * Math.min(1, distance))
        pixels[offset + 1] = Math.round(105 + 25 * (1 - Math.min(1, distance)))
        pixels[offset + 2] = Math.round(170 + 20 * (1 - Math.min(1, distance)))
      }
    }

    const fontSize = size * 0.34
    const label = 'かる'
    const advance = [...label].reduce((sum, character) => {
      const glyph = font.encodeCharacter(character)
      return sum + font.advanceGlyph(glyph)
    }, 0)
    const x = (size - advance * fontSize) / 2
    const baseline = size * 0.68
    text.showString(font, [fontSize, 0, 0, -fontSize, x, baseline], label)
    device = new mupdf.DrawDevice([1, 0, 0, 1, 0, 0], pixmap)
    device.fillText(text, [1, 0, 0, 1, 0, 0], mupdf.ColorSpace.DeviceRGB, [1, 1, 1], 1)
    device.close()
    await fs.writeFile(path.join(outputDirectory, `icon-${size}.png`), pixmap.asPNG())
  } finally {
    device?.destroy()
    text.destroy()
    font.destroy()
    pixmap.destroy()
  }
}

await fs.mkdir(outputDirectory, { recursive: true })
const fontBytes = new Uint8Array(await fs.readFile(fontPath))
await Promise.all([192, 512].map((size) => makeIcon(size, fontBytes)))
