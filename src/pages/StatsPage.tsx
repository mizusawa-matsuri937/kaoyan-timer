import { useMemo, useState } from 'react'
import { ShareDonut, TrendChart } from '../components/Charts'
import { IconFlame } from '../components/icons'
import { GlowBar, GlowStat, Segmented, SectionTitle } from '../components/ui'
import {
  groupTotals,
  rangeBounds,
  streaks,
  subjectTotals,
  sumValues,
  trend,
  type RangeId,
} from '../domain/aggregate'
import { dayKey } from '../domain/dates'
import { formatDuration, hours1 } from '../domain/format'
import { GROUPS, subjectsOf } from '../domain/subjects'
import { useNow } from '../hooks/useNow'
import { useLiveDaily } from '../hooks/useStats'
import { alpha } from '../lib/color'

const RANGES: Array<{ value: RangeId; label: string }> = [
  { value: 'today', label: '今日' },
  { value: 'week', label: '本周' },
  { value: 'month', label: '本月' },
  { value: 'all', label: '全部' },
]

type TrendUnit = 'day' | 'week' | 'month'
const TREND: Array<{ value: TrendUnit; label: string }> = [
  { value: 'day', label: '近 14 天' },
  { value: 'week', label: '近 12 周' },
  { value: 'month', label: '按月' },
]

export function StatsPage() {
  const now = useNow('minute')
  const daily = useLiveDaily(now)
  const today = dayKey(now)
  const [range, setRange] = useState<RangeId>('all')
  const [unit, setUnit] = useState<TrendUnit>('day')

  const bySubject = useMemo(() => subjectTotals(daily, rangeBounds(range, today)), [daily, range, today])
  const byGroup = groupTotals(bySubject)
  const total = sumValues(bySubject)
  const st = useMemo(() => streaks(daily, today), [daily, today])
  const trendData = useMemo(() => trend(daily, today, unit, unit === 'day' ? 14 : 12), [daily, today, unit])

  return (
    <div className="px-4 pb-6">
      <h1 className="pt-2 text-[30px] font-bold tracking-tight">统计</h1>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <GlowStat
          label="当前连续"
          value={st.current}
          unit="天"
          color="#f97316"
          icon={<IconFlame size={14} className="text-orange-500" />}
          valueColor={st.current > 0 ? '#f97316' : undefined}
        />
        <GlowStat label="最长连续" value={st.longest} unit="天" color="#eab308" />
      </div>

      <div className="mt-4">
        <Segmented id="range" value={range} options={RANGES} onChange={setRange} />
      </div>

      <div className="card mt-3 overflow-hidden p-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(90% 70% at 0% 0%, rgba(99,102,241,.14) 0%, transparent 60%)' }}
        />
        <div className="relative">
          <div className="text-xs font-medium text-muted">考研总学习时长</div>
          <div className="num mt-1 text-[38px] leading-tight font-bold tracking-tight">
            {hours1(total)}
            <span className="ml-1 text-base font-semibold text-muted">小时</span>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <ShareDonut data={GROUPS.map((g) => ({ name: g.name, value: byGroup[g.id], color: g.color }))} />
            <div className="flex-1 space-y-3">
              {GROUPS.map((g) => (
                <div key={g.id} className="flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color, boxShadow: `0 0 8px ${alpha(g.color, 0.7)}` }} />
                  <span className="flex-1">{g.name}</span>
                  <span className="num font-semibold">{total ? Math.round((byGroup[g.id] / total) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {GROUPS.map((g) => {
        const subs = subjectsOf(g.id)
        const groupMs = byGroup[g.id]
        return (
          <div key={g.id} className="card mt-3 overflow-hidden p-4">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: `radial-gradient(80% 100% at 100% 0%, ${alpha(g.color, 0.12)} 0%, transparent 60%)` }}
            />
            <div className="relative flex items-baseline justify-between">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: g.color, boxShadow: `0 0 10px ${alpha(g.color, 0.7)}` }} />
                <span className="text-[17px] font-semibold">{subs.length > 1 ? `${g.name} 汇总` : g.name}</span>
              </div>
              <span className="num text-xl font-bold">{formatDuration(groupMs)}</span>
            </div>
            {subs.length > 1 && (
              <div className="relative mt-3 space-y-3">
                {subs.map((s) => {
                  const ms = bySubject[s.id] ?? 0
                  const pct = groupMs ? (ms / groupMs) * 100 : 0
                  return (
                    <div key={s.id}>
                      <div className="mb-1.5 flex justify-between text-sm">
                        <span>{s.name}</span>
                        <span className="num text-muted">
                          {formatDuration(ms)}
                          <span className="ml-1.5 text-faint">{Math.round(pct)}%</span>
                        </span>
                      </div>
                      <GlowBar pct={pct} color={s.color} />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      <SectionTitle>学习趋势</SectionTitle>
      <div className="card p-4">
        <Segmented id="trend" value={unit} options={TREND} onChange={setUnit} />
        <div className="mt-3">
          <TrendChart data={trendData} />
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs text-muted">
          {GROUPS.map((g) => (
            <span key={g.id} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm" style={{ background: g.color }} />
              {g.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
