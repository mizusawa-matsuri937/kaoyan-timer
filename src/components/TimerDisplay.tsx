import { memo } from 'react'
import { HOUR } from '../domain/aggregate'
import { formatHMS } from '../domain/format'
import type { SkinId } from '../skin'

const SEGS = 30 // 一行 30 格 = 1 小时，每格 2 分钟

const cells = (s: string) =>
  [...s].map((ch, i) => (
    <span key={i} className={ch === ':' ? 'd-sep' : 'd'}>
      {ch}
    </span>
  ))

/** 时分 + 弱化的秒；逐字符定宽，跳秒不位移 */
function Digits({ ms }: { ms: number }) {
  const hms = formatHMS(ms)
  const cut = hms.length - 3
  return (
    <div className="timer-digits" role="timer">
      {cells(hms.slice(0, cut))}
      <span className="sec">{cells(hms.slice(cut))}</span>
    </div>
  )
}

/** 终端风格的分格进度条：每 2 分钟才变一次，单独 memo，避免每秒重排 30 个节点 */
const SegBar = memo(function SegBar({ on, showNow }: { on: number; showNow: boolean }) {
  return (
    <div className="segbar" aria-hidden>
      {Array.from({ length: SEGS }, (_, i) => (
        <i key={i} data-on={i < on ? '' : undefined} data-now={showNow && i === on ? '' : undefined} />
      ))}
    </div>
  )
})

const R = 88
const CIRC = 2 * Math.PI * R
const RING: Record<Exclude<SkinId, 'terminal'>, { width: number; edge: boolean }> = {
  brutal: { width: 15, edge: true },
  paper: { width: 3, edge: false },
}

/**
 * 计时主体，形态跟随皮肤：
 * 终端极客 = 大数字 + 分格进度条；新粗野 / 纸感文艺 = 圆环。每满一行 / 一圈 = 1 小时。
 */
export function TimerDisplay({ ms, active, skin }: { ms: number; active: boolean; skin: SkinId }) {
  const lap = Math.floor(ms / HOUR)
  const progress = (ms % HOUR) / HOUR

  if (skin === 'terminal') {
    return (
      <>
        <Digits ms={ms} />
        <SegBar on={Math.floor(progress * SEGS)} showNow={active} />
        <div className="timer-caption">
          <span className="num">{active ? `第 ${lap + 1} 小时 · ${Math.floor(progress * 100)}%` : '每满一行 = 1 小时'}</span>
          <span>每格 2 分钟</span>
        </div>
      </>
    )
  }

  const { width, edge } = RING[skin]
  // svg 整体旋转 -90°，所以 0° 在顶部
  const theta = progress * 2 * Math.PI
  return (
    <div className="dial">
      <svg viewBox="0 0 200 200" aria-hidden>
        <circle className="dial-track" cx={100} cy={100} r={R} strokeWidth={width} />
        {lap > 0 && <circle className="dial-lap" cx={100} cy={100} r={R} strokeWidth={width} />}
        {active && progress > 0 && (
          <circle
            className="dial-arc"
            cx={100}
            cy={100}
            r={R}
            strokeWidth={width}
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - progress)}
          />
        )}
        {edge ? (
          <>
            <circle className="dial-edge" cx={100} cy={100} r={R + width / 2} />
            <circle className="dial-edge" cx={100} cy={100} r={R - width / 2} />
          </>
        ) : (
          active && <circle className="dial-tip" cx={100 + R * Math.cos(theta)} cy={100 + R * Math.sin(theta)} r={4.5} />
        )}
      </svg>
      <div className="dial-center">
        <Digits ms={ms} />
        <div className="timer-caption">
          <span className="num">{active ? `第 ${lap + 1} 小时` : '每圈 1 小时'}</span>
        </div>
      </div>
    </div>
  )
}
