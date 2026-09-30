import type { RasterPagePlan } from './rasterize'

export interface PdfWriteTarget {
  write(data: Uint8Array): Promise<void>
  close(): Promise<void>
  abort(reason?: unknown): Promise<void>
}

export interface PdfImageBand {
  bytes: Uint8Array
  width: number
  height: number
  components: number
  format: 'jpeg' | 'png'
}

interface ParsedPng {
  width: number
  height: number
  components: 1 | 3
  data: Uint8Array[]
  length: number
}

const ASCII = new TextEncoder()
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function ascii(value: string): Uint8Array {
  return ASCII.encode(value)
}

function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('PDFへ書き出せない数値です。')
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
}

export function parsePngForPdf(bytes: Uint8Array): ParsedPng {
  if (bytes.length < 33 || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    throw new Error('PNG画像の形式を読み取れません。')
  }
  let offset = 8
  let width = 0
  let height = 0
  let components: 1 | 3 | 0 = 0
  const data: Uint8Array[] = []
  let length = 0
  let foundHeader = false
  let foundEnd = false
  while (offset + 12 <= bytes.length) {
    const chunkLength = readUint32(bytes, offset)
    const type = chunkType(bytes, offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + chunkLength
    if (dataEnd + 4 > bytes.length) throw new Error('PNG画像のチャンクが途中で切れています。')
    if (type === 'IHDR') {
      if (foundHeader || chunkLength !== 13) throw new Error('PNG画像のIHDRが不正です。')
      width = readUint32(bytes, dataStart)
      height = readUint32(bytes, dataStart + 4)
      const bitDepth = bytes[dataStart + 8]
      const colorType = bytes[dataStart + 9]
      const compression = bytes[dataStart + 10]
      const filter = bytes[dataStart + 11]
      const interlace = bytes[dataStart + 12]
      if (width <= 0 || height <= 0 || bitDepth !== 8 || (colorType !== 0 && colorType !== 2)
        || compression !== 0 || filter !== 0) throw new Error('このPNG画像の形式には対応していません。')
      if (interlace !== 0) throw new Error('インターレースPNGには対応していません。')
      components = colorType === 0 ? 1 : 3
      foundHeader = true
    } else if (type === 'IDAT') {
      if (!foundHeader) throw new Error('PNG画像のIHDRがありません。')
      const part = bytes.subarray(dataStart, dataEnd)
      data.push(part)
      length += part.byteLength
    } else if (type === 'IEND') {
      foundEnd = true
      break
    }
    offset = dataEnd + 4
  }
  if (!foundHeader || !foundEnd || data.length === 0 || components === 0) throw new Error('PNG画像のデータがそろっていません。')
  return { width, height, components, data, length }
}

export class MemoryPdfWriteTarget implements PdfWriteTarget {
  private readonly chunks: Uint8Array[] = []
  private closed = false
  private aborted = false

  async write(data: Uint8Array): Promise<void> {
    if (this.closed || this.aborted) throw new Error('書き出し先は閉じています。')
    this.chunks.push(data.slice())
  }

  async close(): Promise<void> {
    if (this.aborted) throw new Error('書き出しは中止されています。')
    this.closed = true
  }

  async abort(): Promise<void> {
    this.aborted = true
    this.chunks.length = 0
  }

  toBytes(): Uint8Array {
    if (!this.closed || this.aborted) throw new Error('PDFの書き出しが終わっていません。')
    const length = this.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    const output = new Uint8Array(length)
    let offset = 0
    for (const chunk of this.chunks) {
      output.set(chunk, offset)
      offset += chunk.byteLength
    }
    return output
  }
}

export class BlobPdfWriteTarget implements PdfWriteTarget {
  private readonly parts: Blob[] = []
  private closed = false
  private aborted = false

  async write(data: Uint8Array): Promise<void> {
    if (this.closed || this.aborted) throw new Error('書き出し先は閉じています。')
    this.parts.push(new Blob([new Uint8Array(data)], { type: 'application/pdf' }))
  }

  async close(): Promise<void> {
    if (this.aborted) throw new Error('書き出しは中止されています。')
    this.closed = true
  }

  async abort(): Promise<void> {
    this.aborted = true
    this.parts.length = 0
  }

  toBlob(): Blob {
    if (!this.closed || this.aborted) throw new Error('PDFの書き出しが終わっていません。')
    return new Blob(this.parts, { type: 'application/pdf' })
  }
}

export class PdfStreamWriter {
  private readonly offsets: number[] = [0]
  private readonly pageObjects: number[] = []
  private position = 0
  private nextObject = 3
  private started = false
  private ended = false

  constructor(private readonly target: PdfWriteTarget) {}

  get bytesWritten(): number {
    return this.position
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.writeBytes(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 10, 37, 226, 227, 207, 211, 10]))
  }

  async writePage(plan: RasterPagePlan, bands: readonly PdfImageBand[]): Promise<void> {
    if (!this.started || this.ended) throw new Error('PDFの書き出し状態が不正です。')
    if (bands.length !== plan.bands.length) throw new Error('ページの画像がそろっていません。')
    const imageObjects: number[] = []
    for (let index = 0; index < bands.length; index += 1) {
      const band = bands[index]
      const bandPlan = plan.bands[index]
      if (band.width !== plan.pixelWidth || band.height !== bandPlan.height) throw new Error('画像の帯の大きさが一致しません。')
      const objectNumber = this.nextObject++
      imageObjects.push(objectNumber)
      if (band.format === 'jpeg') {
        if (band.components !== 1 && band.components !== 3) throw new Error('JPEG画像の色成分が不正です。')
        await this.writeStreamObject(objectNumber,
          `/Type /XObject /Subtype /Image /Width ${band.width} /Height ${band.height} /ColorSpace /Device${band.components === 1 ? 'Gray' : 'RGB'} /BitsPerComponent 8 /Filter /DCTDecode`,
          [band.bytes], band.bytes.byteLength)
      } else {
        const png = parsePngForPdf(band.bytes)
        if (png.width !== band.width || png.height !== band.height || png.components !== band.components) {
          throw new Error('PNG画像の情報が一致しません。')
        }
        await this.writeStreamObject(objectNumber,
          `/Type /XObject /Subtype /Image /Width ${png.width} /Height ${png.height} /ColorSpace /Device${png.components === 1 ? 'Gray' : 'RGB'} /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${png.components} /BitsPerComponent 8 /Columns ${png.width} >>`,
          png.data, png.length)
      }
    }

    const commands = plan.bands.map((band, index) => {
      const top = band.y / plan.pixelHeight * plan.height
      const bottom = (band.y + band.height) / plan.pixelHeight * plan.height
      return `q ${pdfNumber(plan.width)} 0 0 ${pdfNumber(bottom - top)} 0 ${pdfNumber(plan.height - bottom)} cm /Im${index} Do Q`
    }).join('\n')
    const content = ascii(commands)
    const contentObject = this.nextObject++
    await this.writeStreamObject(contentObject, '', [content], content.byteLength)

    const pageObject = this.nextObject++
    this.pageObjects.push(pageObject)
    const xObjects = imageObjects.map((objectNumber, index) => `/Im${index} ${objectNumber} 0 R`).join(' ')
    await this.writeObject(pageObject,
      `<< /Type /Page /Parent 1 0 R /MediaBox [0 0 ${pdfNumber(plan.width)} ${pdfNumber(plan.height)}] /Resources << /XObject << ${xObjects} >> >> /Contents ${contentObject} 0 R >>`)
  }

  async close(): Promise<void> {
    if (!this.started || this.ended) throw new Error('PDFの書き出し状態が不正です。')
    await this.writeObject(1, `<< /Type /Pages /Count ${this.pageObjects.length} /Kids [${this.pageObjects.map((item) => `${item} 0 R`).join(' ')}] >>`)
    await this.writeObject(2, '<< /Type /Catalog /Pages 1 0 R >>')
    const xrefOffset = this.position
    const rows = ['0000000000 65535 f \n']
    for (let objectNumber = 1; objectNumber < this.nextObject; objectNumber += 1) {
      const offset = this.offsets[objectNumber]
      if (offset === undefined || offset > 9_999_999_999) throw new Error('PDFのオブジェクト位置が不正です。')
      rows.push(`${String(offset).padStart(10, '0')} 00000 n \n`)
    }
    await this.writeAscii(`xref\n0 ${this.nextObject}\n${rows.join('')}trailer\n<< /Size ${this.nextObject} /Root 2 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
    await this.target.close()
    this.ended = true
  }

  async abort(reason?: unknown): Promise<void> {
    if (this.ended) return
    this.ended = true
    await this.target.abort(reason)
  }

  private async writeObject(objectNumber: number, body: string): Promise<void> {
    this.offsets[objectNumber] = this.position
    await this.writeAscii(`${objectNumber} 0 obj\n${body}\nendobj\n`)
  }

  private async writeStreamObject(objectNumber: number, dictionary: string, parts: readonly Uint8Array[], length: number): Promise<void> {
    this.offsets[objectNumber] = this.position
    await this.writeAscii(`${objectNumber} 0 obj\n<<${dictionary ? ` ${dictionary}` : ''} /Length ${length} >>\nstream\n`)
    for (const part of parts) await this.writeBytes(part)
    await this.writeAscii('\nendstream\nendobj\n')
  }

  private async writeAscii(value: string): Promise<void> {
    await this.writeBytes(ascii(value))
  }

  private async writeBytes(bytes: Uint8Array): Promise<void> {
    await this.target.write(bytes)
    this.position += bytes.byteLength
  }
}
