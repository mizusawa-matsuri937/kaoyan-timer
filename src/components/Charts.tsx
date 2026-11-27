import { useLayoutEffect, useRef, useState } from 'react'
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TrendPoint } from '../domain/aggregate'
import { formatDuration } from '../domain/format'
import { GROUPS } from '../domain/subjects'
import { useSkin } from '../skin'
import { OdometerText } from './Odometer'

const skinColor = (hex: string) => `color-mix(in srgb, ${hex} var(--c-mark-pct), var(--c-ink-to))`

const tooltipStyle = {
  background: 'var(--surface)',
  border: 'var(--bw) solid var(--border)',
  borderRadius: 'var(--r-ctl)',
  boxShadow: 'var(--shadow-pop)',
  fontSize: 12,
  color: 'var(--text)',
}

/**
 * 所在页面每次被切回来时 +1。
 * 页面切走后并不卸载（见 App.tsx），只是隐藏；切回来时 React 会把副作用重新挂上，借此得知「又显示了」。
 * 用 layout effect：在浏览器画出这一帧之前就更新，不会先闪一下旧画面。
 */
function useShowCount() {
  const [count, setCount] = useState(0)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    if (mounted.current) setCount((c) => c + 1)
    mounted.current = true
  }, [])
  return count
}

export function ShareDonut({ data }: { data: Array<{ name: string; value: number; color: string }> }) {
  // 图表库的入场动画只在挂载时播一次；页面里其他区块每次切回来都会重播入场，
  // 所以这里也让扇区跟着重新挂载；而在本页切换「今日/本周/本月/全部」时零延迟立即响应
  const skin = useSkin()
  const replay = useShowCount()
  const prevReplay = useRef(replay)
  const isReplay = prevReplay.current !== replay
  prevReplay.current = replay

  const total = data.reduce((a, d) => a + d.value, 0)
  const shown = data.filter((d) => d.value > 0)
  const hasData = shown.length > 0
  const dur = skin === 'terminal' ? 220 : skin === 'brutal' ? 320 : 420
  return (
    <div className="relative h-40 w-40 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            key={replay}
            data={hasData ? shown : [{ name: '无', value: 1, color: 'var(--surface-3)' }]}
            dataKey="value"
            innerRadius="72%"
            outerRadius="100%"
            paddingAngle={shown.length > 1 ? 2 : 0}
            cornerRadius={skin === 'terminal' ? 0 : 2}
            stroke="none"
            isAnimationActive
            animationBegin={isReplay ? 100 : 0}
            animationDuration={dur}
            animationEasing="ease-out"
          >
            {(hasData ? shown : [{ color: 'var(--surface-3)', raw: true }]).map((d, i) => (
              <Cell key={i} fill={'raw' in d ? d.color : skinColor(d.color)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[11px] text-muted">合计</div>
        <div className="num text-lg font-semibold">
          <OdometerText text={formatDuration(total)} value={total} skin={skin} />
        </div>
      </div>
    </div>
  )
}

export function TrendChart({ data, unitKey = 'day' }: { data: TrendPoint[]; unitKey?: string }) {
  const skin = useSkin()
  const replay = useShowCount()
  const dur = skin === 'terminal' ? 200 : skin === 'brutal' ? 340 : 440
  const rows = data.map((p) => {
    const cs408 = +(p.cs408 / 3600000).toFixed(2)
    const math = +(p.math / 3600000).toFixed(2)
    const english = +(p.english / 3600000).toFixed(2)
    const politics = +(p.politics / 3600000).toFixed(2)
    return { label: p.label, cs408, math, english, politics, sum: cs408 + math + english + politics }
  })
  const peakSum = Math.max(0, ...rows.map((r) => r.sum))
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart key={`${replay}-${unitKey}`} data={rows} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'var(--muted)' }}
            axisLine={{ stroke: 'var(--line)' }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} unit="h" width={44} />
          <Tooltip
            cursor={{ fill: 'var(--surface-3)' }}
            contentStyle={tooltipStyle}
            labelStyle={{ color: 'var(--muted)', marginBottom: 4 }}
            formatter={(v, name) => [`${Number(v).toFixed(1)}h`, GROUPS.find((g) => g.id === name)?.name ?? String(name)]}
          />
          {GROUPS.map((g, i) => (
            <Bar
              key={g.id}
              dataKey={g.id}
              stackId="a"
              fill={skinColor(g.color)}
              radius={skin === 'terminal' ? 0 : i === GROUPS.length - 1 ? [3, 3, 0, 0] : 0}
              animationBegin={i * 36}
              animationDuration={dur}
              animationEasing="ease-out"
            >
              {rows.map((r, rIdx) => (
                <Cell
                  key={rIdx}
                  fill={skinColor(g.color)}
                  fillOpacity={peakSum > 0 && r.sum === peakSum ? 1 : 0.82}
                />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
