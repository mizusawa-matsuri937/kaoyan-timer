import { addDays, dayKey, diffDays, nextMidnight, startOfMonth, startOfWeek } from './dates'
import { SUBJECTS, type GroupId, getSubject } from './subjects'
import type { Segment, Session } from './types'

export const HOUR = 3600000

export interface DayStat {
  total: number
  bySubject: Record<string, number>
}

export type Daily = Map<string, DayStat>

/** 把一段时间按本地午夜切开，返回 [日期, 毫秒] 列表 */
export function splitByDay(seg: Segment): Array<[string, number]> {
  const out: Array<[string, number]> = []
  let cur = seg.start
  while (cur < seg.end) {
    const cut = Math.min(nextMidnight(cur), seg.end)
    out.push([dayKey(cur), cut - cur])
    cur = cut
  }
  return out
}

function addTo(daily: Daily, day: string, subjectId: string, ms: number) {
  let stat = daily.get(day)
  if (!stat) {
    stat = { total: 0, bySubject: {} }
    daily.set(day, stat)
  }
  stat.total += ms
  stat.bySubject[subjectId] = (stat.bySubject[subjectId] ?? 0) + ms
}

export function addSegments(daily: Daily, subjectId: string, segments: Segment[]) {
  for (const seg of segments) {
    if (seg.end <= seg.start) continue
    for (const [day, ms] of splitByDay(seg)) addTo(daily, day, subjectId, ms)
  }
}

/** 由全部记录算出每天各科时长（已删除的记录会被跳过） */
export function buildDaily(sessions: Session[]): Daily {
  const daily: Daily = new Map()
  for (const s of sessions) {
    if (s.deleted) continue
    addSegments(daily, s.subjectId, s.segments)
  }
  return daily
}

/** 在基础统计上叠加正在计时的部分（返回新 Map，不修改原对象） */
export function withLive(base: Daily, subjectId: string | null, segments: Segment[]): Daily {
  if (!subjectId || segments.length === 0) return base
  const out: Daily = new Map(base)
  // 只复制会被修改的那几天
  for (const seg of segments) {
    for (const [day] of splitByDay(seg)) {
      const old = base.get(day)
      if (old && out.get(day) === old) out.set(day, { total: old.total, bySubject: { ...old.bySubject } })
    }
  }
  addSegments(out, subjectId, segments)
  return out
}

/**
 * 热度等级：0 没学习；1 (0,1h)；2 [1h,5h)；3 [5h,12h)；4 ≥12h
 */
export function heatLevel(ms: number): 0 | 1 | 2 | 3 | 4 {
  if (ms <= 0) return 0
  if (ms < 1 * HOUR) return 1
  if (ms < 5 * HOUR) return 2
  if (ms < 12 * HOUR) return 3
  return 4
}

export const LEVEL_LABELS = ['未学习', '1h 以内', '1–5h', '5–12h', '12h 以上'] as const

/** 统计 [from, to] 内各等级的天数 */
export function levelCounts(daily: Daily, from: string, to: string): [number, number, number, number, number] {
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0]
  const n = diffDays(from, to)
  for (let i = 0; i <= n; i++) {
    const day = addDays(from, i)
    counts[heatLevel(daily.get(day)?.total ?? 0)]++
  }
  return counts
}

export interface Streaks {
  current: number
  longest: number
}

/** 连续学习天数。今天还没学不算断：从昨天开始往前数 */
export function streaks(daily: Daily, today: string): Streaks {
  const studied = (d: string) => (daily.get(d)?.total ?? 0) > 0

  let current = 0
  let d = studied(today) ? today : addDays(today, -1)
  while (studied(d)) {
    current++
    d = addDays(d, -1)
  }

  const days = [...daily.keys()].filter(studied).sort()
  let longest = 0
  let run = 0
  let prev: string | null = null
  for (const day of days) {
    run = prev !== null && diffDays(prev, day) === 1 ? run + 1 : 1
    if (run > longest) longest = run
    prev = day
  }
  return { current, longest: Math.max(longest, current) }
}

export type RangeId = 'today' | 'week' | 'month' | 'all'

export function rangeBounds(range: RangeId, today: string): [string, string] | null {
  switch (range) {
    case 'today':
      return [today, today]
    case 'week':
      return [startOfWeek(today), today]
    case 'month':
      return [startOfMonth(today), today]
    case 'all':
      return null
  }
}

/** 在某个日期范围内各科总时长 */
export function subjectTotals(daily: Daily, bounds: [string, string] | null): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of SUBJECTS) out[s.id] = 0
  for (const [day, stat] of daily) {
    if (bounds && (day < bounds[0] || day > bounds[1])) continue
    for (const [sid, ms] of Object.entries(stat.bySubject)) out[sid] = (out[sid] ?? 0) + ms
  }
  return out
}

export function groupTotals(bySubject: Record<string, number>): Record<GroupId, number> {
  const out: Record<GroupId, number> = { cs408: 0, math: 0, english: 0, politics: 0 }
  for (const [sid, ms] of Object.entries(bySubject)) {
    const sub = getSubject(sid)
    if (sub) out[sub.group] += ms
  }
  return out
}

export function sumValues(rec: Record<string, number>): number {
  let t = 0
  for (const v of Object.values(rec)) t += v
  return t
}

export interface TrendPoint {
  key: string
  label: string
  total: number
  cs408: number
  math: number
  english: number
  politics: number
}

/** 趋势：最近 count 个日 / 周 / 月，按科目大类堆叠 */
export function trend(daily: Daily, today: string, unit: 'day' | 'week' | 'month', count: number): TrendPoint[] {
  const bucketOf = (day: string) =>
    unit === 'day' ? day : unit === 'week' ? startOfWeek(day) : startOfMonth(day)

  const keys: string[] = []
  let cur = bucketOf(today)
  for (let i = 0; i < count; i++) {
    keys.unshift(cur)
    if (unit === 'day') cur = addDays(cur, -1)
    else if (unit === 'week') cur = addDays(cur, -7)
    else cur = startOfMonth(addDays(cur, -1))
  }

  const points = new Map<string, TrendPoint>()
  for (const k of keys) {
    const [, m, d] = k.split('-').map(Number)
    const label = unit === 'month' ? `${m}月` : `${m}/${d}`
    points.set(k, { key: k, label, total: 0, cs408: 0, math: 0, english: 0, politics: 0 })
  }
  for (const [day, stat] of daily) {
    const p = points.get(bucketOf(day))
    if (!p) continue
    const g = groupTotals(stat.bySubject)
    p.total += stat.total
    p.cs408 += g.cs408
    p.math += g.math
    p.english += g.english
    p.politics += g.politics
  }
  return keys.map((k) => points.get(k)!)
}

/** 某天的记录（跨午夜的记录两天都会出现） */
export function sessionsOnDay(sessions: Session[], day: string): Session[] {
  return sessions
    .filter((s) => !s.deleted && s.segments.some((seg) => splitByDay(seg).some(([d]) => d === day)))
    .sort((a, b) => a.startAt - b.startAt)
}
