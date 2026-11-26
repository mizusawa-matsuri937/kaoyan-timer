import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { HEAT_VARS } from '../components/Heatmap'
import { IconPause, IconPlay, IconStop } from '../components/icons'
import { SubjectGrid, type SubjectTab } from '../components/SubjectGrid'
import { TimerDisplay } from '../components/TimerDisplay'
import { Button, Bar, Sheet, Stat, tint } from '../components/ui'
import { examPrepProgress, heatLevel, heatTierProgress, LEVEL_LABELS } from '../domain/aggregate'
import { dayKey, diffDays } from '../domain/dates'
import { formatDuration, formatDurationCeil, formatHMS } from '../domain/format'
import { getSubject, isMockSubject, SUBJECTS } from '../domain/subjects'
import { elapsed } from '../domain/timer'
import { useNow } from '../hooks/useNow'
import { useLiveDaily } from '../hooks/useStats'
import { useWakeLock } from '../hooks/useWakeLock'
import { THEME_GREEN } from '../lib/color'
import { useSkin } from '../skin'
import { pause, resume, selectSubjectAndStart, stop, useApp } from '../store'

interface ArchiveFeedback {
  id: number
  subjectName: string
  durationMs: number
  level: 0 | 1 | 2 | 3 | 4
  leveledUp: boolean
  color: string
}

