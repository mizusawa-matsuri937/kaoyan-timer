import { useSyncExternalStore } from 'react'
import { db, getMeta, requestPersist, setMeta, type SyncMeta } from './db/db'
import { dayKey } from './domain/dates'
import { HOUR } from './domain/aggregate'
import {
  acknowledgeOvertime,
  finishTimer,
  finishTimerAt,
  finishTimerDiscardingRunning,
  pauseTimer,
  resumeTimer,
  startTimer,
} from './domain/timer'
import type { ActiveTimer, Session, Settings, SyncConfig } from './domain/types'
import { getFile, isConflict, putFile } from './sync/github'
import { makeBackup, mergeSessions, mergeSettings, parseBackup } from './sync/merge'

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'ok' | 'error' | 'offline'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'success'
}

export interface AppState {
  loaded: boolean
  fatal: string | null
  sessions: Session[]
  active: ActiveTimer | null
  settings: Settings
  syncConfig: SyncConfig | null
  sync: SyncMeta & { status: SyncStatus }
  persisted: boolean
  toast: Toast | null
}

const DEFAULT_SETTINGS: Settings = {
  examDate: '2027-12-25',
  startDate: dayKey(Date.now()),
  overtimeHours: 4,
  keepAwake: false,
  updatedAt: 0,
}

let state: AppState = {
  loaded: false,
  fatal: null,
  sessions: [],
  active: null,
  settings: DEFAULT_SETTINGS,
  syncConfig: null,
  sync: { status: 'disabled', lastSyncAt: null, dirty: false, lastError: null },
  persisted: false,
  toast: null,
}

const listeners = new Set<() => void>()

function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function getState(): AppState {
  return state
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => selector(state),
  )
}

// ---------- 提示 ----------

let toastSeq = 0
let toastTimer: ReturnType<typeof setTimeout> | undefined
export function showToast(text: string, kind: Toast['kind'] = 'info') {
  clearTimeout(toastTimer)
  setState({ toast: { id: ++toastSeq, text, kind } })
  toastTimer = setTimeout(() => setState({ toast: null }), kind === 'error' ? 5000 : 2400)
}

// ---------- 写入队列：所有数据库写操作串行执行，保证顺序 ----------

let chain: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn)
  chain = p.catch((e) => {
    console.error(e)
    showToast(`保存失败：${e?.message ?? e}`, 'error')
  })
  return p
}

function persistActive(active: ActiveTimer | null) {
  return enqueue(() => setMeta('activeTimer', active))
}

// ---------- 初始化 ----------

export async function init() {
  try {
    const [sessions, active, settings, syncConfig, syncMeta] = await Promise.all([
      db.sessions.toArray(),
      getMeta('activeTimer'),
      getMeta('settings'),
      getMeta('syncConfig'),
      getMeta('syncMeta'),
    ])
    const s = settings ?? DEFAULT_SETTINGS
    if (!settings) await setMeta('settings', s)
    const meta = syncMeta ?? { lastSyncAt: null, dirty: false, lastError: null }
    setState({
      loaded: true,
      sessions,
      active: active ?? null,
      settings: { ...DEFAULT_SETTINGS, ...s },
      syncConfig: syncConfig ?? null,
      sync: { ...meta, status: syncConfig ? 'idle' : 'disabled' },
    })
    requestPersist().then((persisted) => setState({ persisted }))
    void syncNow()
  } catch (e) {
    console.error(e)
    setState({ fatal: `无法打开本地数据库：${(e as Error)?.message ?? e}` })
  }
}

/** 回到前台时从数据库重新读取（防止多个标签页之间数据不一致） */
export async function reloadFromDb() {
  if (!state.loaded) return
  await chain
  const [sessions, active] = await Promise.all([db.sessions.toArray(), getMeta('activeTimer')])
  setState({ sessions, active: active ?? null })
}

// ---------- 本地修改 ----------

let localVersion = 0

function markDirty() {
  localVersion++
  if (!state.sync.dirty) {
    const sync = { ...state.sync, dirty: true }
    setState({ sync })
    void enqueue(() => setMeta('syncMeta', stripStatus(sync)))
  }
  scheduleSync()
}

