import type { ActiveTimer, Segment, Session } from './types'

/** 少于这个时长的记录直接丢弃（误触） */
export const MIN_SESSION_MS = 1000

export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function segmentsTotal(segments: Segment[]): number {
  let total = 0
  for (const s of segments) total += Math.max(0, s.end - s.start)
  return total
}

export function startTimer(subjectId: string, now: number): ActiveTimer {
  return { sessionId: uuid(), subjectId, segments: [], runningSince: now, createdAt: now, ackAt: null }
}

function closeRunning(t: ActiveTimer, at: number): Segment[] {
  if (t.runningSince === null) return t.segments
  // 时钟被回拨时不产生负时长
  if (at <= t.runningSince) return t.segments
  return [...t.segments, { start: t.runningSince, end: at }]
}

export function pauseTimer(t: ActiveTimer, now: number): ActiveTimer {
  if (t.runningSince === null) return t
  return { ...t, segments: closeRunning(t, now), runningSince: null, ackAt: null }
}

export function resumeTimer(t: ActiveTimer, now: number): ActiveTimer {
  if (t.runningSince !== null) return t
  return { ...t, runningSince: now, ackAt: null }
}

export function isRunning(t: ActiveTimer | null): boolean {
  return !!t && t.runningSince !== null
}

/** 当前计时总时长（不含暂停） */
export function elapsed(t: ActiveTimer, now: number): number {
  let total = segmentsTotal(t.segments)
  if (t.runningSince !== null) total += Math.max(0, now - t.runningSince)
  return total
}

/**
 * 模拟测试还剩多少毫秒到点；不需要安排提醒时返回 null
 * （没在计时、暂停中、不是限时科目，或者已经超时）。
 */
export function examTimeLeft(t: ActiveTimer | null, examMs: number, now: number): number | null {
  if (!t || t.runningSince === null || examMs <= 0) return null
  const left = examMs - elapsed(t, now)
  return left > 0 ? left : null
}

/** 把计时器的全部段（含正在跑的段，截止到 now）取出来，用于实时统计 */
export function liveSegments(t: ActiveTimer, now: number): Segment[] {
  return closeRunning(t, now)
}

/** 结束计时，返回要保存的记录；时长太短返回 null */
export function finishTimer(t: ActiveTimer, now: number): Session | null {
  return toSession(t, closeRunning(t, now), now)
}

/** 以指定时间作为结束（用于"忘记点结束"后修正） */
export function finishTimerAt(t: ActiveTimer, endAt: number, now: number): Session | null {
  return toSession(t, closeRunning(t, endAt), now)
}

/** 丢弃正在跑的这一段，保留之前已完成的段 */
export function finishTimerDiscardingRunning(t: ActiveTimer, now: number): Session | null {
  return toSession(t, t.segments, now)
}

function toSession(t: ActiveTimer, segments: Segment[], now: number): Session | null {
  const segs = segments.filter((s) => s.end > s.start)
  if (segmentsTotal(segs) < MIN_SESSION_MS) return null
  return {
    id: t.sessionId,
    subjectId: t.subjectId,
    segments: segs,
    startAt: segs[0].start,
    source: 'timer',
    createdAt: t.createdAt,
    updatedAt: now,
    deleted: false,
  }
}

/**
 * 是否需要"忘记结束"提醒：当前段（或上次确认之后）连续运行超过阈值
 */
export function isOvertime(t: ActiveTimer | null, now: number, thresholdMs: number): boolean {
  if (!t || t.runningSince === null) return false
  const from = Math.max(t.runningSince, t.ackAt ?? 0)
  return now - from >= thresholdMs
}

export function acknowledgeOvertime(t: ActiveTimer, now: number): ActiveTimer {
  return { ...t, ackAt: now }
}
