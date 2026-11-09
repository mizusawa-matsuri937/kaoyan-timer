import { motion } from 'framer-motion'
import { formatDuration } from '../domain/format'
import { GROUPS, subjectsOf } from '../domain/subjects'

export function SubjectGrid({
  selected,
  activeId,
  running,
  todayBySubject,
  onPick,
}: {
  selected: string | null
  activeId: string | null
  running: boolean
  todayBySubject: Record<string, number>
  onPick: (id: string) => void
}) {
  return (
    <div className="space-y-4">
      {GROUPS.map((g) => {
        const subs = subjectsOf(g.id)
        const cols = subs.length >= 3 ? 'grid-cols-2' : 'grid-cols-2'
        return (
          <div key={g.id}>
            <div className="mb-2 px-1 text-[13px] font-semibold text-muted">{g.name}</div>
            <div className={`grid ${cols} gap-2.5`}>
              {subs.map((s) => {
                const isSel = selected === s.id
                const isActive = activeId === s.id
                const ms = todayBySubject[s.id] ?? 0
                return (
                  <motion.button
                    key={s.id}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => onPick(s.id)}
                    className="card relative overflow-hidden px-3.5 py-3 text-left"
                    style={{
                      borderRadius: '1.1rem',
                      outline: isSel ? `2px solid ${s.color}` : '2px solid transparent',
                      outlineOffset: -2,
                      transition: 'outline-color .2s',
                    }}
                  >
                    {isSel && (
                      <motion.div
                        layoutId="subject-tint"
                        className="absolute inset-0"
                        style={{ background: s.color, opacity: 0.09 }}
                        transition={{ type: 'spring', damping: 30, stiffness: 380 }}
                      />
                    )}
                    <div className="relative flex items-center gap-2">
                      <span
                        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${isActive && running ? 'pulse-dot' : ''}`}
                        style={{ background: s.color }}
                      />
                      <span className="truncate text-[15px] font-semibold">{s.name}</span>
                    </div>
                    <div className="num relative mt-1 pl-[18px] text-xs text-muted">
                      今日 {formatDuration(ms)}
                    </div>
                  </motion.button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
