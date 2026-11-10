import { testLocks } from './fixtures'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildDaily, subjectTotals, sumValues } from '../src/domain/aggregate'
import { parseDay } from '../src/domain/dates'
import { segmentsTotal } from '../src/domain/timer'
import type { ActiveTimer, Session, SyncConfig } from '../src/domain/types'
import { getFile, GitHubError, putFile, type RemoteFile } from '../src/sync/github'
import { compareSessions, makeBackup, mergeSessions, mergeSettings, parseBackup } from '../src/sync/merge'
import { HOUR, MIN, NOW, config, deferred, session, settings } from './fixtures'

// 修复回归测试：真实 Dexie + 独立 fake-indexeddb，网络全部为模拟，虚拟时钟。
// 不读取真实学习数据，不使用真实 Token，不访问 GitHub。

vi.mock('../src/sync/github', async (original) => ({
  ...await original<typeof import('../src/sync/github')>(),
  getFile: vi.fn(), putFile: vi.fn(),
}))

type Store = typeof import('../src/store')
type Database = typeof import('../src/db/db')
const get = vi.mocked(getFile)
const put = vi.mocked(putFile)
let store: Store
let database: Database
let tabs: Array<{ store: Store; database: Database }>

const unhandled: unknown[] = []
const onUnhandled = (e: unknown) => { unhandled.push(e) }
beforeAll(() => { process.on('unhandledRejection', onUnhandled) })
afterAll(() => { process.off('unhandledRejection', onUnhandled) })

async function newTab() {
  vi.resetModules()
  const database = await import('../src/db/db')
  const store = await import('../src/store')
  tabs.push({ store, database })
  await store.init()
  return { store, database }
}

/** 让 fake-indexeddb（使用真实 setImmediate）把排队的读写跑完 */
async function flushIO(n = 50) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

/** 虚拟时间分步推进，每步之间让真实 I/O 完成 */
async function pump(totalMs: number, stepMs: number) {
  for (let t = 0; t < totalMs; t += stepMs) {
    await vi.advanceTimersByTimeAsync(stepMs)
    await flushIO()
  }
}

const crash = () => Dexie.Promise.reject(new DOMException('Simulated crash between writes', 'UnknownError'))
const remote = (rows: Session[] = [session()], remoteSettings = settings): RemoteFile => ({
  sha: 'remote-sha', text: JSON.stringify(makeBackup(rows, remoteSettings, NOW)),
})
const lastPut = () => parseBackup(put.mock.calls[put.mock.calls.length - 1][1])

beforeEach(async () => {
  unhandled.length = 0
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('navigator', { onLine: true, locks: testLocks })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network is forbidden in tests') }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  get.mockReset().mockResolvedValue(null)
  put.mockReset().mockResolvedValue('mock-sha')
  tabs = []
  vi.resetModules()
  database = await import('../src/db/db')
  await database.db.delete()
  await database.db.open()
  store = await import('../src/store')
  tabs.push({ store, database })
  await store.init()
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const tab of tabs) await tab.store.reloadFromDb()
  for (const tab of tabs) tab.database.db.close()
  await database.db.delete()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  await flushIO()
  expect(unhandled).toEqual([]) // 没有未处理的 Promise 拒绝
})

