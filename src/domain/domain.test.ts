import { describe, expect, it } from 'vitest'
import {
  HOUR,
  buildDaily,
  groupTotals,
  heatLevel,
  levelCounts,
  sessionsOnDay,
  splitByDay,
  streaks,
  subjectTotals,
  trend,
  withLive,
} from './aggregate'
import { addDays, diffDays, startOfWeek, weekdayMon0 } from './dates'
import { formatDuration, formatHMS } from './format'
import {
  acknowledgeOvertime,
  elapsed,
  finishTimer,
  finishTimerAt,
  finishTimerDiscardingRunning,
  isOvertime,
  liveSegments,
  pauseTimer,
  resumeTimer,
  startTimer,
} from './timer'
import type { Session } from './types'

const t = (s: string) => new Date(s).getTime() // 本地时间
const MIN = 60000

function session(subjectId: string, segs: Array<[string, string]>, extra: Partial<Session> = {}): Session {
  const segments = segs.map(([a, b]) => ({ start: t(a), end: t(b) }))
  return {
    id: Math.random().toString(36),
    subjectId,
    segments,
    startAt: segments[0].start,
    source: 'timer',
    createdAt: 0,
    updatedAt: 0,
    deleted: false,
    ...extra,
  }
}

describe('计时状态机', () => {
  it('暂停期间不计时，多次暂停累加正确', () => {
    let tm = startTimer('ds', t('2026-11-09T08:00:00'))
    tm = pauseTimer(tm, t('2026-11-09T08:30:00'))
    expect(elapsed(tm, t('2026-11-09T09:00:00'))).toBe(30 * MIN)
    tm = resumeTimer(tm, t('2026-11-09T09:00:00'))
    expect(elapsed(tm, t('2026-11-09T09:15:00'))).toBe(45 * MIN)
    tm = pauseTimer(tm, t('2026-11-09T09:20:00'))
    tm = resumeTimer(tm, t('2026-11-09T10:00:00'))
    const s = finishTimer(tm, t('2026-11-09T10:10:00'))!
    expect(s.segments).toHaveLength(3)
    expect(s.segments.reduce((a, g) => a + g.end - g.start, 0)).toBe(60 * MIN)
    expect(s.startAt).toBe(t('2026-11-09T08:00:00'))
  })

  it('重复暂停/继续是幂等的', () => {
    let tm = startTimer('ds', 1000)
    tm = pauseTimer(tm, 5000)
    const again = pauseTimer(tm, 9000)
    expect(again).toBe(tm)
    const r = resumeTimer(tm, 10000)
    expect(resumeTimer(r, 20000)).toBe(r)
  })

  it('时钟回拨不会产生负时长', () => {
    const tm = startTimer('ds', 10_000)
    expect(elapsed(tm, 5_000)).toBe(0)
    expect(finishTimer(tm, 5_000)).toBeNull()
  })

  it('不到 1 秒的误触记录丢弃', () => {
    const tm = startTimer('ds', 0)
    expect(finishTimer(tm, 500)).toBeNull()
    expect(finishTimer(tm, 1000)).not.toBeNull()
  })

  it('超时判断基于当前段开始或上次确认时间', () => {
    const tm = startTimer('ds', 0)
    expect(isOvertime(tm, 4 * HOUR - 1, 4 * HOUR)).toBe(false)
    expect(isOvertime(tm, 4 * HOUR, 4 * HOUR)).toBe(true)
    const acked = acknowledgeOvertime(tm, 5 * HOUR)
    expect(isOvertime(acked, 8 * HOUR, 4 * HOUR)).toBe(false)
    expect(isOvertime(acked, 9 * HOUR, 4 * HOUR)).toBe(true)
    expect(isOvertime(pauseTimer(tm, HOUR), 10 * HOUR, 4 * HOUR)).toBe(false)
  })

  it('修正结束时间 / 丢弃当前段', () => {
    let tm = startTimer('os', 0)
    tm = pauseTimer(tm, HOUR)
    tm = resumeTimer(tm, 2 * HOUR)
    const fixed = finishTimerAt(tm, 3 * HOUR, 20 * HOUR)!
    expect(fixed.segments.at(-1)!.end).toBe(3 * HOUR)
    expect(fixed.updatedAt).toBe(20 * HOUR)
    const dropped = finishTimerDiscardingRunning(tm, 20 * HOUR)!
    expect(dropped.segments).toEqual([{ start: 0, end: HOUR }])
    expect(finishTimerDiscardingRunning(startTimer('os', 0), 9 * HOUR)).toBeNull()
  })

  it('liveSegments 包含进行中的段', () => {
    const tm = startTimer('ds', 100)
    expect(liveSegments(tm, 600)).toEqual([{ start: 100, end: 600 }])
  })
})

