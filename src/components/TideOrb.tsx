import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { HOUR } from '../domain/aggregate'
import { useMode, useSkin } from '../skin'

const HEAT_VAR_NAMES = ['--h0', '--h1', '--h2', '--h3', '--h4'] as const
const TERM_CELLS = 20 // 2 行 × 10 列 = 20 格，每格代表 5%

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function contrastColor(hex: string): string {
  const m = hex.trim().match(/^#([0-9a-f]{6})$/i)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.62 ? '#111111' : '#ffffff'
}

/**
 * 终端极客专属：TUI 2×10 LED 像素矩阵仪表（替代液体球，完全契合极客等宽界面）：
 * - 上行清晰显示无裁切的等宽百分比与模式标（TIER / 10H）；
 * - 下行 20 格分块矩阵以当前热度色点亮，计时中前沿格像终端光标一样呼吸闪烁；
 * - 点击切换「当前热度档进度」与「今日 10h 满格进度」，触发左至右分步扫描刷新。
 */
function TerminalMatrixGauge({
  ratio,
  level,
  running,
  fullDayMode,
  scanKey,
  onToggle,
}: {
  ratio: number
  level: 0 | 1 | 2 | 3 | 4
  running: boolean
  fullDayMode: boolean
  scanKey: number
  onToggle: () => void
}) {
  const pct = Math.round(ratio * 100)
  const lit = Math.min(TERM_CELLS, Math.round(ratio * TERM_CELLS))
  const fillVar = level === 0 ? 'var(--accent)' : `var(${HEAT_VAR_NAMES[level]})`
  const titleText = fullDayMode
    ? `今日满格（10h）进度 ${pct}%，点击切回当前档位进度`
    : `当前热度档进度 ${pct}%，点击切换查看 10h 满格进度`

  return (
    <button
      type="button"
      className="term-gauge"
      data-running={running ? '' : undefined}
      title={titleText}
      aria-label={titleText}
      style={{ '--tg-color': fillVar } as CSSProperties}
      onClick={onToggle}
    >
      <div className="term-gauge-top num">
        <span className="term-gauge-pct">{pct}%</span>
        <span className="term-gauge-tag">{fullDayMode ? '10H' : 'TIER'}</span>
      </div>
      <div key={scanKey} className="term-gauge-grid" aria-hidden>
        {Array.from({ length: TERM_CELLS }, (_, i) => {
          const isLit = i < lit
          const isHead = running && i === Math.min(TERM_CELLS - 1, lit) && pct < 100
          return (
            <i
              key={i}
              data-on={isLit ? '' : undefined}
              data-head={isHead ? '' : undefined}
              style={{ '--ci': i } as CSSProperties}
            />
          )
        })}
      </div>
    </button>
  )
}

/**
 * 今日已学蓄能组件（按皮肤自适应形态）：
 * - 纸感文艺 / 新粗野：潮汐液态蓄能球（参考 UI Moments Tide Progress），弹簧波浪 + 液面反色切割；
 * - 终端极客：TUI 2×10 像素矩阵仪表（无违和液体，清晰等宽百分比 + 光标脉冲格栅）；
 * - 点击均可在「当前热度档进度」与「今日 10h 满格进度」间切换。
 */
export const TideOrb = memo(function TideOrb({
  tierPct,
  todayMs,
  level,
  running,
  impulseKey = 0,
  size = 54,
}: {
  tierPct: number
  todayMs: number
  level: 0 | 1 | 2 | 3 | 4
  running: boolean
  impulseKey?: number
  size?: number
}) {
  const skin = useSkin()
  const mode = useMode()
  const [fullDayMode, setFullDayMode] = useState(false)
  const [toggleSeq, setToggleSeq] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const targetRatio = fullDayMode ? clamp(todayMs / (10 * HOUR), 0, 1) : clamp(tierPct / 100, 0, 1)

  const stateRef = useRef({
    target: targetRatio,
    levelVal: targetRatio,
    vel: 0,
    slosh: 0.022,
    phase: 0,
    heatLevel: level,
    running,
    skin,
    mode,
  })

  // 同步目标液位，水位变化较大时注入自然晃动冲量
  useEffect(() => {
    const st = stateRef.current
    const diff = Math.abs(targetRatio - st.target)
    st.target = targetRatio
    st.heatLevel = level
    st.running = running
    st.skin = skin
    st.mode = mode
    if (diff > 0.02) {
      st.slosh = Math.min(0.11, st.slosh + Math.min(0.055, diff * 0.25))
    }
  }, [targetRatio, level, running, skin, mode])

  useEffect(() => {
    if (impulseKey > 0) {
      stateRef.current.slosh = 0.095
    }
  }, [impulseKey])

  useEffect(() => {
    if (skin === 'terminal') return
    const canvas = canvasRef.current
    if (!canvas || typeof window === 'undefined') return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    let last = performance.now()
    const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 3)
      canvas.width = Math.round(size * ratio)
      canvas.height = Math.round(size * ratio)
      return ratio
    }
    let ratio = resize()

    const drawWavePath = (offset: number, amp: number, tilt: number, lvl: number, phase: number) => {
      const base = size * (1 - lvl)
      ctx.beginPath()
      ctx.moveTo(0, size)
      for (let x = 0; x <= size; x += 2) {
        const t = x / size
        const y = base + Math.sin(t * Math.PI * 2.25 + phase + offset) * amp * size + (t - 0.5) * tilt * size
        ctx.lineTo(x, y)
      }
      ctx.lineTo(size, size)
      ctx.closePath()
    }

    const paint = () => {
      const st = stateRef.current
      const root = document.documentElement
      const cs = getComputedStyle(root)
      const fillCol =
        st.heatLevel === 0
          ? cs.getPropertyValue('--accent').trim() || '#22c55e'
          : cs.getPropertyValue(HEAT_VAR_NAMES[st.heatLevel]).trim() || '#22c55e'
      const softCol = cs.getPropertyValue('--accent-soft').trim() || 'rgba(34,197,94,0.16)'
      const textCol = cs.getPropertyValue('--text').trim() || '#1f2328'
      const fontNum = cs.getPropertyValue('--font-num').trim() || 'system-ui, sans-serif'
      const onFill = contrastColor(fillCol)

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, size, size)

      const amp = st.levelVal <= 0.01 || st.levelVal >= 0.99 ? 0 : st.slosh
      const tilt = clamp(st.vel * 0.48, -0.22, 0.22)

      drawWavePath(1.75, amp * 0.85, -tilt * 0.55, st.levelVal, st.phase)
      ctx.fillStyle = softCol
      ctx.fill()

      const pct = Math.round(st.levelVal * 100)
      const labelText = `${pct}%`
      const fontSize = Math.round(size * (pct >= 100 ? 0.25 : 0.28))

      const drawLabel = (color: string) => {
        ctx.fillStyle = color
        ctx.font = `700 ${fontSize}px ${fontNum}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(labelText, size / 2, size / 2 + 1)
      }

      drawLabel(textCol)
      ctx.save()
      drawWavePath(0, amp, tilt, st.levelVal, st.phase)
      ctx.fillStyle = fillCol
      ctx.fill()
      ctx.clip()
      drawLabel(onFill)
      ctx.restore()
    }

    const tick = (now: number) => {
      const dt = Math.min(0.034, (now - last) / 1000 || 0.016)
      last = now
      const st = stateRef.current

      if (reduced() || document.hidden) {
        st.levelVal = st.target
        st.vel = 0
        st.slosh = 0.018
        paint()
        frame = 0
        return
      }

      const acc = 44 * (st.target - st.levelVal) - 10 * st.vel
      st.vel += acc * dt
      st.levelVal = clamp(st.levelVal + st.vel * dt, 0, 1)
      const restSlosh = st.running ? 0.034 : 0.018
      st.slosh += (restSlosh + Math.min(0.08, Math.abs(st.vel) * 0.22) - st.slosh) * Math.min(1, dt * 3.4)
      st.phase += dt * ((st.running ? 2.6 : 1.55) + Math.abs(st.vel) * 6)
      paint()
      frame = requestAnimationFrame(tick)
    }

    const start = () => {
      if (frame) return
      ratio = resize()
      if (reduced() || document.hidden) {
        stateRef.current.levelVal = stateRef.current.target
        paint()
        return
      }
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }

    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(frame)
        frame = 0
      } else {
        start()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [size, skin, mode])

  if (skin === 'terminal') {
    return (
      <TerminalMatrixGauge
        ratio={targetRatio}
        level={level}
        running={running}
        fullDayMode={fullDayMode}
        scanKey={impulseKey + toggleSeq}
        onToggle={() => {
          setToggleSeq((s) => s + 1)
          setFullDayMode((v) => !v)
        }}
      />
    )
  }

  const pctShown = Math.round(targetRatio * 100)
  const titleText = fullDayMode
    ? `今日满格（10h）进度 ${pctShown}%，点击切回当前档位进度`
    : `当前热度档进度 ${pctShown}%，点击切换查看 10h 满格进度`

  return (
    <button
      type="button"
      className="tide-orb"
      style={{ width: size, height: size }}
      data-mode-full={fullDayMode ? '' : undefined}
      title={titleText}
      aria-label={titleText}
      onClick={() => {
        stateRef.current.slosh = 0.092
        setFullDayMode((v) => !v)
      }}
    >
      <canvas ref={canvasRef} aria-hidden />
    </button>
  )
})