describe('R1 atomic settlement', () => {
  it('overtime endAt: a failed commit keeps the timer; the retry saves the corrected record once', async () => {
    store.selectSubjectAndStart('ds')
    await store.reloadFromDb()
    const id = store.getState().active!.sessionId
    vi.setSystemTime(NOW + 6 * HOUR)
    const spy = vi.spyOn(database.db.sessions, 'put').mockImplementationOnce(crash)
    expect(await store.resolveOvertime({ kind: 'endAt', endAt: NOW + 2 * HOUR })).toBe(false)
    spy.mockRestore()
    expect((await database.getMeta('activeTimer'))?.sessionId).toBe(id)
    expect(await database.db.sessions.count()).toBe(0)
    expect(store.getState().active?.sessionId).toBe(id)
    expect(await store.resolveOvertime({ kind: 'endAt', endAt: NOW + 2 * HOUR })).toBe(true)
    const rows = await database.db.sessions.toArray()
    expect(rows).toHaveLength(1)
    expect(segmentsTotal(rows[0].segments)).toBe(2 * HOUR)
    expect(await database.getMeta('activeTimer')).toBeNull()
  })

  it('a too-short stop is still discarded, clears the timer and does not mark a pending backup', async () => {
    store.selectSubjectAndStart('ds')
    await store.reloadFromDb()
    const seqBefore = (await database.getMeta('syncMeta'))?.seq ?? 0
    vi.setSystemTime(NOW + 500)
    expect(await store.stop()).toBe(true)
    expect(await database.db.sessions.count()).toBe(0)
    expect(await database.getMeta('activeTimer')).toBeNull()
    expect((await database.getMeta('syncMeta'))?.seq ?? 0).toBe(seqBefore)
  })

  it('a concurrent reader on another connection never observes a half-committed switch', async () => {
    const observer = new Dexie('kaoyan-timer')
    observer.version(1).stores({ sessions: 'id, startAt, updatedAt, subjectId', meta: 'key' })
    await observer.open()
    const subjects = ['ds', 'co', 'os', 'cn', 'calc', 'la', 'prob', 'english', 'politics']
    const snapshots: Array<{ active: ActiveTimer | undefined; ids: string[] }> = []
    let polling = true
    const poll = (async () => {
      while (polling) {
        snapshots.push(await observer.transaction('r', 'sessions', 'meta', async () => ({
          active: (await observer.table('meta').get('activeTimer'))?.value as ActiveTimer | undefined,
          ids: (await observer.table('sessions').toArray()).map((r: Session) => r.id),
        })))
      }
    })()
    try {
      const ops: Promise<boolean>[] = []
      for (let i = 0; i <= 60; i++) {
        vi.setSystemTime(NOW + i * MIN)
        ops.push(store.selectSubjectAndStart(subjects[i % subjects.length]))
      }
      expect((await Promise.all(ops)).every(Boolean)).toBe(true)
      await flushIO()
    } finally {
      polling = false
      await poll
      observer.close()
    }
    const rows = (await database.db.sessions.toArray()).sort((a, b) => a.startAt - b.startAt)
    const finalActive = (await database.getMeta('activeTimer'))!
    const order = new Map([...rows.map((r, i) => [r.id, i] as const), [finalActive.sessionId, rows.length]])
    expect(rows).toHaveLength(60)
    expect(rows.every((r) => segmentsTotal(r.segments) === MIN)).toBe(true)
    expect(snapshots.length).toBeGreaterThan(5)
    for (const snap of snapshots) {
      if (!snap.active) continue // 第一次开始之前
      expect(snap.ids).not.toContain(snap.active.sessionId) // 旧计时器与它的完成记录从不同时存在
      expect(snap.ids).toHaveLength(order.get(snap.active.sessionId)!) // 之前的每一段都已完整入库，没有丢失
    }
  })
})

