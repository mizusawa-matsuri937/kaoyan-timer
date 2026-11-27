import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react'
import {
  dayTimelineSlices,
  heatLevel,
  LEVEL_LABELS,
  splitByDay,
  type Daily,
  type DayStat,
  type LiveSliceInput,
} from '../domain/aggregate'
import { addDays, formatClock, formatDayCN, parseDay } from '../domain/dates'
import { formatDuration, formatDurationCN } from '../domain/format'
import { SUBJECTS, getSubject } from '../domain/subjects'
import type { Session } from '../domain/types'
import { addGoalForDay, removeGoalForDay, toggleGoalForDay, useGoalsForDay } from '../dailyGoals'
import { useSkin } from '../skin'
import { DayTimelineRing } from './DayTimelineRing'
import { HEAT_VARS } from './Heatmap'
import { IconChevron, IconClose, IconPlus } from './icons'
import { Bar, Sheet, tint } from './ui'

const EMPTY_SESSIONS: Session[] = []
const NOOP_SELECT = (_key: string | null) => {}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function rubberBand(excess: number, limit: number): number {
  const abs = Math.abs(excess)
  const damped = (abs * 0.34 * limit) / (abs + limit * 0.55)
  return Math.sign(excess) * damped
}

function readTranslateX(el: HTMLElement): number {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return 0
  const tf = window.getComputedStyle(el).transform
  if (!tf || tf === 'none') return 0
  if (typeof DOMMatrixReadOnly === 'function') {
    try {
      const m = new DOMMatrixReadOnly(tf)
      return Number.isFinite(m.m41) ? m.m41 : 0
    } catch {
      /* fallback below */
    }
  }
  const m2d = tf.match(/^matrix\(([^)]+)\)$/)
  if (m2d) {
    const parts = m2d[1].split(',').map(Number)
    return Number.isFinite(parts[4]) ? parts[4] : 0
  }
  const m3d = tf.match(/^matrix3d\(([^)]+)\)$/)
  if (m3d) {
    const parts = m3d[1].split(',').map(Number)
    return Number.isFinite(parts[12]) ? parts[12] : 0
  }
  return 0
}

function liveForDay(live: LiveSliceInput | null | undefined, day: string): LiveSliceInput | null {
  if (!live || live.segments.length === 0) return null
  const dayStart = parseDay(day).getTime()
  const dayEnd = parseDay(addDays(day, 1)).getTime()
  for (const seg of live.segments) {
    if (seg.end > dayStart && seg.start < dayEnd) return live
  }
  return null
}

const DayGoalsSection = memo(function DayGoalsSection({ day }: { day: string }) {
  const skin = useSkin()
  const goals = useGoalsForDay(day)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const doneCount = goals.filter((g) => g.done).length
  const allDone = goals.length > 0 && doneCount === goals.length

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (addGoalForDay(day, draft)) {
      setDraft('')
      if (goals.length + 1 >= 6) setAdding(false)
    }
  }

  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="section-title">当日微目标</span>
          {goals.length > 0 && (
            <span className="goals-badge num" data-complete={allDone ? '' : undefined}>
              {allDone
                ? skin === 'terminal'
                  ? `[${doneCount}/${goals.length} OK]`
                  : `✓ 已完成 ${doneCount}/${goals.length}`
                : `${doneCount}/${goals.length}`}
            </span>
          )}
        </div>
        {goals.length < 6 && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-0.5 text-xs font-semibold text-accent"
          >
            <IconPlus size={14} /> {adding ? '收起' : '补记'}
          </button>
        )}
      </div>

      {goals.length > 0 ? (
        <div className="well px-3 py-2">
          <fieldset className="stroke-list !mt-0">
            <legend className="sr-only">{day} 微目标完成情况</legend>
            {goals.map((g) => (
              <div key={g.id} className="stroke-row">
                <label className="stroke-item">
                  <input type="checkbox" checked={g.done} onChange={() => toggleGoalForDay(day, g.id)} />
                  <span className="stroke-box" aria-hidden>
                    <svg viewBox="0 0 16 16">
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                  </span>
                  <span className="stroke-text">{g.text}</span>
                </label>
                <button
                  type="button"
                  className="stroke-del"
                  aria-label={`删除「${g.text}」`}
                  onClick={() => removeGoalForDay(day, g.id)}
                >
                  <IconClose size={13} />
                </button>
              </div>
            ))}
          </fieldset>
        </div>
      ) : (
        !adding && <div className="well px-4 py-3 text-center text-xs text-muted">这天没有记录微目标</div>
      )}

      {adding && (
        <form className="goals-form" onSubmit={submit} onPointerDown={(e) => e.stopPropagation()}>
          <input
            type="text"
            className="field !py-1.5 !text-sm"
            placeholder="为这一天补记一项微目标"
            maxLength={28}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn btn-primary !py-1.5 !px-3 !text-sm shrink-0" disabled={!draft.trim()}>
            加入
          </button>
        </form>
      )}
    </div>
  )
})

