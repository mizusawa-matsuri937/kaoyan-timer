import { motion } from 'framer-motion'
import { IconChart, IconGrid, IconSettings, IconTimer } from './icons'

export type TabId = 'timer' | 'heat' | 'stats' | 'settings'

const TABS: Array<{ id: TabId; label: string; Icon: typeof IconTimer }> = [
  { id: 'timer', label: '计时', Icon: IconTimer },
  { id: 'heat', label: '热度', Icon: IconGrid },
  { id: 'stats', label: '统计', Icon: IconChart },
  { id: 'settings', label: '设置', Icon: IconSettings },
]

/** 悬浮胶囊导航（灵动岛风格） */
export function TabBar({ tab, onChange, running }: { tab: TabId; onChange: (t: TabId) => void; running: boolean }) {
  return (
    <nav
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-5"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}
    >
      <div
        className="pointer-events-auto flex w-full max-w-sm rounded-full p-1.5"
        style={{
          background: 'var(--card-strong)',
          WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          backdropFilter: 'blur(28px) saturate(180%)',
          border: '1px solid var(--card-border)',
          boxShadow: 'var(--shadow-float), inset 0 1px 0 var(--card-highlight)',
        }}
      >
        {TABS.map(({ id, label, Icon }) => {
          const on = tab === id
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className="relative flex flex-1 flex-col items-center gap-0.5 rounded-full py-1.5 transition-colors"
              style={{ color: on ? 'var(--accent)' : 'var(--faint)' }}
            >
              {on && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: 'linear-gradient(180deg, color-mix(in srgb, var(--accent) 20%, transparent), color-mix(in srgb, var(--accent) 9%, transparent))',
                    border: '1px solid color-mix(in srgb, var(--accent) 22%, transparent)',
                    boxShadow: '0 4px 16px -6px color-mix(in srgb, var(--accent) 55%, transparent), inset 0 1px 0 rgba(255,255,255,.25)',
                  }}
                  transition={{ type: 'spring', damping: 28, stiffness: 420 }}
                />
              )}
              <span className="relative">
                <Icon size={21} />
                {id === 'timer' && running && !on && (
                  <span
                    className="pulse-dot absolute -top-0.5 -right-1 h-2 w-2 rounded-full"
                    style={{ background: 'var(--accent)', boxShadow: '0 0 8px var(--accent)' }}
                  />
                )}
              </span>
              <span className="relative text-[10px] font-semibold">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