describe('R2 stale tabs and concurrent windows', () => {
  it('a stale tab cannot stop a timer that was paused elsewhere (no over-counting)', async () => {
    store.selectSubjectAndStart('ds')
    await store.reloadFromDb()
    const second = await newTab()
    vi.setSystemTime(NOW + HOUR)
    expect(await store.pause()).toBe(true)
    vi.setSystemTime(NOW + 2 * HOUR)
    expect(await second.store.stop()).toBe(false) // B 仍以为在计时：拒绝并刷新
    expect(second.store.getState().active?.runningSince).toBeNull()
    expect(await database.db.sessions.count()).toBe(0)
    expect(await second.store.stop()).toBe(true) // 刷新后再操作才生效
    expect(segmentsTotal((await database.db.sessions.toArray())[0].segments)).toBe(HOUR)
  })

  it.each([1, 2, 3, 4, 5])('two windows pressing stop at the same moment save exactly one record (run %i)', async () => {
    store.selectSubjectAndStart('ds')
    await store.reloadFromDb()
    const second = await newTab()
    vi.setSystemTime(NOW + HOUR)
    const results = await Promise.all([store.stop(), second.store.stop()])
    expect(results.filter(Boolean)).toHaveLength(1)
    const rows = await database.db.sessions.toArray()
    expect(rows).toHaveLength(1)
    expect(segmentsTotal(rows[0].segments)).toBe(HOUR)
    expect(await database.getMeta('activeTimer')).toBeNull()
    expect(store.getState().active).toBeNull()
    expect(second.store.getState().active).toBeNull()
  })

  it.each([1, 2, 3, 4, 5])('two windows switching subjects at once never lose or duplicate time (run %i)', async () => {
    store.selectSubjectAndStart('ds')
    await store.reloadFromDb()
    const second = await newTab()
    vi.setSystemTime(NOW + HOUR)
    const [a, b] = await Promise.all([store.selectSubjectAndStart('os'), second.store.selectSubjectAndStart('prob')])
    expect(Number(a) + Number(b)).toBe(1)
    const rows = await database.db.sessions.toArray()
    const active = (await database.getMeta('activeTimer'))!
    expect(rows).toHaveLength(1)
    expect(rows[0].subjectId).toBe('ds')
    expect(segmentsTotal(rows[0].segments)).toBe(HOUR)
    expect(active.subjectId).toBe(a ? 'os' : 'prob')
    expect(store.getState().active?.sessionId).toBe(active.sessionId)
    expect(second.store.getState().active?.sessionId).toBe(active.sessionId)
  })

  it('a stale editor cannot overwrite or delete a record changed in another window', async () => {
    await store.saveSession(session('x'))
    const second = await newTab()
    const opened = second.store.getState().sessions.find((s) => s.id === 'x')!
    vi.setSystemTime(NOW + MIN)
    expect(await store.saveSession({ ...opened, subjectId: 'os' }, { expectedSession: opened })).toBe(true)
    expect(await second.store.saveSession({ ...opened, subjectId: 'la' }, { expectedSession: opened })).toBe(false)
    expect(await second.store.deleteSession('x', { expectedSession: opened })).toBe(false)
    const row = (await database.db.sessions.get('x'))!
    expect(row.subjectId).toBe('os')
    expect(row.deleted).toBe(false)
    expect(second.store.getState().sessions.find((s) => s.id === 'x')!.subjectId).toBe('os') // 已刷新
  })

  it.each([7, 99, 2024])('random bursts from two tabs keep one timer, unique records and conserved time (seed %i)', async (seed) => {
    const second = await newTab()
    let r = seed
    const rand = (n: number) => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) >>> 8) % n
    const subjects = ['ds', 'os', 'calc', 'english']
    let now = NOW
    const pending: Promise<unknown>[] = []
    for (let i = 0; i < 200; i++) {
      now += 1000 + rand(60_000)
      vi.setSystemTime(now)
      const tab = rand(2) ? store : second.store
      const op = rand(5)
      pending.push(op === 0 ? tab.pause() : op === 1 ? tab.resume() : op === 2 ? tab.stop() : tab.selectSubjectAndStart(subjects[rand(4)]))
      if (rand(10) === 0) pending.push(tab.reloadFromDb())
    }
    await Promise.all(pending)
    const rows = await database.db.sessions.toArray()
    const active = await database.getMeta('activeTimer')
    expect(new Set(rows.map((x) => x.id)).size).toBe(rows.length)
    if (active) expect(rows.map((x) => x.id)).not.toContain(active.sessionId)
    // 同一时刻只有一个计时器：所有段互不重叠，总时长不超过经过的时间
    const segs = [...rows.flatMap((x) => x.segments), ...(active?.segments ?? [])].sort((a, b) => a.start - b.start)
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeGreaterThanOrEqual(segs[i - 1].end)
    expect(segmentsTotal(segs)).toBeLessThanOrEqual(now - NOW)
    for (const tab of [store, second.store]) {
      await tab.reloadFromDb()
      expect(tab.getState().active?.sessionId ?? null).toBe(active?.sessionId ?? null)
      expect(tab.getState().sessions.length).toBe(rows.length)
    }
  })
})

