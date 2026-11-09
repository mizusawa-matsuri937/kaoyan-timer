/** 十六进制颜色小工具（科目颜色都是 #rrggbb） */

function parse(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full.slice(0, 6), 16)
  if (Number.isNaN(n)) return [34, 197, 94]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')

/** 与另一颜色按比例混合，t=0 为原色 */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = parse(a)
  const [r2, g2, b2] = parse(b)
  return toHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

export const lighten = (c: string, t: number) => mix(c, '#ffffff', t)
export const darken = (c: string, t: number) => mix(c, '#000000', t)

export function alpha(c: string, a: number): string {
  const [r, g, b] = parse(c)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

export const THEME_GREEN = '#22c55e'
export const THEME_INDIGO = '#6366f1'
