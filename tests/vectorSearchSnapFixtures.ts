import mupdf from 'mupdf'

/** Entire fixture stays in memory; no test writes to work/. Coordinates are displayed PDF points. */
export function vectorSearchSnapPdf(raster = false): number[] {
  const doc = new mupdf.PDFDocument()
  const symbols = [[50,50],[150,50],[250,50],[50,150],[150,150],[250,150]]
  const commands = symbols.map(([x,y]) => `${x} ${y} 10 10 re S ${x} ${y} m ${x+10} ${y+10} l S ${x+10} ${y} m ${x} ${y+10} l S`).join('\n')
    + '\n40 155 m 80 155 l S 140 155 m 180 155 l S\n350 50 10 10 re S 350 150 10 10 re S 350 250 10 10 re S\n100 400 m 200 400 l S'
  const ref = doc.addPage([0,0,500,500],0,{},`q 1 0 0 -1 0 500 cm 0 G .5 w ${commands} Q`)
  let output = doc
  try {
    doc.insertPage(-1,ref)
    if (raster) {
      output = new mupdf.PDFDocument()
      const page = doc.loadPage(0), pixmap = page.toPixmap(mupdf.Matrix.scale(3,3),mupdf.ColorSpace.DeviceRGB,false,false)
      const image = new mupdf.Image(pixmap), imageRef=output.addImage(image), images=output.newDictionary(), resources=output.newDictionary()
      let imagePage: ReturnType<typeof output.addPage> | undefined
      try {
        images.put('Im0',imageRef);resources.put('XObject',images)
        imagePage=output.addPage([0,0,500,500],0,resources,'q 500 0 0 500 0 0 cm /Im0 Do Q')
        output.insertPage(-1,imagePage)
      } finally { imagePage?.destroy();resources.destroy();images.destroy();imageRef.destroy();image.destroy();pixmap.destroy();page.destroy() }
    }
    const bytes=output.saveToBuffer('compress')
    try { return [...bytes.asUint8Array()] } finally { bytes.destroy() }
  } finally { if (output!==doc) output.destroy();ref.destroy();doc.destroy() }
}
