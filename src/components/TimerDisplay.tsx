import { memo, useEffect, useRef } from 'react'
import { HOUR } from '../domain/aggregate'
import { formatHMS } from '../domain/format'
import type { SkinId } from '../skin'

const SEGS = 30 // 一行 30 格 = 1 小时，每格 2 分钟

/**
 * 单个数字滚轮槽：首次挂载 / 服务端渲染只输出 .d（不破坏读屏与静态标记），
 * 客户端数字变化时同一帧挂载离场的旧数字 .d-out 与入场的新数字 .d，实现无闪烁滚轮换字。
 */
function DigitSlot({ ch }: { ch: string }) {
  const committedRef = useRef<{ cur: string; prev: string | null; seq: number }>({
    cur: ch,
    prev: null,
    seq: 0,
  })

  let { cur, prev, seq } = committedRef.current
  if (cur !== ch) {
    prev = cur
    cur = ch
    seq += 1
  }

  useEffect(() => {
    committedRef.current = { cur, prev, seq }
  }, [cur, prev, seq])

  if (ch === ':') {
    return <span className="d-sep">:</span>
  }

  return (
    <span className="d-slot">
      {prev !== null && (
        <span key={`out-${seq}`} className="d-out" aria-hidden>
          {prev}
        </span>
      )}
      <span key={`in-${seq}-${ch}`} className="d">
        {ch}
      </span>
    </span>
  )
}

const cells = (s: string, offset = 0) =>
  [...s].map((ch, i) => <DigitSlot key={offset + i} ch={ch} />)

/** 时分 + 弱化的秒；逐字符定宽滚轮，跳秒不位移不闪烁 */
function Digits({ ms }: { ms: number }) {
  const hms = formatHMS(ms)
  const cut = hms.length - 3
  return (
    <div className="timer-digits" role="timer">
      {cells(hms.slice(0, cut), 0)}
      <span className="sec">{cells(hms.slice(cut), cut)}</span>
    </div>
  )
}

/* ---------- 终端皮肤的方块大字 ----------
   3×5 的点阵，一个点 = 一个「█」字符格。画成 SVG 而不是真的输出字符：
   各平台等宽字体里方块字符的行高、字宽都不一样，直接排字会有缝或者错位。 */
const CELL_W = 10
const CELL_H = 14
const GLYPH_ROWS = 5
const GLYPHS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001001001001',
  '8': '111101111101111',
  '9': '111101111001111',
  ':': '01010',
}

/** 每个字形预先拼成一条路径：同一行连着的点合并成一个矩形 */
const GLYPH_PATHS = new Map(
  Object.entries(GLYPHS).map(([ch, bits]) => {
    const cols = bits.length / GLYPH_ROWS
    let d = ''
    for (let r = 0; r < GLYPH_ROWS; r++) {
      for (let c = 0; c < cols; c++) {
        if (bits[r * cols + c] !== '1') continue
        let end = c
        while (end + 1 < cols && bits[r * cols + end + 1] === '1') end++
        d += `M${c * CELL_W} ${r * CELL_H}h${(end - c + 1) * CELL_W}v${CELL_H}h${-(end - c + 1) * CELL_W}z`
        c = end
      }
    }
    return [ch, { d, w: cols * CELL_W }] as const
  }),
)

