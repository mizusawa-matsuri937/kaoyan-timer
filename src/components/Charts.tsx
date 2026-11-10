import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TrendPoint } from '../domain/aggregate'
import { formatDuration } from '../domain/format'
import { GROUPS } from '../domain/subjects'

const tooltipStyle = {
  background: 'var(--surface)',
  border: 'var(--bw) solid var(--border)',
  borderRadius: 'var(--r-ctl)',
  boxShadow: 'var(--shadow-pop)',
  fontSize: 12,
  color: 'var(--text)',
}

export function ShareDonut({ data }: { data: Array<{ name: string; value: number; color: string }> }) {
  const total = data.reduce((a, d) => a + d.value, 0)
  const shown = data.filter((d) => d.value > 0)
  const hasData = shown.length > 0
  return (
    <div className="relative h-40 w-40 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={hasData ? shown : [{ name: '无', value: 1, color: 'var(--surface-3)' }]}
            dataKey="value"
            innerRadius="72%"
            outerRadius="100%"
            paddingAngle={shown.length > 1 ? 2 : 0}
            cornerRadius={2}
            stroke="none"
            isAnimationActive
            animationDuration={450}
          >
            {(hasData ? shown : [{ color: 'var(--surface-3)' }]).map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[11px] text-muted">合计</div>
        <div className="num text-lg font-semibold">{formatDuration(total)}</div>
      </div>
    </div>
  )
}

export function TrendChart({ data }: { data: TrendPoint[] }) {
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
              fill={g.color}
              radius={i === GROUPS.length - 1 ? [2, 2, 0, 0] : 0}
              animationDuration={400}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
