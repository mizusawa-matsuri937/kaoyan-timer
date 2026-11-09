import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBackup, parseBackup } from '../src/sync/merge'
import { getFile, GitHubError, putFile, type RemoteFile } from '../src/sync/github'
import { elapsed, segmentsTotal } from '../src/domain/timer'
import { DAY, HOUR, MIN, NOW, config, deferred, session, settings } from './fixtures'

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

async function newTab() {
  vi.resetModules()
  const database = await import('../src/db/db')
  const store = await import('../src/store')
  tabs.push({ store, database })
  await store.init()
  return { store, database }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network is forbidden in audit tests') }))
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
  // Drain queued writes before closing the isolated, in-memory database.
  vi.restoreAllMocks()
  for (const tab of tabs) await tab.store.reloadFromDb()
  for (const tab of tabs) tab.database.db.close()
  await database.db.delete()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const remote = (rows = [session()], remoteSettings = settings): RemoteFile => ({
  sha: 'remote-sha', text: JSON.stringify(makeBackup(rows, remoteSettings, NOW)),
})

describe('store persistence and recovery with real Dexie + fake IndexedDB', () => {
  it('recovers the active timer after a new module instance and 30 days', async () => {
    store.selectSubjectAndStart('ds')
    await store.reloadFromDb()
    const id = store.getState().active!.sessionId
    vi.setSystemTime(NOW + 30 * DAY)
    const reopened = await newTab()
    expect(reopened.store.getState().active!.sessionId).toBe(id)
    expect(elapsed(reopened.store.getState().active!, Date.now())).toBe(30 * DAY)
  })

  it('recovers paused state after 180 days and excludes the paused interval', async () => {
    store.selectSubjectAndStart('ds')
    vi.setSystemTime(NOW + HOUR)
    store.pause()
    await store.reloadFromDb()
    vi.setSystemTime(NOW + 180 * DAY)
    const reopened = await newTab()
    expect(reopened.store.getState().active!.runningSince).toBeNull()
    expect(elapsed(reopened.store.getState().active!, Date.now())).toBe(HOUR)
  })

  it('serializes 500 rapid start/pause/resume/stop sequences without losing records', async () => {
    for (let i = 0; i < 500; i++) {
      const start = NOW + i * 10_000
      vi.setSystemTime(start)
      store.selectSubjectAndStart(i % 2 ? 'ds' : 'os')
      vi.setSystemTime(start + 2000)
      store.pause()
      vi.setSystemTime(start + 4000)
      store.resume()
      vi.setSystemTime(start + 7000)
      store.stop()
    }
    await store.reloadFromDb()
    const rows = await database.db.sessions.toArray()
    expect(rows).toHaveLength(500)
    expect(new Set(rows.map((row) => row.id)).size).toBe(500)
    expect(rows.reduce((n, row) => n + segmentsTotal(row.segments), 0)).toBe(500 * 5000)
    expect(await database.getMeta('activeTimer')).toBeNull()
  })

  it('imports the same backup idempotently and preserves tombstones', async () => {
    const text = JSON.stringify(makeBackup([session('a'), session('b', { deleted: true })], settings, NOW))
    expect(await store.importBackupText(text)).toBe(2)
    expect(await store.importBackupText(text)).toBe(0)
    await store.reloadFromDb()
    expect(await database.db.sessions.count()).toBe(2)
    expect((await database.db.sessions.get('b'))!.deleted).toBe(true)
    expect(parseBackup(store.exportBackupText()).sessions).toHaveLength(2)
  })

  it('stores offline edits and syncs them after connectivity is restored', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await store.setSyncConfig(config)
    store.saveSession(session())
    await store.reloadFromDb()
    expect(store.getState().sync.status).toBe('offline')
    expect(get).not.toHaveBeenCalled()
    vi.stubGlobal('navigator', { onLine: true })
    await store.syncNow()
    expect(put).toHaveBeenCalledTimes(1)
    expect(parseBackup(put.mock.calls[0][1]).sessions).toHaveLength(1)
    expect(store.getState().sync.dirty).toBe(false)
  })

  it('retries a SHA conflict by reading and merging the latest remote content', async () => {
    await store.setSyncConfig(config)
    store.saveSession(session('local'))
    await store.reloadFromDb()
    get.mockResolvedValue(remote([session('other')]))
    put.mockClear().mockRejectedValueOnce(new GitHubError(409, 'conflict')).mockResolvedValue('new-sha')
    await store.syncNow()
    expect(put).toHaveBeenCalledTimes(2)
    expect(parseBackup(put.mock.calls[1][1]).sessions.map((s) => s.id).sort()).toEqual(['local', 'other'])
    expect(store.getState().sync.status).toBe('ok')
  })

  it('bounds conflict retries and allows a subsequent manual recovery', async () => {
    await store.setSyncConfig(config)
    get.mockResolvedValue(null)
    put.mockClear().mockRejectedValue(new GitHubError(409, 'conflict'))
    await store.syncNow()
    expect(put).toHaveBeenCalledTimes(4)
    expect(store.getState().sync.status).toBe('error')
    put.mockResolvedValue('recovered-sha')
    await store.syncNow()
    expect(store.getState().sync.status).toBe('ok')
  })

  it('continues processing later writes after an IndexedDB transaction abort', async () => {
    const failOneRecord = (_key: unknown, row: { id: string }) => {
      if (row.id === 'abort-this-write') throw new DOMException('Injected storage failure', 'QuotaExceededError')
    }
    database.db.sessions.hook('creating', failOneRecord)
    store.saveSession(session('abort-this-write'))
    store.saveSession(session('next-write'))
    await store.reloadFromDb()
    database.db.sessions.hook('creating').unsubscribe(failOneRecord)
    expect(await database.db.sessions.get('abort-this-write')).toBeUndefined()
    expect((await database.db.sessions.get('next-write'))!.id).toBe('next-write')
  })
})

