import { locks } from 'node:worker_threads'
import type { Session, Settings, SyncConfig } from '../src/domain/types'

export const NOW = Date.parse('2026-11-09T08:00:00Z')
export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

export const settings: Settings = {
  examDate: '2027-12-25', startDate: '2026-11-09',
  overtimeHours: 4, keepAwake: false, updatedAt: NOW,
}

export const config: SyncConfig = {
  owner: 'audit-fixture', repo: 'not-a-real-target', path: 'data.json', token: 'TEST-ONLY',
}

export function session(id = 'sample', patch: Partial<Session> = {}): Session {
  return {
    id, subjectId: 'ds', segments: [{ start: NOW - HOUR, end: NOW }],
    startAt: NOW - HOUR, source: 'timer', createdAt: NOW - HOUR,
    updatedAt: NOW, deleted: false, ...patch,
  }
}

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

// Node's native Web Locks implementation; shared across the simulated tabs in a test.
export const testLocks = locks as unknown as LockManager
