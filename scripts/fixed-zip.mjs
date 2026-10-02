import fs from 'node:fs'
import path from 'node:path'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { createHash } from 'node:crypto'
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
export function createZip(entries) {
  const locals = [], central = []; let offset = 0
  for (const [name, bytes] of entries) {
    const filename = Buffer.from(name), compressed = deflateRawSync(bytes), crc = crc32(bytes)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8)
    header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x800, 8); dir.writeUInt16LE(8, 10); dir.writeUInt16LE(33, 14)
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(compressed.length, 20); dir.writeUInt32LE(bytes.length, 24); dir.writeUInt16LE(filename.length, 28); dir.writeUInt32LE(offset, 42)
    locals.push(header, filename, compressed); central.push(dir, filename); offset += header.length + filename.length + compressed.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
export function extractZip(zip, destination) {
  // Read the central directory, then independently verify each local header,
  // size, CRC and deflated payload. Reject traversal and duplicate entries.
  const end = zip.length - 22
  if (zip.readUInt32LE(end) !== 0x06054b50) throw new Error('Missing ZIP end record')
  const count = zip.readUInt16LE(end + 10), names = new Set(); let cursor = zip.readUInt32LE(end + 16)
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid central directory')
    const size = zip.readUInt32LE(cursor + 20), rawSize = zip.readUInt32LE(cursor + 24), crc = zip.readUInt32LE(cursor + 16)
    const nameSize = zip.readUInt16LE(cursor + 28), extraSize = zip.readUInt16LE(cursor + 30), commentSize = zip.readUInt16LE(cursor + 32), local = zip.readUInt32LE(cursor + 42)
    const name = zip.subarray(cursor + 46, cursor + 46 + nameSize).toString('utf8')
    if (!name || name.startsWith('/') || /[\\:]/.test(name) || name.split('/').includes('..') || names.has(name)) throw new Error('Unsafe ZIP entry')
    names.add(name)
    if (zip.readUInt32LE(local) !== 0x04034b50 || zip.readUInt16LE(local + 8) !== 8) throw new Error('Invalid local header')
    const localNameSize = zip.readUInt16LE(local + 26), localExtra = zip.readUInt16LE(local + 28)
    if (zip.subarray(local + 30, local + 30 + localNameSize).toString('utf8') !== name || zip.readUInt32LE(local + 18) !== size) throw new Error('Mismatched headers')
    const start = local + 30 + localNameSize + localExtra, bytes = inflateRawSync(zip.subarray(start, start + size))
    if (bytes.length !== rawSize || crc32(bytes) !== crc) throw new Error('ZIP size/CRC mismatch')
    const target = path.resolve(destination, name)
    if (!target.startsWith(path.resolve(destination) + path.sep)) throw new Error('Unsafe ZIP entry')
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes)
    cursor += 46 + nameSize + extraSize + commentSize
  }
  if (cursor !== end) throw new Error('Invalid directory length')
  return names
}
export function verifySums(directory, names) {
  const lines = fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split('\n'), checked = new Set()
  for (const line of lines) {
    const match = line.match(/^([a-f0-9]{64})  (.+)$/)
    if (!match || checked.has(match[2]) || !names.has(match[2])) throw new Error('Invalid checksum manifest')
    if (sha256(fs.readFileSync(path.join(directory, match[2]))) !== match[1]) throw new Error('SHA-256 mismatch: ' + match[2])
    checked.add(match[2])
  }
  // A checksum file cannot contain its own hash. ZIP's external hash covers it.
  if (checked.size !== names.size - 1 || !names.has('SHA256SUMS.txt')) throw new Error('Incomplete checksum manifest')
  return checked.size
}
