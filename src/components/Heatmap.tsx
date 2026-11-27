import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { heatLevel, LEVEL_LABELS, type Daily } from '../domain/aggregate'
import { addDays, diffDays, formatDayCN, parseDay, startOfWeek } from '../domain/dates'
import { formatDuration, formatDurationCN } from '../domain/format'
import { getSubject } from '../domain/subjects'
import { useSkin } from '../skin'
import { tint } from './ui'

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

const SHORT_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function shortDayLabel(day: string): string {
  const d = parseDay(day)
  return `${d.getMonth() + 1}月${d.getDate()}日 周${SHORT_WEEKDAYS[d.getDay()]}`
}

interface Props {
  daily: Daily
  from: string
  to: string
  today: string
  selected: string | null
  spotlightLevel?: number | null
  onSelect: (day: string) => void
}

/** GitHub 风格热度表：列 = 周（周一开始），行 = 周一…周日；支持碰撞感知滑行预览气泡与键盘方向键二维漫游 */
export const Heatmap = memo(function Heatmap({
  daily,
  from,
  to,
  today,
  selected,
  spotlightLevel = null,
  onSelect,
}: Props) {
  const skin = useSkin()
  const heatRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const activeCellRef = useRef<HTMLElement | null>(null)
  const [viewW, setViewW] = useState(0)
  const [tipDay, setTipDay] = useState<string | null>(null)

  const activeMax = today < to ? today : to
  const initialRovingDay = today >= from && today <= activeMax ? today : activeMax >= from ? activeMax : from
  const rovingDayRef = useRef<string>(initialRovingDay)

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

  // 列内容与选中 / 聚光 / 悬浮气泡状态无关：切换聚光或滑过格子时这几百个节点不需要重新渲染
  const columns = useMemo(() => {
    rovingDayRef.current = initialRovingDay
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
        const ms = daily.get(day)?.total ?? 0
        const lvl = heatLevel(ms)
        const ariaLabel = future
          ? `${formatDayCN(day)}，未来日期`
          : `${formatDayCN(day)}，${ms > 0 ? `学习 ${formatDurationCN(ms)}，等级 ${LEVEL_LABELS[lvl]}` : '未学习'}${day === today ? '，今天' : ''}`
        cells.push(
          <button
            key={r}
            type="button"
            tabIndex={!future && day === initialRovingDay ? 0 : -1}
            className="heat-cell heat-day"
            aria-label={ariaLabel}
            data-day={day}
            data-r={r}
            data-l={future ? undefined : lvl}
            data-today={day === today ? '' : undefined}
            disabled={future}
            style={{ '--r': r } as CSSProperties}
          />,
        )
      }
      const label = months.get(c)
      out.push(
        <div key={c} className="heat-col" style={{ '--col': c } as CSSProperties}>
          {label && <span className="heat-month">{label}</span>}
          {cells}
        </div>,
      )
    }
    return out
  }, [cols, gridStart, months, daily, from, to, today, initialRovingDay])

  const todayCol = Math.floor(diffDays(gridStart, today) / 7)

  const positionTooltip = useCallback(() => {
    const heatEl = heatRef.current
    const cellEl = activeCellRef.current
    const tipEl = tipRef.current
    if (!heatEl || !cellEl || !tipEl) return
    const heatRect = heatEl.getBoundingClientRect()
    const cellRect = cellEl.getBoundingClientRect()
    if (heatRect.width === 0 || cellRect.width === 0) return

    const tipW = tipEl.offsetWidth
    const tipH = tipEl.offsetHeight
    const cx = cellRect.left - heatRect.left + cellRect.width / 2
    // Floating UI shift：左右贴边自动夹紧，绝不溢出卡片
    const clampedX = Math.max(2, Math.min(heatRect.width - tipW - 2, cx - tipW / 2))
    const arrowX = Math.max(10, Math.min(tipW - 10, cx - clampedX))
    // Floating UI flip：若贴近视口顶端放不下则翻转到格子下方
    const flipBottom = cellRect.top < tipH + 14
    const y = flipBottom
      ? cellRect.bottom - heatRect.top + 7
      : cellRect.top - heatRect.top - tipH - 7

    tipEl.dataset.side = flipBottom ? 'bottom' : 'top'
    tipEl.style.setProperty('--tip-x', `${Math.round(clampedX)}px`)
    tipEl.style.setProperty('--tip-y', `${Math.round(y)}px`)
    tipEl.style.setProperty('--tip-arrow', `${Math.round(arrowX)}px`)
  }, [])

  useLayoutEffect(() => {
    if (tipDay) positionTooltip()
  }, [tipDay, positionTooltip])

  // 月份标签比一列宽，滚到边缘会被切掉半个字：放不下整个标签时直接隐藏。
  // 同时把当前可视区左起列号写入 --vis-c0，让入场与聚光波浪永远从屏幕可见处即时起跳
  const syncMonths = () => {
    const el = scrollRef.current
    if (!el) return
    if (trackRef.current && step > 0) {
      trackRef.current.style.setProperty('--vis-c0', String(Math.max(0, Math.floor(el.scrollLeft / step))))
    }
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

  // 开启某个等级聚光时，若当前可视区里恰好没有任何该等级的格子，则自动滚到最近一个有该等级的列
  useEffect(() => {
    if (spotlightLevel == null || viewW === 0) return
    const el = scrollRef.current
    if (!el) return
    const countEnd = today < to ? today : to
    const matchingCols: number[] = []
    const totalDays = diffDays(from, countEnd)
    for (let i = 0; i <= totalDays; i++) {
      const d = addDays(from, i)
      if (heatLevel(daily.get(d)?.total ?? 0) === spotlightLevel) {
        const col = Math.floor(diffDays(gridStart, d) / 7)
        if (matchingCols[matchingCols.length - 1] !== col) matchingCols.push(col)
      }
    }
    if (matchingCols.length === 0) return
    const lo = el.scrollLeft
    const hi = el.scrollLeft + el.clientWidth
    const anyVisible = matchingCols.some((c) => {
      const x = PAD + c * step
      return x + step - GAP > lo + 2 && x < hi - 2
    })
    if (!anyVisible) {
      const targetCol = matchingCols[matchingCols.length - 1]
      const targetLeft = Math.max(0, targetCol - Math.floor(visible / 2)) * step
      if (trackRef.current && step > 0) {
        trackRef.current.style.setProperty('--vis-c0', String(Math.round(targetLeft / step)))
      }
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      el.scrollTo({ left: targetLeft, behavior: reduced || skin === 'terminal' ? 'auto' : 'smooth' })
    }
  }, [spotlightLevel, viewW, from, to, today, daily, gridStart, step, visible, skin])

  const onScroll = () => {
    const el = scrollRef.current
    // 隐藏时宽度为 0，那时的清零不是用户滚的，不记
    if (el && el.clientWidth > 0 && saved.current) saved.current.left = el.scrollLeft
    if (tipDay) setTipDay(null)
    syncMonths()
  }

  const updateRovingStop = (nextDay: string) => {
    const track = trackRef.current
    if (!track) return
    const prevBtn = track.querySelector<HTMLButtonElement>(`.heat-day[data-day="${rovingDayRef.current}"]`)
    const nextBtn = track.querySelector<HTMLButtonElement>(`.heat-day[data-day="${nextDay}"]`)
    if (!nextBtn || nextBtn.disabled) return
    if (prevBtn && prevBtn !== nextBtn) prevBtn.tabIndex = -1
    nextBtn.tabIndex = 0
    rovingDayRef.current = nextDay

    // 若方向键移动到了可视区外的列，则平滑横向滚入视野
    const el = scrollRef.current
    const idx = diffDays(gridStart, nextDay)
    if (el && idx >= 0 && viewW > 0) {
      const col = Math.floor(idx / 7)
      const x = PAD + col * step
      const lo = el.scrollLeft
      const hi = lo + el.clientWidth
      if (x < lo + 2 || x + step - GAP > hi - 2) {
        const targetLeft = Math.max(0, col - Math.floor(visible / 2)) * step
        el.scrollLeft = targetLeft
        if (saved.current) saved.current.left = targetLeft
        syncMonths()
      }
    }
    nextBtn.focus({ preventScroll: true })
    activeCellRef.current = nextBtn
    setTipDay(nextDay)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = (e.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day
    if (!cur || activeMax < from) return
    let next: string | null = null
    if (e.key === 'ArrowLeft') next = addDays(cur, -7)
    else if (e.key === 'ArrowRight') next = addDays(cur, 7)
    else if (e.key === 'ArrowUp') next = addDays(cur, -1)
    else if (e.key === 'ArrowDown') next = addDays(cur, 1)
    else if (e.key === 'Home') next = from
    else if (e.key === 'End') next = activeMax
    if (!next) return

    e.preventDefault()
    if (next < from) next = from
    if (next > activeMax) next = activeMax
    if (next !== cur) updateRovingStop(next)
  }

  const onPointerOver = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>('.heat-day[data-day]')
    if (!cell || cell.disabled || !cell.dataset.day) return
    activeCellRef.current = cell
    setTipDay(cell.dataset.day)
  }

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>('.heat-day[data-day]')
    if (!cell || cell.disabled || !cell.dataset.day) return
    if (cell.matches?.(':focus-visible')) {
      activeCellRef.current = cell
      setTipDay(cell.dataset.day)
    }
  }

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setTipDay(null)
    }
  }

  const onClick = (e: MouseEvent) => {
    const cell = (e.target as HTMLElement).closest<HTMLButtonElement>('.heat-day[data-day]')
    const day = cell?.dataset.day
    if (!day || cell?.disabled) return
    if (rovingDayRef.current !== day) {
      const prevBtn = trackRef.current?.querySelector<HTMLButtonElement>(`.heat-day[data-day="${rovingDayRef.current}"]`)
      if (prevBtn) prevBtn.tabIndex = -1
      cell.tabIndex = 0
      rovingDayRef.current = day
    }
    setTipDay(null)
    onSelect(day)

    // 点按某天时，向周围 3 格半径内的邻格发射一圈轻量合成层波纹（零 React 重渲染）
    const track = trackRef.current
    if (!track || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const idx = diffDays(gridStart, day)
    if (idx < 0) return
    const tc = Math.floor(idx / 7)
    const tr = idx % 7
    const colNodes = track.children
    const minC = Math.max(0, tc - 3)
    const maxC = Math.min(cols - 1, tc + 3)
    for (let c = minC; c <= maxC; c++) {
      const colEl = colNodes[c] as HTMLElement | undefined
      if (!colEl) continue
      const minR = Math.max(0, tr - 3)
      const maxR = Math.min(6, tr + 3)
      for (let r = minR; r <= maxR; r++) {
        const dist = Math.hypot(c - tc, r - tr)
        if (dist === 0 || dist > 3.1) continue
        const nb = colEl.querySelector<HTMLButtonElement>(`.heat-day[data-r="${r}"]`)
        if (!nb || nb.disabled || typeof nb.animate !== 'function') continue
        if (skin === 'terminal') {
          nb.animate([{ opacity: 1 }, { opacity: 0.42 }, { opacity: 1 }], {
            duration: 160,
            delay: Math.round(dist * 28),
            easing: 'steps(2)',
          })
        } else {
          const peak = skin === 'brutal' ? (dist < 1.5 ? 1.18 : 1.09) : dist < 1.5 ? 1.14 : 1.07
          nb.animate(
            [
              { transform: 'scale(1)' },
              { transform: `scale(${peak})`, offset: 0.44 },
              { transform: 'scale(1)' },
            ],
            {
              duration: skin === 'brutal' ? 300 : 350,
              delay: Math.round(dist * 36),
              easing: skin === 'brutal' ? 'cubic-bezier(0.28, 1.48, 0.48, 1)' : 'cubic-bezier(0.22, 1, 0.36, 1)',
            },
          )
        }
      }
    }
  }

  const sel = selected && selected >= from && selected <= to ? diffDays(gridStart, selected) : -1

  // 在详情面板内前后翻天时，若选中的列超出了可视区则平滑跟随
  useEffect(() => {
    if (sel < 0 || viewW === 0) return
    const el = scrollRef.current
    if (!el) return
    const col = Math.floor(sel / 7)
    const x = PAD + col * step
    const lo = el.scrollLeft
    const hi = lo + el.clientWidth
    if (x < lo + 2 || x + step - GAP > hi - 2) {
      const targetLeft = Math.max(0, col - Math.floor(visible / 2)) * step
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      el.scrollTo({ left: targetLeft, behavior: reduced || skin === 'terminal' ? 'auto' : 'smooth' })
    }
  }, [sel, viewW, step, visible, skin])

  const tipInfo = useMemo(() => {
    if (!tipDay) return null
    const st = daily.get(tipDay)
    const total = st?.total ?? 0
    const lvl = heatLevel(total)
    const topColors = st
      ? Object.entries(st.bySubject)
          .filter(([, ms]) => ms > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([sid]) => getSubject(sid)?.color)
          .filter((c): c is string => !!c)
      : []
    return {
      dateLabel: shortDayLabel(tipDay),
      durLabel: total > 0 ? formatDuration(total) : '未学习',
      lvl,
      topColors,
    }
  }, [tipDay, daily])

  return (
    <div
      ref={heatRef}
      className="heat relative"
      style={{ '--cell': `${step - GAP}px`, '--step': `${step}px` } as CSSProperties}
      onPointerLeave={() => setTipDay(null)}
    >
      {/* 共享锚点碰撞感知悬浮预览气泡 */}
      <div
        ref={tipRef}
        className="heat-tooltip num"
        data-open={tipInfo ? '' : undefined}
        aria-hidden
      >
        {tipInfo && (
          <>
            <span className="heat-cell h-2.5 w-2.5 shrink-0" style={{ background: HEAT_VARS[tipInfo.lvl] }} />
            <span>{tipInfo.dateLabel}</span>
            <span className="heat-tip-sep">·</span>
            <span className="font-bold">{tipInfo.durLabel}</span>
            {tipInfo.topColors.length > 0 && (
              <span className="ml-0.5 inline-flex items-center gap-1">
                {tipInfo.topColors.map((c, idx) => (
                  <i key={idx} className="c dot !h-1.5 !w-1.5" style={tint(c)} />
                ))}
              </span>
            )}
            <span className="heat-tooltip-arrow" />
          </>
        )}
      </div>

      {/* 星期标签固定在左侧，不随横向滚动 */}
      <div className="heat-weekdays" aria-hidden>
        {WEEKDAY_LABELS.map(([row, label]) => (
          <span key={row} style={{ '--r': row } as CSSProperties}>
            {label}
          </span>
        ))}
      </div>
      <div ref={scrollRef} className="heat-scroll no-scrollbar" onScroll={onScroll}>
        <div
          ref={trackRef}
          role="grid"
          aria-label="每日学习热度网格（可用方向键切换日期）"
          className="heat-track"
          data-spot={spotlightLevel != null ? String(spotlightLevel) : undefined}
          onClick={onClick}
          onPointerOver={onPointerOver}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
        >
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
