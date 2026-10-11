import mupdf from 'mupdf'
import type { Rect } from '../src/core/annotations'

// Kept below the capture instruction bar, which overlays the top of the viewer.
export const symbolSampleEraserRect: Rect = [19.5, 59.5, 30.5, 68.5]
const positions = [20, 60, 100]

/** Three identical bodies. Only the first has short wiring fragments inside its bounds. */
export function symbolSampleEraserGeometry(): { segments: Float32Array; widths: Float32Array; body: Float32Array } {
  const lines: number[] = []
  for (const x of positions) {
    lines.push(x, 60, x + 10, 60, x + 10, 60, x + 10, 68, x + 10, 68, x, 68, x, 68, x, 60)
    if (x === positions[0]) {
      for (const y of [62, 64, 66]) lines.push(x + 2, y, x + 8, y)
    }
  }
  return {
    segments: new Float32Array(lines),
    widths: new Float32Array(lines.length / 4).fill(.6),
    body: new Float32Array(lines.slice(0, 16)),
  }
}

export function symbolSampleEraserPdf(): number[] {
  const doc = new mupdf.PDFDocument(), resources = doc.newDictionary()
  let ref: import('mupdf').PDFObject | undefined
  try {
    let content = 'q 1 0 0 -1 0 100 cm 0 G .6 w\n'
    for (const x of positions) {
      content += `${x} 60 m ${x + 10} 60 l ${x + 10} 68 l ${x} 68 l h S\n`
      if (x === positions[0]) {
        for (const y of [62, 64, 66]) content += `${x + 2} ${y} m ${x + 8} ${y} l S\n`
      }
    }
    content += 'Q\n'
    ref = doc.addPage([0, 0, 200, 100], 0, resources, content)
    doc.insertPage(-1, ref)
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally {
    ref?.destroy(); resources.destroy(); doc.destroy()
  }
}
