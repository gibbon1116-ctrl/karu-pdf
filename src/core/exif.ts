export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
export interface ExifInfo { orientation: ExifOrientation; dateTime?: string }

// Only bounded TIFF reads. Malformed metadata must never prevent opening a JPEG.
export function readExif(bytes: Uint8Array): ExifInfo {
  const result: ExifInfo = { orientation: 1 }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return result
  try {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset++] !== 0xff) break
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue
      const length = bytes[offset] * 256 + bytes[offset + 1]
      if (length < 2 || offset + length > bytes.length) break
      if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(offset + 2, offset + 8)) === 'Exif\0\0') {
        const start = offset + 8, end = offset + length
        const view = new DataView(bytes.buffer, bytes.byteOffset + start, end - start)
        const little = view.getUint16(0) === 0x4949
        if (!little && view.getUint16(0) !== 0x4d4d || view.getUint16(2, little) !== 42) return result
        const u16 = (at: number) => view.getUint16(at, little)
        const u32 = (at: number) => view.getUint32(at, little)
        const readIfd = (at: number, dates: boolean) => {
          const count = u16(at)
          if (at + 2 + count * 12 + 4 > view.byteLength) return
          for (let i = 0; i < count; i++) {
            const entry = at + 2 + i * 12, tag = u16(entry), type = u16(entry + 2), size = u32(entry + 4)
            if (!dates && tag === 0x0112 && type === 3 && size === 1) {
              const orientation = u16(entry + 8)
              if (orientation >= 1 && orientation <= 8) result.orientation = orientation as ExifOrientation
            }
            if (tag === 0x9003 && type === 2 && size >= 19 && size <= 32) {
              const pointer = u32(entry + 8)
              if (pointer + size <= view.byteLength) {
                const date = String.fromCharCode(...bytes.subarray(start + pointer, start + pointer + 19))
                if (/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) result.dateTime = date
              }
            }
          }
        }
        const ifd = u32(4)
        readIfd(ifd, false)
        const count = u16(ifd)
        if (ifd + 2 + count * 12 + 4 <= view.byteLength) for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12
          if (u16(entry) === 0x8769 && u16(entry + 2) === 4 && u32(entry + 4) === 1) readIfd(u32(entry + 8), true)
        }
        return result
      }
      offset += length
    }
  } catch { /* Truncated or invalid offsets: keep the safe defaults / validated values. */ }
  return result
}

export function orientedSize(width: number, height: number, orientation: ExifOrientation = 1) {
  return orientation >= 5 ? { width: height, height: width } : { width, height }
}
