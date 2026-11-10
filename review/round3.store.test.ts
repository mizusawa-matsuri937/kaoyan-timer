import { testLocks } from './fixtures'
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFile, putFile, GitHubError, type RemoteFile } from '../src/sync/github'
import { compareSessions, makeBackup, parseBackup, checkSettings } from '../src/sync/merge'
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


describe('round3 data', () => {
  it('T3 no-op reload and sync preserve data references', async () => {
    await store.saveSession(session('same'))
    await store.selectSubjectAndStart('ds')
    const before = store.getState()
    await store.reloadFromDb()
    expect(store.getState().sessions).toBe(before.sessions)
    expect(store.getState().settings).toBe(before.settings)
    expect(store.getState().active).toBe(before.active)
    get.mockResolvedValue(remote(before.sessions, before.settings))
    await store.setSyncConfig(config)
    expect(store.getState().sessions).toBe(before.sessions)
    expect(store.getState().settings).toBe(before.settings)
  })
  it('T4 equal sessions avoid serializing their fingerprints', () => {
    const a = session(), b = structuredClone(a)
    const spy = vi.spyOn(JSON, 'stringify')
    expect(compareSessions(a,b)).toBe(0)
    const calls = spy.mock.calls.length
    spy.mockRestore()
    expect(calls).toBe(0)
  })
})

it('T3 changed timer still rejects stale operations across tabs', async () => {
  await store.selectSubjectAndStart('ds')
  const b = await newTab()
  vi.setSystemTime(NOW + 60_000)
  await store.pause()
  expect(await b.store.stop()).toBe(false)
  expect(b.store.getState().active?.runningSince).toBeNull()
})
it('T4 clean foreground refreshes within five minutes avoid another download', async () => {
  await store.setSyncConfig(config)
  get.mockClear()
  vi.setSystemTime(NOW + 60_000)
  await store.syncNow({ throttle: true })
  expect(get).not.toHaveBeenCalled()
})

async function flushIO() { for (let i=0;i<100;i++) await new Promise<void>(r=>setImmediate(r)) }
function events() {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const win = new EventTarget()
  vi.stubGlobal('document',doc); vi.stubGlobal('window',win); vi.stubGlobal('BroadcastChannel',undefined)
  store.installGlobalListeners()
  return {doc,win}
}
it('T6 automatic triggers honor Retry-After while manual sync can bypass it', async () => {
  await store.setSyncConfig(config)
  await store.saveSession(session('dirty'))
  get.mockClear().mockRejectedValueOnce(new GitHubError(429,'limited',HOUR,true))
  await store.syncNow()
  await store.syncNow()
  expect(get).toHaveBeenCalledTimes(1)
  await store.syncNow({ manual: true })
  expect(get).toHaveBeenCalledTimes(2)
})
it.each(['visibilitychange','pagehide'])('T7 flushes a pending debounce on %s', async event => {
  await store.setSyncConfig(config)
  const {doc,win} = events()
  get.mockClear()
  await store.saveSession(session('hidden'))
  doc.visibilityState = 'hidden'
  ;(event==='pagehide'?win:doc).dispatchEvent(new Event(event))
  await flushIO()
  expect(get).toHaveBeenCalledTimes(1)
})
it('T8 timer writes are canonical even after clock rollback', async () => {
  await store.selectSubjectAndStart('ds')
  vi.setSystemTime(NOW + HOUR); await store.pause()
  vi.setSystemTime(NOW - 2*HOUR); await store.resume()
  vi.setSystemTime(NOW - HOUR); await store.stop()
  const rows = await database.db.sessions.toArray()
  const restored = parseBackup(store.exportBackupText())
  expect(restored.sessions).toEqual(rows)
})

it.each([{examDate:'2207-12-25'}, {startDate:'1900-01-01'}, {startDate:'2028-01-01'}])('T9 rejects unsafe new date edits %j', async patch => {
  expect(await store.updateSettings(patch)).toBe(false)
})
it('T9 legacy out-of-range dates recover without rejecting sessions', async () => {
  const backup = parseBackup(JSON.stringify(makeBackup([session()], { ...settings, startDate:'1900-01-01', examDate:'2207-12-25' },NOW)))
  expect(backup.invalid).toEqual([])
  expect(backup.sessions).toHaveLength(1)
  expect(backup.settings!.examDate <= '2100-01-01').toBe(true)
  expect(backup.settings!.startDate >= '2000-01-01').toBe(true)
  expect(checkSettings(backup.settings).ok).toBe(true)
})
it('T10 legacy overlapping records continue to parse unchanged', () => {
  const row = session('overlap',{segments:[{start:NOW-2*HOUR,end:NOW},{start:NOW-HOUR,end:NOW+HOUR}]})
  expect(parseBackup(JSON.stringify(makeBackup([row],null,NOW))).sessions[0].segments).toEqual(row.segments)
})

