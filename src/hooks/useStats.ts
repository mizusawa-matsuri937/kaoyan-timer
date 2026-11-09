import { useMemo } from 'react'
import { buildDaily, withLive, type Daily } from '../domain/aggregate'
import { liveSegments } from '../domain/timer'
import { useApp } from '../store'

/** 基础每日统计（只在记录变化时重算） */
export function useBaseDaily(): Daily {
  const sessions = useApp((s) => s.sessions)
  return useMemo(() => buildDaily(sessions), [sessions])
}

/** 叠加正在计时部分的每日统计（传入 now 实时刷新） */
export function useLiveDaily(now: number): Daily {
  const base = useBaseDaily()
  const active = useApp((s) => s.active)
  return useMemo(
    () => (active ? withLive(base, active.subjectId, liveSegments(active, now)) : base),
    [base, active, now],
  )
}

export function useVisibleSessions() {
  const sessions = useApp((s) => s.sessions)
  return useMemo(() => sessions.filter((s) => !s.deleted), [sessions])
}
