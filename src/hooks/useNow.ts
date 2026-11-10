import { useEffect, useLayoutEffect, useState } from 'react'

/**
 * 当前时间，按秒（或分钟）对齐刷新。
 * 计时显示永远由 Date.now() 和时间戳算出，这里只是触发重渲染，所以后台被挂起也不会累积误差。
 */
export function useNow(unit: 'second' | 'minute' = 'second'): number {
  const [now, setNow] = useState(() => Date.now())
  const step = unit === 'second' ? 1000 : 60000
  // 页面切走时不卸载、定时器是停的，切回来（副作用重新挂上）时先把时间对上再画，
  // 否则要等到下一次整秒 / 整分才刷新，会先看到一眼旧数据
  useLayoutEffect(() => {
    setNow((prev) => {
      const t = Date.now()
      return Math.floor(prev / step) === Math.floor(t / step) ? prev : t
    })
  }, [step])
  useEffect(() => {
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
  }, [step])
  return now
}
