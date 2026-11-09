import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { setAmbient } from '../ambient'
import { IconPause, IconPlay, IconStop } from '../components/icons'
import { SubjectGrid } from '../components/SubjectGrid'
import { TimerRing } from '../components/TimerRing'
import { fluidFill, GlowStat } from '../components/ui'
import { dayKey, diffDays } from '../domain/dates'
import { formatDuration } from '../domain/format'
import { getSubject } from '../domain/subjects'
import { elapsed } from '../domain/timer'
import { useNow } from '../hooks/useNow'
import { useLiveDaily } from '../hooks/useStats'
import { useWakeLock } from '../hooks/useWakeLock'
import { THEME_GREEN } from '../lib/color'
import { pause, resume, selectSubjectAndStart, stop, useApp } from '../store'

const pop = {
  initial: { scale: 0.8, opacity: 0 },
  exit: { scale: 0.8, opacity: 0 },
  whileTap: { scale: 0.92 },
  transition: { type: 'spring' as const, damping: 18, stiffness: 420 },
}

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
  const color = subject?.color ?? THEME_GREEN
  const ms = active ? elapsed(active, now) : 0

  // 背景环境光跟随科目颜色，计时中呼吸
  useEffect(() => {
    setAmbient({ color: subject?.color ?? null, running })
  }, [subject?.color, running])

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
        <GlowStat
          label={countdown >= 0 ? '距离初试' : '初试已过'}
          value={Math.abs(countdown)}
          unit="天"
          color="#f59e0b"
        />
        <GlowStat label="今日已学" value={formatDuration(todayTotal)} color={active ? color : THEME_GREEN} valueColor="var(--accent)" />
      </header>

      <div className="card mt-3 overflow-hidden px-3 pt-4 pb-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(70% 55% at 50% 38%, color-mix(in srgb, ${color} ${running ? 16 : 9}%, transparent) 0%, transparent 70%)`,
            transition: 'background .8s ease',
          }}
        />
        <div className="relative">
          <TimerRing
            ms={ms}
            color={color}
            running={running}
            active={!!active}
            label={subject ? subject.name : '选择一个科目'}
            sub={active ? (running ? '专注中 · 每圈 1 小时' : '已暂停') : '准备好了就开始'}
          />

          <div className="mt-3 flex h-16 items-center justify-center gap-4">
            <AnimatePresence mode="popLayout" initial={false}>
              {!active ? (
                <motion.button
                  key="start"
                  {...pop}
                  animate={{ scale: 1, opacity: selected ? 1 : 0.45 }}
                  disabled={!selected}
                  onClick={() => selected && selectSubjectAndStart(selected)}
                  className="flex h-16 items-center gap-2 rounded-full px-11 text-lg font-semibold"
                  style={fluidFill(color)}
                >
                  <IconPlay size={22} /> 开始
                </motion.button>
              ) : (
                <>
                  <motion.button
                    key="toggle"
                    {...pop}
                    animate={{ scale: 1, opacity: 1 }}
                    onClick={() => (running ? pause() : resume())}
                    className="flex h-16 w-16 items-center justify-center rounded-full"
                    style={fluidFill(color)}
                    aria-label={running ? '暂停' : '继续'}
                  >
                    {running ? <IconPause size={26} /> : <IconPlay size={26} />}
                  </motion.button>
                  <motion.button
                    key="stop"
                    {...pop}
                    animate={{ scale: 1, opacity: 1 }}
                    onClick={stop}
                    className="flex h-16 items-center gap-2 rounded-full px-7 text-base font-semibold"
                    style={{
                      background: 'var(--card-strong)',
                      border: '1px solid var(--card-border)',
                      boxShadow: 'var(--shadow), inset 0 1px 1px var(--card-highlight)',
                    }}
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
      </div>

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