/** 方块字符拼出来的时间。纯装饰（aria-hidden），读屏和测试看的还是旁边那份文字版 */
function BlockDigits({ ms }: { ms: number }) {
  const hms = formatHMS(ms)
  const cut = hms.length - 3
  let x = 0
  const glyphs = [...hms].map((ch, i) => {
    const g = GLYPH_PATHS.get(ch)
    if (!g) return null
    // 定位放在外层 <g> 上：CSS 动画的 transform 会盖掉元素自己的 transform 属性
    const node = (
      <g key={i} transform={`translate(${x} 0)`}>
        <path key={ch} d={g.d} className={i >= cut ? 'sec' : undefined} />
      </g>
    )
    x += g.w + CELL_W
    return node
  })
  return (
    <svg
      className="blockdigits"
      viewBox={`0 0 ${x - CELL_W} ${GLYPH_ROWS * CELL_H}`}
      shapeRendering="crispEdges"
      aria-hidden
    >
      {glyphs}
    </svg>
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

const DIAL_60 = Array.from({ length: 60 }, (_, i) => {
  const rad = (i / 60) * 2 * Math.PI
  return { i, cos: Math.cos(rad), sin: Math.sin(rad), major: i % 5 === 0, quarter: i % 15 === 0 }
})

/**
 * 计时主体，形态跟随皮肤：
 * 终端极客 = 方块字符大字 + 分格进度条；新粗野 / 纸感文艺 = 精细刻度圆环与运行呼吸。每满一行 / 一圈 = 1 小时。
 *
 * 传入 examMs（模拟测试）时改成倒计时：数字显示剩余时间，一行 / 一圈 = 整场考试；
 * 时间用完后数字变成超出的时长，由外层的 data-over 标红。
 */
export function TimerDisplay({
  ms,
  active,
  running = active,
  skin,
  examMs = 0,
}: {
  ms: number
  active: boolean
  running?: boolean
  skin: SkinId
  examMs?: number
}) {
  const exam = examMs > 0
  const span = exam ? examMs : HOUR
  const lap = exam ? 0 : Math.floor(ms / HOUR)
  const over = exam && ms >= examMs
  const progress = exam ? Math.min(1, ms / examMs) : (ms % HOUR) / HOUR
  // 倒计时向上取整到秒：刚开始显示 03:00:00，而不是立刻跳到 02:59:59
  const shown = !exam ? ms : over ? ms - examMs : Math.ceil((examMs - ms) / 1000) * 1000
  const examMinutes = Math.round(examMs / 60000)

  // 圆环扫秒节奏：每秒正常递增走 1s 线性连续扫针，跨整点套圈走瞬切防倒转，后台切回走柔顺追赶
  const prevDialRef = useRef<{ ms: number; progress: number; active: boolean }>({ ms, progress, active })
  const prevDial = prevDialRef.current
  const deltaMs = ms - prevDial.ms
  let sweep: 'linear' | 'catchup' | 'none' = 'none'
  if (active && prevDial.active && progress >= prevDial.progress) {
    if (running && deltaMs > 0 && deltaMs <= 1800) sweep = 'linear'
    else if (deltaMs > 1800) sweep = 'catchup'
  }
  useEffect(() => {
    prevDialRef.current = { ms, progress, active }
  }, [ms, progress, active])

  if (skin === 'terminal') {
    const caption = exam
      ? active
        ? `${over ? '已超时' : '已用'} ${formatHMS(over ? ms - examMs : ms)} · ${Math.floor(progress * 100)}%`
        : `模拟考试 · 满格 = ${examMinutes} 分钟`
      : active
        ? `第 ${lap + 1} 小时 · ${Math.floor(progress * 100)}%`
        : '每满一行 = 1 小时'
    return (
      <>
        <BlockDigits ms={shown} />
        <Digits ms={shown} />
        <SegBar on={Math.floor(progress * SEGS)} showNow={active && !over} />
        <div className="timer-caption">
          <span className="num">{caption}</span>
          <span>每格 {Math.round(span / SEGS / 60000)} 分钟</span>
        </div>
      </>
    )
  }

  const { width, edge } = RING[skin]
  // svg 整体旋转 -90°，所以 0° 在顶部；圆点指针用合成层旋转，配合线性过渡实现机械表式顺滑扫秒
  const deg = progress * 360
  const caption = exam
    ? active
      ? `${over ? '已超时' : '已用'} ${formatHMS(over ? ms - examMs : ms)}`
      : `模拟考试 · ${examMinutes} 分钟`
    : active
      ? `第 ${lap + 1} 小时`
      : '每圈 1 小时'
  return (
    <div className="dial" data-running={running ? '' : undefined} data-sweep={sweep}>
      <svg viewBox="0 0 200 200" aria-hidden>
        {edge ? (
          <>
            <circle className="dial-breathe-ring" cx={100} cy={100} r={R - width / 2 - 9.5} />
            <g className="dial-ticks-brutal">
              {DIAL_60.filter((t) => t.major).map(({ i, cos, sin, quarter }) => {
                const r1 = R - width / 2 - (quarter ? 7 : 4.5)
                const r2 = R - width / 2 - 1.5
                return (
                  <line
                    key={i}
                    x1={100 + r1 * cos}
                    y1={100 + r1 * sin}
                    x2={100 + r2 * cos}
                    y2={100 + r2 * sin}
                    strokeWidth={quarter ? 2.2 : 1.4}
                  />
                )
              })}
            </g>
          </>
        ) : (
          <g className="dial-ticks-paper">
            {DIAL_60.map(({ i, cos, sin, major, quarter }) =>
              major ? (
                <line
                  key={i}
                  x1={100 + (R - (quarter ? 9.5 : 7)) * cos}
                  y1={100 + (R - (quarter ? 9.5 : 7)) * sin}
                  x2={100 + (R - 4) * cos}
                  y2={100 + (R - 4) * sin}
                  strokeWidth={quarter ? 1.15 : 0.75}
                />
              ) : (
                <circle key={i} cx={100 + (R - 5.5) * cos} cy={100 + (R - 5.5) * sin} r={0.55} />
              ),
            )}
          </g>
        )}
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
          active && (
            <g className="dial-hand" style={{ transform: `rotate(${deg.toFixed(3)}deg)` }}>
              <circle className="dial-tip-halo" cx={100 + R} cy={100} r={9} />
              <circle className="dial-tip" cx={100 + R} cy={100} r={4.5} />
            </g>
          )
        )}
      </svg>
      <div className="dial-center">
        <Digits ms={shown} />
        <div className="timer-caption">
          <span className="num">{caption}</span>
        </div>
      </div>
    </div>
  )
}
