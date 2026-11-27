import { useEffect, useId, useMemo, useRef } from 'react'
import { partitionRingSpans, type DaySlice } from '../domain/aggregate'
import { addDays, formatClock, parseDay } from '../domain/dates'
import { formatDuration } from '../domain/format'
import { getSubject } from '../domain/subjects'
import { useMode, useSkin } from '../skin'
import { THEME_GREEN } from '../lib/color'
import { tint } from './ui'

const CX = 76
const CY = 76
const CARDINALS = [
  { deg: 0, label: '00' },
  { deg: 90, label: '06' },
  { deg: 180, label: '12' },
  { deg: 270, label: '18' },
] as const
const HOURS_24 = Array.from({ length: 24 }, (_, h) => h)
const DOTS_3H = [0, 3, 6, 9, 12, 15, 18, 21]

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number, minDeg = 2.0): string {
  const span = Math.min(359.8, Math.max(minDeg, endDeg - startDeg))
  const [x1, y1] = polar(cx, cy, r, startDeg)
  const [x2, y2] = polar(cx, cy, r, startDeg + span)
  const large = span > 180 ? 1 : 0
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

function sectorPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  startDeg: number,
  endDeg: number,
  minDeg = 0.35,
): string {
  const span = Math.min(359.8, Math.max(minDeg, endDeg - startDeg))
  const large = span > 180 ? 1 : 0
  const [ox1, oy1] = polar(cx, cy, rOuter, startDeg)
  const [ox2, oy2] = polar(cx, cy, rOuter, startDeg + span)
  const [ix2, iy2] = polar(cx, cy, rInner, startDeg + span)
  const [ix1, iy1] = polar(cx, cy, rInner, startDeg)
  return `M ${ox1.toFixed(2)} ${oy1.toFixed(2)} A ${rOuter} ${rOuter} 0 ${large} 1 ${ox2.toFixed(2)} ${oy2.toFixed(2)} L ${ix2.toFixed(2)} ${iy2.toFixed(2)} A ${rInner} ${rInner} 0 ${large} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)} Z`
}

