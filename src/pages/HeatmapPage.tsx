import { useMemo, useState } from 'react'
import { DaySheet } from '../components/DaySheet'
import { HEAT_VARS, HeatLegend, Heatmap } from '../components/Heatmap'
import { SessionEditor, type EditorTarget } from '../components/SessionEditor'
import { SectionTitle } from '../components/ui'
import { LEVEL_LABELS, levelCounts, sessionsOnDay } from '../domain/aggregate'
import { dayKey, diffDays } from '../domain/dates'
import { formatDuration } from '../domain/format'
import { useNow } from '../hooks/useNow'
import { useLiveDaily, useVisibleSessions } from '../hooks/useStats'
import { useApp } from '../store'

export function HeatmapPage() {
  const settings = useApp((s) => s.settings)
  const now = useNow('minute')
  const daily = useLiveDaily(now)
  const sessions = useVisibleSessions()
  const today = dayKey(now)
  const [selected, setSelected] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorTarget>(null)

  // 起始日早于第一条记录时以设置为准；有更早的记录（补录）时自动向前扩展
  const from = useMemo(() => {
    let min = settings.startDate
    for (const d of daily.keys()) if (d < min) min = d
    return min
  }, [daily, settings.startDate])
  const to = settings.examDate > today ? settings.examDate : today
  const countTo = today < settings.examDate ? today : settings.examDate

  const counts = useMemo(() => levelCounts(daily, from, countTo), [daily, from, countTo])
  const passedDays = Math.max(1, diffDays(from, countTo) + 1)
  const studiedDays = passedDays - counts[0]
  let totalMs = 0
  for (const [d, st] of daily) if (d >= from && d <= countTo) totalMs += st.total

  const daySessions = useMemo(() => (selected ? sessionsOnDay(sessions, selected) : []), [sessions, selected])

  return (
    <div className="px-4 pb-6">
      <h1 className="pt-2 text-[28px] font-bold">学习热度</h1>

      <div className="card mt-3 p-4">
        <Heatmap daily={daily} from={from} to={to} today={today} selected={selected} onSelect={setSelected} />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-muted">点格子查看当天详情</span>
          <HeatLegend />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {[
          ['已备考', `${passedDays}`, '天'],
          ['学习天数', `${studiedDays}`, '天'],
          ['日均', formatDuration(totalMs / passedDays), ''],
        ].map(([k, v, u]) => (
          <div key={k} className="card px-3 py-3">
            <div className="text-xs text-muted">{k}</div>
            <div className="num mt-0.5 text-xl font-bold">
              {v}
              {u && <span className="ml-0.5 text-sm font-medium text-muted">{u}</span>}
            </div>
          </div>
        ))}
      </div>

      <SectionTitle>各等级天数</SectionTitle>
      <div className="card divide-y px-4" style={{ borderColor: 'var(--line)' }}>
        {[4, 3, 2, 1, 0].map((lvl) => {
          const n = counts[lvl]
          const pct = (n / passedDays) * 100
          return (
            <div key={lvl} className="flex items-center gap-3 py-3" style={{ borderColor: 'var(--line)' }}>
              <span
                className="h-5 w-5 shrink-0 rounded-md"
                style={{ background: HEAT_VARS[lvl], boxShadow: lvl === 0 ? 'inset 0 0 0 1px var(--line)' : undefined }}
              />
              <span className="w-20 text-[15px]">{LEVEL_LABELS[lvl]}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-2">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${pct}%`, background: lvl === 0 ? 'var(--faint)' : HEAT_VARS[lvl] }}
                />
              </div>
              <span className="num w-12 text-right text-[15px] font-semibold">
                {n}
                <span className="ml-0.5 text-xs font-normal text-muted">天</span>
              </span>
            </div>
          )
        })}
      </div>
      <p className="mt-2 px-1 text-xs text-faint">统计范围：备考第一天至今天，共 {passedDays} 天</p>

      <DaySheet
        day={editor ? null : selected}
        stat={selected ? daily.get(selected) : undefined}
        sessions={daySessions}
        onClose={() => setSelected(null)}
        onEdit={(s) => setEditor({ kind: 'edit', session: s })}
        onAdd={(day) => setEditor({ kind: 'new', day })}
      />
      <SessionEditor target={editor} onClose={() => setEditor(null)} />
    </div>
  )
}
