import { motion } from 'framer-motion'
import { useId } from 'react'
import { HOUR } from '../domain/aggregate'
import { formatHMS } from '../domain/format'
import { alpha, darken, lighten } from '../lib/color'

const SIZE = 272
const STROKE = 16
const PAD = 14 // 给外发光留出空间
const BOX = SIZE + PAD * 2
const C0 = BOX / 2
const R = (SIZE - STROKE) / 2
const CIRC = 2 * Math.PI * R

/**
 * 极简流体计时环：无刻度，靠渐变流光与多层光晕。每满一圈 = 1 小时。
 */
export function TimerRing({
  ms,
  color,
  running,
  active,
  label,
  sub,
}: {
  ms: number
  color: string
  running: boolean
  active: boolean
  label: string
  sub: string
}) {
  const uid = useId().replace(/:/g, '')
  const lap = Math.floor(ms / HOUR)
  const progress = (ms % HOUR) / HOUR
  const offset = CIRC * (1 - progress)
  const hms = formatHMS(ms)

  // 进度弧终点（svg 整体旋转 -90°，所以 0° 在顶部）
  const theta = progress * 2 * Math.PI
  const tipX = C0 + R * Math.cos(theta)
  const tipY = C0 + R * Math.sin(theta)
  const showTip = active && (progress > 0 || running)

  const hi = lighten(color, 0.45)
  const deep = darken(color, 0.12)

  return (
    <div className="relative mx-auto" style={{ width: BOX, height: BOX }}>
      <svg width={BOX} height={BOX} className="-rotate-90 overflow-visible">
        <defs>
          <linearGradient id={`arc-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={hi} />
            <stop offset="45%" stopColor={color} />
            <stop offset="100%" stopColor={deep} />
          </linearGradient>
          <filter id={`glow-${uid}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id={`tip-${uid}`} x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        {/* 1. 底层轨道：凹陷感 */}
        <circle cx={C0} cy={C0} r={R} stroke="var(--ring-track)" strokeWidth={STROKE} fill="none" />
        <circle cx={C0} cy={C0} r={R + STROKE / 2 - 0.5} stroke="var(--ring-track-edge)" strokeWidth={1} fill="none" />
        {lap > 0 && <circle cx={C0} cy={C0} r={R} stroke={color} strokeOpacity={0.16} strokeWidth={STROKE} fill="none" />}

        {/* 2. 外发光层 */}
        {active && progress > 0 && (
          <circle
            key={`g${lap}`}
            cx={C0}
            cy={C0}
            r={R}
            stroke={color}
            strokeOpacity={running ? 0.75 : 0.35}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            filter={`url(#glow-${uid})`}
            style={{ transition: 'stroke .5s, stroke-opacity .5s' }}
          />
        )}

        {/* 3. 渐变流光主进度弧（每小时换 key，避免从 100% 倒退到 0 的动画） */}
        <circle
          key={lap}
          cx={C0}
          cy={C0}
          r={R}
          stroke={`url(#arc-${uid})`}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={CIRC}
          strokeDashoffset={active ? offset : CIRC}
          style={{ transition: running ? 'stroke-dashoffset 1s linear' : 'stroke-dashoffset .4s ease' }}
        />

        {/* 4. 发光前缘游标 */}
        {showTip && (
          <g style={{ transition: 'opacity .3s' }}>
            <circle cx={tipX} cy={tipY} r={STROKE / 2 + 5} fill={color} opacity={running ? 0.85 : 0.45} filter={`url(#tip-${uid})`} />
            <circle cx={tipX} cy={tipY} r={STROKE / 2 - 1} fill={lighten(color, 0.55)} />
            <circle cx={tipX} cy={tipY} r={STROKE / 4} fill="#fff" />
          </g>
        )}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', damping: 22, stiffness: 320 }}
          className="mb-2.5 flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-semibold"
          style={{
            color,
            background: alpha(color, 0.12),
            border: `1px solid ${alpha(color, 0.22)}`,
            boxShadow: running ? `0 0 18px ${alpha(color, 0.3)}` : undefined,
          }}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${running ? 'pulse-dot' : ''}`}
            style={{ background: color, boxShadow: `0 0 6px ${color}` }}
          />
          {label}
        </motion.div>
        <div
          className="num text-[54px] leading-none font-bold tracking-tight"
          style={{ textShadow: running ? `0 0 28px ${alpha(color, 0.35)}` : 'none', transition: 'text-shadow .6s' }}
        >
          {hms}
        </div>
        <div className="mt-2.5 text-xs font-medium text-muted">{sub}</div>
      </div>
    </div>
  )
}
