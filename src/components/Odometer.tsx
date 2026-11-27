import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SkinId } from '../skin'

const DIGITS_11 = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'] as const

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * 单格 11 位（0–9–0）真实机械里程表滚轮槽：
 * - 终端极客皮肤（terminal）：保持纯粹等宽字符直出，不套用翻页滚筒动画；
 * - 纸感文艺 / 新粗野：使用基于 100% 行高百分比的精确定位（translateY(-pos * 100%)），
 *   彻底消除 offsetHeight 整数取整带来的高矮参差，实现 9→0 顺向进位与 0→9 顺向退位；
 * - SSR / 首帧直接输出 `<span class="d">{ch}</span>`，保持读屏与既有测试契约零破坏。
 */
export const OdometerDigit = memo(function OdometerDigit({
  ch,
  skin,
  rising = true,
  className = 'd-slot',
}: {
  ch: string
  skin: SkinId
  rising?: boolean
  className?: string
}) {
  const [mounted, setMounted] = useState(false)
  const slotRef = useRef<HTMLSpanElement>(null)
  const stripRef = useRef<HTMLSpanElement>(null)
  const initialDigit = /\d/.test(ch) ? Number(ch) : 0
  const stateRef = useRef<{ digit: number; pos: number; anim: Animation | null }>({
    digit: initialDigit,
    pos: initialDigit,
    anim: null,
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  const useReel = mounted && skin !== 'terminal' && /\d/.test(ch)

  // 从 terminal 切回其他皮肤或首次挂载滚筒时，直接对齐到当前数字百分比位置
  useLayoutEffect(() => {
    if (!useReel) {
      stateRef.current.anim?.cancel()
      stateRef.current.anim = null
      if (/\d/.test(ch)) {
        stateRef.current.digit = Number(ch)
        stateRef.current.pos = Number(ch)
      }
      return
    }
    const strip = stripRef.current
    if (!strip) return
    const next = Number(ch)
    const st = stateRef.current
    if (!st.anim && next === st.digit) {
      strip.style.transform = `translateY(${-st.pos * 100}%)`
    }
  }, [useReel, skin, ch])

  // 数字变更时执行纯百分比物理滚筒动画（零亚像素漂移）
  useLayoutEffect(() => {
    if (!useReel) return
    const slot = slotRef.current
    const strip = stripRef.current
    if (!slot || !strip) return

    const next = Number(ch)
    const st = stateRef.current
    const pctOf = (pos: number) => `translateY(${-pos * 100}%)`

    if (next === st.digit) {
      if (!st.anim) strip.style.transform = pctOf(st.pos)
      return
    }

    let fromPct = -st.pos * 100
    if (st.anim && typeof window !== 'undefined' && typeof DOMMatrixReadOnly === 'function') {
      try {
        const tf = getComputedStyle(strip).transform
        const exactH = slot.getBoundingClientRect().height
        if (tf && tf !== 'none' && exactH > 0) {
          const m = new DOMMatrixReadOnly(tf)
          if (Number.isFinite(m.m42)) fromPct = (m.m42 / exactH) * 100
        }
      } catch {
        /* fallback */
      }
    }

    st.anim?.cancel()
    st.anim = null

    if (st.pos === 10) {
      st.pos = 0
      fromPct += 1000
    }

    let target = next
    if (rising && st.digit === 9 && next === 0) target = 10
    else if (!rising && st.digit === 0 && next === 9) fromPct = -1000

    strip.style.transform = pctOf(target)
    st.pos = target
    st.digit = next

    const settle = () => {
      if (st.pos !== 10) return
      strip.style.transform = pctOf(0)
      st.pos = 0
    }

    const toPct = -target * 100
    if (prefersReducedMotion() || typeof strip.animate !== 'function' || Math.abs(fromPct - toPct) < 1) {
      settle()
      return
    }

    const duration = skin === 'brutal' ? 250 : 340
    const easing =
      skin === 'brutal' ? 'cubic-bezier(0.28, 1.45, 0.48, 1)' : 'cubic-bezier(0.22, 1.2, 0.36, 1)'

    const anim = strip.animate([{ transform: `translateY(${fromPct}%)` }, { transform: `translateY(${toPct}%)` }], {
      duration,
      easing,
    })
    st.anim = anim
    anim.onfinish = () => {
      if (st.anim === anim) st.anim = null
      settle()
    }
    anim.oncancel = () => {
      if (st.anim === anim) st.anim = null
    }
  }, [ch, useReel, rising, skin])

  if (!/\d/.test(ch)) {
    return <span className="d-sep">{ch}</span>
  }

  return (
    <span ref={slotRef} className={className} data-odo={useReel ? '' : undefined}>
      <span className="d">{ch}</span>
      {useReel && (
        <span ref={stripRef} className="d-strip" aria-hidden>
          {DIGITS_11.map((digit, idx) => (
            <span key={idx}>{digit}</span>
          ))}
        </span>
      )}
    </span>
  )
})

/**
 * 任意数值文本的里程表滚筒封装（如 "148.6"、"3h 20m"）：
 * 终端极客皮肤直接渲染平齐等宽文字；纸感/新粗野仅对数字挂接 0–9–0 滚筒，所有字符严格同基线齐平。
 */
export const OdometerText = memo(function OdometerText({
  text,
  value,
  skin,
  className = '',
}: {
  text: string
  value: number
  skin: SkinId
  className?: string
}) {
  const prevValRef = useRef(value)
  const rising = value >= prevValRef.current
  useEffect(() => {
    prevValRef.current = value
  }, [value])

  if (skin === 'terminal') {
    return <span className={`odo-inline ${className}`.trim()}>{text}</span>
  }

  // 从右往左计算数字槽位 key，确保 "4.5" → "148.6" 时小数位、个位、十位槽位稳定复用不重建
  const chars = [...text]
  const digitTotal = chars.filter((c) => /\d/.test(c)).length
  let digitSeen = 0

  return (
    <span className={`odo-inline ${className}`.trim()}>
      {chars.map((ch, idx) => {
        if (/\d/.test(ch)) {
          const fromRight = digitTotal - 1 - digitSeen
          digitSeen += 1
          return <OdometerDigit key={`d-${fromRight}`} ch={ch} skin={skin} rising={rising} className="odo-slot" />
        }
        return (
          <span key={`s-${idx}-${ch}`} className="odo-char">
            {ch}
          </span>
        )
      })}
    </span>
  )
})