function stripStatus(s: AppState['sync']): SyncMeta {
  return { lastSyncAt: s.lastSyncAt, dirty: s.dirty, lastError: s.lastError }
}

function upsertSessionsInState(list: Session[]) {
  if (list.length === 0) return
  const byId = new Map(state.sessions.map((s) => [s.id, s]))
  for (const s of list) byId.set(s.id, s)
  setState({ sessions: [...byId.values()] })
}

function commitSession(session: Session | null) {
  if (!session) return
  upsertSessionsInState([session])
  void enqueue(() => db.sessions.put(session))
  markDirty()
}

// ---------- 计时操作 ----------

/** 点科目：没在计时就开始；计时中点另一个科目就结算当前段并开始新科目 */
export function selectSubjectAndStart(subjectId: string) {
  const now = Date.now()
  const cur = state.active
  if (cur) {
    if (cur.subjectId === subjectId) {
      if (cur.runningSince === null) resume()
      return
    }
    const done = finishTimer(cur, now)
    commitSession(done)
    if (done) showToast(`已保存上一段，开始新科目`, 'success')
  }
  const next = startTimer(subjectId, now)
  setState({ active: next })
  void persistActive(next)
}

export function pause() {
  if (!state.active) return
  const next = pauseTimer(state.active, Date.now())
  setState({ active: next })
  void persistActive(next)
}

export function resume() {
  if (!state.active) return
  const next = resumeTimer(state.active, Date.now())
  setState({ active: next })
  void persistActive(next)
}

export function stop() {
  const cur = state.active
  if (!cur) return
  const done = finishTimer(cur, Date.now())
  setState({ active: null })
  void persistActive(null)
  commitSession(done)
  showToast(done ? '本段已保存' : '时长太短，未保存', done ? 'success' : 'info')
}

export type OvertimeChoice = { kind: 'keep' } | { kind: 'endAt'; endAt: number } | { kind: 'discard' }

export function resolveOvertime(choice: OvertimeChoice) {
  const cur = state.active
  if (!cur) return
  const now = Date.now()
  if (choice.kind === 'keep') {
    const next = acknowledgeOvertime(cur, now)
    setState({ active: next })
    void persistActive(next)
    return
  }
  const done = choice.kind === 'endAt' ? finishTimerAt(cur, choice.endAt, now) : finishTimerDiscardingRunning(cur, now)
  setState({ active: null })
  void persistActive(null)
  commitSession(done)
  showToast(done ? '已保存修正后的记录' : '已丢弃这一段', 'success')
}

// ---------- 记录编辑 ----------

export function saveSession(session: Session) {
  const segments = session.segments.filter((g) => g.end > g.start).sort((a, b) => a.start - b.start)
  if (segments.length === 0) return
  commitSession({ ...session, segments, startAt: segments[0].start, updatedAt: Date.now(), deleted: false })
}

export function deleteSession(id: string) {
  const s = state.sessions.find((x) => x.id === id)
  if (!s) return
  commitSession({ ...s, deleted: true, updatedAt: Date.now() })
}

// ---------- 设置 ----------

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch, updatedAt: Date.now() }
  setState({ settings })
  void enqueue(() => setMeta('settings', settings))
  if (patch.examDate || patch.startDate || patch.overtimeHours) markDirty()
}

export async function setSyncConfig(cfg: SyncConfig | null) {
  setState({
    syncConfig: cfg,
    sync: { ...state.sync, status: cfg ? 'idle' : 'disabled', lastError: null },
  })
  await enqueue(() => setMeta('syncConfig', cfg))
  if (cfg) await syncNow({ manual: true })
}

// ---------- 导入导出 ----------

export function exportBackupText(): string {
  return JSON.stringify(makeBackup(state.sessions, state.settings, Date.now()), null, 1)
}

