import { testLocks } from './fixtures'
import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFile, putFile, type RemoteFile } from '../src/sync/github'
import { checkSession, checkSettings, makeBackup, MAX_TIMESTAMP, MAX_REVISION, mergeSessions, parseBackup } from '../src/sync/merge'
import { segmentsTotal } from '../src/domain/timer'
import type { Session } from '../src/domain/types'
import { HOUR, NOW, config, deferred, session, settings } from './fixtures'

// Original reproductions of 88b7396, followed by fix acceptance tests.
// All IndexedDB data is synthetic and in-memory; transport is mocked.
vi.mock('../src/sync/github', async (original) => ({
  ...await original<typeof import('../src/sync/github')>(), getFile: vi.fn(), putFile: vi.fn(),
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
  if (store.getState().syncConfig) await store.syncNow()
  return { store, database }
}

async function flushIO(n = 30) {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => setImmediate(r))
}

const remote = (rows: Session[], remoteSettings = settings): RemoteFile => ({
  sha: 'synthetic-sha', text: JSON.stringify(makeBackup(rows, remoteSettings, NOW)),
})

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('navigator', { onLine: true, locks: testLocks })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live network is forbidden') }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  get.mockReset().mockResolvedValue(null)
  put.mockReset().mockResolvedValue('synthetic-sha')
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
  for (const tab of tabs) await tab.store.setSyncConfig(null)
  for (const tab of tabs) await tab.store.reloadFromDb()
  for (const tab of tabs) tab.database.db.close()
  await database.db.delete()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Codex: defects beyond the existing 136 tests', () => {
  it('[C1] an editor opened before a same-revision remote change must not overwrite it', async () => {
    await store.saveSession(session('edit'))
    const opened = (await database.db.sessions.get('edit'))!
    const otherDevice = { ...opened, subjectId: 'os' }
    get.mockResolvedValue(remote([otherDevice], store.getState().settings))
    await store.setSyncConfig(config)
    expect((await database.db.sessions.get('edit'))!.subjectId).toBe('os')
    expect(otherDevice.updatedAt).toBe(opened.updatedAt) // deterministic tie-break was used
    const accepted = await store.saveSession({ ...opened, subjectId: 'la' }, { expectedSession: opened })
    expect({ accepted, subject: (await database.db.sessions.get('edit'))!.subjectId })
      .toEqual({ accepted: false, subject: 'os' })
  })

  it('[C1] an editor opened before a same-revision remote tombstone must not resurrect it', async () => {
    await store.saveSession(session('delete'))
    const opened = (await database.db.sessions.get('delete'))!
    get.mockResolvedValue(remote([{ ...opened, deleted: true }], store.getState().settings))
    await store.setSyncConfig(config)
    expect((await database.db.sessions.get('delete'))!.deleted).toBe(true)
    const accepted = await store.saveSession(opened, { expectedSession: opened })
    expect({ accepted, deleted: (await database.db.sessions.get('delete'))!.deleted })
      .toEqual({ accepted: false, deleted: true })
  })

  it('[C2] rejecting a stale timer action must refresh the finished session as well as activeTimer', async () => {
    await store.selectSubjectAndStart('ds')
    const second = await newTab()
    vi.setSystemTime(NOW + HOUR)
    await store.stop()
    expect(await second.store.stop()).toBe(false)
    // Do not reload before checking: that would hide the stale publication.
    const persisted = await database.db.sessions.toArray()
    expect(second.store.getState().active).toBeNull()
    expect(parseBackup(second.store.exportBackupText()).sessions).toEqual(persisted)
  })

  it('[C3] closing backup in another tab after merge commit must stop the later PUT', async () => {
    await store.setSyncConfig(config)
    const second = await newTab()
    put.mockClear()
    const committed = deferred<void>()
    const release = deferred<void>()
    // Pause ONLY the continuation AFTER the real transaction has committed.
    // No awaited gate is inserted inside an IndexedDB transaction.
    type Tx = (mode: unknown, ...args: unknown[]) => Promise<unknown>
    const original = database.db.transaction.bind(database.db) as Tx
    let paused = false
    vi.spyOn(database.db, 'transaction').mockImplementation(((mode: unknown, ...args: unknown[]) => {
      return original(mode, ...args).then(async (value) => {
        if (!paused && value && typeof value === 'object' && 'plan' in value && 'merged' in value) {
          paused = true
          committed.resolve()
          await release.promise
        }
        return value
      })
    }) as typeof database.db.transaction)
    const task = store.syncNow()
    await committed.promise
    await second.store.setSyncConfig(null)
    expect(await second.database.getMeta('syncConfig')).toBeNull()
    release.resolve()
    await task
    expect(put).not.toHaveBeenCalled()
  })

  it('[C4] a failed configuration write must not leave a cancelled sync displayed as running', async () => {
    await store.setSyncConfig(config)
    const pending = deferred<RemoteFile | null>()
    get.mockReturnValueOnce(pending.promise)
    const syncing = store.syncNow()
    const original = database.db.meta.put.bind(database.db.meta)
    const spy = vi.spyOn(database.db.meta, 'put').mockImplementation((row, key) => row.key === 'syncConfig'
      ? Dexie.Promise.reject(new DOMException('Synthetic quota failure', 'QuotaExceededError'))
      : original(row, key))
    await store.setSyncConfig(null)
    await syncing // cancelled; no sync is running now
    pending.resolve(null)
    spy.mockRestore()
    expect(await database.getMeta('syncConfig')).toEqual(config)
    expect(store.getState().sync.status).not.toBe('syncing')
  })

  it('[C5] accepting the maximum revision must not produce an unimportable backup after delete', async () => {
    const atLimit = session('limit', { updatedAt: MAX_TIMESTAMP })
    expect(checkSession(atLimit).ok).toBe(true)
    await store.importBackupText(JSON.stringify(makeBackup([atLimit], null, NOW)))
    expect(await store.deleteSession('limit')).toBe(true)
    const text = store.exportBackupText()
    const parsed = parseBackup(text)
    expect(parsed.invalid).toEqual([])
    await expect(store.importBackupText(text)).resolves.toBe(0)
  })

  it('[C5] settings accepted at the maximum revision must remain editable', async () => {
    await store.importBackupText(JSON.stringify(makeBackup([], { ...settings, updatedAt: MAX_TIMESTAMP }, NOW)))
    expect(await store.updateSettings({ examDate: '2027-12-20' })).toBe(true)
    const saved = (await database.getMeta('settings'))!
    await store.reloadFromDb()
    expect({ valid: checkSettings(saved).ok, date: store.getState().settings.examDate })
      .toEqual({ valid: true, date: '2027-12-20' })
  })

  it('[C4] adopting another tab configuration must not retain the cancelled task syncing status', async () => {
    await store.setSyncConfig(config)
    const second = await newTab()
    const pending = deferred<RemoteFile | null>()
    get.mockReturnValueOnce(pending.promise)
    const syncing = store.syncNow()
    const next = { ...config, repo: 'another-synthetic-repo' }
    await second.store.setSyncConfig(next)
    await store.reloadFromDb() // exactly what BroadcastChannel.onmessage does
    await syncing
    pending.resolve(null)
    expect(store.getState().syncConfig).toEqual(next)
    expect(store.getState().sync.status).not.toBe('syncing')
  })

  it('[C4] a quota failure while recording a sync error must still publish a recoverable error status', async () => {
    await store.setSyncConfig(config)
    await store.saveSession(session('pending'))
    get.mockResolvedValue(remote([session('remote')], store.getState().settings))
    const quota = () => Dexie.Promise.reject(new DOMException('Synthetic full database', 'QuotaExceededError'))
    const bulkSpy = vi.spyOn(database.db.sessions, 'bulkPut').mockImplementationOnce(quota)
    const original = database.db.meta.put.bind(database.db.meta)
    const metaSpy = vi.spyOn(database.db.meta, 'put').mockImplementation((row, key) => row.key === 'syncMeta'
      ? quota() : original(row, key))
    await store.syncNow()
    bulkSpy.mockRestore()
    metaSpy.mockRestore()
    expect((await database.getMeta('syncMeta'))!.dirty).toBe(true)
    expect(store.getState().sync.status).toBe('error')
  })

  it('[C6] a failed settings write and failed rollback read must not leave optimistic settings exportable', async () => {
    const before = store.getState().settings
    const originalPut = database.db.meta.put.bind(database.db.meta)
    const originalGet = database.db.meta.get.bind(database.db.meta)
    let failed = false
    const writeSpy = vi.spyOn(database.db.meta, 'put').mockImplementation((row, key) => {
      if (row.key === 'settings') {
        failed = true
        return Dexie.Promise.reject(new DOMException('Synthetic database failure', 'UnknownError'))
      }
      return originalPut(row, key)
    })
    const readSpy = vi.spyOn(database.db.meta, 'get').mockImplementation((key) => failed && (key as unknown) === 'settings'
      ? Dexie.Promise.reject(new DOMException('Synthetic database unavailable', 'UnknownError'))
      : originalGet(key))
    expect(await store.updateSettings({ examDate: '2027-12-20' })).toBe(false)
    writeSpy.mockRestore()
    readSpy.mockRestore()
    expect(await database.getMeta('settings')).toEqual(before)
    expect(parseBackup(store.exportBackupText()).settings).toEqual(before)
  })
})

