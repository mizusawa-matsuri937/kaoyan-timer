import { formatDuration } from '../domain/format'
import { GROUPS, SUBJECTS, subjectsOf, type Subject } from '../domain/subjects'
import { Bar, Segmented, tint } from './ui'

export type SubjectTab = 'daily' | 'mock'

const TAB_OPTIONS: Array<{ value: SubjectTab; label: string }> = [
  { value: 'daily', label: '日常科目' },
  { value: 'mock', label: '全真模考' },
]

function SubjectButton({
  subject,
  ms,
  todayTotal,
  selected,
  live,
  onPick,
}: {
  subject: Subject
  ms: number
  todayTotal: number
  selected: boolean
  live: boolean
  onPick: (id: string) => void
}) {
  const pct = todayTotal > 0 ? (ms / todayTotal) * 100 : 0
  return (
    <button
      onClick={() => onPick(subject.id)}
      aria-pressed={selected}
      data-live={live ? '' : undefined}
      className="subj c"
      style={tint(subject.color)}
    >
      <span className="subj-mark">
        <span className="dot" />
      </span>
      <span className="subj-name">{subject.name}</span>
      <span className="subj-time num">
        {formatDuration(ms)}
        <span className="subj-pct">{pct > 0 ? `${Math.round(pct)}%` : ''}</span>
      </span>
      <Bar pct={pct} />
    </button>
  )
}

/** 按「日常科目 | 全真模考」分栏展示；列表还是双列卡片网格由皮肤的 CSS 决定 */
export function SubjectGrid({
  tab,
  onTabChange,
  selected,
  activeId,
  running,
  todayBySubject,
  todayTotal,
  onPick,
}: {
  tab: SubjectTab
  onTabChange: (tab: SubjectTab) => void
  selected: string | null
  activeId: string | null
  running: boolean
  todayBySubject: Record<string, number>
  todayTotal: number
  onPick: (id: string) => void
}) {
  const mockSubjects = SUBJECTS.filter((s) => s.examMinutes)
  const mockGroupMs = mockSubjects.reduce((a, s) => a + (todayBySubject[s.id] ?? 0), 0)

  return (
    <div className="subj-wrap mt-5">
      <Segmented value={tab} options={TAB_OPTIONS} onChange={(v) => onTabChange(v)} />

      <div className="subj-groups mt-4 space-y-5">
        {tab === 'daily' ? (
          GROUPS.map((g) => {
            const subs = subjectsOf(g.id).filter((s) => !s.examMinutes)
            const groupMs = subs.reduce((a, s) => a + (todayBySubject[s.id] ?? 0), 0)
            return (
              <section key={g.id}>
                <div className="subj-head c" style={tint(g.color)}>
                  <h2 className="section-title">{g.name}</h2>
                  {groupMs > 0 && <span className="num text-xs text-muted">今日 {formatDuration(groupMs)}</span>}
                </div>
                <div className="subj-list">
                  {subs.map((s) => (
                    <SubjectButton
                      key={s.id}
                      subject={s}
                      ms={todayBySubject[s.id] ?? 0}
                      todayTotal={todayTotal}
                      selected={selected === s.id}
                      live={activeId === s.id && running}
                      onPick={onPick}
                    />
                  ))}
                </div>
              </section>
            )
          })
        ) : (
          <section key="mock">
            <div className="subj-head">
              <h2 className="section-title">全真模考 · 180 分钟</h2>
              {mockGroupMs > 0 && <span className="num text-xs text-muted">今日 {formatDuration(mockGroupMs)}</span>}
            </div>
            <div className="subj-list">
              {mockSubjects.map((s) => (
                <SubjectButton
                  key={s.id}
                  subject={s}
                  ms={todayBySubject[s.id] ?? 0}
                  todayTotal={todayTotal}
                  selected={selected === s.id}
                  live={activeId === s.id && running}
                  onPick={onPick}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
