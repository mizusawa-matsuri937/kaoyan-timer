import { useMemo } from 'react'
import { heatLevel, LEVEL_LABELS, splitByDay, type DayStat } from '../domain/aggregate'
import { formatClock, formatDayCN } from '../domain/dates'
import { formatDuration, formatDurationCN } from '../domain/format'
import { SUBJECTS, getSubject } from '../domain/subjects'
import type { Session } from '../domain/types'
import { HEAT_GLOWS, HEAT_VARS } from './Heatmap'
import { IconChevron, IconPlus } from './icons'
import { GlowBar, Sheet } from './ui'

export function DaySheet({
  day,
  stat,
  sessions,
  onClose,
  onEdit,
  onAdd,
}: {
  day: string | null
  stat: DayStat | undefined
  sessions: Session[]
  onClose: () => void
  onEdit: (s: Session) => void
  onAdd: (day: string) => void
}) {
  const total = stat?.total ?? 0
  const lvl = heatLevel(total)
  const rows = useMemo(
    () =>
      SUBJECTS.map((s) => ({ s, ms: stat?.bySubject[s.id] ?? 0 }))
        .filter((x) => x.ms > 0)
        .sort((a, b) => b.ms - a.ms),
    [stat],
  )
  const max = rows[0]?.ms ?? 1

  return (
    <Sheet open={!!day} onClose={onClose} title={day ? formatDayCN(day) : ''}>
      {day && (
        <>
          <div className="glass-flat flex items-center gap-3 rounded-2xl p-4">
            <span className="h-9 w-9 rounded-xl" style={{ background: HEAT_VARS[lvl], boxShadow: HEAT_GLOWS[lvl] }} />
            <div>
              <div className="num text-2xl font-bold">{formatDurationCN(total)}</div>
              <div className="text-xs text-muted">等级：{LEVEL_LABELS[lvl]}</div>
            </div>
          </div>

          {rows.length > 0 && (
            <div className="mt-4 space-y-2.5">
              {rows.map(({ s, ms }) => (
                <div key={s.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{s.name}</span>
                    <span className="num text-muted">{formatDuration(ms)}</span>
                  </div>
                  <GlowBar pct={(ms / max) * 100} color={s.color} />
                </div>
              ))}
            </div>
          )}

          <div className="mt-6 mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-muted">学习记录（{sessions.length}）</span>
            <button onClick={() => onAdd(day)} className="flex items-center gap-0.5 text-sm font-semibold text-accent">
              <IconPlus size={16} /> 补录
            </button>
          </div>
          {sessions.length === 0 ? (
            <div className="rounded-2xl bg-card-2 py-8 text-center text-sm text-muted">这天没有记录</div>
          ) : (
            <div className="divide-y overflow-hidden rounded-2xl bg-card-2" style={{ borderColor: 'var(--line)' }}>
              {sessions.map((s) => {
                const sub = getSubject(s.subjectId)
                const first = s.segments[0]
                const last = s.segments[s.segments.length - 1]
                // 只统计落在这一天的部分
                let msToday = 0
                for (const g of s.segments) for (const [d, ms] of splitByDay(g)) if (d === day) msToday += ms
                const crossDay = splitByDay({ start: first.start, end: last.end }).length > 1
                return (
                  <button
                    key={s.id}
                    onClick={() => onEdit(s)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-card"
                    style={{ borderColor: 'var(--line)' }}
                  >
                    <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: sub?.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[15px] font-medium">
                        {sub?.name ?? s.subjectId}
                        {s.source === 'manual' && (
                          <span className="rounded-md bg-card px-1.5 py-0.5 text-[10px] text-muted">补录</span>
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
      )}
    </Sheet>
  )
}
