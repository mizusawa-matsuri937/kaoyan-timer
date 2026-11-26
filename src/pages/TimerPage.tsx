import { useEffect, useMemo, useState } from 'react'
import { HEAT_VARS } from '../components/Heatmap'
import { IconPause, IconPlay, IconStop } from '../components/icons'
import { SubjectGrid } from '../components/SubjectGrid'
import { TimerDisplay } from '../components/TimerDisplay'
import { Button, Bar, Stat, tint } from '../components/ui'
import { heatLevel, heatTierProgress, LEVEL_LABELS } from '../domain/aggregate'
import { dayKey, diffDays } from '../domain/dates'
import { formatDuration, formatDurationCeil } from '../domain/format'
import { getSubject } from '../domain/subjects'
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

  const today = dayKey(now)
  const todayStat = daily.get(today)
  const todayTotal = todayStat?.total ?? 0
  const countdown = diffDays(today, settings.examDate)
  const tier = useMemo(() => heatTierProgress(todayTotal), [todayTotal])

  const subject = selected ? getSubject(selected) : undefined
  const color = subject?.color ?? THEME_GREEN
  const ms = active ? elapsed(active, now) : 0
  const state = !active ? 'idle' : running ? 'running' : 'paused'
  // 模拟测试：面板改成整场考试的倒计时，到点只提醒、不自动结束
  const examMs = (subject?.examMinutes ?? 0) * 60000
  const over = !!active && examMs > 0 && ms >= examMs

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

  const onPick = (id: string) => {
    if (active) {
      if (active.subjectId !== id) void selectSubjectAndStart(id)
      else if (!running) void resume()
    } else {
      setPicked(id)
    }
  }

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
              <div className="stat-meta num">
                <span>初试 {settings.examDate}</span>
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

        {archived && !active && (
          <div key={archived.id} className="finish-banner num" role="status">
            <span className="heat-cell finish-swatch" style={{ background: HEAT_VARS[archived.level] }} aria-hidden />
            <span>
              已归档 {archived.subjectName} +{formatDuration(archived.durationMs)}
              {' · '}
              {archived.leveledUp ? `升至「${LEVEL_LABELS[archived.level]}」` : `今日「${LEVEL_LABELS[archived.level]}」`}
            </span>
          </div>
        )}

        <div className="timer-controls" data-active={active ? '' : undefined}>
          {!active ? (
            <Button className="btn-lg" disabled={!selected} onClick={() => selected && selectSubjectAndStart(selected)}>
              <IconPlay size={18} /> {examMs ? '开始考试' : '开始'}
            </Button>
          ) : (
            <>
              <Button className="btn-lg" onClick={() => (running ? pause() : resume())}>
                {running ? <IconPause size={18} /> : <IconPlay size={18} />}
                {running ? '暂停' : '继续'}
              </Button>
              <Button className="btn-lg" variant="secondary" onClick={handleStop}>
                <IconStop size={16} /> 结束
              </Button>
            </>
          )}
        </div>
        <p className="mt-3 text-center text-xs text-faint">
          {active ? '计时中点其他科目会自动保存当前这段并切换' : selected ? '可以在下方换一个科目' : '先在下方选择科目'}
        </p>
      </section>

      <SubjectGrid
        selected={selected}
        activeId={active?.subjectId ?? null}
        running={running}
        todayBySubject={todayStat?.bySubject ?? {}}
        todayTotal={todayTotal}
        onPick={onPick}
      />
    </div>
  )
}
