import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { heatLevel, type Daily } from '../domain/aggregate'
import { addDays, diffDays, parseDay, startOfWeek } from '../domain/dates'

/** 格子的最小边长；实际边长按容器宽度略微放大，让可视区正好容纳整数列 */
const MIN_CELL = 18
/** 与 index.css 里 .heat 的 --gap / --pad 保持一致 */
const GAP = 4
const PAD = 4

export const HEAT_VARS = ['var(--h0)', 'var(--h1)', 'var(--h2)', 'var(--h3)', 'var(--h4)']

const WEEKDAY_LABELS: Array<[row: number, label: string]> = [
  [0, '一'],
  [2, '三'],
  [4, '五'],
  [6, '日'],
]

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
  const [viewW, setViewW] = useState(0)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setViewW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 可视区放 visible 列：两侧各留 PAD 给描边，列距取小数，保证左右都不露半格
  const visible = Math.max(1, Math.floor((viewW - 2 * PAD + GAP) / (MIN_CELL + GAP)))
  const step = viewW > 0 ? (viewW - 2 * PAD + GAP) / visible : MIN_CELL + GAP

  const { cols, gridStart, months } = useMemo(() => {
    const gridStart = startOfWeek(from)
    const gridEnd = addDays(startOfWeek(to), 6)
    const cols = Math.floor(diffDays(gridStart, gridEnd) / 7) + 1
    const months = new Map<number, string>()
    let lastMonth = -1
    for (let c = 0; c < cols; c++) {
      // 用这一周中第一个在范围内的日子决定月份
      for (let r = 0; r < 7; r++) {
        const d = addDays(gridStart, c * 7 + r)
        if (d < from || d > to) continue
        const dt = parseDay(d)
        const m = dt.getMonth()
        if (m !== lastMonth && (dt.getDate() <= 7 || months.size === 0)) {
          months.set(c, m === 0 || months.size === 0 ? `${dt.getFullYear() % 100}年${m + 1}月` : `${m + 1}月`)
          lastMonth = m
        }
        break
      }
    }
    return { cols, gridStart, months }
  }, [from, to])

  // 列内容与选中状态无关：点格子时这几百个节点不需要重新渲染
  const columns = useMemo(() => {
    const out: ReactNode[] = []
    for (let c = 0; c < cols; c++) {
      const cells: ReactNode[] = []
      for (let r = 0; r < 7; r++) {
        const day = addDays(gridStart, c * 7 + r)
        if (day < from || day > to) {
          cells.push(<i key={r} className="heat-gap" />)
          continue
        }
        const future = day > today
        cells.push(
          <button
            key={r}
            type="button"
            className="heat-cell heat-day"
            aria-label={day}
            data-day={day}
            data-l={future ? undefined : heatLevel(daily.get(day)?.total ?? 0)}
            data-today={day === today ? '' : undefined}
            disabled={future}
          />,
        )
      }
      const label = months.get(c)
      out.push(
        <div key={c} className="heat-col">
          {label && <span className="heat-month">{label}</span>}
          {cells}
        </div>,
      )
    }
    return out
  }, [cols, gridStart, months, daily, from, to, today])

  const todayCol = Math.floor(diffDays(gridStart, today) / 7)

  // 月份标签比一列宽，滚到边缘会被切掉半个字：放不下整个标签时直接隐藏。
  // 只改 opacity、不触发布局，所以可以直接挂在 scroll 事件上
  const syncMonths = () => {
    const el = scrollRef.current
    if (!el) return
    const lo = el.scrollLeft - 1
    const hi = el.scrollLeft + el.clientWidth + 1
    for (const label of el.querySelectorAll<HTMLElement>('.heat-month')) {
      const x = label.parentElement!.offsetLeft
      label.style.opacity = x >= lo && x + label.offsetWidth <= hi ? '' : '0'
    }
  }

  // 初始位置：今天落在可视区靠右约 3/4 处，左边留给已经学过的日子。
  // 页面切走时容器是 display:none，滚动位置会被浏览器清零；切回来这个副作用会重跑，
  // 只要布局没变（同一周、同样的列宽）就恢复到离开时的位置，而不是跳回今天。
  const saved = useRef<{ key: string; left: number } | null>(null)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || viewW === 0) return
    const key = `${todayCol}/${visible}/${step}`
    if (saved.current?.key === key) {
      el.scrollLeft = saved.current.left
    } else {
      const lead = visible - 1 - Math.floor(visible / 4)
      el.scrollLeft = Math.max(0, todayCol - lead) * step
    }
    saved.current = { key, left: el.scrollLeft }
    syncMonths()
  }, [todayCol, visible, step, viewW, months])

  const onScroll = () => {
    const el = scrollRef.current
    // 隐藏时宽度为 0，那时的清零不是用户滚的，不记
    if (el && el.clientWidth > 0 && saved.current) saved.current.left = el.scrollLeft
    syncMonths()
  }

  const onClick = (e: MouseEvent) => {
    const day = (e.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day
    if (day) onSelect(day)
  }

  const sel = selected && selected >= from && selected <= to ? diffDays(gridStart, selected) : -1

  return (
    <div className="heat" style={{ '--cell': `${step - GAP}px`, '--step': `${step}px` } as CSSProperties}>
      {/* 星期标签固定在左侧，不随横向滚动 */}
      <div className="heat-weekdays" aria-hidden>
        {WEEKDAY_LABELS.map(([row, label]) => (
          <span key={row} style={{ '--r': row } as CSSProperties}>
            {label}
          </span>
        ))}
      </div>
      <div ref={scrollRef} className="heat-scroll no-scrollbar" onScroll={onScroll}>
        <div className="heat-track" onClick={onClick}>
          {columns}
          {sel >= 0 && (
            <span className="heat-ring" style={{ '--c': Math.floor(sel / 7), '--r': sel % 7 } as CSSProperties} />
          )}
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
        <span key={i} className="heat-cell inline-block" style={{ width: 11, height: 11, background: c }} />
      ))}
      <span className="ml-1">多</span>
    </div>
  )
}
