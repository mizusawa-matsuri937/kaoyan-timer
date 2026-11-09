/** 本地时区日期工具。日期统一用 'YYYY-MM-DD' 字符串表示，避免时区歧义 */

const pad = (n: number) => String(n).padStart(2, '0')

export function dayKey(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 下一个本地午夜 */
export function nextMidnight(ts: number): number {
  const d = new Date(ts)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

export function addDays(key: string, n: number): string {
  const d = parseDay(key)
  d.setDate(d.getDate() + n)
  return dayKey(d)
}

/** 两个日期之间相差的天数 b - a */
export function diffDays(a: string, b: string): number {
  const da = parseDay(a)
  const db = parseDay(b)
  // 用 UTC 计算避免夏令时误差
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate())
  return Math.round((ub - ua) / 86400000)
}

/** 周一 = 0 ... 周日 = 6 */
export function weekdayMon0(key: string): number {
  return (parseDay(key).getDay() + 6) % 7
}

export function startOfWeek(key: string): string {
  return addDays(key, -weekdayMon0(key))
}

export function startOfMonth(key: string): string {
  return key.slice(0, 8) + '01'
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  const n = diffDays(from, to)
  for (let i = 0; i <= n; i++) out.push(addDays(from, i))
  return out
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

export function formatDayCN(key: string): string {
  const d = parseDay(key)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`
}

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
