// Generates the PWA icon PNGs (192, 512, and a maskable 512) with a tiny
// dependency-free PNG encoder. The icon is a simple "factory bars" emblem on
// the app's dark chrome colour — content sits within the maskable safe zone so
// the same artwork works for both `any` and `maskable` purposes.
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePNG(size, pixel) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size)
  let o = 0
  for (let y = 0; y < size; y++) {
    raw[o++] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size)
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
      raw[o++] = a
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const BG = [0x1f, 0x29, 0x33, 255]
const FG = [0xf0, 0xb4, 0x29, 255]
const BARS = [
  { x0: 0.24, x1: 0.37, y0: 0.52 },
  { x0: 0.435, x1: 0.565, y0: 0.34 },
  { x0: 0.63, x1: 0.76, y0: 0.46 },
]
const BASELINE = 0.78

function pixel(x, y, size) {
  const fx = (x + 0.5) / size
  const fy = (y + 0.5) / size
  for (const b of BARS) {
    if (fx >= b.x0 && fx <= b.x1 && fy >= b.y0 && fy <= BASELINE) return FG
  }
  return BG
}

const outDir = path.join(process.cwd(), 'public')
fs.mkdirSync(outDir, { recursive: true })

const targets = [
  ['pwa-192x192.png', 192],
  ['pwa-512x512.png', 512],
  ['pwa-maskable-512x512.png', 512],
]

for (const [name, size] of targets) {
  fs.writeFileSync(path.join(outDir, name), encodePNG(size, pixel))
  console.log(`  wrote public/${name} (${size}x${size})`)
}
console.log('\nPWA icons generated.')