const DayPane = memo(function DayPane({
  day,
  stat,
  sessions,
  live,
  canSwipe,
  animateEntrance,
  selectedSliceKey,
  onSelectSliceKey,
  onEdit,
  onAdd,
}: {
  day: string
  stat: DayStat | undefined
  sessions: Session[]
  live: LiveSliceInput | null
  canSwipe: boolean
  animateEntrance: boolean
  selectedSliceKey: string | null
  onSelectSliceKey: (key: string | null) => void
  onEdit: (s: Session) => void
  onAdd: (day: string) => void
}) {
  const total = stat?.total ?? 0
  const lvl = heatLevel(total)
  const slices = useMemo(() => dayTimelineSlices(sessions, day, live), [sessions, day, live])
  const activeSliceKey = slices.some((sl) => sl.key === selectedSliceKey) ? selectedSliceKey : null
  const selectedSessionId = useMemo(
    () => slices.find((sl) => sl.key === activeSliceKey)?.sessionId ?? null,
    [slices, activeSliceKey],
  )

  const rows = useMemo(
    () =>
      SUBJECTS.map((s) => ({ s, ms: stat?.bySubject[s.id] ?? 0 }))
        .filter((x) => x.ms > 0)
        .sort((a, b) => b.ms - a.ms),
    [stat],
  )
  const max = rows[0]?.ms ?? 1

  return (
    <>
      <div className="well flex items-center gap-3 p-4">
        <span className="heat-cell h-9 w-9 shrink-0" style={{ background: HEAT_VARS[lvl] }} />
        <div className="min-w-0 flex-1">
          <div className="num text-2xl font-semibold">{formatDurationCN(total)}</div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted">
            <span>等级：{LEVEL_LABELS[lvl]}</span>
            {canSwipe && <span className="text-[11px] text-faint">⇄ 左右轻扫切天</span>}
          </div>
        </div>
      </div>

      {slices.length > 0 && (
        <div className="mt-3">
          <DayTimelineRing
            day={day}
            slices={slices}
            selectedKey={activeSliceKey}
            onSelectKey={onSelectSliceKey}
            animateEntrance={animateEntrance}
          />
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-4 space-y-2.5">
          {rows.map(({ s, ms }) => (
            <div key={s.id}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium">{s.name}</span>
                <span className="num text-muted">{formatDuration(ms)}</span>
              </div>
              <Bar pct={(ms / max) * 100} color={s.color} />
            </div>
          ))}
        </div>
      )}

      <DayGoalsSection day={day} />

      <div className="mt-6 mb-2 flex items-center justify-between">
        <span className="section-title">学习记录（{sessions.length}）</span>
        <button type="button" onClick={() => onAdd(day)} className="flex items-center gap-0.5 text-sm font-semibold text-accent">
          <IconPlus size={16} /> 补录
        </button>
      </div>
      {sessions.length === 0 ? (
        <div className="well py-8 text-center text-sm text-muted">这天没有记录</div>
      ) : (
        <div className="well rows overflow-hidden">
          {sessions.map((s) => {
            const sub = getSubject(s.subjectId)
            const first = s.segments[0]
            const last = s.segments[s.segments.length - 1]
            // 只统计落在这一天的部分
            let msToday = 0
            for (const g of s.segments) for (const [d, ms] of splitByDay(g)) if (d === day) msToday += ms
            const crossDay = splitByDay({ start: first.start, end: last.end }).length > 1
            const highlighted = selectedSessionId === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onEdit(s)}
                data-highlighted={highlighted ? '' : undefined}
                className="c day-ring-row flex w-full items-center gap-3 px-4 py-3 text-left active:bg-card"
                style={sub ? tint(sub.color) : undefined}
              >
                <span className="dot" style={{ width: 6, height: 32, borderRadius: 3 }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[15px] font-medium">
                    {sub?.name ?? s.subjectId}
                    {s.source === 'manual' && (
                      <span className="rounded-md border border-line bg-card px-1.5 py-0.5 text-[10px] text-muted">补录</span>
                    )}
                    {highlighted && (
                      <span className="rounded-md border border-line bg-card px-1.5 py-0.5 text-[10px] text-accent">圆环已选中</span>
                    )}
                  </div>
                  <div className="num text-xs text-muted">
                    {formatClock(first.start)} – {formatClock(last.end)}
                    {crossDay && ' (跨天)'}
                    {s.segments.length > 1 && ` · ${s.segments.length} 段`}
                  </div>
                </div>
                <span className="num text-sm font-semibold">{formatDuration(msToday)}</span>
                <IconChevron size={16} className="text-faint" />
              </button>
            )
          })}
        </div>
      )}
    </>
  )
})