export function TimerPage() {
  const active = useApp((s) => s.active)
  const sessions = useApp((s) => s.sessions)
  const settings = useApp((s) => s.settings)
  const skin = useSkin()
  const running = !!active && active.runningSince !== null
  const [archived, setArchived] = useState<ArchiveFeedback | null>(null)
  const [confirmSwitchId, setConfirmSwitchId] = useState<string | null>(null)
  const now = useNow(active ? 'second' : 'minute')
  const daily = useLiveDaily(now)
  useWakeLock(settings.keepAwake && running)

  // 默认选中上一次学习的科目
  const lastSubject = useMemo(() => {
    let best: { id: string; t: number } | null = null
    for (const s of sessions) if (!s.deleted && (!best || s.startAt > best.t)) best = { id: s.subjectId, t: s.startAt }
    return best?.id ?? null
  }, [sessions])
  const [picked, setPicked] = useState<string | null>(null)
  const selected = active?.subjectId ?? picked ?? lastSubject

  const [subjectTab, setSubjectTab] = useState<SubjectTab>(() =>
    isMockSubject(active?.subjectId ?? lastSubject) ? 'mock' : 'daily',
  )
  useEffect(() => {
    if (active) setSubjectTab(isMockSubject(active.subjectId) ? 'mock' : 'daily')
  }, [active?.subjectId])

  const today = dayKey(now)
  const todayStat = daily.get(today)
  const todayTotal = todayStat?.total ?? 0
  const countdown = diffDays(today, settings.examDate)
  const tier = useMemo(() => heatTierProgress(todayTotal), [todayTotal])
  const effectiveStart = useMemo(() => {
    let min = settings.startDate
    for (const d of daily.keys()) if (d < min) min = d
    return min
  }, [daily, settings.startDate])
  const prep = useMemo(
    () => examPrepProgress(effectiveStart, settings.examDate, today),
    [effectiveStart, settings.examDate, today],
  )

  const subject = selected ? getSubject(selected) : undefined
  const color = subject?.color ?? THEME_GREEN
  const ms = active ? elapsed(active, now) : 0
  const state = !active ? 'idle' : running ? 'running' : 'paused'
  // 模拟测试：面板改成整场考试的倒计时，到点只提醒、不自动结束
  const examMs = (subject?.examMinutes ?? 0) * 60000
  const over = !!active && examMs > 0 && ms >= examMs

  useEffect(() => {
    if (active) setArchived(null)
  }, [active])

  useEffect(() => {
    if (!archived) return
    const timer = setTimeout(() => setArchived(null), 3200)
    return () => clearTimeout(timer)
  }, [archived])

  const handleStop = () => {
    if (active && ms >= 1000) {
      const prevLevel = heatLevel(Math.max(0, todayTotal - ms))
      const nextLevel = heatLevel(todayTotal)
      setArchived({
        id: Date.now(),
        subjectName: subject?.short ?? subject?.name ?? '专注',
        durationMs: ms,
        level: nextLevel,
        leveledUp: nextLevel > prevLevel,
        color,
      })
    }
    void stop()
  }

  const handleSubjectTab = (next: SubjectTab) => {
    setSubjectTab(next)
    if (!active) {
      const curSub = selected ? getSubject(selected) : undefined
      if (next === 'mock' && (!curSub || !curSub.examMinutes)) {
        const match = SUBJECTS.find((s) => s.examMinutes && (!curSub || s.group === curSub.group))
        if (match) setPicked(match.id)
      } else if (next === 'daily' && curSub?.examMinutes) {
        let bestDaily: { id: string; t: number } | null = null
        for (const s of sessions) {
          if (!s.deleted && !isMockSubject(s.subjectId) && (!bestDaily || s.startAt > bestDaily.t)) {
            bestDaily = { id: s.subjectId, t: s.startAt }
          }
        }
        const fallback = SUBJECTS.find((s) => !s.examMinutes && s.group === curSub.group) ?? SUBJECTS[0]
        setPicked(bestDaily?.id ?? fallback.id)
      }
    }
  }

  const onPick = (id: string) => {
    if (active) {
      if (active.subjectId === id) {
        if (!running) void resume()
        return
      }
      // 模考进行中点击其他科目弹出二次确认，防止误触打断 3 小时全真模考
      if (isMockSubject(active.subjectId)) {
        setConfirmSwitchId(id)
        return
      }
      void selectSubjectAndStart(id)
    } else {
      setPicked(id)
    }
  }

  const targetSwitchSub = confirmSwitchId ? getSubject(confirmSwitchId) : undefined
  const activeMockSub = active && isMockSubject(active.subjectId) ? getSubject(active.subjectId) : undefined

  return (
    <div className="px-4 pb-6">
      <header className="grid grid-cols-2 gap-3 pt-2">
        <Stat
          label={countdown >= 0 ? '距离初试' : '初试已过'}
          value={Math.abs(countdown)}
          unit="天"
          color="#f59e0b"
          footer={
            <div className="stat-sub">
              <Bar pct={prep.pct} height={7} />
              <div className="stat-meta num mt-1.5">
                {countdown >= 0 ? (
                  <>
                    <span className="truncate">第 {prep.week} 周</span>
                    <span className="shrink-0">已走过 {Math.floor(prep.pct)}%</span>
                  </>
                ) : (
                  <span className="truncate">初试 {settings.examDate}</span>
                )}
              </div>
            </div>
          }
        />
        <Stat
          label="今日已学"
          value={formatDuration(todayTotal)}
          color={active ? color : THEME_GREEN}
          footer={
            <div className="stat-sub">
              <Bar pct={tier.pct} height={7} />
              <div className="stat-meta num mt-1.5">
                <span className="inline-flex min-w-0 items-center gap-1">
                  <span
                    className="heat-cell stat-heat-dot"
                    data-low={tier.level <= 1 ? '' : undefined}
                    style={{ background: HEAT_VARS[tier.level] }}
                    aria-hidden
                  />
                  <span className="truncate">
                    {tier.remainMs > 0 ? `差 ${formatDurationCeil(tier.remainMs)} 进 ${tier.nextTierLabel}` : tier.nextTierLabel}
                  </span>
                </span>
                {todayTotal > 0 && <span className="shrink-0">{Math.floor(tier.pct)}%</span>}
              </div>
            </div>
          }
        />
      </header>

      <section
        className="card timer c mt-3"
        style={tint(archived && !active ? archived.color : color)}
        data-state={state}
        data-over={over ? '' : undefined}
        data-archived={archived && !active ? '' : undefined}
      >
        <div className="timer-head">
          <span className="prompt">
            {subject ? subject.name : '选择一个科目'}
            {state !== 'running' && <span className="cursor" />}
          </span>
          <span className="status">
            <span className="dot" />
            {state === 'paused' ? '已暂停' : state === 'idle' ? '待开始' : over ? '已超时' : examMs ? '考试中' : '专注中'}
          </span>
        </div>

        <TimerDisplay ms={ms} active={!!active} running={running} skin={skin} examMs={examMs} />

        <AnimatePresence initial={false}>
          {archived && !active && (
            <motion.div
              key={archived.id}
              initial={{ height: 0, opacity: 0, scale: 0.96 }}
              animate={{ height: 'auto', opacity: 1, scale: 1 }}
              exit={{ height: 0, opacity: 0, scale: 0.97 }}
              transition={
                skin === 'terminal'
                  ? { duration: 0.14, ease: 'linear' }
                  : skin === 'brutal'
                    ? { type: 'spring', stiffness: 460, damping: 28 }
                    : { duration: 0.34, ease: [0.22, 1, 0.36, 1] }
              }
              className="overflow-hidden"
            >
              <div className="finish-banner num" role="status">
                <span className="heat-cell finish-swatch" style={{ background: HEAT_VARS[archived.level] }} aria-hidden />
                <span>
                  已归档 {archived.subjectName} +{formatDuration(archived.durationMs)}
                  {' · '}
                  {archived.leveledUp ? `升至「${LEVEL_LABELS[archived.level]}」` : `今日「${LEVEL_LABELS[archived.level]}」`}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <LayoutGroup id="timer-controls">
          <div className="timer-controls" data-active={active ? '' : undefined}>
            <motion.div
              layout
              transition={
                skin === 'terminal'
                  ? { duration: 0.14, ease: 'linear' }
                  : skin === 'brutal'
                    ? { type: 'spring', stiffness: 520, damping: 30 }
                    : { duration: 0.3, ease: [0.22, 1, 0.36, 1] }
              }
            >
              {!active ? (
                <Button className="btn-lg w-full" disabled={!selected} onClick={() => selected && selectSubjectAndStart(selected)}>
                  <IconPlay size={18} /> {examMs ? '开始考试' : '开始'}
                </Button>
              ) : (
                <Button className="btn-lg w-full" onClick={() => (running ? pause() : resume())}>
                  {running ? <IconPause size={18} /> : <IconPlay size={18} />}
                  {running ? '暂停' : '继续'}
                </Button>
              )}
            </motion.div>
            <AnimatePresence mode="popLayout" initial={false}>
              {active && (
                <motion.div
                  key="stop-btn"
                  layout
                  initial={{ opacity: 0, scale: 0.9, x: 10 }}
                  animate={{ opacity: 1, scale: 1, x: 0 }}
                  exit={{ opacity: 0, scale: 0.9, x: 10 }}
                  transition={
                    skin === 'terminal'
                      ? { duration: 0.12, ease: 'linear' }
                      : skin === 'brutal'
                        ? { type: 'spring', stiffness: 500, damping: 28 }
                        : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }
                  }
                >
                  <Button className="btn-lg w-full" variant="secondary" onClick={handleStop}>
                    <IconStop size={16} /> 结束
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      </section>

      <SubjectGrid
        tab={subjectTab}
        onTabChange={handleSubjectTab}
        selected={selected}
        activeId={active?.subjectId ?? null}
        running={running}
        todayBySubject={todayStat?.bySubject ?? {}}
        todayTotal={todayTotal}
        onPick={onPick}
      />

      <Sheet
        open={!!(confirmSwitchId && activeMockSub)}
        onClose={() => setConfirmSwitchId(null)}
        title="正在进行模拟测试"
      >
        {activeMockSub && targetSwitchSub && (
          <>
            <p className="mb-4 text-[15px] leading-relaxed text-muted">
              当前正在进行 <b style={{ color: activeMockSub.color }}>{activeMockSub.name}</b>（已用时{' '}
              <b className="num text-ink">{formatHMS(ms)}</b>），切换科目会立即结算并结束本场模考。确定切换到{' '}
              <b style={{ color: targetSwitchSub.color }}>{targetSwitchSub.name}</b> 吗？
            </p>
            <div className="grid gap-2.5">
              <Button onClick={() => setConfirmSwitchId(null)}>继续当前考试</Button>
              <Button
                variant="danger"
                onClick={() => {
                  const nextId = confirmSwitchId
                  setConfirmSwitchId(null)
                  if (nextId) void selectSubjectAndStart(nextId)
                }}
              >
                结束考试并切换
              </Button>
            </div>
          </>
        )}
      </Sheet>
    </div>
  )
}