describe('R3 asynchronous ordering', () => {
  it('a queued stop keeps the click time even when the queue is delayed', async () => {
    store.selectSubjectAndStart('ds')
    await store.reloadFromDb()
    const captured = deferred<void>()
    const release = deferred<void>()
    const originalGet = database.db.meta.get.bind(database.db.meta)
    vi.spyOn(database.db.meta, 'get').mockImplementationOnce((key) => Dexie.Promise.resolve(
      originalGet(key).then((row) => { captured.resolve(); return release.promise.then(() => row) }),
    ))
    const reload = store.reloadFromDb()
    await captured.promise
    vi.setSystemTime(NOW + HOUR)
    const stopping = store.stop() // 用户在第 1 小时点击结束
    vi.setSystemTime(NOW + 3 * HOUR) // 队列被拖延了 2 小时
    release.resolve()
    await reload
    expect(await stopping).toBe(true)
    expect(segmentsTotal((await database.db.sessions.toArray())[0].segments)).toBe(HOUR)
  })

  it('an edit made while a pull is in flight wins; DB, memory, export and the upload agree', async () => {
    await store.saveSession(session('x'))
    await store.setSyncConfig(config)
    const started = deferred<void>()
    const read = deferred<RemoteFile | null>()
    get.mockImplementationOnce(() => { started.resolve(); return read.promise })
    const syncing = store.syncNow()
    await started.promise
    vi.setSystemTime(NOW + MIN)
    const original = (await database.db.sessions.get('x'))!
    expect(await store.saveSession({ ...original, subjectId: 'os' }, { expectedSession: original })).toBe(true)
    read.resolve(remote([session('x')])) // 远端还是旧版本
    await syncing
    await store.reloadFromDb()
    const persisted = (await database.db.sessions.get('x'))!
    const inMemory = store.getState().sessions.find((s) => s.id === 'x')!
    const exported = parseBackup(store.exportBackupText()).sessions.find((s) => s.id === 'x')!
    expect(persisted.subjectId).toBe('os')
    expect(inMemory).toEqual(persisted)
    expect(exported).toEqual(persisted)
    expect(lastPut().sessions.find((s) => s.id === 'x')).toEqual(persisted)
    expect(store.getState().sync.dirty).toBe(false)
  })

  it('a pause made while a pull is in flight is not overwritten', async () => {
    await store.setSyncConfig(config)
    store.selectSubjectAndStart('ds')
    await store.reloadFromDb()
    const started = deferred<void>()
    const read = deferred<RemoteFile | null>()
    get.mockImplementationOnce(() => { started.resolve(); return read.promise })
    const syncing = store.syncNow()
    await started.promise
    vi.setSystemTime(NOW + HOUR)
    expect(await store.pause()).toBe(true)
    read.resolve(remote([session('other')]))
    await syncing
    expect(store.getState().active?.runningSince).toBeNull()
    expect((await database.getMeta('activeTimer'))?.runningSince).toBeNull()
    expect(store.getState().sessions.map((s) => s.id)).toContain('other')
  })
})

describe('R4 timeouts, cancellation and bounded retry', () => {
  it('transient failures back off with bounded, growing delays and keep the change pending', async () => {
    await store.setSyncConfig(config)
    get.mockReset().mockImplementation(() => Promise.reject(new TypeError('network down')))
    const calls: number[] = []
    get.mockImplementation(() => { calls.push(Date.now()); return Promise.reject(new TypeError('network down')) })
    await store.saveSession(session('pending'))
    await pump(2 * HOUR, 10_000)
    expect(calls).toHaveLength(9) // 首次 + 8 次退避重试，之后等待下一次触发
    for (let i = 2; i < calls.length; i++) expect(calls[i] - calls[i - 1]).toBeGreaterThanOrEqual(calls[i - 1] - calls[i - 2])
    expect(store.getState().sync.status).toBe('error')
    expect((await database.getMeta('syncMeta'))?.dirty).toBe(true)
    get.mockReset().mockResolvedValue(null)
    await store.syncNow({ manual: true })
    expect(store.getState().sync.status).toBe('ok')
    expect(lastPut().sessions.map((s) => s.id)).toContain('pending')
    expect((await database.getMeta('syncMeta'))?.dirty).toBe(false)
  })

  it('honours Retry-After from a rate-limit response', async () => {
    await store.setSyncConfig(config)
    get.mockReset()
      .mockRejectedValueOnce(new GitHubError(429, 'rate limited', 10 * MIN, true))
      .mockResolvedValue(null)
    await store.syncNow()
    expect(store.getState().sync.status).toBe('error')
    await pump(9 * MIN, 30_000)
    expect(get).toHaveBeenCalledTimes(1)
    await pump(3 * MIN, 30_000)
    expect(get).toHaveBeenCalledTimes(2)
    expect(store.getState().sync.status).toBe('ok')
  })

  it.each([401, 403, 404])('does not retry a definite auth/permission error (%i)', async (status) => {
    await store.setSyncConfig(config)
    get.mockReset().mockRejectedValue(new GitHubError(status, `HTTP ${status}`))
    await store.saveSession(session('pending'))
    await pump(2 * HOUR, 60_000)
    expect(get).toHaveBeenCalledTimes(1)
    expect(store.getState().sync.status).toBe('error')
    expect((await database.getMeta('syncMeta'))?.dirty).toBe(true)
  })

  it('a request that never answers times out, releases the task and is retried', async () => {
    const actual = await vi.importActual<typeof import('../src/sync/github')>('../src/sync/github')
    const hang = vi.fn(() => new Promise<Response>(() => {})) // 完全不理会 AbortSignal
    vi.stubGlobal('fetch', hang)
    get.mockImplementation((cfg, opts) => actual.getFile(cfg, opts))
    const enabling = store.setSyncConfig(config)
    await pump(31_000, 1000)
    await enabling
    expect(store.getState().sync.status).toBe('error')
    expect(store.getState().sync.lastError).toMatch(/超时/)
    get.mockReset().mockResolvedValue(null)
    await pump(10_000, 1000)
    expect(store.getState().sync.status).toBe('ok')
  })

  it('concurrent triggers share one sync task instead of running in parallel', async () => {
    await store.setSyncConfig(config)
    get.mockClear()
    const read = deferred<RemoteFile | null>()
    get.mockImplementationOnce(() => read.promise)
    const tasks = Array.from({ length: 10 }, () => store.syncNow())
    read.resolve(null)
    await Promise.all(tasks)
    expect(get).toHaveBeenCalledTimes(1)
  })
})