export function DaySheet({
  day,
  daily,
  sessions,
  live,
  minDay,
  maxDay,
  onSelectDay,
  onClose,
  onEdit,
  onAdd,
}: {
  day: string | null
  daily: Daily
  sessions: Session[]
  live?: LiveSliceInput | null
  minDay?: string
  maxDay?: string
  onSelectDay?: (day: string) => void
  onClose: () => void
  onEdit: (s: Session) => void
  onAdd: (day: string) => void
}) {
  const skin = useSkin()
  const [selectedSliceKey, setSelectedSliceKey] = useState<string | null>(null)
  const [pendingDay, setPendingDay] = useState<string | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const suppressClickRef = useRef(false)
  const panRef = useRef<{
    pointerId: number
    x0: number
    y0: number
    baseX: number
    currentX: number
    lastX: number
    lastT: number
    vx: number
    locked: 'x' | 'y' | null
  } | null>(null)
  const settlingRef = useRef<{
    dir: -1 | 0 | 1
    targetDay: string | null
    cleanup: () => void
  } | null>(null)

  // 只在弹层首次打开时播放当日入场动效；左右预渲染页和滑入页直接呈稳态，避免切天时像刷新一样重绘
  const prevDayRef = useRef<string | null>(null)
  const initialOpenDayRef = useRef<string | null>(null)
  if (day !== prevDayRef.current) {
    if (prevDayRef.current === null && day !== null) {
      initialOpenDayRef.current = day
    } else {
      initialOpenDayRef.current = null
    }
    prevDayRef.current = day
  }
  const initialOpenDay = initialOpenDayRef.current

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, Session[]>()
    for (const s of sessions) {
      if (s.deleted) continue
      const seen = new Set<string>()
      for (const seg of s.segments) {
        for (const [d] of splitByDay(seg)) {
          if (seen.has(d)) continue
          seen.add(d)
          let list = map.get(d)
          if (!list) {
            list = []
            map.set(d, list)
          }
          list.push(s)
        }
      }
    }
    for (const list of map.values()) list.sort((a, b) => a.startAt - b.startAt)
    return map
  }, [sessions])

  const clearSettling = useCallback(() => {
    const cur = settlingRef.current
    if (!cur) return
    settlingRef.current = null
    cur.cleanup()
  }, [])

  const setTrackX = useCallback((x: number, transition = 'none') => {
    const track = trackRef.current
    if (!track) return
    track.style.transition = transition
    track.style.transform = `translate3d(${x.toFixed(1)}px, 0, 0)`
  }, [])

  // React 提交新 day（邻页 key 复用并平移回 0%）后、浏览器绘制前同步把轨道归零，实现零闪烁无缝衔接
  useLayoutEffect(() => {
    clearSettling()
    setPendingDay(null)
    setSelectedSliceKey(null)
    if (!day) {
      panRef.current = null
    }
    const activePan = panRef.current
    setTrackX(activePan && activePan.locked === 'x' ? activePan.currentX : 0, 'none')
  }, [day, clearSettling, setTrackX])

  useEffect(() => () => clearSettling(), [clearSettling])

  // 一旦判定为横向切天手势，在 iOS Safari 上阻止同一次触摸中途被纵向滚动接管导致 pointercancel
  const isOpen = !!day
  useEffect(() => {
    const el = viewportRef.current
    if (!isOpen || !el) return
    const onTouchMove = (e: TouchEvent) => {
      if (panRef.current?.locked === 'x' && e.cancelable) e.preventDefault()
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [isOpen])

  const canPrev = !!(day && onSelectDay && (!minDay || day > minDay))
  const canNext = !!(day && onSelectDay && (!maxDay || day < maxDay))

  const displayDay = pendingDay ?? day
  const canStepPrev = !!(displayDay && onSelectDay && (!minDay || displayDay > minDay))
  const canStepNext = !!(displayDay && onSelectDay && (!maxDay || displayDay < maxDay))

  const slides = useMemo(() => {
    if (!day) return []
    const out: Array<{ slideDay: string; offset: -1 | 0 | 1 }> = []
    if (canPrev) out.push({ slideDay: addDays(day, -1), offset: -1 })
    out.push({ slideDay: day, offset: 0 })
    if (canNext) out.push({ slideDay: addDays(day, 1), offset: 1 })
    return out
  }, [day, canPrev, canNext])

  const animateTrackTo = useCallback(
    (dir: -1 | 0 | 1, fromX: number, vx = 0) => {
      clearSettling()
      if (!day) return
      const track = trackRef.current
      const width = viewportRef.current?.clientWidth || 360
      const targetX = dir === 0 ? 0 : -dir * width
      const targetDay = dir === 0 ? null : addDays(day, dir)

      if (dir !== 0 && targetDay) {
        setPendingDay(targetDay)
      }

      const reduced = prefersReducedMotion()
      const dist = Math.abs(targetX - fromX)
      if (!track || reduced || dist < 1) {
        if (dir !== 0 && targetDay && onSelectDay) {
          onSelectDay(targetDay)
        } else {
          setPendingDay(null)
          setTrackX(0, 'none')
        }
        return
      }

      const speed = Math.abs(vx)
      const dur =
        skin === 'terminal'
          ? 125
          : skin === 'brutal'
            ? Math.round(Math.max(150, Math.min(240, 155 + (dist / width) * 95 - speed * 38)))
            : Math.round(Math.max(170, Math.min(280, 175 + (dist / width) * 110 - speed * 42)))
      const ease =
        skin === 'terminal'
          ? 'steps(4, end)'
          : skin === 'brutal'
            ? 'cubic-bezier(0.16, 1, 0.3, 1)'
            : 'cubic-bezier(0.22, 1, 0.36, 1)'

      setTrackX(fromX, 'none')
      void track.offsetWidth
      setTrackX(targetX, `transform ${dur}ms ${ease}`)

      let done = false
      const cleanup = () => {
        track.removeEventListener('transitionend', onEnd)
        window.clearTimeout(timer)
      }
      const finish = () => {
        if (done) return
        done = true
        cleanup()
        if (settlingRef.current?.cleanup === cleanup) settlingRef.current = null
        if (dir !== 0 && targetDay && onSelectDay) {
          onSelectDay(targetDay)
        } else {
          setPendingDay(null)
          setTrackX(0, 'none')
        }
      }
      const onEnd = (ev: TransitionEvent) => {
        if (ev.target !== track || ev.propertyName !== 'transform') return
        finish()
      }
      track.addEventListener('transitionend', onEnd)
      const timer = window.setTimeout(finish, dur + 70)
      settlingRef.current = { dir, targetDay, cleanup }
    },
    [clearSettling, day, onSelectDay, setTrackX, skin],
  )

  const stepDay = (dir: -1 | 1) => {
    if (!day || !onSelectDay) return
    const curSettling = settlingRef.current
    if (curSettling && curSettling.dir !== 0 && curSettling.targetDay) {
      clearSettling()
      const nextTarget = addDays(curSettling.targetDay, dir)
      const clamped =
        minDay && nextTarget < minDay ? minDay : maxDay && nextTarget > maxDay ? maxDay : nextTarget
      setPendingDay(null)
      onSelectDay(clamped)
      return
    }
    if (dir < 0 ? !canPrev : !canNext) return
    panRef.current = null
    animateTrackTo(dir, 0, 0)
  }

  const onBodyPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!onSelectDay || !day) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-no-day-swipe]')) return

    let baseX = 0
    const curSettling = settlingRef.current
    if (curSettling) {
      clearSettling()
      if (curSettling.dir !== 0 && curSettling.targetDay) {
        setPendingDay(null)
        onSelectDay(curSettling.targetDay)
        baseX = 0
      } else if (trackRef.current) {
        baseX = readTranslateX(trackRef.current)
        setTrackX(baseX, 'none')
      }
    }

    panRef.current = {
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      baseX,
      currentX: baseX,
      lastX: e.clientX,
      lastT: performance.now(),
      vx: 0,
      locked: null,
    }
  }

  const onBodyPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const st = panRef.current
    if (!st || st.pointerId !== e.pointerId) return
    const dx = e.clientX - st.x0
    const dy = e.clientY - st.y0
    if (st.locked === null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      if (Math.abs(dx) > Math.abs(dy) * 1.15) {
        st.locked = 'x'
        e.currentTarget.setPointerCapture?.(e.pointerId)
      } else {
        st.locked = 'y'
        if (st.baseX !== 0) animateTrackTo(0, st.baseX, 0)
        return
      }
    }
    if (st.locked !== 'x') return
    if (e.pointerType === 'mouse') e.preventDefault()

    const now = performance.now()
    const dt = now - st.lastT
    if (dt > 0) {
      const instVx = (e.clientX - st.lastX) / dt
      st.vx = st.vx * 0.35 + instVx * 0.65
      st.lastX = e.clientX
      st.lastT = now
    }

    const width = viewportRef.current?.clientWidth || 360
    const rawX = st.baseX + dx
    let nextX = rawX
    if (rawX > 0) {
      if (!canPrev) nextX = rubberBand(rawX, width)
      else if (rawX > width) nextX = width + rubberBand(rawX - width, width)
    } else if (rawX < 0) {
      if (!canNext) nextX = rubberBand(rawX, width)
      else if (rawX < -width) nextX = -width + rubberBand(rawX + width, width)
    }
    st.currentX = nextX
    setTrackX(nextX, 'none')
  }

  const finishBodyPointer = (e: PointerEvent<HTMLDivElement>) => {
    const st = panRef.current
    if (!st || st.pointerId !== e.pointerId) return
    panRef.current = null
    if (st.locked !== 'x') {
      if (st.baseX !== 0) animateTrackTo(0, st.baseX, 0)
      return
    }

    suppressClickRef.current = true
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 60)

    const width = viewportRef.current?.clientWidth || 360
    const curX = st.currentX
    const vx = performance.now() - st.lastT > 90 ? 0 : st.vx
    const threshold = Math.min(width * 0.25, 90)

    let dir: -1 | 0 | 1 = 0
    if (canPrev && (curX > threshold || (vx > 0.35 && curX > 12))) {
      dir = -1
    } else if (canNext && (curX < -threshold || (vx < -0.35 && curX < -12))) {
      dir = 1
    }
    animateTrackTo(dir, curX, vx)
  }

  const cancelBodyPointer = (e: PointerEvent<HTMLDivElement>) => {
    const st = panRef.current
    if (!st || st.pointerId !== e.pointerId) return
    panRef.current = null
    if (st.currentX !== 0) {
      animateTrackTo(0, st.currentX, 0)
    }
  }

  const onBodyClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return
    e.stopPropagation()
    e.preventDefault()
  }

  const titleNode = displayDay ? (
    <div className="flex items-center justify-between gap-2">
      <span>{formatDayCN(displayDay)}</span>
      {onSelectDay && (
        <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            disabled={!canStepPrev}
            onClick={() => stepDay(-1)}
            aria-label="前一天"
            className="day-ring-step disabled:opacity-35"
          >
            {skin === 'terminal' ? '<' : '‹'}
          </button>
          <button
            type="button"
            disabled={!canStepNext}
            onClick={() => stepDay(1)}
            aria-label="后一天"
            className="day-ring-step disabled:opacity-35"
          >
            {skin === 'terminal' ? '>' : '›'}
          </button>
        </div>
      )}
    </div>
  ) : (
    ''
  )

  return (
    <Sheet open={!!day} onClose={onClose} title={titleNode} flushBody>
      {day && (
        <div
          ref={viewportRef}
          className="day-pager relative h-full w-full overflow-hidden touch-pan-y"
          onPointerDown={onBodyPointerDown}
          onPointerMove={onBodyPointerMove}
          onPointerUp={finishBodyPointer}
          onPointerCancel={cancelBodyPointer}
          onClickCapture={onBodyClickCapture}
        >
          <div ref={trackRef} className="day-pager-track relative h-full w-full">
            {slides.map(({ slideDay, offset }) => {
              const isCurrent = offset === 0
              const isInitial = slideDay === initialOpenDay
              return (
                <div
                  key={slideDay}
                  className="day-pager-slide absolute inset-0 h-full w-full overflow-y-auto overscroll-y-contain px-5 pb-6"
                  style={{ transform: `translate3d(${offset * 100}%, 0, 0)` }}
                  data-static={!isInitial ? '' : undefined}
                  aria-hidden={!isCurrent ? true : undefined}
                >
                  <DayPane
                    day={slideDay}
                    stat={daily.get(slideDay)}
                    sessions={sessionsByDay.get(slideDay) ?? EMPTY_SESSIONS}
                    live={liveForDay(live, slideDay)}
                    canSwipe={!!onSelectDay}
                    animateEntrance={isInitial}
                    selectedSliceKey={isCurrent ? selectedSliceKey : null}
                    onSelectSliceKey={isCurrent ? setSelectedSliceKey : NOOP_SELECT}
                    onEdit={onEdit}
                    onAdd={onAdd}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Sheet>
  )
}