describe('Codex: controls for the author questions and R1 tests', () => {
  it.each(['session', 'activeTimer', 'timerRev', 'syncMeta'])('R1 rollback at %s preserves memory before any reload', async (point) => {
    await store.selectSubjectAndStart('ds')
    const before = store.getState().active
    vi.setSystemTime(NOW + HOUR)
    const fail = () => Dexie.Promise.reject(new DOMException('Synthetic abort', 'UnknownError'))
    const original = database.db.meta.put.bind(database.db.meta)
    const spy = point === 'session'
      ? vi.spyOn(database.db.sessions, 'put').mockImplementationOnce(fail)
      : vi.spyOn(database.db.meta, 'put').mockImplementation((row, key) => row.key === point ? fail() : original(row, key))
    expect(await store.stop()).toBe(false)
    spy.mockRestore()
    expect(store.getState().active).toEqual(before)
    expect(store.getState().sessions).toEqual([])
    expect(await database.getMeta('activeTimer')).toEqual(before)
    expect(await database.db.sessions.count()).toBe(0)
    expect(await store.stop()).toBe(true)
    expect(segmentsTotal((await database.db.sessions.toArray())[0].segments)).toBe(HOUR)
  })

  it('same-tab reload followed by a click does not falsely change externalEpoch', async () => {
    await store.selectSubjectAndStart('ds')
    vi.setSystemTime(NOW + HOUR)
    const reload = store.reloadFromDb()
    const pause = store.pause()
    await reload
    expect(await pause).toBe(true)
    expect(store.getState().active?.runningSince).toBeNull()
  })

  it('acknowledging overtime increments revisions and rejects another tab stale action', async () => {
    await store.selectSubjectAndStart('ds')
    const second = await newTab()
    vi.setSystemTime(NOW + 5 * HOUR)
    await store.resolveOvertime({ kind: 'keep' })
    expect(await second.store.stop()).toBe(false)
    expect(second.store.getState().active?.ackAt).toBe(NOW + 5 * HOUR)
  })

  it('a queued reload does not prevent a committed configuration from syncing', async () => {
    const enabling = store.setSyncConfig(config)
    const reload = store.reloadFromDb()
    await Promise.all([enabling, reload])
    await flushIO()
    expect(store.getState().syncConfig).toEqual(config)
    await store.syncNow({ manual: true })
    expect(store.getState().sync.status).toBe('ok')
  })

  it('a far-future version can be superseded after it has actually been observed', async () => {
    const future = session('future', { updatedAt: Date.UTC(2099, 0, 1) })
    await store.importBackupText(JSON.stringify(makeBackup([future], null, NOW)))
    expect(await store.deleteSession(future.id)).toBe(true)
    const tombstone = (await database.db.sessions.get(future.id))!
    expect(tombstone.updatedAt).toBeGreaterThan(future.updatedAt)
    expect(mergeSessions([tombstone], [future]).merged[0].deleted).toBe(true)
  })

  it('an actually newer concurrent edit beats a tombstone under the documented policy', () => {
    const tombstone = session('policy', { deleted: true, updatedAt: NOW + 1 })
    const edit = session('policy', { subjectId: 'os', updatedAt: NOW + 2 })
    expect(mergeSessions([tombstone], [edit]).merged).toEqual([edit])
    expect(mergeSessions([edit], [tombstone]).merged).toEqual([edit])
  })

  it('unknown subjects are refused explicitly without deleting existing records', async () => {
    await store.saveSession(session('keep'))
    const text = JSON.stringify(makeBackup([session('future', { subjectId: 'unknown-future-subject' })], null, NOW))
    await expect(store.importBackupText(text)).rejects.toThrow(/未知科目/)
    expect(await database.db.sessions.count()).toBe(1)
  })

  it('normal export and upload payloads contain no configured token', async () => {
    await store.saveSession(session('safe'))
    await store.setSyncConfig(config)
    expect(store.exportBackupText()).not.toContain(config.token)
    for (const [, body] of put.mock.calls) expect(body).not.toContain(config.token)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(config.token)
  })

  it('Q11 synthetic suspended DB completion blocks the queue, then resumes when released', async () => {
    await store.selectSubjectAndStart('ds')
    const reached = deferred<void>()
    const release = deferred<void>()
    type Tx = (mode: unknown, ...args: unknown[]) => Promise<unknown>
    const original = database.db.transaction.bind(database.db) as Tx
    const spy = vi.spyOn(database.db, 'transaction').mockImplementationOnce(((mode: unknown, ...args: unknown[]) =>
      original(mode, ...args).then(async (value) => {
        reached.resolve()
        await release.promise
        return value
      })) as typeof database.db.transaction)
    const reading = store.reloadFromDb()
    await reached.promise
    vi.setSystemTime(NOW + HOUR)
    let finished = false
    const stopping = store.stop().then((ok) => { finished = true; return ok })
    await vi.advanceTimersByTimeAsync(60_000)
    const wasBlocked = !finished
    release.resolve()
    await reading
    const ok = await stopping
    spy.mockRestore()
    expect(wasBlocked).toBe(true) // characterization only: this does not prove a real Safari hang
    expect(ok).toBe(true)
    expect(segmentsTotal((await database.db.sessions.toArray())[0].segments)).toBe(HOUR)
  })
})

