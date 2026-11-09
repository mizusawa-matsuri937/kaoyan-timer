// 生成 PWA 图标（纯 Node，无依赖）：绿色圆角底 + 3x3 热度格子
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}
// 圆角矩形的有符号距离
const sdRound = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const cov = (d) => Math.max(0, Math.min(1, 0.5 - d))
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

// 每个格子的热度（0–4）
const LEVELS = [[1, 2, 4], [2, 4, 3], [4, 3, 2]]
const ALPHA = [0.18, 0.35, 0.55, 0.78, 1]

function icon(size, { rounded, pad }) {
  const top = [46, 160, 67], bot = [22, 101, 52]
  return png(size, (x, y) => {
    const u = x / size, v = y / size
    let bg = mix(top, bot, (u + v) / 2)
    let a = 1
    if (rounded) a = cov(sdRound(x, y, size / 2, size / 2, size / 2, size / 2, size * 0.225))
    const inner = size * (1 - 2 * pad)
    const cell = inner / 3.4, gap = (inner - cell * 3) / 2
    let col = bg
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      const cx = size * pad + c * (cell + gap) + cell / 2
      const cy = size * pad + r * (cell + gap) + cell / 2
      const k = cov(sdRound(x, y, cx, cy, cell / 2, cell / 2, cell * 0.22))
      if (k > 0) col = mix(col, [255, 255, 255], k * ALPHA[LEVELS[r][c]])
    }
    return [...col, Math.round(a * 255)]
  })
}

const out = process.argv[2] ?? 'public'
writeFileSync(`${out}/icon-192.png`, icon(192, { rounded: true, pad: 0.2 }))
writeFileSync(`${out}/icon-512.png`, icon(512, { rounded: true, pad: 0.2 }))
writeFileSync(`${out}/icon-maskable-512.png`, icon(512, { rounded: false, pad: 0.27 }))
writeFileSync(`${out}/apple-touch-icon.png`, icon(180, { rounded: false, pad: 0.2 }))
writeFileSync(`${out}/favicon.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2ea043"/><stop offset="1" stop-color="#166534"/></linearGradient></defs><rect width="32" height="32" rx="7" fill="url(#g)"/>${LEVELS.flatMap((row, r) => row.map((l, c) => `<rect x="${6.5 + c * 7}" y="${6.5 + r * 7}" width="5.5" height="5.5" rx="1.3" fill="#fff" fill-opacity="${ALPHA[l]}"/>`)).join('')}</svg>`)
console.log('icons written to', out)
