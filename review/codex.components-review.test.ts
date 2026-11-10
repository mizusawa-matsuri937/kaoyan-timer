import { testLocks } from './fixtures'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { getFile, putFile } from '../src/sync/github'
import { buildDaily, subjectTotals, sumValues } from '../src/domain/aggregate'
import { startTimer, segmentsTotal } from '../src/domain/timer'
import { makeBackup } from '../src/sync/merge'
import { HOUR, NOW, session } from './fixtures'

// Event-handler / hook calculation unit harness, not a browser render test.
// State slots start at their already-rendered values. Effects/DOM are not simulated.
// Business store and Dexie writes are real; only React scheduling and network are mocked.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refs: [] as Array<{ current: unknown }>, refCursor: 0 }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const at = hooks.cursor++
    if (!(at in hooks.values)) hooks.values[at] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[at], (value: unknown) => {
      hooks.values[at] = typeof value === 'function' ? value(hooks.values[at]) : value
    }]
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refCursor++] ??= { current: initial },
  useEffect: () => {},
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}))
vi.mock('../src/sync/github', async (original) => ({
  ...await original<typeof import('../src/sync/github')>(), getFile: vi.fn(), putFile: vi.fn(),
}))

type Store = typeof import('../src/store')
type Database = typeof import('../src/db/db')
let store: Store
let database: Database

function findElement(node: ReactNode, label: string): ReactElement<{ onClick: () => unknown; disabled?: boolean }> {
  if (Array.isArray(node)) {
    for (const child of node) { try { return findElement(child, label) } catch { /* try the next child */ } }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const el = node as ReactElement<{ children?: ReactNode; onClick: () => unknown; disabled?: boolean }>
    if (el.props.children === label && typeof el.props.onClick === 'function') return el
    return findElement(el.props.children, label)
  }
  throw new Error(`No handler found for ${label}`)
}