describe('Codex fix acceptance: conflict, recovery and dispatch boundaries', () => {
  it('C1 rejects a stale delete at the same revision, but accepts an edit of the freshly opened snapshot', async () => {
    await store.saveSession(session('edit'))
    const opened = (await database.db.sessions.get('edit'))!
    await store.importBackupText(JSON.stringify(makeBackup([{ ...opened, subjectId: 'os' }], null, NOW)))
    expect(await store.deleteSession('edit', { expectedSession: opened })).toBe(false)
    const fresh = (await database.db.sessions.get('edit'))!
    expect(await store.saveSession({ ...fresh, subjectId: 'la' }, { expectedSession: fresh })).toBe(true)
    expect((await database.db.sessions.get('edit'))!.subjectId).toBe('la')
  })

  it('C1 does not recreate a record missing since the editor opened', async () => {
    await store.saveSession(session('missing'))
    const opened = (await database.db.sessions.get('missing'))!
    await database.db.sessions.delete('missing') // synthetic external database change
    expect(await store.saveSession(opened, { expectedSession: opened })).toBe(false)
    expect(await database.db.sessions.count()).toBe(0)
  })

  it('C3 a dispatch check holds the lock until request start, but does not block local timing', async () => {
    await store.setSyncConfig(config)
    const second = await newTab()
    const checked = deferred<void>(), release = deferred<void>(), response = deferred<RemoteFile | null>()
    const started = deferred<void>()
    get.mockClear().mockImplementationOnce(() => { started.resolve(); return response.promise })
    put.mockClear()
    type Tx = (mode: unknown, ...args: unknown[]) => Promise<unknown>
    const original = database.db.transaction.bind(database.db) as Tx
    let paused = false
    const spy = vi.spyOn(database.db, 'transaction').mockImplementation(((mode: unknown, ...args: unknown[]) =>
      original(mode, ...args).then(async (value) => {
        // AFTER the config read transaction completes, still inside the Web Lock callback.
        if (!paused && mode === 'r' && value === true) {
          paused = true
          checked.resolve()
          await release.promise
        }
        return value
      })) as typeof database.db.transaction)
    const syncing = store.syncNow()
    await checked.promise
    let closed = false
    const closing = second.store.setSyncConfig(null).then(() => { closed = true })
    await flushIO()
    const closedBeforeDispatch = closed
    const cfgBeforeDispatch = await second.database.getMeta('syncConfig')
    const timingWorked = await store.selectSubjectAndStart('ds')
    release.resolve()
    await started.promise
    await closing // must complete even while the network response is pending
    response.resolve(null)
    await syncing
    spy.mockRestore()
    expect(closedBeforeDispatch).toBe(false)
    expect(cfgBeforeDispatch).toEqual(config)
    expect(timingWorked).toBe(true)
    expect(await database.getMeta('syncConfig')).toBeNull()
    expect(put).not.toHaveBeenCalled()
  })

  it('C3 disabling does not wait for an already-dispatched PUT response', async () => {
    await store.setSyncConfig(config)
    const second = await newTab()
    const started = deferred<void>(), response = deferred<string>()
    put.mockImplementationOnce(() => { started.resolve(); return response.promise })
    const syncing = store.syncNow()
    await started.promise
    await second.store.setSyncConfig(null)
    expect(await database.getMeta('syncConfig')).toBeNull()
    expect(await store.selectSubjectAndStart('ds')).toBe(true)
    response.resolve('already-dispatched-sha')
    await syncing
    await store.reloadFromDb()
    expect(store.getState().sync.status).toBe('disabled')
  })

  it('C3 disable then re-enable identical credentials does not revive an old task', async () => {
    await store.setSyncConfig(config)
    const second = await newTab()
    const started = deferred<void>(), response = deferred<RemoteFile | null>()
    get.mockImplementationOnce(() => { started.resolve(); return response.promise })
    const syncing = store.syncNow()
    await started.promise
    await second.store.setSyncConfig(null)
    await second.store.setSyncConfig(config)
    put.mockClear()
    response.resolve(null)
    await syncing
    expect(put).not.toHaveBeenCalled()
    await store.reloadFromDb()
    await store.syncNow()
    expect(store.getState().sync.status).toBe('ok')
  })

  it('C3 missing Web Locks prevents network writes but preserves local use and disabling', async () => {
    await store.setSyncConfig(config)
    get.mockClear(); put.mockClear()
    vi.stubGlobal('navigator', { onLine: true })
    await store.syncNow()
    expect(store.getState().sync.status).toBe('error')
    expect(store.getState().sync.lastError).toMatch(/浏览器/)
    await vi.advanceTimersByTimeAsync(2 * HOUR)
    expect(get).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(await store.saveSession(session('local'))).toBe(true)
    expect(parseBackup(store.exportBackupText()).sessions).toHaveLength(1)
    await store.setSyncConfig(null)
    expect(await database.getMeta('syncConfig')).toBeNull()
  })

  it('C3 lock acquisition times out recoverably without blocking local timing', async () => {
    await store.setSyncConfig(config)
    const held = deferred<void>(), release = deferred<void>()
    const blocker = testLocks.request('kaoyan-timer/sync-config-dispatch', async () => {
      held.resolve(); await release.promise
    })
    await held.promise
    const syncing = store.syncNow()
    expect(await store.selectSubjectAndStart('ds')).toBe(true)
    await vi.advanceTimersByTimeAsync(10_001)
    await syncing
    release.resolve()
    await blocker
    expect(store.getState().sync.status).toBe('error')
    await store.syncNow({ manual: true })
    expect(store.getState().sync.status).toBe('ok')
  })

  it('C4 quota errors remain retryable manually even when recording the error also failed', async () => {
    await store.setSyncConfig(config)
    await store.saveSession(session('local'))
    get.mockResolvedValue(remote([session('remote')]))
    const quota = () => Dexie.Promise.reject(new DOMException('Synthetic quota', 'QuotaExceededError'))
    const bulkSpy = vi.spyOn(database.db.sessions, 'bulkPut').mockImplementationOnce(quota)
    const original = database.db.meta.put.bind(database.db.meta)
    const metaSpy = vi.spyOn(database.db.meta, 'put').mockImplementation((row, key) =>
      row.key === 'syncMeta' ? quota() : original(row, key))
    await store.syncNow()
    bulkSpy.mockRestore(); metaSpy.mockRestore()
    expect(store.getState().sync.status).toBe('error')
    get.mockClear()
    await vi.advanceTimersByTimeAsync(2 * HOUR)
    expect(get).not.toHaveBeenCalled() // quota requires intervention, not repeated writes
    await store.syncNow({ manual: true })
    expect(store.getState().sync.status).toBe('ok')
    expect((await database.db.sessions.toArray()).map((r) => r.id).sort()).toEqual(['local', 'remote'])
  })

  it('C4 an old network error cannot overwrite metadata after another tab disables backup', async () => {
    await store.setSyncConfig(config)
    const second = await newTab()
    const started = deferred<void>(), response = deferred<RemoteFile | null>()
    get.mockImplementationOnce(() => { started.resolve(); return response.promise })
    const syncing = store.syncNow()
    await started.promise
    await second.store.setSyncConfig(null)
    response.reject(new TypeError('Late failure from the old request'))
    await syncing
    await store.reloadFromDb()
    expect((await database.getMeta('syncMeta'))!.lastError).toBeNull()
    expect(store.getState().sync.status).toBe('disabled')
  })

  it('C3 cancelling a task waiting for a lock completes without dispatching its request', async () => {
    await store.setSyncConfig(config)
    const held = deferred<void>(), release = deferred<void>()
    const blocker = testLocks.request('kaoyan-timer/sync-config-dispatch', async () => {
      held.resolve(); await release.promise
    })
    await held.promise
    get.mockClear(); put.mockClear()
    const syncing = store.syncNow()
    const closing = store.setSyncConfig(null)
    await syncing // cancellation settles before the held lock is released
    release.resolve()
    await blocker
    await closing
    expect(get).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(store.getState().sync.status).toBe('disabled')
  })

  it('C5 repeated changes beyond the calendar timestamp cap remain valid and restorable', async () => {
    await store.importBackupText(JSON.stringify(makeBackup([session('limit', { updatedAt: MAX_TIMESTAMP })],
      { ...settings, updatedAt: MAX_TIMESTAMP }, NOW)))
    for (let i = 0; i < 25; i++) {
      const row = (await database.db.sessions.get('limit'))!
      expect(await store.saveSession({ ...row, subjectId: i % 2 ? 'ds' : 'os' }, { expectedSession: row })).toBe(true)
      expect(await store.updateSettings({ keepAwake: i % 2 === 0 })).toBe(true)
      const backup = parseBackup(store.exportBackupText())
      expect(backup.invalid).toEqual([])
      expect(backup.sessions[0].updatedAt).toBeGreaterThan(MAX_TIMESTAMP)
      expect(backup.settings!.updatedAt).toBeGreaterThan(MAX_TIMESTAMP)
      expect(await store.importBackupText(store.exportBackupText())).toBe(0)
    }
  })

  it('C5 numerical exhaustion refuses the mutation without corrupting the last export', async () => {
    await store.importBackupText(JSON.stringify(makeBackup([session('exhausted', { updatedAt: MAX_REVISION })],
      { ...settings, updatedAt: MAX_REVISION }, NOW)))
    const before = store.exportBackupText()
    expect(await store.deleteSession('exhausted')).toBe(false)
    expect(await store.updateSettings({ keepAwake: true })).toBe(false)
    expect(store.exportBackupText()).toBe(before)
    expect(parseBackup(before).invalid).toEqual([])
    expect((await database.db.sessions.get('exhausted'))!.deleted).toBe(false)
  })

  it('C5 an old record without createdAt still round-trips when its logical revision exceeds the date cap', () => {
    const row = { ...session(), updatedAt: MAX_TIMESTAMP + 1, createdAt: undefined }
    const parsed = parseBackup(JSON.stringify(makeBackup([row as unknown as Session], null, NOW)))
    expect(parsed.invalid).toEqual([])
    expect(parseBackup(JSON.stringify(parsed)).invalid).toEqual([])
  })

  it('C6 a failed earlier settings intent does not erase a later queued change', async () => {
    const original = database.db.meta.put.bind(database.db.meta)
    let failed = false
    const spy = vi.spyOn(database.db.meta, 'put').mockImplementation((row, key) => {
      if (row.key === 'settings' && !failed) {
        failed = true
        return Dexie.Promise.reject(new DOMException('Synthetic failure', 'UnknownError'))
      }
      return original(row, key)
    })
    const dateBefore = store.getState().settings.examDate
    const first = store.updateSettings({ examDate: '2027-12-20' })
    const second = store.updateSettings({ keepAwake: true })
    expect(store.getState().settings.keepAwake).toBe(true)
    expect(parseBackup(store.exportBackupText()).settings!.keepAwake).toBe(false)
    expect(await first).toBe(false)
    expect(store.getState().settings.keepAwake).toBe(true)
    expect(await second).toBe(true)
    spy.mockRestore()
    expect(store.getState().settings).toEqual(await database.getMeta('settings'))
    expect(store.getState().settings).toMatchObject({ examDate: dateBefore, keepAwake: true })
  })

  it('C6 queued reload cannot flash away a pending settings intent, and export waits for commit', async () => {
    const before = store.getState().settings
    const reload = store.reloadFromDb()
    const update = store.updateSettings({ examDate: '2027-12-20' })
    expect(parseBackup(store.exportBackupText()).settings).toEqual(before)
    await reload
    expect(store.getState().settings.examDate).toBe('2027-12-20')
    expect(await update).toBe(true)
    expect(parseBackup(store.exportBackupText()).settings).toEqual(await database.getMeta('settings'))
  })
})
