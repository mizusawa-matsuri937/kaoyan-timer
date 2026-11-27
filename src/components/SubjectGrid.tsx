import { motion, Reorder, useDragControls } from 'framer-motion'
import { memo, useCallback, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { formatDuration } from '../domain/format'
import { getSubject, type GroupId, type Subject } from '../domain/subjects'
import { useSkin, type SkinId, type TransitionOrigin } from '../skin'
import {
  isDefaultSubjectOrder,
  orderedGroups,
  orderedSubjects,
  resetSubjectOrder,
  setGroupOrder,
  setScopeSubjectOrder,
  useSubjectOrder,
  type OrderScope,
} from '../subjectOrder'
import { IconGrip, IconSort } from './icons'
import { Bar, clickOrigin, Segmented, tint } from './ui'

export type SubjectTab = 'daily' | 'mock'

const TAB_OPTIONS: Array<{ value: SubjectTab; label: string }> = [
  { value: 'daily', label: '日常科目' },
  { value: 'mock', label: '全真模考' },
]

const EMPTY_GROUPS: Record<string, number> = {}

function layoutTransition(skin: SkinId) {
  if (skin === 'terminal') return { duration: 0.12, ease: 'linear' as const }
  if (skin === 'brutal') return { type: 'spring' as const, stiffness: 520, damping: 32 }
  return { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const }
}

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
      type="button"
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

function ReorderSubjectRow({
  subject,
  ms,
  skin,
}: {
  subject: Subject
  ms: number
  skin: SkinId
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      as="div"
      value={subject.id}
      dragListener={false}
      dragControls={controls}
      transition={layoutTransition(skin)}
      whileDrag={{
        scale: skin === 'terminal' ? 1 : 1.02,
        zIndex: 25,
        boxShadow: 'var(--shadow-pop)',
      }}
      onPointerDown={(e) => controls.start(e)}
      className="subj subj-sort-row c touch-none select-none"
      style={tint(subject.color)}
    >
      <span className="subj-mark">
        <span className="dot" />
      </span>
      <span className="subj-name">{subject.name}</span>
      <span className="subj-sort-meta num">
        {ms > 0 && <span className="text-xs text-muted">{formatDuration(ms)}</span>}
        <span className="subj-grip" aria-label={`拖拽调整 ${subject.name} 顺序`}>
          {skin === 'terminal' ? '::' : <IconGrip size={15} />}
        </span>
      </span>
    </Reorder.Item>
  )
}

function SortableScopeList({
  scope,
  subjects,
  todayBySubject,
  skin,
}: {
  scope: OrderScope
  subjects: Subject[]
  todayBySubject: Record<string, number>
  skin: SkinId
}) {
  if (subjects.length <= 1) {
    const only = subjects[0]
    if (!only) return null
    const ms = todayBySubject[only.id] ?? 0
    return (
      <div className="subj-list" data-sorting="">
        <div className="subj subj-sort-row subj-sort-single c" style={tint(only.color)}>
          <span className="subj-mark">
            <span className="dot" />
          </span>
          <span className="subj-name">{only.name}</span>
          <span className="subj-sort-meta num">
            {ms > 0 && <span className="text-xs text-muted">{formatDuration(ms)}</span>}
            <span className="text-[11px] text-faint">用上方 ↑↓ 调组序</span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <Reorder.Group
      as="div"
      axis="y"
      values={subjects.map((s) => s.id)}
      onReorder={(ids) => setScopeSubjectOrder(scope, ids)}
      className="subj-list"
      data-sorting=""
    >
      {subjects.map((s) => (
        <ReorderSubjectRow key={s.id} subject={s} ms={todayBySubject[s.id] ?? 0} skin={skin} />
      ))}
    </Reorder.Group>
  )
}

/** 按「日常科目 | 全真模考」分栏展示；支持进入排序模式用 Motion Reorder 拖拽置顶常用科目与调整科目组顺序 */
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
  const order = useSubjectOrder()
  const [sorting, setSorting] = useState(false)
  const groupsRef = useRef<HTMLDivElement>(null)
  const gliderRef = useRef<HTMLDivElement>(null)
  const prevStateRef = useRef<{ selected: string | null; tab: SubjectTab; skin: string; sorting: boolean } | null>(null)

  const syncGlider = useCallback(
    (animate: boolean) => {
      const groupsEl = groupsRef.current
      const gliderEl = gliderRef.current
      if (!groupsEl || !gliderEl || groupsEl.clientWidth === 0 || sorting) {
        if (gliderEl) {
          gliderEl.style.opacity = '0'
          delete gliderEl.dataset.glide
        }
        if (groupsEl) delete groupsEl.dataset.gliderReady
        return
      }
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
    [selected, sorting],
  )

  useLayoutEffect(() => {
    const prev = prevStateRef.current
    const shouldAnimate =
      !sorting &&
      !!prev &&
      !prev.sorting &&
      prev.tab === tab &&
      prev.skin === skin &&
      prev.selected !== null &&
      selected !== null &&
      prev.selected !== selected
    prevStateRef.current = { selected, tab, skin, sorting }
    syncGlider(shouldAnimate)
  }, [selected, tab, skin, sorting, order, syncGlider])

  useLayoutEffect(() => {
    const el = groupsRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => syncGlider(false))
    ro.observe(el)
    return () => ro.disconnect()
  }, [syncGlider])

  const dailyGroups = orderedGroups(order)
  const mockSubjects = orderedSubjects(order, 'mock')
  const mockGroupMs = mockSubjects.reduce((a, s) => a + (todayBySubject[s.id] ?? 0), 0)
  const isCustom = !isDefaultSubjectOrder(order)

  const moveGroup = (gid: GroupId, dir: -1 | 1) => {
    const cur = [...order.groups]
    const idx = cur.indexOf(gid)
    const nextIdx = idx + dir
    if (idx < 0 || nextIdx < 0 || nextIdx >= cur.length) return
    ;[cur[idx], cur[nextIdx]] = [cur[nextIdx], cur[idx]]
    setGroupOrder(cur)
  }

  return (
    <div className="subj-wrap mt-5">
      <div className="subj-toolbar flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Segmented value={tab} options={TAB_OPTIONS} onChange={(v) => onTabChange(v)} />
        </div>
        {sorting && isCustom && (
          <button
            type="button"
            onClick={resetSubjectOrder}
            className="subj-sort-reset shrink-0 text-xs font-medium text-muted"
          >
            恢复默认
          </button>
        )}
        <button
          type="button"
          onClick={() => setSorting((v) => !v)}
          aria-pressed={sorting}
          className="subj-sort-btn shrink-0"
        >
          <IconSort size={14} />
          <span>{sorting ? '完成' : '排序'}</span>
        </button>
      </div>

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
          dailyGroups.map((g, gIdx) => {
            const subs = orderedSubjects(order, g.id)
            const groupMs = subs.reduce((a, s) => a + (todayBySubject[s.id] ?? 0), 0)
            return (
              <motion.section key={g.id} layout={sorting ? 'position' : false} transition={layoutTransition(skin)}>
                <div className="subj-head c" style={tint(g.color)}>
                  <h2 className="section-title">{g.name}</h2>
                  {sorting ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={gIdx === 0}
                        onClick={() => moveGroup(g.id, -1)}
                        aria-label={`${g.name} 上移`}
                        className="day-ring-step !h-6 !w-6 !text-xs disabled:opacity-35"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={gIdx === dailyGroups.length - 1}
                        onClick={() => moveGroup(g.id, 1)}
                        aria-label={`${g.name} 下移`}
                        className="day-ring-step !h-6 !w-6 !text-xs disabled:opacity-35"
                      >
                        ↓
                      </button>
                    </div>
                  ) : (
                    groupMs > 0 && <span className="num text-xs text-muted">今日 {formatDuration(groupMs)}</span>
                  )}
                </div>
                {sorting ? (
                  <SortableScopeList scope={g.id} subjects={subs} todayBySubject={todayBySubject} skin={skin} />
                ) : (
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
                )}
              </motion.section>
            )
          })
        ) : (
          <section key="mock">
            <div className="subj-head">
              <h2 className="section-title">{sorting ? '拖拽调整模考顺序' : '全真模考 · 180 分钟'}</h2>
              {!sorting && mockGroupMs > 0 && <span className="num text-xs text-muted">今日 {formatDuration(mockGroupMs)}</span>}
            </div>
            {sorting ? (
              <SortableScopeList scope="mock" subjects={mockSubjects} todayBySubject={todayBySubject} skin={skin} />
            ) : (
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
            )}
          </section>
        )}
      </div>
    </div>
  )
})
