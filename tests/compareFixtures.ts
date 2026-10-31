import mupdf from 'mupdf'

export function makeComparePdf(options: { revised?: boolean; shift?: number; width?: number; height?: number; annotation?: boolean; count?: number } = {}): Uint8Array {
  const doc = new mupdf.PDFDocument()
  const width = options.width ?? 400, height = options.height ?? 400, factor = width / 400
  const shift = options.shift ?? 0
  try {
    for (let i = 0; i < (options.count ?? 1); i++) {
      const b = options.revised ? 210 : 200
      // A: identical rectangle; B: vertical 3pt line shifted 10pt; C: new circle.
      const content = `q 1 0 0 -1 0 ${height} cm ${factor} 0 0 ${factor} ${shift * factor} 0 cm\n` +
        `0 0 0 RG 4 w 40 40 80 60 re S\n0 0 0 rg ${b} 70 3 60 re f\n` +
        (options.revised ? '0 0 0 RG 4 w 315 200 m 315 208.284 308.284 215 300 215 c 291.716 215 285 208.284 285 200 c 285 191.716 291.716 185 300 185 c 308.284 185 315 191.716 315 200 c S\n' : '') + 'Q'
      const object = doc.addPage([0, 0, width, height], 0, {}, content)
      try { doc.insertPage(-1, object) } finally { object.destroy() }
    }
    if (options.annotation) {
      const page = doc.loadPage(0)
      try {
        const annotation = page.createAnnotation('Square')
        try { annotation.setRect([150 * factor, 250 * factor, 180 * factor, 280 * factor]); annotation.setColor([1, 0, 0]); annotation.setInteriorColor([1, 0, 0]); annotation.update() }
        finally { annotation.destroy() }
      } finally { page.destroy() }
    }
    const buffer = doc.saveToBuffer('compress')
    try { return buffer.asUint8Array().slice() } finally { buffer.destroy() }
  } finally { doc.destroy() }
}
