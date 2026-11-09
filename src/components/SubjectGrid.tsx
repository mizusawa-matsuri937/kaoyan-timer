import { motion } from 'framer-motion'
import { formatDuration } from '../domain/format'
import { GROUPS, subjectsOf } from '../domain/subjects'
import { alpha } from '../lib/color'
import { GlowBar } from './ui'

export function SubjectGrid({
  selected,
  activeId,
  running,
  todayBySubject,
  todayTotal,
  onPick,
}: {
  selected: string | null
  activeId: string | null
  running: boolean
  todayBySubject: Record<string, number>
  todayTotal: number
  onPick: (id: string) => void
}) {
  return (
    <div className="space-y-5">
      {GROUPS.map((g) => {
        const subs = subjectsOf(g.id)
        return (
          <div key={g.id}>
            <div className="mb-2 flex items-center gap-1.5 px-1 text-[13px] font-semibold text-muted">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: g.color, boxShadow: `0 0 6px ${g.color}` }} />
              {g.name}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {subs.map((s) => {
                const isSel = selected === s.id
                const live = activeId === s.id && running
                const ms = todayBySubject[s.id] ?? 0
                const pct = todayTotal > 0 ? (ms / todayTotal) * 100 : 0
                return (
                  <motion.button
                    key={s.id}
                    whileTap={{ scale: 0.96 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 500 }}
                    onClick={() => onPick(s.id)}
                    className={`card overflow-hidden px-3.5 pt-3 pb-3 text-left ${live ? 'glow-pulse' : ''}`}
                    style={
                      {
                        borderRadius: '1.15rem',
                        borderColor: isSel ? alpha(s.color, 0.55) : undefined,
                        boxShadow: isSel
                          ? `var(--shadow), inset 0 1px 0 var(--card-highlight), 0 8px 24px -10px ${alpha(s.color, 0.55)}`
                          : undefined,
                        '--glow': alpha(s.color, 0.5),
                        transition: 'border-color .25s, box-shadow .25s',
                      } as React.CSSProperties
                    }
                  >
                    {isSel && (
                      <motion.div
                        layoutId="subject-tint"
                        className="absolute inset-0"
                        style={{
                          background: `linear-gradient(135deg, ${alpha(s.color, 0.2)} 0%, ${alpha(s.color, 0.06)} 55%, transparent 100%)`,
                        }}
                        transition={{ type: 'spring', damping: 30, stiffness: 380 }}
                      />
                    )}
                    <div className="relative flex items-center gap-2">
                      <span
                        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${live ? 'pulse-dot' : ''}`}
                        style={{ background: s.color, boxShadow: `0 0 8px ${alpha(s.color, 0.7)}` }}
                      />
                      <span className="truncate text-[15px] font-semibold">{s.name}</span>
                    </div>
                    <div className="relative mt-1 flex items-baseline justify-between pl-[18px]">
                      <span className="num text-xs text-muted">今日 {formatDuration(ms)}</span>
                      {pct > 0 && <span className="num text-[10px] text-faint">{Math.round(pct)}%</span>}
                    </div>
                    <div className="relative mt-2 pl-[18px]">
                      <GlowBar pct={pct} color={s.color} height={4} />
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
