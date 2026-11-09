import { describe, expect, it } from 'vitest'
import { buildDaily, splitByDay, streaks, subjectTotals, sumValues, withLive } from '../src/domain/aggregate'
import { addDays, dayKey, diffDays, nextMidnight, parseDay } from '../src/domain/dates'
import { elapsed, finishTimer, liveSegments, pauseTimer, resumeTimer, segmentsTotal, startTimer } from '../src/domain/timer'
import { makeBackup, mergeSessions, mergeSettings, parseBackup } from '../src/sync/merge'
import type { Session } from '../src/domain/types'
import { DAY, HOUR, NOW, session, settings } from './fixtures'

describe('long-running timer and aggregation', () => {
  it('recovers a serialized running timer after 30 days without interval ticks', () => {
    const saved = JSON.parse(JSON.stringify(startTimer('ds', NOW)))
    expect(elapsed(saved, NOW + 30 * DAY)).toBe(30 * DAY)
    expect(segmentsTotal(finishTimer(saved, NOW + 30 * DAY)!.segments)).toBe(30 * DAY)
  })

  it('does not count 180 days spent paused', () => {
    const paused = pauseTimer(startTimer('ds', NOW), NOW + HOUR)
    const saved = JSON.parse(JSON.stringify(paused))
    expect(elapsed(saved, NOW + 180 * DAY)).toBe(HOUR)
    const resumed = resumeTimer(saved, NOW + 180 * DAY)
    expect(elapsed(resumed, NOW + 180 * DAY + HOUR)).toBe(2 * HOUR)
  })

  it.each([1, 42, 8675309])('matches an independent duration model for 10,000 operations, seed %i', (seed) => {
    let randomState = seed
    const random = () => (randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0)
    let now = NOW
    let total = 0
    let running = true
    let timer = startTimer('ds', now)
    let pauses = 0
    let resumes = 0
    for (let i = 0; i < 10_000; i++) {
      const step = random() % 60_000
      now += step
      if (running) total += step
      // Use high bits: the low bit of this PRNG alternates deterministically.
      if ((random() >>> 16) % 2) {
        if (running) pauses++
        timer = pauseTimer(timer, now); running = false
      } else {
        if (!running) resumes++
        timer = resumeTimer(timer, now); running = true
      }
      if (i % 79 === 0) timer = JSON.parse(JSON.stringify(timer))
      expect(elapsed(timer, now)).toBe(total)
    }
    expect(pauses).toBeGreaterThan(1000)
    expect(resumes).toBeGreaterThan(1000)
    expect(segmentsTotal(finishTimer(timer, now)!.segments)).toBe(total)
  })

  it('conserves every millisecond across a leap year and 730 midnights', () => {
    const start = new Date(2027, 2, 1, 23, 59, 59, 123).getTime()
    const end = new Date(2029, 2, 1, 0, 0, 0, 456).getTime()
    const parts = splitByDay({ start, end })
    expect(parts.reduce((n, [, ms]) => n + ms, 0)).toBe(end - start)
    expect(parts.every(([, ms]) => ms > 0)).toBe(true)
    expect(new Set(parts.map(([day]) => day)).size).toBe(parts.length)
    expect(parts.some(([day]) => day === '2028-02-29')).toBe(true)
  })

  it.each(['2026-03-08', '2026-11-01', '2028-02-29'])('preserves local midnight boundaries on %s', (day) => {
    const start = parseDay(day).getTime()
    const end = nextMidnight(start)
    expect(splitByDay({ start, end })).toEqual([[day, end - start]])
    expect(diffDays(day, addDays(day, 1))).toBe(1)
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone === 'America/New_York') {
      const hours = day === '2026-03-08' ? 23 : day === '2026-11-01' ? 25 : 24
      expect(end - start).toBe(hours * HOUR)
    } else if (zone === 'Asia/Shanghai') expect(end - start).toBe(24 * HOUR)
  })

  it('aggregates five years / 21,900 records and round-trips the multi-MB backup', () => {
    const list: Session[] = []
    for (let day = 0; day < 365 * 5; day++) {
      const start = parseDay(addDays('2026-01-01', day)).getTime()
      for (let part = 0; part < 12; part++) {
        const at = start + part * HOUR
        list.push(session(`${day}-${part}`, {
          subjectId: part % 2 ? 'ds' : 'os', startAt: at,
          segments: [{ start: at, end: at + HOUR / 2 }],
        }))
      }
    }
    const began = performance.now()
    const text = JSON.stringify(makeBackup(list, settings, NOW))
    const parsed = parseBackup(text)
    const daily = buildDaily(parsed.sessions)
    const merged = mergeSessions(list.slice(0, 10_950), parsed.sessions)
    expect(parsed.sessions).toHaveLength(21_900)
    expect(daily.size).toBe(1825)
    expect(sumValues(subjectTotals(daily, null))).toBe(1825 * 6 * HOUR)
    expect(merged.merged).toHaveLength(21_900)
    expect(streaks(daily, addDays('2026-01-01', 1824)).longest).toBe(1825)
    console.info(JSON.stringify({ workload: 'five-years', records: list.length,
      backupBytes: new TextEncoder().encode(text).length,
      aggregateParseMergeMs: Math.round(performance.now() - began) }))
  })

  it('repeated live aggregation leaves archived daily totals unchanged', () => {
    const base = buildDaily([session()])
    const timer = startTimer('os', NOW)
    const original = JSON.stringify([...base])
    for (let i = 1; i <= 2000; i++) {
      const live = withLive(base, timer.subjectId, liveSegments(timer, NOW + i * 1000))
      expect(sumValues(subjectTotals(live, null))).toBe(HOUR + i * 1000)
    }
    expect(JSON.stringify([...base])).toBe(original)
  })

  it('newer tombstones keep deleted records deleted over 1,000 stale merges', () => {
    let local = [session('deleted', { deleted: true, updatedAt: NOW + 1 })]
    for (let i = 0; i < 1000; i++) local = mergeSessions(local, [session('deleted')]).merged
    expect(local).toHaveLength(1)
    expect(local[0].deleted).toBe(true)
  })
})

