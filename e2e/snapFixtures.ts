import mupdf from 'mupdf'

export function snapPdf(contents = '1 w 100 400 m 172 400 l S 172 400 m 172 300 l S 250 400 m 350 300 l S 250 300 m 350 400 l S 400 400 20 20 re f') {
  const doc = new mupdf.PDFDocument(), ref = doc.addPage([0, 0, 600, 600], 0, {}, contents)
  try {
    doc.insertPage(-1, ref)
    const buffer = doc.saveToBuffer('compress')
    try { return [...buffer.asUint8Array()] } finally { buffer.destroy() }
  } finally { ref.destroy(); doc.destroy() }
}
