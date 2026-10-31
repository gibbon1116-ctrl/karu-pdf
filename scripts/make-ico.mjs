import fs from 'node:fs'
import mupdf from 'mupdf'

export function makeIco(source = 'public/icons/icon-512.png') {
  const image = new mupdf.Image(fs.readFileSync(source))
  try {
    const sizes = [16, 32, 48, 256]
    const images = sizes.map(size => {
      const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, size, size], true)
      try {
        pixmap.clear(0)
        const device = new mupdf.DrawDevice(mupdf.Matrix.identity, pixmap)
        try { device.fillImage(image, [size, 0, 0, size, 0, 0], 1); device.close() }
        finally { device.destroy() }
        return Buffer.from(pixmap.asPNG())
      } finally { pixmap.destroy() }
    })
    const header = Buffer.alloc(6 + sizes.length * 16)
    header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4)
    let offset = header.length
    sizes.forEach((size, i) => {
      const entry = 6 + i * 16
      header[entry] = header[entry + 1] = size === 256 ? 0 : size
      header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6)
      header.writeUInt32LE(images[i].length, entry + 8); header.writeUInt32LE(offset, entry + 12)
      offset += images[i].length
    })
    return Buffer.concat([header, ...images])
  } finally { image.destroy() }
}
