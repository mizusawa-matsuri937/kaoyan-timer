import { useId } from 'react'
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TrendPoint } from '../domain/aggregate'
import { formatDuration } from '../domain/format'
import { GROUPS } from '../domain/subjects'
import { alpha, darken, lighten } from '../lib/color'

const tooltipStyle = {
  background: 'var(--card-strong)',
  border: '1px solid var(--card-border)',
  borderRadius: 14,
  boxShadow: 'var(--shadow-float)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  fontSize: 12,
  color: 'var(--text)',
}

export function ShareDonut({ data }: { data: Array<{ name: string; value: number; color: string }> }) {
  const uid = useId().replace(/:/g, '')
  const total = data.reduce((a, d) => a + d.value, 0)
  const shown = data.filter((d) => d.value > 0)
  const hasData = shown.length > 0
  return (
    <div className="relative h-44 w-44 shrink-0">
      {/* 背后的柔光 */}
      {hasData && (
        <div
          aria-hidden
          className="absolute inset-4 rounded-full"
          style={{
            background: `conic-gradient(${shown
              .map((d, i) => {
                const start = (shown.slice(0, i).reduce((a, x) => a + x.value, 0) / total) * 100
                const end = start + (d.value / total) * 100
                return `${alpha(d.color, 0.5)} ${start}% ${end}%`
              })
              .join(', ')})`,
            filter: 'blur(18px)',
            opacity: 0.55,
          }}
        />
      )}
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <defs>
            {shown.map((d, i) => (
              <linearGradient key={i} id={`donut-${uid}-${i}`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={lighten(d.color, 0.3)} />
                <stop offset="100%" stopColor={darken(d.color, 0.08)} />
              </linearGradient>
            ))}
          </defs>
          <Pie
            data={hasData ? shown : [{ name: '无', value: 1, color: 'var(--card-2)' }]}
            dataKey="value"
            innerRadius="70%"
            outerRadius="100%"
            paddingAngle={shown.length > 1 ? 3 : 0}
            cornerRadius={8}
            stroke="none"
            isAnimationActive
            animationDuration={700}
          >
            {(hasData ? shown : [{ color: 'var(--card-2)' }]).map((_, i) => (
              <Cell key={i} fill={hasData ? `url(#donut-${uid}-${i})` : 'var(--card-2)'} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[11px] text-muted">合计</div>
        <div className="num text-lg font-bold">{formatDuration(total)}</div>
      </div>
    </div>
  )
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const uid = useId().replace(/:/g, '')
  const rows = data.map((p) => ({
    label: p.label,
    cs408: +(p.cs408 / 3600000).toFixed(2),
    math: +(p.math / 3600000).toFixed(2),
    english: +(p.english / 3600000).toFixed(2),
    politics: +(p.politics / 3600000).toFixed(2),
  }))
  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
          <defs>
            {GROUPS.map((g) => (
              <linearGradient key={g.id} id={`bar-${uid}-${g.id}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lighten(g.color, 0.2)} />
                <stop offset="100%" stopColor={g.color} />
              </linearGradient>
            ))}
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: 'var(--muted)' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} unit="h" width={44} />
          <Tooltip
            cursor={{ fill: 'var(--card-2)', radius: 6 }}
            contentStyle={tooltipStyle}
            labelStyle={{ color: 'var(--muted)', marginBottom: 4 }}
            formatter={(v, name) => [`${Number(v).toFixed(1)}h`, GROUPS.find((g) => g.id === name)?.name ?? String(name)]}
          />
          {GROUPS.map((g, i) => (
            <Bar
              key={g.id}
              dataKey={g.id}
              stackId="a"
              fill={`url(#bar-${uid}-${g.id})`}
              radius={i === GROUPS.length - 1 ? [5, 5, 0, 0] : 0}
              animationDuration={500}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
