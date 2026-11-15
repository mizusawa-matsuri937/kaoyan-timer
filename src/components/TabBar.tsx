import type { CSSProperties } from 'react'
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
  return (
    <nav className="tabbar">
      <div className="tabbar-inner">
        {/* 当前页的底色块，切换时滑过去；哪些皮肤显示它由 CSS 决定 */}
        <span className="tab-ind" aria-hidden style={{ '--i': TABS.findIndex((t) => t.id === tab) } as CSSProperties} />
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
