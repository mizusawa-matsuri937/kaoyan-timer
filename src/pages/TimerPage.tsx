import { useMemo, useState } from 'react'
import { IconPause, IconPlay, IconStop } from '../components/icons'
import { SubjectGrid } from '../components/SubjectGrid'
import { TimerDisplay } from '../components/TimerDisplay'
import { Button, Stat, tint } from '../components/ui'
import { dayKey, diffDays } from '../domain/dates'
import { formatDuration } from '../domain/format'
import { getSubject } from '../domain/subjects'
import { elapsed } from '../domain/timer'
import { useNow } from '../hooks/useNow'
import { useLiveDaily } from '../hooks/useStats'
import { useWakeLock } from '../hooks/useWakeLock'
import { THEME_GREEN } from '../lib/color'
import { useSkin } from '../skin'
import { pause, resume, selectSubjectAndStart, stop, useApp } from '../store'

export function TimerPage() {
  const active = useApp((s) => s.active)
  const sessions = useApp((s) => s.sessions)
  const settings = useApp((s) => s.settings)
  const skin = useSkin()
  const running = !!active && active.runningSince !== null
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

  const subject = selected ? getSubject(selected) : undefined
  const color = subject?.color ?? THEME_GREEN
  const ms = active ? elapsed(active, now) : 0
  const state = !active ? 'idle' : running ? 'running' : 'paused'

  const onPick = (id: string) => {
    if (active) {
      if (active.subjectId !== id) selectSubjectAndStart(id)
      else if (!running) resume()
    } else {
      setPicked(id)
    }
  }

  return (
    <div className="px-4 pb-6">
      <header className="grid grid-cols-2 gap-3 pt-2">
        <Stat label={countdown >= 0 ? '距离初试' : '初试已过'} value={Math.abs(countdown)} unit="天" color="#f59e0b" />
        <Stat label="今日已学" value={formatDuration(todayTotal)} color={active ? color : THEME_GREEN} />
      </header>

      <section className="card timer c mt-3" style={tint(color)} data-state={state}>
        <div className="timer-head">
          <span className="prompt">
            {subject ? subject.name : '选择一个科目'}
            {state !== 'running' && <span className="cursor" />}
          </span>
          <span className="status">
            <span className="dot" />
            {state === 'running' ? '专注中' : state === 'paused' ? '已暂停' : '待开始'}
          </span>
        </div>

        <TimerDisplay ms={ms} active={!!active} skin={skin} />

        <div className="timer-controls" data-active={active ? '' : undefined}>
          {!active ? (
            <Button className="btn-lg" disabled={!selected} onClick={() => selected && selectSubjectAndStart(selected)}>
              <IconPlay size={18} /> 开始
            </Button>
          ) : (
            <>
              <Button className="btn-lg" onClick={() => (running ? pause() : resume())}>
                {running ? <IconPause size={18} /> : <IconPlay size={18} />}
                {running ? '暂停' : '继续'}
              </Button>
              <Button className="btn-lg" variant="secondary" onClick={stop}>
                <IconStop size={16} /> 结束
              </Button>
            </>
          )}
        </div>
        <p className="mt-3 text-center text-xs text-faint">
          {active ? '计时中点其他科目会自动保存当前这段并切换' : selected ? '可以在下方换一个科目' : '先在下方选择科目'}
        </p>
      </section>

      <div className="mt-6">
        <SubjectGrid
          selected={selected}
          activeId={active?.subjectId ?? null}
          running={running}
          todayBySubject={todayStat?.bySubject ?? {}}
          todayTotal={todayTotal}
          onPick={onPick}
        />
      </div>
    </div>
  )
}
