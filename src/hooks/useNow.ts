import { useEffect, useState } from 'react'

/**
 * 当前时间，按秒（或分钟）对齐刷新。
 * 计时显示永远由 Date.now() 和时间戳算出，这里只是触发重渲染，所以后台被挂起也不会累积误差。
 */
export function useNow(unit: 'second' | 'minute' = 'second'): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const step = unit === 'second' ? 1000 : 60000
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const t = Date.now()
      setNow(t)
      timer = setTimeout(tick, step - (t % step) + 5)
    }
    timer = setTimeout(tick, step - (Date.now() % step) + 5)
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer)
        tick()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onVis)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onVis)
    }
  }, [unit])
  return now
}
