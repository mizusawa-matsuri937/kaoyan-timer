import { motion } from 'framer-motion'
import { IconChart, IconGrid, IconSettings, IconTimer } from './icons'

export type TabId = 'timer' | 'heat' | 'stats' | 'settings'

const TABS: Array<{ id: TabId; label: string; Icon: typeof IconTimer }> = [
  { id: 'timer', label: '计时', Icon: IconTimer },
  { id: 'heat', label: '热度', Icon: IconGrid },
  { id: 'stats', label: '统计', Icon: IconChart },
  { id: 'settings', label: '设置', Icon: IconSettings },
]

export function TabBar({ tab, onChange, running }: { tab: TabId; onChange: (t: TabId) => void; running: boolean }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xl safe-bottom"
      style={{ background: 'color-mix(in srgb, var(--card) 82%, transparent)', borderColor: 'var(--line)' }}
    >
      <div className="mx-auto flex max-w-lg">
        {TABS.map(({ id, label, Icon }) => {
          const on = tab === id
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              className="relative flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5"
              style={{ color: on ? 'var(--accent)' : 'var(--faint)' }}
            >
              {on && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute top-1 h-8 w-14 rounded-full"
                  style={{ background: 'var(--accent-soft)' }}
                  transition={{ type: 'spring', damping: 30, stiffness: 420 }}
                />
              )}
              <span className="relative">
                <Icon size={22} />
                {id === 'timer' && running && !on && (
                  <span className="pulse-dot absolute -top-0.5 -right-1 h-2 w-2 rounded-full" style={{ background: 'var(--accent)' }} />
                )}
              </span>
              <span className="relative text-[10px] font-medium">{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