function localInput(ts: number) {
  const d = new Date(ts)
  const pad = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('navigator', { onLine: false, locks: testLocks })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live network is forbidden') }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(getFile).mockReset().mockResolvedValue(null)
  vi.mocked(putFile).mockReset().mockResolvedValue('synthetic-sha')
  hooks.values = []
  hooks.cursor = 0
  hooks.refs = []
  hooks.refCursor = 0
  vi.resetModules()
  database = await import('../src/db/db')
  await database.db.delete()
  await database.db.open()
  store = await import('../src/store')
  await store.init()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await store.reloadFromDb()
  database.db.close()
  await database.db.delete()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Codex: asynchronous UI handlers and actual statistics hook calculations', () => {
  it('[C7] clicking manual-save twice before the first save finishes must create only one record', async () => {
    const { SessionEditor } = await import('../src/components/SessionEditor')
    hooks.values = ['ds', [{ start: localInput(NOW - HOUR), end: localInput(NOW) }], false]
    const close = vi.fn()
    const tree = SessionEditor({ target: { kind: 'new', day: localInput(NOW).slice(0, 10) }, onClose: close })
    const button = findElement(tree, '保存')
    expect(button.props.disabled).not.toBe(true)
    const first = button.props.onClick()
    expect(close).not.toHaveBeenCalled() // the editor remains open while saving
    const second = button.props.onClick()
    await Promise.all([first, second])
    const rows = await database.db.sessions.toArray()
    expect({ count: rows.length, total: rows.reduce((n, r) => n + segmentsTotal(r.segments), 0) })
      .toEqual({ count: 1, total: HOUR })
  })

  it('[C8] a failed overtime settlement must keep the correction dialog open for retry', async () => {
    await store.selectSubjectAndStart('ds')
    vi.setSystemTime(NOW + HOUR)
    await store.pause()
    vi.setSystemTime(NOW + 2 * HOUR)
    await store.resume()
    vi.setSystemTime(NOW + 6 * HOUR)
    const before = store.getState().active
    hooks.values = [true, Date.now(), 'choose', '']
    const { OvertimeDialog } = await import('../src/components/OvertimeDialog')
    const tree = OvertimeDialog()
    const spy = vi.spyOn(database.db.sessions, 'put').mockImplementationOnce(() =>
      Dexie.Promise.reject(new DOMException('Synthetic quota failure', 'QuotaExceededError')))
    findElement(tree, '丢弃这一段').props.onClick()
    await store.reloadFromDb()
    spy.mockRestore()
    expect(store.getState().active).toEqual(before)
    expect(await database.db.sessions.count()).toBe(0)
    expect(hooks.values[0]).toBe(true)
  })

  it('C7 failed save can be retried with the same draft ID and a single success callback', async () => {
    const { SessionEditor } = await import('../src/components/SessionEditor')
    hooks.values = ['ds', [{ start: localInput(NOW - HOUR), end: localInput(NOW) }], false]
    const close = vi.fn()
    const target = { kind: 'new' as const, day: localInput(NOW).slice(0, 10) }
    const firstTree = SessionEditor({ target, onClose: close })
    const spy = vi.spyOn(database.db.sessions, 'put').mockImplementationOnce(() =>
      Dexie.Promise.reject(new DOMException('Synthetic quota', 'QuotaExceededError')))
    const button = findElement(firstTree, '保存')
    await Promise.all([button.props.onClick(), button.props.onClick()])
    expect(spy).toHaveBeenCalledTimes(1)
    const firstId = spy.mock.calls[0][0].id
    expect(close).not.toHaveBeenCalled()
    expect(await database.db.sessions.count()).toBe(0)
    hooks.cursor = 0; hooks.refCursor = 0 // render again with persistent hook slots
    const retryTree = SessionEditor({ target, onClose: close })
    expect(findElement(retryTree, '保存').props.disabled).not.toBe(true)
    await findElement(retryTree, '保存').props.onClick()
    expect(spy.mock.calls[1][0].id).toBe(firstId)
    expect(close).toHaveBeenCalledTimes(1)
    expect(await database.db.sessions.count()).toBe(1)
  })

  it('C1 the actual editor passes its original full snapshot and stays open after a same-version conflict', async () => {
    await store.saveSession(session('edit'))
    const opened = (await database.db.sessions.get('edit'))!
    const { SessionEditor } = await import('../src/components/SessionEditor')
    hooks.values = ['la', [{ start: localInput(NOW - HOUR), end: localInput(NOW) }], false]
    const close = vi.fn()
    const tree = SessionEditor({ target: { kind: 'edit', session: opened }, onClose: close })
    await store.importBackupText(JSON.stringify(makeBackup([{ ...opened, subjectId: 'os' }], null, NOW)))
    await findElement(tree, '保存').props.onClick()
    expect(close).not.toHaveBeenCalled()
    expect((await database.db.sessions.get('edit'))!.subjectId).toBe('os')
  })

  it.each(['keep', 'discard', 'endAt'] as const)('C8 %s keeps inputs on failure and closes only after successful retry', async (kind) => {
    await store.selectSubjectAndStart('ds')
    vi.setSystemTime(NOW + HOUR)
    await store.pause()
    vi.setSystemTime(NOW + 2 * HOUR)
    await store.resume()
    vi.setSystemTime(NOW + 7 * HOUR)
    const before = store.getState().active
    const end = localInput(NOW + 3 * HOUR)
    hooks.values = [true, Date.now(), kind === 'endAt' ? 'endAt' : 'choose', end]
    const { OvertimeDialog } = await import('../src/components/OvertimeDialog')
    const tree = OvertimeDialog()
    const label = kind === 'keep' ? '一直在学，全部保留并继续计时' : kind === 'discard' ? '丢弃这一段' : '保存并结束'
    const original = database.db.meta.put.bind(database.db.meta)
    const spy = vi.spyOn(database.db.meta, 'put').mockImplementation((row, key) => row.key === 'activeTimer'
      ? Dexie.Promise.reject(new DOMException('Synthetic failure', 'UnknownError')) : original(row, key))
    const button = findElement(tree, label)
    await Promise.all([button.props.onClick(), button.props.onClick()])
    expect(hooks.values[0]).toBe(true)
    expect(hooks.values[3]).toBe(end)
    expect(store.getState().active).toEqual(before)
    spy.mockRestore()
    await button.props.onClick()
    expect(hooks.values[0]).toBe(false)
    if (kind === 'keep') expect(store.getState().active!.ackAt).toBe(Date.now())
    else {
      expect(store.getState().active).toBeNull()
      const rows = await database.db.sessions.toArray()
      expect(rows).toHaveLength(1)
      expect(segmentsTotal(rows[0].segments)).toBe(kind === 'discard' ? HOUR : 2 * HOUR)
    }
  })

  it('Q12 useLiveDaily counts a legacy active/archived ID once without mutating the DB', async () => {
    const timer = startTimer('ds', NOW)
    const sameId = session(timer.sessionId, { startAt: NOW, segments: [{ start: NOW, end: NOW + HOUR }] })
    const other = session('other')
    await database.db.sessions.bulkPut([sameId, other])
    await database.setMeta('activeTimer', timer)
    await store.reloadFromDb()
    const { useBaseDaily, useLiveDaily } = await import('../src/hooks/useStats')
    expect(sumValues(subjectTotals(useBaseDaily(), null))).toBe(HOUR)
    expect(sumValues(subjectTotals(useLiveDaily(NOW + 2 * HOUR), null))).toBe(3 * HOUR)
    expect(sumValues(subjectTotals(buildDaily(await database.db.sessions.toArray()), null))).toBe(2 * HOUR)
  })

  it('Q12 useLiveDaily includes all archived records when no timer is active', async () => {
    await store.saveSession(session('a'))
    await store.saveSession(session('b', { subjectId: 'os' }))
    const { useLiveDaily } = await import('../src/hooks/useStats')
    expect(sumValues(subjectTotals(useLiveDaily(NOW), null))).toBe(2 * HOUR)
  })
})
