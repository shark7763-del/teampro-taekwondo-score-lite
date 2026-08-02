/**
 * 產生 PWA 圖示（純 Node，不需要任何影像套件）。
 *
 * 圖案：深色底 + 左藍右紅兩個方塊，對應計分板的固定版位，
 * 在手機主畫面上一眼就能認出是計分系統。
 *
 * 執行：node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

/** pixels: (x, y) => [r, g, b] */
function encodePng(size, pixels) {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  let offset = 0
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0 // filter type: none
    offset += 1
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixels(x, y)
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
      offset += 3
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const INK = [5, 7, 12]
const BLUE = [29, 111, 224]
const RED = [224, 52, 44]

/** padding 為安全區比例，maskable 圖示需要較大留白 */
function makeIcon(size, padding) {
  const inset = Math.round(size * padding)
  const inner = size - inset * 2
  const gap = Math.max(2, Math.round(size * 0.045))
  const blockWidth = Math.round((inner - gap) / 2)
  const blockHeight = Math.round(inner * 0.62)
  const top = Math.round((size - blockHeight) / 2)

  return encodePng(size, (x, y) => {
    const inBand = y >= top && y < top + blockHeight
    if (inBand) {
      const blueStart = inset
      const blueEnd = inset + blockWidth
      const redStart = blueEnd + gap
      const redEnd = redStart + blockWidth
      if (x >= blueStart && x < blueEnd) return BLUE
      if (x >= redStart && x < redEnd) return RED
    }
    return INK
  })
}

mkdirSync(OUT_DIR, { recursive: true })

const outputs = [
  ['icon-192.png', makeIcon(192, 0.12)],
  ['icon-512.png', makeIcon(512, 0.12)],
  ['icon-maskable-512.png', makeIcon(512, 0.22)],
  ['apple-touch-icon.png', makeIcon(180, 0.1)],
]

for (const [name, buffer] of outputs) {
  writeFileSync(join(OUT_DIR, name), buffer)
  console.log(`已產生 ${name}（${buffer.length} bytes）`)
}
