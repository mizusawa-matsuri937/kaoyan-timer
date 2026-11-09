import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { IconPause, IconPlay, IconStop } from '../components/icons'
import { SubjectGrid } from '../components/SubjectGrid'
import { TimerRing } from '../components/TimerRing'
import { dayKey, diffDays } from '../domain/dates'
import { formatDuration } from '../domain/format'
import { getSubject } from '../domain/subjects'
import { elapsed } from '../domain/timer'
import { useNow } from '../hooks/useNow'
import { useLiveDaily } from '../hooks/useStats'
import { useWakeLock } from '../hooks/useWakeLock'
import { pause, resume, selectSubjectAndStart, stop, useApp } from '../store'

export function TimerPage() {
  const active = useApp((s) => s.active)
  const sessions = useApp((s) => s.sessions)
  const settings = useApp((s) => s.settings)
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
  const color = subject?.color ?? 'var(--accent)'
  const ms = active ? elapsed(active, now) : 0

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
      <header className="flex items-end justify-between pt-2">
        <div>
          <div className="text-[13px] text-muted">{countdown >= 0 ? '距离初试' : '初试已过'}</div>
          <div className="num text-[28px] font-bold leading-tight">
            {Math.abs(countdown)}
            <span className="ml-1 text-base font-semibold text-muted">天</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[13px] text-muted">今日已学</div>
          <div className="num text-[28px] font-bold leading-tight" style={{ color: 'var(--accent)' }}>
            {formatDuration(todayTotal)}
          </div>
        </div>
      </header>

      <div className="card mt-4 px-4 pt-6 pb-5">
        <TimerRing
          ms={ms}
          color={color}
          running={running}
          label={subject ? subject.name : '选择一个科目'}
          sub={active ? (running ? '计时中 · 每圈 1 小时' : '已暂停') : '点击开始计时'}
        />

        <div className="mt-5 flex items-center justify-center gap-4">
          <AnimatePresence mode="popLayout" initial={false}>
            {!active ? (
              <motion.button
                key="start"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: selected ? 1 : 0.4 }}
                exit={{ scale: 0.8, opacity: 0 }}
                whileTap={{ scale: 0.92 }}
                disabled={!selected}
                onClick={() => selected && selectSubjectAndStart(selected)}
                className="flex h-16 items-center gap-2 rounded-full px-10 text-lg font-semibold text-white disabled:opacity-40"
                style={{ background: color, boxShadow: `0 10px 30px -8px ${subject?.color ?? '#16a34a'}` }}
              >
                <IconPlay size={22} /> 开始
              </motion.button>
            ) : (
              <>
                <motion.button
                  key="toggle"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={() => (running ? pause() : resume())}
                  className="flex h-16 w-16 items-center justify-center rounded-full text-white"
                  style={{ background: color, boxShadow: `0 10px 30px -8px ${subject?.color}` }}
                  aria-label={running ? '暂停' : '继续'}
                >
                  {running ? <IconPause size={26} /> : <IconPlay size={26} />}
                </motion.button>
                <motion.button
                  key="stop"
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  whileTap={{ scale: 0.92 }}
                  onClick={stop}
                  className="flex h-16 items-center gap-2 rounded-full bg-card-2 px-7 text-base font-semibold"
                >
                  <IconStop size={18} /> 结束
                </motion.button>
              </>
            )}
          </AnimatePresence>
        </div>
        <p className="mt-3 text-center text-xs text-faint">
          {active ? '计时中点其他科目会自动保存当前这段并切换' : selected ? '可以在下方换一个科目' : '先在下方选择科目'}
        </p>
      </div>

      <div className="mt-6">
        <SubjectGrid
          selected={selected}
          activeId={active?.subjectId ?? null}
          running={running}
          todayBySubject={todayStat?.bySubject ?? {}}
          onPick={onPick}
        />
      </div>
    </div>
  )
}
