import { useCallback, useMemo, useRef, useState } from 'react'
import { DaySheet } from '../components/DaySheet'
import { HEAT_VARS, HeatLegend, Heatmap } from '../components/Heatmap'
import { SessionEditor, type EditorTarget } from '../components/SessionEditor'
import { Bar, SectionTitle, Stat } from '../components/ui'
import { LEVEL_LABELS, levelCounts } from '../domain/aggregate'
import { dayKey, diffDays } from '../domain/dates'
import { formatDuration } from '../domain/format'
import { liveSegments } from '../domain/timer'
import type { Session } from '../domain/types'
import { useNow } from '../hooks/useNow'
import { useLiveDaily, useVisibleSessions } from '../hooks/useStats'
import { useApp } from '../store'

export function HeatmapPage() {
  const settings = useApp((s) => s.settings)
  const active = useApp((s) => s.active)
  const now = useNow('minute')
  const daily = useLiveDaily(now)
  const sessions = useVisibleSessions()
  const today = dayKey(now)
  const [selected, setSelected] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorTarget>(null)
  const [spotlight, setSpotlight] = useState<number | null>(null)
  const heatCardRef = useRef<HTMLDivElement>(null)

  const live = useMemo(
    () => (active ? { sessionId: active.sessionId, subjectId: active.subjectId, segments: liveSegments(active, now) } : null),
    [active, now],
  )

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

  const closeDaySheet = useCallback(() => setSelected(null), [])
  const editSession = useCallback((s: Session) => setEditor({ kind: 'edit', session: s }), [])
  const addSession = useCallback((day: string) => setEditor({ kind: 'new', day }), [])

  const toggleSpotlight = (lvl: number) => {
    const next = spotlight === lvl ? null : lvl
    setSpotlight(next)
    if (next !== null && heatCardRef.current) {
      const rect = heatCardRef.current.getBoundingClientRect()
      if (rect.top < 0) {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
      }
    }
  }

  return (
    <div className="px-4 pb-6">
      <h1 className="page-title">学习热度</h1>

      <div ref={heatCardRef} className="card heat-stage mt-3 p-4" data-spot-active={spotlight !== null ? '' : undefined}>
        <Heatmap
          daily={daily}
          from={from}
          to={to}
          today={today}
          selected={selected}
          spotlightLevel={spotlight}
          onSelect={setSelected}
        />
        <div className={`mt-3 flex items-center gap-2 ${spotlight !== null ? 'justify-between' : 'justify-end'}`}>
          {spotlight !== null && (
            <button type="button" className="heat-spot-status" onClick={() => setSpotlight(null)}>
              <span className="heat-cell inline-block h-2.5 w-2.5 shrink-0" style={{ background: HEAT_VARS[spotlight] }} />
              <span>
                {counts[spotlight] > 0
                  ? `${LEVEL_LABELS[spotlight]} · ${counts[spotlight]} 天`
                  : `暂无「${LEVEL_LABELS[spotlight]}」记录`}
              </span>
              <span className="heat-spot-clear">还原</span>
            </button>
          )}
          <HeatLegend />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2.5">
        <Stat compact label="已备考" value={passedDays} unit="天" color="#f59e0b" />
        <Stat compact label="学习天数" value={studiedDays} unit="天" color="#22c55e" />
        <Stat compact label="日均" value={formatDuration(totalMs / passedDays)} color="#6366f1" />
      </div>

      <SectionTitle
        right={
          spotlight !== null ? (
            <button type="button" className="text-xs font-medium text-accent" onClick={() => setSpotlight(null)}>
              退出聚光
            </button>
          ) : (
            <span className="num text-xs text-muted">至今 {passedDays} 天</span>
          )
        }
      >
        各等级天数
      </SectionTitle>
      <div className="card rows heat-lvl-list overflow-hidden" data-has-spot={spotlight !== null ? '' : undefined}>
        {[4, 3, 2, 1, 0].map((lvl) => {
          const n = counts[lvl]
          const pct = (n / passedDays) * 100
          const activeLvl = spotlight === lvl
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => toggleSpotlight(lvl)}
              aria-pressed={activeLvl}
              className="heat-lvl-row flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span className="heat-cell heat-lvl-swatch h-5 w-5 shrink-0" style={{ background: HEAT_VARS[lvl] }} />
              <span className="w-20 text-[15px]">{LEVEL_LABELS[lvl]}</span>
              <div className="flex-1">
                <Bar pct={pct} />
              </div>
              <span className="num w-14 text-right text-[15px] font-semibold">
                {n}
                <span className="ml-0.5 text-xs font-normal text-muted">天</span>
              </span>
            </button>
          )
        })}
      </div>

      <DaySheet
        day={editor ? null : selected}
        daily={daily}
        sessions={sessions}
        live={live}
        minDay={from}
        maxDay={countTo}
        onSelectDay={setSelected}
        onClose={closeDaySheet}
        onEdit={editSession}
        onAdd={addSession}
      />
      <SessionEditor target={editor} onClose={() => setEditor(null)} />
    </div>
  )
}