describe('R4 transport deadlines (real github module, mocked fetch)', () => {
  it('a response body that stalls is bounded by the request timeout', async () => {
    const actual = await vi.importActual<typeof import('../src/sync/github')>('../src/sync/github')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start() {} }), { status: 200 })))
    let error: unknown
    const task = actual.getFile(config).catch((e) => { error = e })
    await vi.advanceTimersByTimeAsync(actual.GET_TIMEOUT_MS + 1)
    await task
    expect((error as DOMException).name).toBe('TimeoutError')
  })

  it('an external abort cancels an in-flight upload immediately', async () => {
    const actual = await vi.importActual<typeof import('../src/sync/github')>('../src/sync/github')
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    const ac = new AbortController()
    let error: unknown
    const task = actual.putFile(config, '{}', null, 'test', { signal: ac.signal }).catch((e) => { error = e })
    ac.abort(new DOMException('closed', 'AbortError'))
    await task
    expect(actual.isAbort(error)).toBe(true)
  })

  it('classifies retryable vs permanent failures and parses Retry-After', async () => {
    const actual = await vi.importActual<typeof import('../src/sync/github')>('../src/sync/github')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"message":"slow down"}', { status: 403, headers: { 'Retry-After': '120' } })))
    const err = await actual.getFile(config).catch((e) => e)
    expect(err).toMatchObject({ status: 403, rateLimited: true, retryAfterMs: 120_000 })
    expect(actual.isTransient(err)).toBe(true)
    // vi.importActual 返回独立的模块实例，需要用它自己的 GitHubError 类构造
    expect(actual.isTransient(new actual.GitHubError(401, 'x'))).toBe(false)
    expect(actual.isTransient(new actual.GitHubError(403, 'forbidden'))).toBe(false)
    expect(actual.isTransient(new actual.GitHubError(503, 'x'))).toBe(true)
    expect(actual.isTransient(new TypeError('fetch failed'))).toBe(true)
  })
})

