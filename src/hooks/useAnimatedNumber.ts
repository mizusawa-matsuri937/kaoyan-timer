import { useEffect, useRef, useState } from 'react'
import type { SkinId } from '../skin'

/**
 * 数值切换时的插值过渡（如统计页切换「今日 / 本周 / 本月 / 全部」）：
 * 首次挂载直接显示目标值，之后按当前皮肤的节奏滚动到新值。
 */
export function useAnimatedNumber(target: number, skin: SkinId): number {
  const [value, setValue] = useState(target)
  const currentRef = useRef(target)
  const prevTargetRef = useRef(target)

  useEffect(() => {
    if (prevTargetRef.current === target) return
    prevTargetRef.current = target

    if (
      typeof window === 'undefined' ||
      typeof requestAnimationFrame !== 'function' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
      Math.abs(target - currentRef.current) < 1
    ) {
      currentRef.current = target
      setValue(target)
      return
    }

    const from = currentRef.current
    const delta = target - from
    const duration = skin === 'terminal' ? 190 : skin === 'brutal' ? 260 : 400
    const start = performance.now()
    let raf = 0

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      let eased: number
      if (skin === 'terminal') {
        eased = t >= 1 ? 1 : Math.floor(t * 6) / 6
      } else if (skin === 'brutal') {
        eased = 1 - Math.pow(1 - t, 2.4)
      } else {
        eased = 1 - Math.pow(1 - t, 3)
      }
      const next = t >= 1 ? target : from + delta * eased
      currentRef.current = next
      setValue(next)
      if (t < 1) raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, skin])

  return value
}
