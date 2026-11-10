import { formatDuration } from '../domain/format'
import { GROUPS, subjectsOf } from '../domain/subjects'
import { Bar, tint } from './ui'

/** 按科目组列出全部科目；列表还是卡片网格由皮肤的 CSS 决定 */
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
        const groupMs = subs.reduce((a, s) => a + (todayBySubject[s.id] ?? 0), 0)
        return (
          <section key={g.id}>
            <div className="subj-head c" style={tint(g.color)}>
              <h2 className="section-title">{g.name}</h2>
              {groupMs > 0 && <span className="num text-xs text-muted">今日 {formatDuration(groupMs)}</span>}
            </div>
            <div className="subj-list">
              {subs.map((s) => {
                const ms = todayBySubject[s.id] ?? 0
                const pct = todayTotal > 0 ? (ms / todayTotal) * 100 : 0
                return (
                  <button
                    key={s.id}
                    onClick={() => onPick(s.id)}
                    aria-pressed={selected === s.id}
                    data-live={activeId === s.id && running ? '' : undefined}
                    className="subj c"
                    style={tint(s.color)}
                  >
                    <span className="subj-mark">
                      <span className="dot" />
                    </span>
                    <span className="subj-name">{s.name}</span>
                    <span className="subj-time num">
                      {formatDuration(ms)}
                      <span className="subj-pct">{pct > 0 ? `${Math.round(pct)}%` : ''}</span>
                    </span>
                    <Bar pct={pct} />
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
