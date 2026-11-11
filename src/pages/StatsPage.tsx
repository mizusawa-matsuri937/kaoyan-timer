import { useMemo, useState } from 'react'
import { ShareDonut, TrendChart } from '../components/Charts'
import { IconFlame } from '../components/icons'
import { Bar, Segmented, SectionTitle, Stat, tint } from '../components/ui'
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
      <h1 className="page-title">统计</h1>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Stat label="当前连续" value={st.current} unit="天" color="#f97316" icon={<IconFlame size={14} />} />
        <Stat label="最长连续" value={st.longest} unit="天" color="#eab308" />
      </div>

      <div className="mt-4">
        <Segmented value={range} options={RANGES} onChange={setRange} />
      </div>

      <div className="card mt-3 p-4">
        <div>
          <div className="card-legend">考研总学习时长</div>
          <div className="num mt-1 text-[38px] leading-tight font-semibold">
            {hours1(total)}
            <span className="ml-1.5 text-base font-medium text-muted">小时</span>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <ShareDonut data={GROUPS.map((g) => ({ name: g.name, value: byGroup[g.id], color: g.color }))} />
            <div className="flex-1 space-y-3">
              {GROUPS.map((g) => (
                <div key={g.id} className="c flex items-center gap-2 text-sm" style={tint(g.color)}>
                  <span className="dot" />
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
          <div key={g.id} className="card c mt-3 p-4" style={tint(g.color)}>
            <div className="flex items-baseline justify-between">
              <div className="flex items-center gap-2">
                <span className="dot" />
                <span className="text-[16px] font-semibold">{subs.length > 1 ? `${g.name} 汇总` : g.name}</span>
              </div>
              <span className="num text-xl font-semibold">{formatDuration(groupMs)}</span>
            </div>
            {subs.length > 1 && (
              <div className="mt-3 space-y-3">
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
                      <Bar pct={pct} color={s.color} />
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
        <Segmented value={unit} options={TREND} onChange={setUnit} />
        <div className="mt-3">
          <TrendChart data={trendData} />
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs text-muted">
          {GROUPS.map((g) => (
            <span key={g.id} className="flex items-center gap-1.5">
              <span className="h-2 w-2" style={{ background: g.color }} />
              {g.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
