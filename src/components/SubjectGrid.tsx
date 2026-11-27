import { memo, useCallback, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { formatDuration } from '../domain/format'
import { GROUPS, getSubject, SUBJECTS, subjectsOf, type Subject } from '../domain/subjects'
import { useSkin, type TransitionOrigin } from '../skin'
import { Bar, clickOrigin, Segmented, tint } from './ui'

export type SubjectTab = 'daily' | 'mock'

const TAB_OPTIONS: Array<{ value: SubjectTab; label: string }> = [
  { value: 'daily', label: '日常科目' },
  { value: 'mock', label: '全真模考' },
]

const EMPTY_GROUPS: Record<string, number> = {}

const SubjectButton = memo(function SubjectButton({
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
  onPick: (id: string, origin?: TransitionOrigin) => void
}) {
  const pct = todayTotal > 0 ? (ms / todayTotal) * 100 : 0
  return (
    <button
      data-subj-id={subject.id}
      onClick={(e) => onPick(subject.id, clickOrigin(e))}
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
})

/** 按「日常科目 | 全真模考」分栏展示；列表还是双列卡片网格由皮肤的 CSS 决定 */
export const SubjectGrid = memo(function SubjectGrid({
  tab,
  onTabChange,
  selected,
  activeId,
  running,
  todayBySubject = EMPTY_GROUPS,
  todayTotal,
  onPick,
}: {
  tab: SubjectTab
  onTabChange: (tab: SubjectTab) => void
  selected: string | null
  activeId: string | null
  running: boolean
  todayBySubject?: Record<string, number>
  todayTotal: number
  onPick: (id: string, origin?: TransitionOrigin) => void
}) {
  const skin = useSkin()
  const groupsRef = useRef<HTMLDivElement>(null)
  const gliderRef = useRef<HTMLDivElement>(null)
  const prevStateRef = useRef<{ selected: string | null; tab: SubjectTab; skin: string } | null>(null)

  const syncGlider = useCallback(
    (animate: boolean) => {
      const groupsEl = groupsRef.current
      const gliderEl = gliderRef.current
      if (!groupsEl || !gliderEl || groupsEl.clientWidth === 0) return
      const target = selected ? groupsEl.querySelector<HTMLElement>(`[data-subj-id="${CSS.escape(selected)}"]`) : null
      if (!target) {
        gliderEl.style.opacity = '0'
        delete gliderEl.dataset.glide
        delete groupsEl.dataset.gliderReady
        return
      }
      // 沿 offsetParent 累加静态布局坐标，不受入场或按压 CSS transform 的干扰
      let x = 0
      let y = 0
      let cur: HTMLElement | null = target
      while (cur && cur !== groupsEl) {
        x += cur.offsetLeft
        y += cur.offsetTop
        cur = cur.offsetParent as HTMLElement | null
      }
      const sub = selected ? getSubject(selected) : undefined
      if (!animate) delete gliderEl.dataset.glide
      else gliderEl.dataset.glide = ''
      if (sub) gliderEl.style.setProperty('--c', sub.color)
      gliderEl.style.setProperty('--gx', `${x}px`)
      gliderEl.style.setProperty('--gy', `${y}px`)
      gliderEl.style.setProperty('--gw', `${target.offsetWidth}px`)
      gliderEl.style.setProperty('--gh', `${target.offsetHeight}px`)
      gliderEl.style.opacity = '1'
      groupsEl.dataset.gliderReady = ''
    },
    [selected],
  )

  useLayoutEffect(() => {
    const prev = prevStateRef.current
    const shouldAnimate =
      !!prev &&
      prev.tab === tab &&
      prev.skin === skin &&
      prev.selected !== null &&
      selected !== null &&
      prev.selected !== selected
    prevStateRef.current = { selected, tab, skin }
    syncGlider(shouldAnimate)
  }, [selected, tab, skin, syncGlider])

  useLayoutEffect(() => {
    const el = groupsRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => syncGlider(false))
    ro.observe(el)
    return () => ro.disconnect()
  }, [syncGlider])

  const mockSubjects = SUBJECTS.filter((s) => s.examMinutes)
  const mockGroupMs = mockSubjects.reduce((a, s) => a + (todayBySubject[s.id] ?? 0), 0)

  return (
    <div className="subj-wrap mt-5">
      <Segmented value={tab} options={TAB_OPTIONS} onChange={(v) => onTabChange(v)} />

      <div ref={groupsRef} className="subj-groups relative mt-4 space-y-5">
        <div
          ref={gliderRef}
          className="subj-glider c"
          style={{ opacity: 0 } as CSSProperties}
          onTransitionEnd={(e) => {
            if (e.target === e.currentTarget) delete e.currentTarget.dataset.glide
          }}
          aria-hidden
        />
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
})