describe('R5 import validation and compatibility', () => {
  it('a backup mixing valid and damaged records is rejected as a whole and writes nothing', async () => {
    await store.saveSession(session('keep'))
    const text = JSON.stringify(makeBackup([session('new1'), session('keep', { updatedAt: NOW + 5, segments: [] })], null, NOW))
    await expect(store.importBackupText(text)).rejects.toThrow(/损坏/)
    expect(await database.db.sessions.get('new1')).toBeUndefined()
    expect(segmentsTotal((await database.db.sessions.get('keep'))!.segments)).toBe(HOUR)
  })

  it('legacy version-1 backups (incl. missing version and legacy tombstones) still import idempotently', async () => {
    const legacy = {
      app: 'kaoyan-timer', exportedAt: NOW,
      settings: { ...settings, examDate: '2027-12-20', updatedAt: NOW + 1 },
      sessions: [
        { id: 'old-1', subjectId: 'ds', segments: [{ start: NOW - HOUR, end: NOW }], startAt: NOW - HOUR, source: 'timer', createdAt: NOW - HOUR, updatedAt: NOW, deleted: false },
        { id: 'old-2', subjectId: 'os', segments: [{ start: NOW, end: NOW - 1 }], startAt: NOW, source: 'manual', createdAt: NOW, updatedAt: NOW, deleted: true },
      ],
    }
    expect(await store.importBackupText(JSON.stringify(legacy))).toBe(2)
    expect(await store.importBackupText(JSON.stringify({ ...legacy, version: 1 }))).toBe(0)
    expect((await database.db.sessions.get('old-2'))!.deleted).toBe(true)
    expect(store.getState().settings.examDate).toBe('2027-12-20')
    expect(parseBackup(store.exportBackupText()).sessions).toHaveLength(2)
  })

  it('unsupported versions and broken settings are rejected with readable errors', async () => {
    await expect(store.importBackupText(JSON.stringify({ ...makeBackup([], null, NOW), version: 2 }))).rejects.toThrow(/版本 2/)
    await expect(store.importBackupText(JSON.stringify({ ...makeBackup([], null, NOW), settings: { ...settings, examDate: '2027-02-30' } }))).rejects.toThrow(/设置/)
    expect(store.getState().settings.examDate).toBe('2027-12-25')
  })

  it('a damaged remote backup pauses sync without overwriting it or retrying', async () => {
    await store.setSyncConfig(config)
    await store.saveSession(session('local'))
    const damaged = JSON.stringify(makeBackup([session('r')], null, NOW)).replace(`"updatedAt":${NOW}`, '"updatedAt":1e400')
    get.mockReset().mockResolvedValue({ sha: 'sha', text: damaged })
    put.mockClear()
    await store.syncNow()
    await pump(HOUR, 60_000)
    expect(put).not.toHaveBeenCalled()
    expect(get).toHaveBeenCalledTimes(1)
    expect(store.getState().sync.lastError).toMatch(/损坏/)
    expect((await database.getMeta('syncMeta'))?.dirty).toBe(true)
    expect(await database.db.sessions.get('local')).toBeDefined()
  })

  it('saveSession rejects damaged input instead of storing an empty record', async () => {
    expect(await store.saveSession(session('bad', { segments: [{ start: NOW, end: NOW - HOUR }] }))).toBe(false)
    expect(await store.saveSession(session('bad', { segments: [{ start: NOW, end: Infinity }] }))).toBe(false)
    expect(await database.db.sessions.count()).toBe(0)
  })
})

describe('R6 revisions, clock correction and convergence', () => {
  it('an edit after a clock correction still beats the previously synced version', async () => {
    vi.setSystemTime(NOW + HOUR)
    await store.saveSession(session('x'))
    await store.setSyncConfig(config)
    const synced = (await database.db.sessions.get('x'))!
    vi.setSystemTime(NOW) // 时钟被往回校正 1 小时
    expect(await store.saveSession({ ...synced, subjectId: 'os' }, { expectedSession: synced })).toBe(true)
    const edited = (await database.db.sessions.get('x'))!
    expect(edited.updatedAt).toBeGreaterThan(synced.updatedAt)
    get.mockResolvedValue(remote([synced]))
    await store.syncNow()
    expect(store.getState().sessions.find((s) => s.id === 'x')!.subjectId).toBe('os')
    expect(lastPut().sessions.find((s) => s.id === 'x')!.subjectId).toBe('os')
  })

  it('settings revisions stay monotonic across a clock correction', async () => {
    vi.setSystemTime(NOW + HOUR)
    await store.updateSettings({ examDate: '2027-12-20' })
    const first = store.getState().settings
    vi.setSystemTime(NOW)
    await store.updateSettings({ examDate: '2027-12-21' })
    const second = store.getState().settings
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt)
    expect(mergeSettings(second, first)).toEqual(second)
    expect(mergeSettings(first, second)).toEqual(second)
  })

  it.each([3, 17, 4242])('replicas converge for random edits/deletes with colliding timestamps (seed %i)', (seed) => {
    let r = seed
    const rand = (n: number) => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) >>> 8) % n
    const subjects = ['ds', 'os', 'la']
    const variant = (id: string): Session => session(id, {
      updatedAt: NOW + rand(3), // 故意制造大量相同版本
      subjectId: subjects[rand(3)],
      deleted: rand(4) === 0,
    })
    for (let round = 0; round < 300; round++) {
      const ids = ['a', 'b', 'c', 'd']
      const A = ids.filter(() => rand(2)).map(variant)
      const B = ids.filter(() => rand(2)).map(variant)
      const C = ids.filter(() => rand(2)).map(variant)
      const sort = (xs: Session[]) => [...xs].sort((x, y) => x.id.localeCompare(y.id))
      const ab = sort(mergeSessions(A, B).merged)
      const ba = sort(mergeSessions(B, A).merged)
      expect(ab).toEqual(ba)
      const left = sort(mergeSessions(mergeSessions(A, B).merged, C).merged)
      const right = sort(mergeSessions(A, mergeSessions(B, C).merged).merged)
      expect(left).toEqual(right)
      // 合并后再与任一方合并，不应再报告需要推送给自己
      expect(mergeSessions(ab, ab).remoteChanged).toBe(false)
    }
  })

  it('a tombstone wins over an older or same-version ordinary record in both directions', () => {
    const live = session('t', { updatedAt: NOW + 5 })
    const tomb = session('t', { updatedAt: NOW + 5, deleted: true })
    const older = session('t', { updatedAt: NOW + 4, subjectId: 'os' })
    expect(compareSessions(tomb, live)).toBeGreaterThan(0)
    for (const other of [live, older]) {
      expect(mergeSessions([tomb], [other]).merged[0].deleted).toBe(true)
      expect(mergeSessions([other], [tomb]).merged[0].deleted).toBe(true)
    }
  })
})

