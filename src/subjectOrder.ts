import { useSyncExternalStore } from 'react'
import { GROUPS, SUBJECTS, type Group, type GroupId, type Subject } from './domain/subjects'

export type OrderScope = GroupId | 'mock'

export interface SubjectOrderState {
  groups: GroupId[]
  byScope: Record<OrderScope, string[]>
}

const ORDER_KEY = 'kaoyan.subjectOrder'

const DEFAULT_GROUPS: GroupId[] = GROUPS.map((g) => g.id)
const DEFAULT_BY_SCOPE: Record<OrderScope, string[]> = {
  cs408: SUBJECTS.filter((s) => s.group === 'cs408' && !s.examMinutes).map((s) => s.id),
  math: SUBJECTS.filter((s) => s.group === 'math' && !s.examMinutes).map((s) => s.id),
  english: SUBJECTS.filter((s) => s.group === 'english' && !s.examMinutes).map((s) => s.id),
  politics: SUBJECTS.filter((s) => s.group === 'politics' && !s.examMinutes).map((s) => s.id),
  mock: SUBJECTS.filter((s) => !!s.examMinutes).map((s) => s.id),
}

function normalizeList<T extends string>(input: unknown, canonical: readonly T[]): T[] {
  const allowed = new Set<string>(canonical)
  const seen = new Set<string>()
  const out: T[] = []
  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string' && allowed.has(item) && !seen.has(item)) {
        seen.add(item)
        out.push(item as T)
      }
    }
  }
  for (const c of canonical) {
    if (!seen.has(c)) out.push(c)
  }
  return out
}

function parseOrder(raw: string | null): SubjectOrderState {
  let parsed: { groups?: unknown; byScope?: Record<string, unknown> } | null = null
  if (raw) {
    try {
      parsed = JSON.parse(raw) as { groups?: unknown; byScope?: Record<string, unknown> }
    } catch {
      parsed = null
    }
  }
  const src = parsed?.byScope ?? {}
  return {
    groups: normalizeList(parsed?.groups, DEFAULT_GROUPS),
    byScope: {
      cs408: normalizeList(src.cs408, DEFAULT_BY_SCOPE.cs408),
      math: normalizeList(src.math, DEFAULT_BY_SCOPE.math),
      english: normalizeList(src.english, DEFAULT_BY_SCOPE.english),
      politics: normalizeList(src.politics, DEFAULT_BY_SCOPE.politics),
      mock: normalizeList(src.mock, DEFAULT_BY_SCOPE.mock),
    },
  }
}

function readRaw(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(ORDER_KEY) : null
  } catch {
    return null
  }
}

function writeState(next: SubjectOrderState) {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ORDER_KEY, JSON.stringify(next))
    }
  } catch {
    /* ignore quota / privacy errors */
  }
}

let state: SubjectOrderState = parseOrder(readRaw())
const listeners = new Set<() => void>()

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (e) => {
    if (e.key !== ORDER_KEY) return
    state = parseOrder(e.newValue)
    for (const l of listeners) l()
  })
}

function commit(next: SubjectOrderState) {
  state = next
  writeState(next)
  for (const l of listeners) l()
}

export function setGroupOrder(groups: GroupId[]) {
  commit({
    ...state,
    groups: normalizeList(groups, DEFAULT_GROUPS),
  })
}

export function setScopeSubjectOrder(scope: OrderScope, ids: string[]) {
  commit({
    ...state,
    byScope: {
      ...state.byScope,
      [scope]: normalizeList(ids, DEFAULT_BY_SCOPE[scope]),
    },
  })
}

export function resetSubjectOrder() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(ORDER_KEY)
  } catch {
    /* ignore */
  }
  state = parseOrder(null)
  for (const l of listeners) l()
}

export function isDefaultSubjectOrder(cur: SubjectOrderState = state): boolean {
  if (cur.groups.some((g, i) => g !== DEFAULT_GROUPS[i])) return false
  for (const scope of Object.keys(DEFAULT_BY_SCOPE) as OrderScope[]) {
    const def = DEFAULT_BY_SCOPE[scope]
    if (cur.byScope[scope].some((id, i) => id !== def[i])) return false
  }
  return true
}

export function orderedGroups(cur: SubjectOrderState): Group[] {
  const map = new Map(GROUPS.map((g) => [g.id, g]))
  return cur.groups.map((id) => map.get(id)!).filter(Boolean)
}

export function orderedSubjects(cur: SubjectOrderState, scope: OrderScope): Subject[] {
  const map = new Map(SUBJECTS.map((s) => [s.id, s]))
  return cur.byScope[scope].map((id) => map.get(id)!).filter(Boolean)
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
const getSnapshot = () => state

export function getSubjectOrder(): SubjectOrderState {
  return state
}

export function useSubjectOrder(): SubjectOrderState {
  return useSyncExternalStore(subscribe, getSnapshot)
}