export async function importBackupText(text: string): Promise<number> {
  const backup = parseBackup(text) // 格式不对会直接抛错
  const { toLocal } = mergeSessions(state.sessions, backup.sessions)
  if (toLocal.length) {
    await enqueue(() => db.sessions.bulkPut(toLocal))
    upsertSessionsInState(toLocal)
    markDirty()
  }
  if (backup.settings) {
    const merged = mergeSettings(state.settings, backup.settings)
    if (merged !== state.settings) {
      setState({ settings: merged })
      await enqueue(() => setMeta('settings', merged))
    }
  }
  return toLocal.length
}

// ---------- GitHub 同步 ----------

let syncTimer: ReturnType<typeof setTimeout> | undefined
function scheduleSync() {
  if (!state.syncConfig) return
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => void syncNow(), 1500)
}

let running: Promise<void> | null = null
let again = false
let lastAutoSync = 0

/** 与 GitHub 私有仓库双向合并同步 */
export function syncNow(opts: { manual?: boolean; throttle?: boolean } = {}): Promise<void> {
  if (!state.syncConfig) return Promise.resolve()
  if (opts.throttle && Date.now() - lastAutoSync < 30_000) return Promise.resolve()
  if (running) {
    again = true
    return running
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setState({ sync: { ...state.sync, status: 'offline' } })
    if (opts.manual) showToast('当前离线，联网后会自动备份', 'info')
    return Promise.resolve()
  }
  lastAutoSync = Date.now()
  running = (async () => {
    do {
      again = false
      await doSync(opts.manual ?? false)
    } while (again)
  })().finally(() => {
    running = null
  })
  return running
}

async function doSync(manual: boolean) {
  const cfg = state.syncConfig
  if (!cfg) return
  setState({ sync: { ...state.sync, status: 'syncing' } })
  const versionAtStart = localVersion
  try {
    await chain
    for (let attempt = 0; ; attempt++) {
      const remote = await getFile(cfg)
      const parsed = remote ? parseBackup(remote.text) : null

      // 1) 拉取：远端更新的记录写入本地
      const { toLocal, remoteChanged } = mergeSessions(state.sessions, parsed?.sessions ?? [])
      if (toLocal.length) {
        await enqueue(() => db.sessions.bulkPut(toLocal))
        upsertSessionsInState(toLocal)
      }
      const mergedSettings = mergeSettings(state.settings, parsed?.settings ?? null)
      if (mergedSettings !== state.settings) {
        setState({ settings: mergedSettings })
        await enqueue(() => setMeta('settings', mergedSettings))
      }
      const settingsAhead = !parsed?.settings || state.settings.updatedAt > parsed.settings.updatedAt

      // 2) 推送：本地有远端没有的内容
      if (!remote || remoteChanged || settingsAhead) {
        const text = JSON.stringify(makeBackup(state.sessions, state.settings, Date.now()))
        const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
        try {
          await putFile(cfg, text, remote?.sha ?? null, `备份学习记录 ${stamp}`)
        } catch (e) {
          if (isConflict(e) && attempt < 3) continue // 另一台设备刚更新过，重新拉取合并
          throw e
        }
      }
      break
    }
    const sync = {
      status: 'ok' as const,
      lastSyncAt: Date.now(),
      dirty: localVersion !== versionAtStart,
      lastError: null,
    }
    setState({ sync })
    await enqueue(() => setMeta('syncMeta', stripStatus(sync)))
    if (manual) showToast('已与 GitHub 同步', 'success')
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    const sync = { ...state.sync, status: offline ? ('offline' as const) : ('error' as const), lastError: msg }
    setState({ sync })
    void enqueue(() => setMeta('syncMeta', stripStatus(sync)))
    if (manual) showToast(`同步失败：${msg}`, 'error')
  }
}

// ---------- 全局事件 ----------

export function installGlobalListeners() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void reloadFromDb().then(() => syncNow({ throttle: true }))
    }
  })
  window.addEventListener('online', () => void syncNow())
  // 页面关闭前确保同步计划不丢：标记 dirty 已持久化，下次打开会补推
}

export const overtimeMs = (s: Settings) => Math.max(0.5, s.overtimeHours) * HOUR