describe('R7 settings changes and the in-flight sync version', () => {
  it('a settings change made while an upload is in flight is pushed afterwards', async () => {
    await store.setSyncConfig(config)
    const uploading = deferred<void>()
    const release = deferred<string>()
    put.mockImplementationOnce(() => { uploading.resolve(); return release.promise })
    await store.updateSettings({ examDate: '2027-12-20' })
    const syncing = store.syncNow()
    await uploading.promise
    expect(await store.updateSettings({ examDate: '2027-12-18' })).toBe(true) // 上传进行中再次修改
    release.resolve('sha-1')
    await syncing
    expect(lastPut().settings!.examDate).toBe('2027-12-18')
    expect((await database.getMeta('syncMeta'))?.dirty).toBe(false)
    expect(store.getState().sync.status).toBe('ok')
  })
})

describe('R8 disabling or switching backup', () => {
  it('disabling during an upload never flips the status back to ok and stops later requests', async () => {
    await store.setSyncConfig(config)
    await store.saveSession(session('p'))
    const uploading = deferred<void>()
    const release = deferred<string>()
    put.mockImplementationOnce(() => { uploading.resolve(); return release.promise })
    const syncing = store.syncNow()
    await uploading.promise
    await store.setSyncConfig(null)
    release.resolve('sha-late')
    await syncing
    const calls = get.mock.calls.length + put.mock.calls.length
    await store.saveSession(session('after-disable'))
    await pump(2 * HOUR, 60_000)
    expect(get.mock.calls.length + put.mock.calls.length).toBe(calls)
    expect(store.getState().sync.status).toBe('disabled')
    expect(await database.getMeta('syncConfig')).toBeNull()
  })

  it('disabling clears a pending backoff retry', async () => {
    await store.setSyncConfig(config)
    get.mockReset().mockRejectedValue(new TypeError('network down'))
    await store.syncNow()
    expect(store.getState().sync.status).toBe('error')
    await store.setSyncConfig(null)
    await pump(HOUR, 60_000)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('switching repositories never uploads to the old one after the switch', async () => {
    const other: SyncConfig = { ...config, repo: 'second-fixture-repo' }
    await store.setSyncConfig(config)
    await store.saveSession(session('p'))
    put.mockClear()
    const started = deferred<void>()
    const read = deferred<RemoteFile | null>()
    get.mockImplementationOnce(() => { started.resolve(); return read.promise })
    const syncing = store.syncNow()
    await started.promise
    await store.setSyncConfig(other)
    read.resolve(null)
    await syncing
    await pump(MIN, 5000)
    expect(put.mock.calls.length).toBeGreaterThan(0)
    expect(put.mock.calls.every(([cfg]) => cfg.repo === 'second-fixture-repo')).toBe(true)
  })

  it('disabling backup in another tab stops this tab before its upload', async () => {
    await store.setSyncConfig(config)
    const second = await newTab()
    await second.store.syncNow()
    put.mockClear()
    const started = deferred<void>()
    const read = deferred<RemoteFile | null>()
    get.mockImplementationOnce(() => { started.resolve(); return read.promise })
    await store.saveSession(session('p'))
    const syncing = store.syncNow()
    await started.promise
    await second.store.setSyncConfig(null)
    read.resolve(null)
    await syncing
    await store.reloadFromDb()
    await pump(MIN, 5000)
    expect(put).not.toHaveBeenCalled()
    expect(store.getState().sync.status).toBe('disabled')
  })
})

describe('migration, recovery and calendar boundaries', () => {
  it('legacy activeTimer without rev and syncMeta without seq keep working', async () => {
    await database.setMeta('activeTimer', { sessionId: 'legacy', subjectId: 'ds', segments: [], runningSince: NOW - HOUR, createdAt: NOW - HOUR, ackAt: null })
    await database.setMeta('syncMeta', { lastSyncAt: null, dirty: false, lastError: null })
    const tab = await newTab()
    expect(await tab.store.pause()).toBe(true)
    expect((await database.getMeta('activeTimer'))!.rev).toBe(1)
    expect(await tab.store.stop()).toBe(true)
    expect(segmentsTotal((await database.db.sessions.get('legacy'))!.segments)).toBe(HOUR)
    expect(await database.getMeta('syncMeta')).toMatchObject({ dirty: true, seq: 1 })
  })

  it('a legacy half-committed switch (timer + same-id record) settles into exactly one record', async () => {
    await database.setMeta('activeTimer', { sessionId: 'L', subjectId: 'ds', segments: [], runningSince: NOW - 2 * HOUR, createdAt: NOW - 2 * HOUR, ackAt: null })
    await database.db.sessions.put(session('L', { segments: [{ start: NOW - 2 * HOUR, end: NOW - HOUR }], startAt: NOW - 2 * HOUR, updatedAt: NOW - HOUR }))
    const tab = await newTab()
    expect(await tab.store.stop()).toBe(true)
    const rows = await database.db.sessions.toArray()
    expect(rows).toHaveLength(1)
    expect(segmentsTotal(rows[0].segments)).toBe(2 * HOUR)
    expect(rows[0].updatedAt).toBeGreaterThan(NOW - HOUR)
  })

  it('after rapid operations a reopened tab recovers exactly the persisted state', async () => {
    for (let i = 0; i < 50; i++) {
      vi.setSystemTime(NOW + i * 10_000)
      store.selectSubjectAndStart(i % 3 ? 'ds' : 'la')
      vi.setSystemTime(NOW + i * 10_000 + 3000)
      if (i % 4) store.pause()
      if (i % 5 === 0) store.stop()
    }
    await store.reloadFromDb()
    const reopened = await newTab()
    const byId = (xs: Session[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id))
    expect(byId(reopened.store.getState().sessions)).toEqual(byId(await database.db.sessions.toArray()))
    expect(byId(store.getState().sessions)).toEqual(byId(await database.db.sessions.toArray()))
    expect(reopened.store.getState().active).toEqual((await database.getMeta('activeTimer')) ?? null)
    expect(store.getState().active).toEqual(reopened.store.getState().active)
  })

  it('timers across midnight and a DST change are stored and split without losing a millisecond', async () => {
    const start = parseDay('2026-10-31').getTime() + 23.5 * HOUR // 本地 23:30（纽约 11-01 为 25 小时）
    const end = parseDay('2026-11-02').getTime() + 0.5 * HOUR
    vi.setSystemTime(start)
    store.selectSubjectAndStart('ds')
    vi.setSystemTime(end)
    expect(await store.stop()).toBe(true)
    const rows = await database.db.sessions.toArray()
    const daily = buildDaily(rows)
    expect(sumValues(subjectTotals(daily, null))).toBe(end - start)
    expect(daily.get('2026-10-31')!.total).toBe(HOUR / 2)
    expect(daily.get('2026-11-02')!.total).toBe(HOUR / 2)
    expect(daily.get('2026-11-01')!.total).toBe(parseDay('2026-11-02').getTime() - parseDay('2026-11-01').getTime())
  })
})