function nextShortestAngle(prev: number | null, targetDeg: number): number {
  if (prev === null) return targetDeg
  const delta = (((targetDeg - (prev % 360)) + 540) % 360) - 180
  return prev + delta
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

function readDimOpacity(): number {
  if (typeof document !== 'undefined' && document.documentElement.dataset.mode === 'dark') return 0.72
  return 0.56
}

/** 00:00–24:00 三皮肤专属圆环时间轴：上方居中大圆环 + 底部详情与逐段切换，零滚动跳动 */
export function DayTimelineRing({
  day,
  slices,
  selectedKey,
  onSelectKey,
}: {
  day: string
  slices: DaySlice[]
  selectedKey: string | null
  onSelectKey: (key: string | null) => void
}) {
  const skin = useSkin()
  useMode() // 明暗切换时触发重渲染，保证对比度令牌同步
  const gradId = useId()
  const dialRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const sweepRef = useRef<SVGGElement>(null)
  const sideRef = useRef<HTMLDivElement>(null)
  const pointerAngleRef = useRef<number | null>(null)
  const mountedKeyRef = useRef<string | null>(null)

  const dimOp = readDimOpacity()
  const dayEndTs = useMemo(() => parseDay(addDays(day, 1)).getTime(), [day])
  const fmtEnd = (ts: number) => (ts >= dayEndTs ? '24:00' : formatClock(ts))

  const selectedIndex = slices.findIndex((s) => s.key === selectedKey)
  const selectedSlice = selectedIndex >= 0 ? slices[selectedIndex] : null
  const selSub = selectedSlice ? getSubject(selectedSlice.subjectId) : undefined
  const selColor = selSub?.color ?? THEME_GREEN

  // 切换日期或皮肤时重置最短角缓存，避免跨天跳转
  const resetKey = `${day}|${skin}`
  const prevResetRef = useRef(resetKey)
  if (prevResetRef.current !== resetKey) {
    prevResetRef.current = resetKey
    pointerAngleRef.current = null
  }

  let targetAngle = pointerAngleRef.current ?? 0
  if (selectedSlice) {
    const midDeg = ((selectedSlice.startFrac + selectedSlice.endFrac) / 2) * 360
    targetAngle = nextShortestAngle(pointerAngleRef.current, midDeg)
    pointerAngleRef.current = targetAngle
  }

  const { studySpans, restSpans } = useMemo(
    () => (skin === 'brutal' ? partitionRingSpans(slices, 3.4) : { studySpans: [], restSpans: [] }),
    [skin, slices],
  )

  // 右侧空白区汇总：首末跨度 + 四时段分布 + 涉及科目
  const summary = useMemo(() => {
    const first = slices[0]
    const last = slices[slices.length - 1]
    const spanText = first && last ? `${formatClock(first.start)} – ${fmtEnd(last.end)}` : '—'

    const buckets = [
      { label: '凌晨', from: 0, to: 0.25, ms: 0 },
      { label: '上午', from: 0.25, to: 0.5, ms: 0 },
      { label: '下午', from: 0.5, to: 0.75, ms: 0 },
      { label: '晚上', from: 0.75, to: 1, ms: 0 },
    ]
    const dayMs = 86400000
    for (const sl of slices) {
      for (const b of buckets) {
        const s = Math.max(sl.startFrac, b.from)
        const e = Math.min(sl.endFrac, b.to)
        if (e > s) b.ms += (e - s) * dayMs
      }
    }
    const nonZero = buckets.filter((b) => b.ms >= 60000)
    const shownBuckets = (nonZero.length > 0 ? nonZero : buckets.filter((b) => b.ms > 0)).slice(0, 2)
    const periodText = shownBuckets.map((b) => `${b.label} ${formatDuration(b.ms)}`).join(' · ')

    const seenSub = new Set<string>()
    const subjects: Array<{ id: string; short: string; color: string }> = []
    for (const sl of slices) {
      if (seenSub.has(sl.subjectId)) continue
      seenSub.add(sl.subjectId)
      const sub = getSubject(sl.subjectId)
      subjects.push({ id: sl.subjectId, short: sub?.short ?? sl.subjectId, color: sub?.color ?? THEME_GREEN })
      if (subjects.length >= 4) break
    }
    return { spanText, periodText, subjects }
  }, [slices, dayEndTs])

  // 入场动画：按皮肤区分
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || typeof svg.animate !== 'function' || prefersReducedMotion()) return

    const handles: Animation[] = []
    const track = (anim: Animation | undefined) => {
      if (anim) handles.push(anim)
      return anim
    }

    if (skin === 'paper') {
      const arcs = svg.querySelectorAll<SVGPathElement>('[data-paper-arc]')
      arcs.forEach((arc, i) => {
        const targetOp = arc.dataset.targetOp ?? '1'
        arc.style.strokeDasharray = '1'
        const anim = track(
          arc.animate(
            [
              { strokeDashoffset: 1, opacity: 0.2 },
              { strokeDashoffset: 0, opacity: Number(targetOp) },
            ],
            { delay: 40 + i * 45, duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
          ),
        )
        if (anim) {
          anim.onfinish = () => {
            arc.style.strokeDasharray = ''
            arc.style.opacity = targetOp
            anim.cancel()
          }
        }
      })
    } else if (skin === 'terminal') {
      const sweep = sweepRef.current
      if (sweep) {
        const swAnim = track(
          sweep.animate(
            [
              { opacity: 0.95, transform: 'rotate(0deg)' },
              { opacity: 0.95, transform: 'rotate(360deg)', offset: 0.88 },
              { opacity: 0, transform: 'rotate(360deg)' },
            ],
            { duration: 720, easing: 'linear' },
          ),
        )
        if (swAnim) {
          swAnim.onfinish = () => {
            sweep.style.opacity = '0'
            swAnim.cancel()
          }
        }
      }
      const arcs = svg.querySelectorAll<SVGPathElement>('[data-term-arc]')
      arcs.forEach((arc) => {
        const targetOp = arc.dataset.targetOp ?? '1'
        const baseW = arc.getAttribute('stroke-width') ?? '10'
        const frac = Number(arc.dataset.startFrac ?? '0')
        const anim = track(
          arc.animate(
            [
              { opacity: 0, strokeWidth: `${Number(baseW) + 3.2}px` },
              { opacity: 1, strokeWidth: `${Number(baseW) + 2}px`, offset: 0.35 },
              { opacity: Number(targetOp), strokeWidth: `${baseW}px` },
            ],
            { delay: frac * 620, duration: 220, easing: 'steps(4, end)', fill: 'both' },
          ),
        )
        if (anim) {
          anim.onfinish = () => {
            arc.style.opacity = targetOp
            anim.cancel()
          }
        }
      })
    } else {
      if (dialRef.current && typeof dialRef.current.animate === 'function') {
        track(
          dialRef.current.animate(
            [
              { opacity: 0, transform: 'translate(4px, 5px) scale(0.92)' },
              { opacity: 1, transform: 'translate(0, 0) scale(1)' },
            ],
            { duration: 260, easing: 'cubic-bezier(0.3, 1.5, 0.5, 1)' },
          ),
        )
      }
      svg.querySelectorAll<SVGPathElement>('.day-ring-rest').forEach((rp, idx) => {
        const anim = track(
          rp.animate(
            [
              { opacity: 0, transform: 'scale(0.86)' },
              { opacity: 1, transform: 'scale(1)' },
            ],
            { delay: 20 + idx * 18, duration: 280, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)', fill: 'both' },
          ),
        )
        if (anim) anim.onfinish = () => anim.cancel()
      })
      svg.querySelectorAll<SVGGElement>('[data-brutal-wedge]').forEach((g, idx) => {
        const targetTf = g.dataset.targetTf ?? 'translate(0px, 0px)'
        const targetOp = g.dataset.targetOp ?? '1'
        const anim = track(
          g.animate(
            [
              { opacity: 0, transform: 'scale(0.7)' },
              { opacity: Number(targetOp), transform: targetTf },
            ],
            { delay: 65 + idx * 32, duration: 320, easing: 'cubic-bezier(0.34, 1.65, 0.64, 1)', fill: 'both' },
          ),
        )
        if (anim) {
          anim.onfinish = () => {
            g.style.opacity = targetOp
            g.style.transform = targetTf
            anim.cancel()
          }
        }
      })
    }

    return () => {
      for (const a of handles) {
        try {
          a.cancel()
        } catch {
          /* ignore */
        }
      }
    }
  }, [day, skin])

  // 选中切换动效：右侧详情浮现 / 扫描打印 / 终端弧段闪烁
  useEffect(() => {
    const curMount = `${day}|${skin}`
    if (mountedKeyRef.current !== curMount) {
      mountedKeyRef.current = curMount
      return
    }
    const side = sideRef.current
    if (!side || typeof side.animate !== 'function' || prefersReducedMotion()) return

    const handles: Animation[] = []
    if (skin === 'terminal') {
      handles.push(
        side.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], {
          duration: 180,
          easing: 'steps(6, end)',
        }),
      )
      if (selectedKey && svgRef.current) {
        const activeArc = svgRef.current.querySelector<SVGPathElement>(`[data-term-arc="${CSS.escape(selectedKey)}"]`)
        if (activeArc && typeof activeArc.animate === 'function') {
          handles.push(
            activeArc.animate(
              [
                { opacity: 0.55, strokeWidth: '15.2px' },
                { opacity: 1, strokeWidth: '12.8px' },
              ],
              {
                duration: 180,
                easing: 'steps(3)',
              },
            ),
          )
        }
      }
    } else if (skin === 'brutal') {
      handles.push(
        side.animate(
          [
            { opacity: 0.4, transform: 'translateX(6px) scale(0.97)' },
            { opacity: 1, transform: 'translateX(0) scale(1)' },
          ],
          { duration: 220, easing: 'cubic-bezier(0.3, 1.6, 0.5, 1)' },
        ),
      )
    } else {
      handles.push(
        side.animate(
          [
            { opacity: 0, transform: 'translateY(4px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 220, easing: 'cubic-bezier(0.2, 0.6, 0.2, 1)' },
        ),
      )
    }

    return () => {
      for (const a of handles) {
        try {
          a.cancel()
        } catch {
          /* ignore */
        }
      }
    }
  }, [selectedKey, day, skin])

  const stepSlice = (dir: -1 | 1) => {
    if (slices.length === 0) return
    if (selectedIndex < 0) {
      onSelectKey(dir > 0 ? slices[0].key : slices[slices.length - 1].key)
      return
    }
    const nextIdx = (selectedIndex + dir + slices.length) % slices.length
    onSelectKey(slices[nextIdx].key)
  }

  const [sx1, sy1] = polar(CX, CY, 61.5, -45)
  const [sx2, sy2] = polar(CX, CY, 61.5, 0)
  const sweepPath = `M ${CX} ${CY} L ${sx1.toFixed(1)} ${sy1.toFixed(1)} A 61.5 61.5 0 0 1 ${sx2.toFixed(1)} ${sy2.toFixed(1)} Z`

  const stepLabel =
    skin === 'terminal'
      ? `${selectedIndex >= 0 ? String(selectedIndex + 1).padStart(2, '0') : '--'}/${String(slices.length).padStart(2, '0')}`
      : selectedIndex >= 0
        ? `${selectedIndex + 1}/${slices.length}`
        : `${slices.length}段`

  return (
    <div className="day-ring day-ring-box px-3.5 pt-3 pb-3" onClick={() => onSelectKey(null)}>
      {skin === 'terminal' && <span className="day-ring-legend">24h_TIMELINE</span>}

      {/* 上方居中大圆环（圆心保持留白） */}
      <div className="flex justify-center pb-1.5">
        <div ref={dialRef} className="relative h-[212px] w-[212px] shrink-0">
          <svg ref={svgRef} viewBox="0 0 152 152" className="h-full w-full overflow-visible" aria-label="00:00至24:00学习时间圆环">
            {skin === 'paper' && (
              <>
                <circle cx={CX} cy={CY} r={54} fill="none" stroke="var(--surface-3)" strokeWidth={13.5} />
                <circle cx={CX} cy={CY} r={43} fill="none" stroke="var(--line)" strokeWidth={0.75} />
                {DOTS_3H.map((h) => {
                  const [x, y] = polar(CX, CY, 43, h * 15)
                  return <circle key={h} cx={x} cy={y} r={h % 6 === 0 ? 1.3 : 0.75} fill="var(--faint)" />
                })}
                {CARDINALS.map((c) => {
                  const [x, y] = polar(CX, CY, 69.5, c.deg)
                  return (
                    <text
                      key={c.label}
                      x={x}
                      y={y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={9.2}
                      fill="var(--faint)"
                      className="num"
                    >
                      {c.label}
                    </text>
                  )
                })}
                <path
                  className={`day-ring-halo ${selSub ? 'c' : ''}`}
                  style={selSub ? tint(selSub.color) : undefined}
                  d={selectedSlice ? arcPath(CX, CY, 54, selectedSlice.startFrac * 360, selectedSlice.endFrac * 360, 2.0) : ''}
                  fill="none"
                  stroke="var(--c-ring, var(--accent))"
                  strokeWidth={22}
                  strokeLinecap="round"
                  opacity={selectedSlice ? 0.24 : 0}
                  pointerEvents="none"
                />
                {slices.map((s) => {
                  const sub = getSubject(s.subjectId)
                  const d = arcPath(CX, CY, 54, s.startFrac * 360, s.endFrac * 360, 2.0)
                  const isSel = selectedSlice?.key === s.key
                  const op = selectedSlice ? (isSel ? 1 : dimOp) : 1
                  return (
                    <g key={s.key} className="c" style={tint(sub?.color ?? THEME_GREEN)}>
                      <path
                        data-paper-arc={s.key}
                        data-target-op={op}
                        className="day-ring-paper-arc"
                        d={d}
                        pathLength={1}
                        fill="none"
                        stroke="var(--c-ring)"
                        strokeWidth={isSel ? 16.5 : 13.5}
                        strokeLinecap="butt"
                        opacity={op}
                        pointerEvents="none"
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={26}
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectKey(selectedKey === s.key ? null : s.key)
                        }}
                      />
                    </g>
                  )
                })}
                <g
                  className={`day-ring-bead ${selSub ? 'c' : ''}`}
                  style={{
                    ...(selSub ? tint(selSub.color) : undefined),
                    opacity: selectedSlice ? 1 : 0,
                    transform: `rotate(${targetAngle.toFixed(1)}deg)`,
                  }}
                  pointerEvents="none"
                >
                  <circle cx={CX} cy={CY - 43} r={3.1} fill="var(--c-ring, var(--accent))" stroke="var(--surface-2)" strokeWidth={1.35} />
                </g>
              </>
            )}

            {skin === 'terminal' && (
              <>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.3} />
                  </linearGradient>
                </defs>
                <line x1={CX} y1={16} x2={CX} y2={136} stroke="var(--line)" strokeWidth={0.8} strokeDasharray="2 3" />
                <line x1={16} y1={CY} x2={136} y2={CY} stroke="var(--line)" strokeWidth={0.8} strokeDasharray="2 3" />
                <circle cx={CX} cy={CY} r={61.5} fill="none" stroke="var(--line)" strokeWidth={0.8} strokeDasharray="2 3.5" />
                <circle cx={CX} cy={CY} r={44.5} fill="none" stroke="var(--border)" strokeWidth={1} />
                <circle cx={CX} cy={CY} r={2.4} fill="var(--muted)" />
                {HOURS_24.map((h) => {
                  const deg = h * 15
                  const major = h % 6 === 0
                  const mid = h % 3 === 0
                  const [x1, y1] = polar(CX, CY, 44.5 - (major ? 4.8 : mid ? 3.0 : 1.7), deg)
                  const [x2, y2] = polar(CX, CY, 44.5 + (major ? 1.4 : 0), deg)
                  return (
                    <line
                      key={h}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      stroke={major ? 'var(--muted)' : 'var(--faint)'}
                      strokeWidth={major ? 1.2 : 0.75}
                    />
                  )
                })}
                {CARDINALS.map((c) => {
                  const [x, y] = polar(CX, CY, 70, c.deg)
                  return (
                    <text
                      key={c.label}
                      x={x}
                      y={y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={9}
                      fontWeight={700}
                      fill="var(--muted)"
                      className="num"
                    >
                      {c.label}
                    </text>
                  )
                })}
                {slices.map((s) => {
                  const sub = getSubject(s.subjectId)
                  const d = arcPath(CX, CY, 53.5, s.startFrac * 360, s.endFrac * 360, 2.0)
                  const isSel = selectedSlice?.key === s.key
                  const op = selectedSlice ? (isSel ? 1 : dimOp) : 1
                  return (
                    <g key={s.key} className="c" style={tint(sub?.color ?? THEME_GREEN)}>
                      <path
                        data-term-arc={s.key}
                        data-start-frac={s.startFrac}
                        data-target-op={op}
                        className="day-ring-term-arc"
                        d={d}
                        fill="none"
                        stroke="var(--c-ring)"
                        strokeWidth={isSel ? 12.8 : 10}
                        strokeLinecap="butt"
                        opacity={op}
                        pointerEvents="none"
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={26}
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectKey(selectedKey === s.key ? null : s.key)
                        }}
                      />
                    </g>
                  )
                })}
                <g ref={sweepRef} className="day-ring-sweep" style={{ opacity: 0 }} pointerEvents="none">
                  <path d={sweepPath} fill={`url(#${gradId})`} />
                  <line x1={CX} y1={CY} x2={CX} y2={14.5} stroke="var(--accent)" strokeWidth={1.5} />
                </g>
                <g
                  className={`day-ring-pointer ${selSub ? 'c' : ''}`}
                  style={{
                    ...(selSub ? tint(selSub.color) : undefined),
                    opacity: selectedSlice ? 1 : 0,
                    transform: `rotate(${targetAngle.toFixed(1)}deg)`,
                  }}
                  pointerEvents="none"
                >
                  <line x1={CX} y1={CY} x2={CX} y2={17} stroke="var(--c-ring, var(--accent))" strokeWidth={1.35} strokeDasharray="2 2" />
                  <circle cx={CX} cy={CY} r={2.6} fill="var(--c-ring, var(--accent))" />
                  <circle cx={CX} cy={14.5} r={2.3} fill="var(--c-ring, var(--accent))" />
                </g>
              </>
            )}

            {skin === 'brutal' && (
              <>
                {CARDINALS.map((c) => {
                  const [x, y] = polar(CX, CY, 71.5, c.deg)
                  return (
                    <text
                      key={c.label}
                      x={x}
                      y={y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={9.5}
                      fontWeight={800}
                      fill="var(--text)"
                      className="num"
                    >
                      {c.label}
                    </text>
                  )
                })}
                {restSpans.map((r, idx) => (
                  <path
                    key={`rest-${idx}`}
                    className="day-ring-rest"
                    d={sectorPath(CX, CY, 42.5, 57.5, r.startDeg, r.endDeg, 0.35)}
                    fill="var(--surface-3)"
                    stroke="var(--border)"
                    strokeWidth={1.75}
                    strokeLinejoin="round"
                  />
                ))}
                {studySpans.map((sp) => {
                  const s = sp.slice
                  const sub = getSubject(s.subjectId)
                  const isSel = selectedSlice?.key === s.key
                  const midDeg = (sp.vStart + sp.vEnd) / 2
                  const midRad = ((midDeg - 90) * Math.PI) / 180
                  const tf = isSel
                    ? `translate(${(Math.cos(midRad) * 7).toFixed(1)}px, ${(Math.sin(midRad) * 7).toFixed(1)}px)`
                    : 'translate(0px, 0px)'
                  const op = selectedSlice ? (isSel ? 1 : dimOp) : 1
                  const sectorD = sectorPath(CX, CY, 42.5, 57.5, sp.vStart, sp.vEnd, 0.35)
                  const hitD = arcPath(CX, CY, 50, sp.vStart, sp.vEnd, 3.4)
                  return (
                    <g
                      key={s.key}
                      data-brutal-wedge={s.key}
                      data-target-tf={tf}
                      data-target-op={op}
                      className="day-ring-wedge c cursor-pointer"
                      style={{ ...tint(sub?.color ?? THEME_GREEN), transform: tf, opacity: op }}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectKey(selectedKey === s.key ? null : s.key)
                      }}
                    >
                      <path
                        d={sectorD}
                        fill="var(--c-ring)"
                        stroke="var(--border)"
                        strokeWidth={isSel ? 2.1 : 1.75}
                        strokeLinejoin="round"
                      />
                      <path d={hitD} fill="none" stroke="transparent" strokeWidth={26} />
                    </g>
                  )
                })}
              </>
            )}
          </svg>
        </div>
      </div>

      {/* 底部横向详情栏 + 逐段切换（圆环中心不放任何文字） */}
      <div className="mt-1 flex items-center justify-between gap-2.5 border-t pt-2.5" style={{ borderColor: 'var(--line)' }}>
        <div ref={sideRef} className="min-w-0 flex-1">
          {selectedSlice ? (
            skin === 'terminal' ? (
              <div className="c" style={tint(selColor)}>
                <div className="flex items-center gap-1.5 text-sm font-bold">
                  <span className="truncate" style={{ color: 'var(--c-ring)' }}>
                    &gt; {selSub?.name ?? selectedSlice.subjectId}
                  </span>
                  {selectedSlice.isLive && <span className="shrink-0 text-[10px] text-accent">[LIVE]</span>}
                  <span className="num shrink-0 text-xs font-bold">
                    [{formatDuration(selectedSlice.durationMs)}]
                    <span className="day-ring-cursor" />
                  </span>
                </div>
                <div className="num mt-0.5 flex items-center gap-2 text-xs text-muted">
                  <span>
                    $ {formatClock(selectedSlice.start)} - {fmtEnd(selectedSlice.end)}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-[11px] text-accent"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectKey(null)
                    }}
                  >
                    [ESC]
                  </button>
                </div>
              </div>
            ) : skin === 'brutal' ? (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="day-ring-chip c" style={tint(selColor)}>
                    {selSub?.name ?? selectedSlice.subjectId}
                    {selectedSlice.isLive ? ' · 计时中' : ''}
                  </span>
                  <span className="num text-base font-extrabold leading-none">{formatDuration(selectedSlice.durationMs)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="num font-bold text-muted">
                    {formatClock(selectedSlice.start)} – {fmtEnd(selectedSlice.end)}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-muted"
                    style={{ border: '1px solid var(--line)' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectKey(null)
                    }}
                  >
                    闭合
                  </button>
                </div>
              </div>
            ) : (
              <div className="c" style={tint(selColor)}>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: 'var(--c-ring)' }} />
                  <span className="truncate text-sm font-semibold">{selSub?.name ?? selectedSlice.subjectId}</span>
                  {selectedSlice.isLive && (
                    <span className="shrink-0 rounded px-1 py-0.5 text-[10px] text-accent" style={{ background: 'var(--accent-soft)' }}>
                      计时中
                    </span>
                  )}
                  <span className="num ml-1 shrink-0 text-[15px] font-semibold leading-none">
                    {formatDuration(selectedSlice.durationMs)}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span className="num text-muted">
                    {formatClock(selectedSlice.start)} – {fmtEnd(selectedSlice.end)}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 text-[11px] text-accent"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectKey(null)
                    }}
                  >
                    收起
                  </button>
                </div>
              </div>
            )
          ) : skin === 'terminal' ? (
            <div>
              <div className="num flex items-center gap-1.5 text-sm font-bold">
                <span>$ {summary.spanText}</span>
                <span className="day-ring-cursor" />
              </div>
              <div className="mt-0.5 truncate text-[11px] text-faint">
                {summary.periodText || `${slices.length} segments`}
              </div>
            </div>
          ) : skin === 'brutal' ? (
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="day-ring-badge">全天 {slices.length} 段</span>
                <span className="num text-xs font-extrabold">{summary.spanText}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-semibold text-muted">
                {summary.subjects.map((sub) => (
                  <span key={sub.id} className="c inline-flex items-center gap-1" style={tint(sub.color)}>
                    <i
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: 'var(--c-ring)', border: '1px solid var(--border)' }}
                    />
                    {sub.short}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="num text-sm font-semibold">{summary.spanText}</span>
              </div>
              <div className="num mt-0.5 truncate text-[11px] text-faint">
                {summary.periodText || `共 ${slices.length} 段学习记录`}
              </div>
            </div>
          )}
        </div>

        {/* 逐段微调切段器：方便手机精准选中极短学习时段 */}
        {slices.length > 0 && (
          <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="day-ring-step"
              aria-label="上一段学习"
              title="上一段"
              onClick={() => stepSlice(-1)}
            >
              {skin === 'terminal' ? '<' : '‹'}
            </button>
            <span className="num min-w-[30px] text-center text-[11px] text-muted">{stepLabel}</span>
            <button
              type="button"
              className="day-ring-step"
              aria-label="下一段学习"
              title="下一段"
              onClick={() => stepSlice(1)}
            >
              {skin === 'terminal' ? '>' : '›'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
