import { motion } from 'framer-motion'
import { HOUR } from '../domain/aggregate'
import { formatHMS } from '../domain/format'

const SIZE = 264
const STROKE = 14
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R

/** 圆环每满一圈 = 1 小时 */
export function TimerRing({
  ms,
  color,
  running,
  label,
  sub,
}: {
  ms: number
  color: string
  running: boolean
  label: string
  sub: string
}) {
  const lap = Math.floor(ms / HOUR)
  const progress = (ms % HOUR) / HOUR
  const hms = formatHMS(ms)

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke="var(--card-2)" strokeWidth={STROKE} fill="none" />
        {lap > 0 && (
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={color} strokeOpacity={0.22} strokeWidth={STROKE} fill="none" />
        )}
        {/* 每过一小时换一个 key，避免进度从 100% 倒退回 0 的动画 */}
        <circle
          key={lap}
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - progress)}
          style={{ transition: running ? 'stroke-dashoffset 1s linear, stroke .4s' : 'stroke .4s' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-1 flex items-center gap-1.5 text-sm font-medium"
          style={{ color }}
        >
          {running && <span className="pulse-dot inline-block h-2 w-2 rounded-full" style={{ background: color }} />}
          {label}
        </motion.div>
        <div className="num text-[52px] font-semibold leading-none tracking-tight">{hms}</div>
        <div className="mt-2 text-xs text-muted">{sub}</div>
      </div>
    </div>
  )
}
