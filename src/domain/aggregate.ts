import { addDays, dayKey, diffDays, nextMidnight, parseDay, startOfMonth, startOfWeek } from './dates'
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
 * 热度等级：0 没学习；1 (0,1h)；2 [1h,5h)；3 [5h,10h)；4 ≥10h
 */
export function heatLevel(ms: number): 0 | 1 | 2 | 3 | 4 {
  if (ms <= 0) return 0
  if (ms < 1 * HOUR) return 1
  if (ms < 5 * HOUR) return 2
  if (ms < 10 * HOUR) return 3
  return 4
}

export const LEVEL_LABELS = ['未学习', '1h 以内', '1–5h', '5–10h', '10h 以上'] as const

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

export interface LiveSliceInput {
  sessionId: string
  subjectId: string
  segments: Segment[]
}

export interface DaySlice {
  key: string
  sessionId: string
  subjectId: string
  start: number
  end: number
  durationMs: number
  /** [0, 1] 落在当天 00:00–24:00 的起止比例 */
  startFrac: number
  endFrac: number
  isLive?: boolean
}

/** 提取某天 [0, 24h] 区间内的全部连续学习切片（跨午夜记录自动裁切至当天边界，支持叠加 live 去重） */
export function dayTimelineSlices(sessions: Session[], day: string, live?: LiveSliceInput | null): DaySlice[] {
  const dayStart = parseDay(day).getTime()
  const dayEnd = parseDay(addDays(day, 1)).getTime()
  const spanMs = dayEnd - dayStart
  if (spanMs <= 0) return []

  const out: DaySlice[] = []
  const pushSegs = (prefix: string, sessionId: string, subjectId: string, segments: Segment[], isLive?: boolean) => {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (seg.end <= seg.start) continue
      const start = Math.max(seg.start, dayStart)
      const end = Math.min(seg.end, dayEnd)
      if (end <= start) continue
      out.push({
        key: `${prefix}${sessionId}:${i}`,
        sessionId,
        subjectId,
        start,
        end,
        durationMs: end - start,
        startFrac: (start - dayStart) / spanMs,
        endFrac: (end - dayStart) / spanMs,
        ...(isLive ? { isLive: true } : {}),
      })
    }
  }

  for (const s of sessions) {
    if (s.deleted) continue
    if (live && s.id === live.sessionId) continue
    pushSegs('', s.id, s.subjectId, s.segments)
  }
  if (live && live.segments.length > 0) {
    pushSegs('live:', live.sessionId, live.subjectId, live.segments, true)
  }

  return out.sort((a, b) => a.start - b.start || a.end - b.end)
}

export interface VisualStudySpan {
  slice: DaySlice
  vStart: number
  vEnd: number
}

export interface RestSpan {
  startDeg: number
  endDeg: number
}

/**
 * 将当天切片映射为 [0°, 360°] 上互不重叠的视觉扇区，并计算互补的休息扇区（跨 00:00 午夜自动合并）。
 * 用于新粗野皮肤的无底圆断环渲染。
 */
export function partitionRingSpans(
  slices: DaySlice[],
  minDeg = 3.4,
): { studySpans: VisualStudySpan[]; restSpans: RestSpan[] } {
  if (slices.length === 0) return { studySpans: [], restSpans: [] }
  const effMin = Math.min(minDeg, 360 / slices.length)
  let cursor = 0
  const studySpans: VisualStudySpan[] = slices.map((slice) => {
    const rawS = slice.startFrac * 360
    const rawE = slice.endFrac * 360
    const vStart = Math.max(cursor, rawS)
    const vEnd = Math.max(vStart + effMin, rawE)
    cursor = vEnd
    return { slice, vStart, vEnd }
  })

  if (studySpans[studySpans.length - 1].vEnd > 360) {
    let rightLimit = 360
    for (let i = studySpans.length - 1; i >= 0; i--) {
      const sp = studySpans[i]
      if (sp.vEnd <= rightLimit) break
      const width = Math.max(effMin, sp.vEnd - sp.vStart)
      const minStart = i * effMin
      sp.vEnd = rightLimit
      sp.vStart = Math.max(minStart, rightLimit - width)
      rightLimit = sp.vStart
    }
  }

  const restSpans: RestSpan[] = []
  const n = studySpans.length
  for (let i = 0; i < n; i++) {
    const curEnd = studySpans[i].vEnd
    const nextStart = i < n - 1 ? studySpans[i + 1].vStart : studySpans[0].vStart + 360
    if (nextStart - curEnd > 0.35) {
      restSpans.push({ startDeg: curEnd, endDeg: nextStart })
    }
  }
  return { studySpans, restSpans }
}

export interface HeatTierProgress {
  level: 0 | 1 | 2 | 3 | 4
  /** 当前朝下一热度档推进的连续百分比 [0, 100]，等于 已学时长 / 下一档门槛 */
  pct: number
  /** 下一级热度档名称；满格或未开始时为状态说明 */
  nextTierLabel: string
  remainMs: number
}

/** 计算当日学习时长朝下一级热度档（1–5h / 5–10h / 10h+）推进的连续进度与差值 */
export function heatTierProgress(ms: number): HeatTierProgress {
  if (ms <= 0) {
    return { level: 0, pct: 0, nextTierLabel: '开始学习点亮热度', remainMs: 0 }
  }
  if (ms < HOUR) {
    return {
      level: 1,
      pct: (ms / HOUR) * 100,
      nextTierLabel: '1–5h',
      remainMs: HOUR - ms,
    }
  }
  if (ms < 5 * HOUR) {
    return {
      level: 2,
      pct: (ms / (5 * HOUR)) * 100,
      nextTierLabel: '5–10h',
      remainMs: 5 * HOUR - ms,
    }
  }
  if (ms < 10 * HOUR) {
    return {
      level: 3,
      pct: (ms / (10 * HOUR)) * 100,
      nextTierLabel: '10h+',
      remainMs: 10 * HOUR - ms,
    }
  }
  return { level: 4, pct: 100, nextTierLabel: '已达 10h+ 最高热度', remainMs: 0 }
}