describe('regression contracts: backup integrity and conflicts', () => {
  it('[R6] equal timestamp edit/delete conflicts must converge in either merge direction', () => {
    const edited = session('same', { subjectId: 'os' })
    const deleted = session('same', { deleted: true })
    const forward = mergeSessions([edited], [deleted])
    const reverse = mergeSessions([deleted], [edited])
    expect(forward.merged).toEqual(reverse.merged)
  })

  it('[R6] differing settings at an equal revision must converge', () => {
    const other = { ...settings, examDate: '2027-12-20' }
    expect(mergeSettings(settings, other)).toEqual(mergeSettings(other, settings))
  })

  it('[R5] rejects unsupported future backup versions', () => {
    const backup = { ...makeBackup([session()], settings, NOW), version: 999 }
    expect(() => parseBackup(JSON.stringify(backup))).toThrow()
  })

  it('[R5] must not accept timestamps outside the JavaScript Date range', () => {
    const bad = session('bad', { segments: [{ start: 1e30, end: 1e30 + 1e15 }] })
    let accepted: Session[] = []
    try { accepted = parseBackup(JSON.stringify(makeBackup([bad], null, NOW))).sessions } catch { /* rejection is safe */ }
    expect(accepted).toHaveLength(0)
  })

  it('[R5] must not accept infinite updatedAt from a legal JSON exponent', () => {
    const text = JSON.stringify(makeBackup([session()], null, NOW)).replace(`"updatedAt":${NOW}`, '"updatedAt":1e400')
    let accepted: Session[] = []
    try { accepted = parseBackup(text).sessions } catch { /* rejection is safe */ }
    expect(accepted.every((row) => Number.isFinite(row.updatedAt))).toBe(true)
  })

  it('[R5] malformed imported settings must not poison date calculations', () => {
    const bad = { ...settings, startDate: null, overtimeHours: 'invalid' }
    let imported = null
    try { imported = parseBackup(JSON.stringify({ ...makeBackup([], null, NOW), settings: bad })).settings } catch { /* rejection is safe */ }
    if (imported) {
      expect(typeof imported.startDate).toBe('string')
      expect(Number.isFinite(imported.overtimeHours)).toBe(true)
      expect(dayKey(parseDay(imported.startDate))).toBe(imported.startDate)
    }
  })
})
