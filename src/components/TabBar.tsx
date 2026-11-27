import { useEffect, useRef, type CSSProperties } from 'react'
import { useSkin } from '../skin'
import { IconChart, IconGrid, IconSettings, IconTimer } from './icons'

export type TabId = 'timer' | 'heat' | 'stats' | 'settings'

const TABS: Array<{ id: TabId; label: string; Icon: typeof IconTimer }> = [
  { id: 'timer', label: '计时', Icon: IconTimer },
  { id: 'heat', label: '热度', Icon: IconGrid },
  { id: 'stats', label: '统计', Icon: IconChart },
  { id: 'settings', label: '设置', Icon: IconSettings },
]

/** 底部导航。图标和编号都输出，显示哪个由皮肤决定（终端皮肤是「1 计时」这种状态栏写法） */
export function TabBar({ tab, onChange, running }: { tab: TabId; onChange: (t: TabId) => void; running: boolean }) {
  const skin = useSkin()
  const curIdx = TABS.findIndex((t) => t.id === tab)
  const prevIdxRef = useRef(curIdx)
  const pillRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const prev = prevIdxRef.current
    prevIdxRef.current = curIdx
    const dist = Math.abs(curIdx - prev)
    const el = pillRef.current
    if (
      dist === 0 ||
      !el ||
      typeof el.animate !== 'function' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }
    let anim: Animation | undefined
    if (skin === 'paper') {
      const sx = Math.min(1.52, 1 + dist * 0.2)
      anim = el.animate(
        [
          { transform: 'scale(1, 1)' },
          { transform: `scale(${sx.toFixed(2)}, 0.86)`, offset: 0.38 },
          { transform: 'scale(0.95, 1.04)', offset: 0.78 },
          { transform: 'scale(1, 1)' },
        ],
        { duration: 380, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
    } else if (skin === 'brutal') {
      const sx = Math.min(1.42, 1 + dist * 0.15)
      anim = el.animate(
        [
          { transform: 'scaleX(1)' },
          { transform: `scaleX(${sx.toFixed(2)})`, offset: 0.36 },
          { transform: 'scaleX(0.96)', offset: 0.76 },
          { transform: 'scaleX(1)' },
        ],
        { duration: 300, easing: 'cubic-bezier(0.28, 1.42, 0.48, 1)' },
      )
    }
    return () => {
      try {
        anim?.cancel()
      } catch {
        /* ignore */
      }
    }
  }, [curIdx, skin])

  return (
    <nav className="tabbar">
      <div className="tabbar-inner">
        {/* 当前页的底色块，切换时滑过去；内部胶囊在跨距移动时做弹性速度拉伸 */}
        <span className="tab-ind" aria-hidden style={{ '--i': curIdx } as CSSProperties}>
          <span ref={pillRef} className="tab-ind-pill" />
        </span>
        {TABS.map(({ id, label, Icon }, i) => (
          <button key={id} onClick={() => onChange(id)} aria-current={tab === id ? 'page' : undefined} className="tab">
            <span className="tab-icon">
              <Icon size={20} />
            </span>
            <span className="tab-idx" aria-hidden>
              {i + 1}
            </span>
            <span>{label}</span>
            {id === 'timer' && running && tab !== id && <span className="tab-live" />}
          </button>
        ))}
      </div>
    </nav>
  )
}
