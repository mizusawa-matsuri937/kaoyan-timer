import { useSyncExternalStore } from 'react'
import { dayKey } from './domain/dates'

/**
 * #10D · 按日期归档的每日微目标（Stroke Checklist）本地存储：
 * - 以 YYYY-MM-DD 为键持久化每一天的任务与完成情况，支持在热度页「每日详情」中随时回溯历史某天的完成度；
 * - 自动兼容并迁移旧版 v1 单日数据，不改动 IndexedDB 表结构与云端同步协议。
 */
export interface DailyGoal {
  id: string
  text: string
  done: boolean
}

type GoalsByDay = Record<string, DailyGoal[]>

const STORAGE_KEY_V2 = 'kaoyan.dailyGoals.v2'
const STORAGE_KEY_V1 = 'kaoyan.dailyGoals.v1'
const MAX_GOALS_PER_DAY = 6
const MAX_DAYS_RETAINED = 400
const EMPTY_GOALS: DailyGoal[] = []
const listeners = new Set<() => void>()

let cache: GoalsByDay = loadFromStorage()

function todayStr(): string {
  return dayKey(Date.now())
}

function sanitizeItems(raw: unknown): DailyGoal[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (x): x is DailyGoal =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as DailyGoal).id === 'string' &&
        typeof (x as DailyGoal).text === 'string' &&
        (x as DailyGoal).text.trim().length > 0 &&
        typeof (x as DailyGoal).done === 'boolean',
    )
    .slice(0, MAX_GOALS_PER_DAY)
}

function loadFromStorage(): GoalsByDay {
  if (typeof localStorage === 'undefined') return {}
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2)
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: GoalsByDay = {}
        for (const [day, list] of Object.entries(parsed)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
          const clean = sanitizeItems(list)
          if (clean.length > 0) out[day] = clean
        }
        return out
      }
    }
    // 平滑迁移旧版 v1 单日格式
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1)
    if (rawV1) {
      const parsed = JSON.parse(rawV1) as { day?: string; items?: unknown }
      if (parsed && typeof parsed.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.day)) {
        const clean = sanitizeItems(parsed.items)
        if (clean.length > 0) {
          const migrated: GoalsByDay = { [parsed.day]: clean }
          localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(migrated))
          return migrated
        }
      }
    }
  } catch {
    /* 隐私模式或损坏数据 */
  }
  return {}
}

function pruneAndCommit(next: GoalsByDay) {
  const days = Object.keys(next).sort()
  if (days.length > MAX_DAYS_RETAINED) {
    const trimmed: GoalsByDay = {}
    for (const d of days.slice(days.length - MAX_DAYS_RETAINED)) {
      if (next[d]?.length) trimmed[d] = next[d]
    }
    cache = trimmed
  } else {
    cache = next
  }
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(cache))
  } catch {
    /* ignore */
  }
  for (const l of listeners) l()
}

export function getGoalsForDay(day: string): DailyGoal[] {
  return cache[day] ?? EMPTY_GOALS
}

export function addGoalForDay(day: string, text: string): boolean {
  const clean = text.trim().slice(0, 28)
  if (!clean) return false
  const cur = cache[day] ?? EMPTY_GOALS
  if (cur.length >= MAX_GOALS_PER_DAY) return false
  if (cur.some((x) => x.text === clean)) return false
  const id = `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  pruneAndCommit({ ...cache, [day]: [...cur, { id, text: clean, done: false }] })
  return true
}

export function toggleGoalForDay(day: string, id: string): void {
  const cur = cache[day]
  if (!cur) return
  const next = cur.map((x) => (x.id === id ? { ...x, done: !x.done } : x))
  pruneAndCommit({ ...cache, [day]: next })
}

export function removeGoalForDay(day: string, id: string): void {
  const cur = cache[day]
  if (!cur) return
  const filtered = cur.filter((x) => x.id !== id)
  const copy = { ...cache }
  if (filtered.length > 0) copy[day] = filtered
  else delete copy[day]
  pruneAndCommit(copy)
}

export function addDailyGoal(text: string): boolean {
  return addGoalForDay(todayStr(), text)
}

export function toggleDailyGoal(id: string): void {
  toggleGoalForDay(todayStr(), id)
}

export function removeDailyGoal(id: string): void {
  removeGoalForDay(todayStr(), id)
}

export function seedDailyGoals(items: Array<{ text: string; done?: boolean }>): void {
  seedGoalsByDay({ [todayStr()]: items })
}

export function seedGoalsByDay(byDay: Record<string, Array<{ text: string; done?: boolean }>>): void {
  const next: GoalsByDay = { ...cache }
  const stamp = Date.now().toString(36)
  for (const [day, list] of Object.entries(byDay)) {
    const clean: DailyGoal[] = list.slice(0, MAX_GOALS_PER_DAY).map((it, idx) => ({
      id: `seed-${day}-${idx}-${stamp}`,
      text: it.text.trim().slice(0, 28),
      done: !!it.done,
    }))
    if (clean.length > 0) next[day] = clean
    else delete next[day]
  }
  pruneAndCommit(next)
}

export function clearDailyGoals(): void {
  pruneAndCommit({})
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useGoalsForDay(day: string): DailyGoal[] {
  return useSyncExternalStore(
    subscribe,
    () => cache[day] ?? EMPTY_GOALS,
    () => cache[day] ?? EMPTY_GOALS,
  )
}

export function useDailyGoals(): DailyGoal[] {
  return useGoalsForDay(todayStr())
}