describe('按日切分', () => {
  it('跨午夜按实际时间拆到两天', () => {
    const parts = splitByDay({ start: t('2026-11-09T23:30:00'), end: t('2026-11-10T01:15:00') })
    expect(parts).toEqual([
      ['2026-11-09', 30 * MIN],
      ['2026-11-10', 75 * MIN],
    ])
  })

  it('跨多天也正确', () => {
    const parts = splitByDay({ start: t('2026-11-09T20:00:00'), end: t('2026-11-11T02:00:00') })
    expect(parts.map((p) => p[0])).toEqual(['2026-11-09', '2026-11-10', '2026-11-11'])
    expect(parts[1][1]).toBe(24 * HOUR)
  })

  it('刚好在午夜结束不会产生空的第二天', () => {
    const parts = splitByDay({ start: t('2026-11-09T23:00:00'), end: t('2026-11-10T00:00:00') })
    expect(parts).toEqual([['2026-11-09', HOUR]])
  })

  it('buildDaily 汇总各科并跳过已删除', () => {
    const daily = buildDaily([
      session('ds', [['2026-11-09T08:00:00', '2026-11-09T10:00:00']]),
      session('calc', [['2026-11-09T23:00:00', '2026-11-10T01:00:00']]),
      session('english', [['2026-11-09T12:00:00', '2026-11-09T13:00:00']], { deleted: true }),
    ])
    expect(daily.get('2026-11-09')!.total).toBe(3 * HOUR)
    expect(daily.get('2026-11-09')!.bySubject).toEqual({ ds: 2 * HOUR, calc: HOUR })
    expect(daily.get('2026-11-10')!.total).toBe(HOUR)
  })

  it('withLive 叠加计时中的时长且不修改原数据', () => {
    const base = buildDaily([session('ds', [['2026-11-09T08:00:00', '2026-11-09T09:00:00']])])
    const live = withLive(base, 'ds', [{ start: t('2026-11-09T10:00:00'), end: t('2026-11-09T10:30:00') }])
    expect(live.get('2026-11-09')!.total).toBe(90 * MIN)
    expect(base.get('2026-11-09')!.total).toBe(HOUR)
    expect(base.get('2026-11-09')!.bySubject.ds).toBe(HOUR)
  })

  it('sessionsOnDay 跨午夜的记录两天都能查到', () => {
    const s = session('calc', [['2026-11-09T23:00:00', '2026-11-10T01:00:00']])
    expect(sessionsOnDay([s], '2026-11-09')).toHaveLength(1)
    expect(sessionsOnDay([s], '2026-11-10')).toHaveLength(1)
    expect(sessionsOnDay([s], '2026-11-11')).toHaveLength(0)
  })
})

describe('热度等级', () => {
  it('五个等级边界', () => {
    expect(heatLevel(0)).toBe(0)
    expect(heatLevel(1)).toBe(1)
    expect(heatLevel(HOUR - 1)).toBe(1)
    expect(heatLevel(HOUR)).toBe(2)
    expect(heatLevel(5 * HOUR - 1)).toBe(2)
    expect(heatLevel(5 * HOUR)).toBe(3)
    expect(heatLevel(12 * HOUR - 1)).toBe(3)
    expect(heatLevel(12 * HOUR)).toBe(4)
  })

  it('levelCounts 统计范围内每级天数（含未学习）', () => {
    const daily = buildDaily([
      session('ds', [['2026-11-09T08:00:00', '2026-11-09T08:30:00']]),
      session('ds', [['2026-11-10T08:00:00', '2026-11-10T14:00:00']]),
    ])
    expect(levelCounts(daily, '2026-11-09', '2026-11-12')).toEqual([2, 1, 0, 1, 0])
  })
})

describe('连续天数', () => {
  const daily = buildDaily([
    session('ds', [['2026-11-01T08:00:00', '2026-11-01T09:00:00']]),
    session('ds', [['2026-11-02T08:00:00', '2026-11-02T09:00:00']]),
    session('ds', [['2026-11-03T08:00:00', '2026-11-03T09:00:00']]),
    session('ds', [['2026-11-08T08:00:00', '2026-11-08T09:00:00']]),
    session('ds', [['2026-11-09T08:00:00', '2026-11-09T09:00:00']]),
  ])
  it('今天学了：从今天往前数', () => {
    expect(streaks(daily, '2026-11-09')).toEqual({ current: 2, longest: 3 })
  })
  it('今天还没学不算断', () => {
    expect(streaks(daily, '2026-11-10')).toEqual({ current: 2, longest: 3 })
  })
  it('昨天也没学则为 0', () => {
    expect(streaks(daily, '2026-11-11').current).toBe(0)
  })
})

describe('汇总与趋势', () => {
  const daily = buildDaily([
    session('ds', [['2026-11-09T08:00:00', '2026-11-09T10:00:00']]),
    session('os', [['2026-11-09T10:00:00', '2026-11-09T11:00:00']]),
    session('la', [['2026-11-02T08:00:00', '2026-11-02T09:00:00']]),
    session('politics', [['2026-10-20T08:00:00', '2026-10-20T08:30:00']]),
  ])
  it('科目与大类汇总', () => {
    const all = subjectTotals(daily, null)
    expect(all.ds).toBe(2 * HOUR)
    expect(all.co).toBe(0)
    const g = groupTotals(all)
    expect(g).toEqual({ cs408: 3 * HOUR, math: HOUR, english: 0, politics: 30 * MIN })
    const week = subjectTotals(daily, ['2026-11-09', '2026-11-09'])
    expect(groupTotals(week).math).toBe(0)
  })
  it('按周趋势', () => {
    const tr = trend(daily, '2026-11-09', 'week', 3)
    expect(tr.map((p) => p.key)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09'])
    expect(tr[2].cs408).toBe(3 * HOUR)
    expect(tr[1].math).toBe(HOUR)
  })
  it('按月趋势', () => {
    const tr = trend(daily, '2026-11-09', 'month', 2)
    expect(tr.map((p) => p.key)).toEqual(['2026-10-01', '2026-11-01'])
    expect(tr[0].politics).toBe(30 * MIN)
  })
})

describe('日期与格式化', () => {
  it('周一为一周开始', () => {
    expect(weekdayMon0('2026-11-09')).toBe(0) // 2026-11-09 是周一
    expect(startOfWeek('2026-11-15')).toBe('2026-11-09')
  })
  it('跨月加减日与天数差', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(diffDays('2026-11-09', '2027-12-25')).toBe(411)
  })
  it('格式化', () => {
    expect(formatHMS(3723000)).toBe('01:02:03')
    expect(formatDuration(5 * HOUR + 32 * MIN)).toBe('5h 32m')
    expect(formatDuration(32 * MIN + 59000)).toBe('32m')
  })
})
