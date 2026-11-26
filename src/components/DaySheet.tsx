import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { dayTimelineSlices, heatLevel, LEVEL_LABELS, splitByDay, type DayStat, type LiveSliceInput } from '../domain/aggregate'
import { addDays, formatClock, formatDayCN } from '../domain/dates'
import { formatDuration, formatDurationCN } from '../domain/format'
import { SUBJECTS, getSubject } from '../domain/subjects'
import type { Session } from '../domain/types'
import { useSkin } from '../skin'
import { DayTimelineRing } from './DayTimelineRing'
import { HEAT_VARS } from './Heatmap'
import { IconChevron, IconPlus } from './icons'
import { Bar, Sheet, tint } from './ui'

export function DaySheet({
  day,
  stat,
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
  stat: DayStat | undefined
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
  const prevDayRef = useRef<string | null>(day)
  let dayDir: -1 | 0 | 1 = 0
  if (day && prevDayRef.current && day !== prevDayRef.current) {
    dayDir = day > prevDayRef.current ? 1 : -1
  }
  useEffect(() => {
    prevDayRef.current = day
    setSelectedSliceKey(null)
  }, [day])

  const total = stat?.total ?? 0
  const lvl = heatLevel(total)
  const slices = useMemo(() => (day ? dayTimelineSlices(sessions, day, live) : []), [sessions, day, live])
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
  const canPrev = !!(day && onSelectDay && (!minDay || day > minDay))
  const canNext = !!(day && onSelectDay && (!maxDay || day < maxDay))

  const titleNode = day ? (
    <div className="flex items-center justify-between gap-2">
      <span>{formatDayCN(day)}</span>
      {onSelectDay && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canPrev}
            onClick={() => day && canPrev && onSelectDay(addDays(day, -1))}
            aria-label="前一天"
            className="day-ring-step disabled:opacity-35"
          >
            {skin === 'terminal' ? '<' : '‹'}
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => day && canNext && onSelectDay(addDays(day, 1))}
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
    <Sheet open={!!day} onClose={onClose} title={titleNode}>
      {day && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={day}
            initial={dayDir === 0 ? false : { opacity: 0, x: dayDir * 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dayDir * -14 }}
            transition={
              skin === 'terminal'
                ? { duration: 0.1, ease: 'linear' }
                : skin === 'brutal'
                  ? { duration: 0.18, ease: [0.25, 1.3, 0.5, 1] }
                  : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }
            }
          >
            <div className="well flex items-center gap-3 p-4">
            <span className="heat-cell h-9 w-9 shrink-0" style={{ background: HEAT_VARS[lvl] }} />
            <div>
              <div className="num text-2xl font-semibold">{formatDurationCN(total)}</div>
              <div className="text-xs text-muted">等级：{LEVEL_LABELS[lvl]}</div>
            </div>
          </div>

          {slices.length > 0 && (
            <div className="mt-3">
              <DayTimelineRing
                day={day}
                slices={slices}
                selectedKey={activeSliceKey}
                onSelectKey={setSelectedSliceKey}
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

          <div className="mt-6 mb-2 flex items-center justify-between">
            <span className="section-title">学习记录（{sessions.length}）</span>
            <button onClick={() => onAdd(day)} className="flex items-center gap-0.5 text-sm font-semibold text-accent">
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
          </motion.div>
        </AnimatePresence>
      )}
    </Sheet>
  )
}