describe('regression contracts: interrupted writes and interleavings', () => {
  it('[R1] an aborted finish write must retain the recoverable timer', async () => {
    store.selectSubjectAndStart('ds')
    await store.reloadFromDb()
    const id = store.getState().active!.sessionId
    const failWrite = () => { throw new DOMException('Injected storage failure', 'QuotaExceededError') }
    database.db.sessions.hook('creating', failWrite)
    vi.setSystemTime(NOW + HOUR)
    store.stop()
    await store.reloadFromDb()
    database.db.sessions.hook('creating').unsubscribe(failWrite)
    const active = await database.getMeta('activeTimer')
    const saved = await database.db.sessions.get(id)
    expect(Boolean(active || saved)).toBe(true)
  })

  // 修复说明（fix-summary.md「测试调整」）：原用例把单个表操作挂在测试外部的 Promise 上来观察两次提交之间的窗口。
  // 结算改为单个 IndexedDB 读写事务后，这种注入不再成立：事务不能跨外部等待保持打开，被延迟的写入会在
  // Dexie 事务区之外以独立的隐式事务执行，测到的是测试自己制造的拆分（已用诊断用例证实）。
  // 改为在同一提交边界让事务中断（等价于进程在写入之间退出/写入失败），并对每个写入点分别注入；
  // 业务不变量保持不变：提交前数据库里必须始终保留可恢复的计时器，且不能出现半提交状态。
  const crashAt = (point: 'session' | 'activeTimer' | 'syncMeta') => {
    const crash = () => Dexie.Promise.reject(new DOMException('Simulated crash between writes', 'UnknownError'))
    if (point === 'session') return vi.spyOn(database.db.sessions, 'put').mockImplementationOnce(crash)
    const originalPut = database.db.meta.put.bind(database.db.meta)
    return vi.spyOn(database.db.meta, 'put').mockImplementation((row, key) => (row.key === point ? crash() : originalPut(row, key)))
  }

  it('[R1] stop must leave a recoverable timer until the finished record is committed', async () => {
    for (const point of ['session', 'activeTimer', 'syncMeta'] as const) {
      store.selectSubjectAndStart('ds')
      await store.reloadFromDb()
      const timer = store.getState().active!
      const spy = crashAt(point)
      vi.setSystemTime(Date.now() + HOUR)
      const ok = await store.stop()
      await store.reloadFromDb() // drain this tab's queue
      spy.mockRestore()
      // This is the durable DB state if the process dies at this exact boundary.
      const persistedActive = await database.getMeta('activeTimer')
      const persistedSession = await database.db.sessions.get(timer.sessionId)
      expect(Boolean(persistedActive || persistedSession)).toBe(true)
      expect(persistedActive?.sessionId).toBe(timer.sessionId)
      expect(persistedSession).toBeUndefined()
      expect(store.getState().active?.sessionId).toBe(timer.sessionId) // 内存与数据库一致，可以重试
      expect(ok).toBe(false)
      expect(await store.stop()).toBe(true)
      expect(segmentsTotal((await database.db.sessions.get(timer.sessionId))!.segments)).toBe(HOUR)
      expect(await database.getMeta('activeTimer')).toBeNull()
    }
    expect(await database.db.sessions.count()).toBe(3)
  })

  it('[R1] switching subject must not expose the old timer and its finished record together', async () => {
    for (const point of ['session', 'activeTimer', 'syncMeta'] as const) {
      await store.stop()
      store.selectSubjectAndStart('ds')
      await store.reloadFromDb()
      const previousId = store.getState().active!.sessionId
      const spy = crashAt(point)
      vi.setSystemTime(Date.now() + HOUR)
      const ok = await store.selectSubjectAndStart('os')
      await store.reloadFromDb() // drain this tab's queue
      spy.mockRestore()
      const active = await database.getMeta('activeTimer')
      const saved = await database.db.sessions.get(previousId)
      expect(Boolean(saved && active?.sessionId === saved.id)).toBe(false)
      expect(active?.sessionId).toBe(previousId) // 整体回滚：旧计时器仍可恢复
      expect(saved).toBeUndefined()
      expect(ok).toBe(false)
      expect(await store.selectSubjectAndStart('os')).toBe(true)
      const after = await database.getMeta('activeTimer')
      expect(after?.subjectId).toBe('os')
      expect(segmentsTotal((await database.db.sessions.get(previousId))!.segments)).toBe(HOUR)
    }
  })

  it('[R2] a stale second tab must not clear a newer timer from the first tab', async () => {
    store.selectSubjectAndStart('ds')
    await store.reloadFromDb()
    const second = await newTab()
    vi.setSystemTime(NOW + HOUR)
    store.stop()
    store.selectSubjectAndStart('os')
    await store.reloadFromDb()
    const nextId = store.getState().active!.sessionId
    vi.setSystemTime(NOW + HOUR + MIN)
    second.store.stop()
    await second.store.reloadFromDb()
    expect((await database.getMeta('activeTimer'))?.sessionId).toBe(nextId)
  })

  it('[R3] a foreground reload must not overwrite a pause made during its DB read', async () => {
    store.selectSubjectAndStart('ds')
    await store.reloadFromDb()
    const captured = deferred<void>()
    const releaseRead = deferred<void>()
    const originalGet = database.db.meta.get.bind(database.db.meta)
    vi.spyOn(database.db.meta, 'get').mockImplementationOnce((key) => Dexie.Promise.resolve(
      originalGet(key).then((row) => {
        captured.resolve()
        return releaseRead.promise.then(() => row)
      }),
    ))
    const reload = store.reloadFromDb()
    await captured.promise
    vi.setSystemTime(NOW + HOUR)
    store.pause()
    releaseRead.resolve()
    await reload
    // A subsequent user action turns the stale read into durable overcounting.
    vi.setSystemTime(NOW + 2 * HOUR)
    store.stop()
    await store.reloadFromDb()
    const saved = await database.db.sessions.toArray()
    expect(segmentsTotal(saved[0].segments)).toBe(HOUR)
  })

  it('[R3] a remote pull must not undo a newer delete made during bulkPut', async () => {
    store.saveSession(session())
    await store.reloadFromDb()
    await store.setSyncConfig(config)
    get.mockResolvedValue(remote([session('sample', { updatedAt: NOW + 1000, subjectId: 'os' })]))
    const entered = deferred<void>()
    const releaseWrite = deferred<void>()
    const originalBulkPut = database.db.sessions.bulkPut.bind(database.db.sessions)
    vi.spyOn(database.db.sessions, 'bulkPut').mockImplementationOnce((rows) => {
      entered.resolve()
      return Dexie.Promise.resolve(releaseWrite.promise.then(() => originalBulkPut(rows)))
    })
    const syncing = store.syncNow()
    await entered.promise
    vi.setSystemTime(NOW + 2000)
    store.deleteSession('sample')
    releaseWrite.resolve()
    await syncing
    const inMemory = store.getState().sessions.find((row) => row.id === 'sample')!
    const persisted = await database.db.sessions.get('sample')
    expect(persisted!.deleted).toBe(true)
    expect(inMemory.deleted).toBe(true)
  })

  it('[R5] importing a damaged newer record must not erase a valid saved duration', async () => {
    store.saveSession(session())
    await store.reloadFromDb()
    const bad = session('sample', { updatedAt: NOW + 1000, segments: [{ start: NOW, end: NOW - HOUR }] })
    try { await store.importBackupText(JSON.stringify(makeBackup([bad], null, NOW))) } catch { /* rejection is safe */ }
    await store.reloadFromDb()
    expect(segmentsTotal((await database.db.sessions.get('sample'))!.segments)).toBe(HOUR)
  })

  it('[R7] a settings-only import must schedule a new backup', async () => {
    await store.setSyncConfig(config)
    get.mockClear()
    put.mockClear()
    const updated = { ...store.getState().settings, examDate: '2027-12-20', updatedAt: NOW + 1 }
    await store.importBackupText(JSON.stringify(makeBackup([], updated, NOW)))
    await vi.advanceTimersByTimeAsync(2000)
    await store.syncNow({ throttle: true }) // does not force a sync inside the 30s throttle window
    expect(put).toHaveBeenCalled()
  })

  it('[R4] a transient network failure must retry while the page stays open and online', async () => {
    await store.setSyncConfig(config)
    get.mockClear().mockRejectedValueOnce(new TypeError('temporary network failure')).mockResolvedValue(null)
    await store.syncNow()
    expect(store.getState().sync.status).toBe('error')
    await vi.advanceTimersByTimeAsync(HOUR)
    expect(get.mock.calls.length).toBeGreaterThan(1)
  })

  it('[R8] disabling backup must prevent an in-flight read from starting a later upload', async () => {
    await store.setSyncConfig(config)
    put.mockClear()
    const started = deferred<void>()
    const read = deferred<RemoteFile | null>()
    get.mockImplementationOnce(() => { started.resolve(); return read.promise })
    const syncing = store.syncNow()
    await started.promise
    await store.setSyncConfig(null)
    read.resolve(null)
    await syncing
    expect(put).not.toHaveBeenCalled()
    expect(store.getState().sync.status).toBe('disabled')
  })

  it('[R6] correcting the system clock must not resurrect a just-deleted record', async () => {
    vi.setSystemTime(NOW + HOUR)
    store.saveSession(session())
    await store.reloadFromDb()
    const beforeDelete = store.getState().sessions[0]
    await store.setSyncConfig(config)
    vi.setSystemTime(NOW)
    store.deleteSession(beforeDelete.id)
    await store.reloadFromDb()
    get.mockResolvedValue(remote([beforeDelete]))
    await store.syncNow()
    expect(store.getState().sessions[0].deleted).toBe(true)
  })
})
