import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { heatLevel, type Daily } from '../domain/aggregate'
import { addDays, diffDays, parseDay, startOfWeek } from '../domain/dates'

const CELL = 14
const GAP = 3
const STEP = CELL + GAP
const LEFT = 0
const LABEL_W = 18
const TOP = 18

export const HEAT_VARS = ['var(--h0)', 'var(--h1)', 'var(--h2)', 'var(--h3)', 'var(--h4)']

interface Props {
  daily: Daily
  from: string
  to: string
  today: string
  selected: string | null
  onSelect: (day: string) => void
}

/** GitHub 风格热度表：列 = 周（周一开始），行 = 周一…周日 */
export const Heatmap = memo(function Heatmap({ daily, from, to, today, selected, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const { cols, gridStart, months } = useMemo(() => {
    const gridStart = startOfWeek(from)
    const gridEnd = addDays(startOfWeek(to), 6)
    const cols = Math.floor(diffDays(gridStart, gridEnd) / 7) + 1
    const months: Array<{ col: number; label: string }> = []
    let lastMonth = -1
    for (let c = 0; c < cols; c++) {
      // 用这一周中第一个在范围内的日子决定月份
      for (let r = 0; r < 7; r++) {
        const d = addDays(gridStart, c * 7 + r)
        if (d < from || d > to) continue
        const dt = parseDay(d)
        const m = dt.getMonth()
        if (m !== lastMonth && (dt.getDate() <= 7 || months.length === 0)) {
          const label = m === 0 || months.length === 0 ? `${dt.getFullYear() % 100}年${m + 1}月` : `${m + 1}月`
          months.push({ col: c, label })
          lastMonth = m
        }
        break
      }
    }
    return { cols, gridStart, months }
  }, [from, to])

  const todayCol = Math.floor(diffDays(gridStart, today) / 7)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const x = LEFT + todayCol * STEP - el.clientWidth / 2 + CELL
    el.scrollLeft = Math.max(0, x)
  }, [todayCol])

  const cells = []
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < 7; r++) {
      const day = addDays(gridStart, c * 7 + r)
      if (day < from || day > to) continue
      const ms = daily.get(day)?.total ?? 0
      const future = day > today
      const lvl = heatLevel(ms)
      const isToday = day === today
      const isSel = day === selected
      cells.push(
        <button
          key={day}
          onClick={() => !future && onSelect(day)}
          aria-label={day}
          className="absolute rounded-[4px] transition-transform active:scale-90"
          style={{
            left: LEFT + c * STEP,
            top: TOP + r * STEP,
            width: CELL,
            height: CELL,
            background: future ? 'transparent' : HEAT_VARS[lvl],
            border: future ? '1px dashed var(--line)' : undefined,
            outline: isSel ? '2px solid var(--text)' : isToday ? '1.5px solid var(--accent)' : undefined,
            outlineOffset: 1,
            cursor: future ? 'default' : 'pointer',
          }}
        />,
      )
    }
  }

  const width = LEFT + cols * STEP + 4
  const height = TOP + 7 * STEP

  return (
    <div className="flex">
      {/* 星期标签固定在左侧，不随横向滚动 */}
      <div className="relative shrink-0" style={{ width: LABEL_W, height }}>
        {['一', '三', '五', '日'].map((w, i) => (
          <div
            key={w}
            className="absolute text-[10px] text-muted"
            style={{ left: 0, top: TOP + [0, 2, 4, 6][i] * STEP, lineHeight: `${CELL}px` }}
          >
            {w}
          </div>
        ))}
      </div>
      <div ref={scrollRef} className="no-scrollbar min-w-0 flex-1 overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="relative" style={{ width, height }}>
          {months.map((m) => (
            <div key={m.col} className="absolute text-[10px] whitespace-nowrap text-muted" style={{ left: LEFT + m.col * STEP, top: 0 }}>
              {m.label}
            </div>
          ))}
          {cells}
        </div>
      </div>
    </div>
  )
})

export function HeatLegend() {
  return (
    <div className="flex items-center gap-1 text-[11px] text-muted">
      <span className="mr-1">少</span>
      {HEAT_VARS.map((c, i) => (
        <span key={i} className="inline-block rounded-[3px]" style={{ width: 11, height: 11, background: c }} />
      ))}
      <span className="ml-1">多</span>
    </div>
  )
}