it('T11 waiting to change configuration must not block pause', async () => {
  await store.selectSubjectAndStart('ds')
  vi.setSystemTime(NOW+HOUR)
  const held=deferred<void>(), release=deferred<void>()
  const lock=testLocks.request('kaoyan-timer/sync-config-dispatch', async()=>{held.resolve();await release.promise})
  await held.promise
  const configTask=store.setSyncConfig(null)
  let paused=false
  const pauseTask=store.pause().then(ok=>{paused=ok})
  await flushIO()
  const beforeRelease=paused
  release.resolve()
  await Promise.all([lock,configTask,pauseTask])
  expect(beforeRelease).toBe(true)
})
it('T6/T7 background flushing never bypasses a server retry deadline', async () => {
  await store.setSyncConfig(config)
  const {doc,win}=events()
  await store.saveSession(session('retry'))
  get.mockClear().mockRejectedValueOnce(new GitHubError(429,'limited',HOUR,true))
  await store.syncNow()
  doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));win.dispatchEvent(new Event('pagehide'))
  await flushIO()
  doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'))
  await flushIO()
  expect(get).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(HOUR)
  await flushIO()
  expect(get).toHaveBeenCalledTimes(2)
})
it('T9 legacy local dates remain safe through import and synchronization', async () => {
  await database.setMeta('settings', { ...settings, startDate:'1900-01-01', examDate:'2207-12-25' })
  await store.importBackupText(JSON.stringify(makeBackup([session('legacy')],null,NOW)))
  expect(store.getState().settings.examDate <= '2100-01-01').toBe(true)
  await store.setSyncConfig(config)
  const uploaded=JSON.parse(put.mock.calls.at(-1)![1])
  expect(uploaded.settings.examDate <= '2100-01-01').toBe(true)
})

// ---- Follow-up to the round-3 fixes (F1, F3) ----
it('F1 a fresh install after the default exam date keeps valid, editable settings', async () => {
  vi.setSystemTime(Date.parse('2028-01-05T04:00:00Z'))
  await database.db.meta.delete('settings')
  const fresh = await newTab()
  const first = fresh.store.getState().settings
  expect(first.startDate <= first.examDate).toBe(true)
  expect(checkSettings(first, true).ok).toBe(true)
  expect(await fresh.store.updateSettings({ keepAwake: true })).toBe(true)
  const reopened = await newTab()
  expect(reopened.store.getState().settings).toMatchObject({ startDate: first.startDate, examDate: first.examDate, keepAwake: true })
})
it('F1 never-edited inverted defaults fall back near their own dates and stay editable', () => {
  const repaired = checkSettings({ ...settings, startDate: '2028-01-05', examDate: '2027-12-25', updatedAt: 0 })
  if (!repaired.ok) throw new Error(repaired.reason)
  expect(repaired.value).toMatchObject({ startDate: '2028-01-01', examDate: '2029-12-25', updatedAt: 0 })
  expect(checkSettings({ ...repaired.value, examDate: '2028-12-23', updatedAt: 1 }, true).ok).toBe(true)
  expect(checkSettings({ ...repaired.value, startDate: '2028-01-05', updatedAt: 1 }, true).ok).toBe(true)
})
it('F3 returning to the foreground retries an ordinary failed sync without waiting for backoff', async () => {
  await store.setSyncConfig(config)
  const { doc } = events()
  await store.saveSession(session('transient'))
  get.mockClear().mockRejectedValueOnce(new TypeError('network down'))
  await store.syncNow()
  expect(get).toHaveBeenCalledTimes(1)
  expect(store.getState().sync.status).toBe('error')
  doc.dispatchEvent(new Event('visibilitychange'))
  await flushIO()
  expect(get).toHaveBeenCalledTimes(2)
  expect(store.getState().sync.dirty).toBe(false)
})
