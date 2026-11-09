import { useMemo, useState } from 'react'
import { ShareDonut, TrendChart } from '../components/Charts'
import { IconFlame } from '../components/icons'
import { Segmented, SectionTitle } from '../components/ui'
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
  const trendData = useMemo(
    () => trend(daily, today, unit, unit === 'day' ? 14 : unit === 'week' ? 12 : 12),
    [daily, today, unit],
  )

  return (
    <div className="px-4 pb-6">
      <h1 className="pt-2 text-[28px] font-bold">统计</h1>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="card px-4 py-3.5">
          <div className="flex items-center gap-1 text-xs text-muted">
            <IconFlame size={14} className="text-orange-500" /> 当前连续
          </div>
          <div className="num mt-0.5 text-2xl font-bold">
            {st.current}
            <span className="ml-0.5 text-sm font-medium text-muted">天</span>
          </div>
        </div>
        <div className="card px-4 py-3.5">
          <div className="text-xs text-muted">最长连续</div>
          <div className="num mt-0.5 text-2xl font-bold">
            {st.longest}
            <span className="ml-0.5 text-sm font-medium text-muted">天</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Segmented id="range" value={range} options={RANGES} onChange={setRange} />
      </div>

      <div className="card mt-3 p-4">
        <div className="text-xs text-muted">考研总学习时长</div>
        <div className="num mt-0.5 text-[34px] font-bold leading-tight">
          {hours1(total)}
          <span className="ml-1 text-base font-semibold text-muted">小时</span>
        </div>
        <div className="mt-4 flex items-center gap-4">
          <ShareDonut data={GROUPS.map((g) => ({ name: g.name, value: byGroup[g.id], color: g.color }))} />
          <div className="flex-1 space-y-2.5">
            {GROUPS.map((g) => (
              <div key={g.id} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                <span className="flex-1">{g.name}</span>
                <span className="num text-muted">{total ? Math.round((byGroup[g.id] / total) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {GROUPS.map((g) => {
        const subs = subjectsOf(g.id)
        const groupMs = byGroup[g.id]
        return (
          <div key={g.id} className="card mt-3 p-4">
            <div className="flex items-baseline justify-between">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full" style={{ background: g.color }} />
                <span className="text-[17px] font-semibold">{subs.length > 1 ? `${g.name} 汇总` : g.name}</span>
              </div>
              <span className="num text-xl font-bold">{formatDuration(groupMs)}</span>
            </div>
            {subs.length > 1 && (
              <div className="mt-3 space-y-2.5">
                {subs.map((s) => {
                  const ms = bySubject[s.id] ?? 0
                  return (
                    <div key={s.id}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{s.name}</span>
                        <span className="num text-muted">
                          {formatDuration(ms)}
                          <span className="ml-1.5 text-faint">{groupMs ? Math.round((ms / groupMs) * 100) : 0}%</span>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-card-2">
                        <div
                          className="h-full rounded-full transition-[width] duration-500"
                          style={{ width: `${groupMs ? (ms / groupMs) * 100 : 0}%`, background: s.color }}
                        />
                      </div>
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
