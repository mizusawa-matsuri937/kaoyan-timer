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
import { GitHubError, getFile, isConflict, isTransient, putFile } from './sync/github'
import {
  checkSession,
  checkSettings,
  compareSettings,
  describeInvalid,
  makeBackup,
  mergeSessions,
  mergeSettings,
  nextRevision,
  parseBackup,
  type ParsedBackup,
} from './sync/merge'

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

const EMPTY_SYNC_META: SyncMeta = { lastSyncAt: null, dirty: false, lastError: null, seq: 0 }

let state: AppState = {
  loaded: false,
  fatal: null,
  sessions: [],
  active: null,
  settings: DEFAULT_SETTINGS,
  syncConfig: null,
  sync: { ...EMPTY_SYNC_META, status: 'disabled' },
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

function errorText(e: unknown): string {
  return (e as Error)?.message ?? String(e)
}

function reportSaveError(e: unknown) {
  console.error(e)
  showToast(`保存失败：${errorText(e)}`, 'error')
}

// ---------- 状态操作队列 ----------
//
// 每个会改动数据的操作都是一个完整的"读取数据库当前状态 → 决定变更 → 在一个事务里提交 → 发布到内存"。
// 操作在本标签页内串行执行；跨标签页由 IndexedDB 读写事务串行化，并在事务内核对计时器修订号。
// 网络请求从不放进事务或这个队列里。

let queue: Promise<unknown> = Promise.resolve()
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn)
  queue = p.then(
    () => undefined,
    () => undefined,
  )
  return p
}

function rwTx<T>(fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', db.sessions, db.meta, fn)
}

/** 跨标签页刷新通知（只是辅助：正确性由事务和版本核对保证） */
let channel: BroadcastChannel | null = null
function notifyOtherTabs() {
  try {
    channel?.postMessage('changed')
  } catch {
    /* ignore */
  }
}

/** 在事务内：标记有未同步的本地改动，改动序号 +1 */
async function bumpDirtyInTx(): Promise<SyncMeta> {
  const cur = (await getMeta('syncMeta')) ?? EMPTY_SYNC_META
  const next: SyncMeta = { ...EMPTY_SYNC_META, ...cur, dirty: true, seq: (cur.seq ?? 0) + 1 }
  await setMeta('syncMeta', next)
  return next
}

function publishSyncMeta(meta: SyncMeta, status: SyncStatus = state.sync.status) {
  setState({ sync: { ...EMPTY_SYNC_META, ...meta, status } })
}

function upsert(list: Session[], rows: Session[]): Session[] {
  if (rows.length === 0) return list
  const byId = new Map(list.map((s) => [s.id, s]))
  for (const s of rows) byId.set(s.id, s)
  return [...byId.values()]
}

function sameTimer(a: ActiveTimer | null | undefined, b: ActiveTimer | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return (
    a.sessionId === b.sessionId &&
    (a.rev ?? 0) === (b.rev ?? 0) &&
    a.runningSince === b.runningSince &&
    a.segments.length === b.segments.length
  )
}

function sameConfig(a: SyncConfig | null | undefined, b: SyncConfig | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.owner === b.owner && a.repo === b.repo && a.path === b.path && a.token === b.token
}

// ---------- 初始化 / 重新读取 ----------

interface Snapshot {
  sessions: Session[]
  active: ActiveTimer | null
  timerRev: number
  settings: Settings
  syncConfig: SyncConfig | null
  syncMeta: SyncMeta
}

async function readSnapshotInTx(): Promise<Snapshot> {
  const sessions = await db.sessions.toArray()
  const active = (await getMeta('activeTimer')) ?? null
  const timerRev = (await getMeta('timerRev')) ?? 0
  const stored = await getMeta('settings')
  const syncConfig = (await getMeta('syncConfig')) ?? null
  const syncMeta = (await getMeta('syncMeta')) ?? EMPTY_SYNC_META
  const checked = stored ? checkSettings({ ...DEFAULT_SETTINGS, ...stored }) : null
  return {
    sessions,
    active,
    timerRev,
    settings: checked?.ok ? checked.value : DEFAULT_SETTINGS,
    syncConfig,
    syncMeta: { ...EMPTY_SYNC_META, ...syncMeta },
  }
}

/** 本标签页已知的数据库计时修订号 */
let knownTimerRev = 0
/** 内存中的计时器被"外部"（其他标签页的结果）替换的次数；点击时捕获，执行前不一致说明用户操作的是过期画面 */
let externalEpoch = 0

function adoptTimer(active: ActiveTimer | null, timerRev: number) {
  if (!sameTimer(active, state.active) || timerRev !== knownTimerRev) externalEpoch++
  knownTimerRev = timerRev
}

function publishSnapshot(snap: Snapshot) {
  if (!sameConfig(snap.syncConfig, state.syncConfig)) invalidateSync() // 其他标签页改了备份配置
  adoptTimer(snap.active, snap.timerRev)
  setState({
    loaded: true,
    sessions: snap.sessions,
    active: snap.active,
    settings: snap.settings,
    syncConfig: snap.syncConfig,
    sync: {
      ...snap.syncMeta,
      status: !snap.syncConfig
        ? 'disabled'
        : running
          ? 'syncing'
          : state.sync.status === 'disabled'
            ? 'idle'
            : state.sync.status,
    },
  })
}

export async function init() {
  try {
    await serial(async () => {
      const snap = await rwTx(async () => {
        const s = await readSnapshotInTx()
        if (!(await getMeta('settings'))) await setMeta('settings', s.settings)
        return s
      })
      publishSnapshot(snap)
    })
  } catch (e) {
    console.error(e)
    setState({ fatal: `无法打开本地数据库：${errorText(e)}` })
    return
  }
  requestPersist().then((persisted) => setState({ persisted }))
  void syncNow()
}

/** 从数据库重新读取（回到前台 / 其他标签页有改动时）。排在操作队列中，不会覆盖之后的操作 */
export function reloadFromDb(): Promise<void> {
  return serial(async () => {
    if (!state.loaded) return
    try {
      const snap = await db.transaction('r', db.sessions, db.meta, readSnapshotInTx)
      publishSnapshot(snap)
    } catch (e) {
      console.error(e)
    }
  })
}

// ---------- 计时操作 ----------

type TimerIntent =
  | { kind: 'select'; subjectId: string }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'stop' }
  | { kind: 'overtime'; choice: OvertimeChoice }

interface TimerPlan {
  /** undefined = 计时器不变 */
  active?: ActiveTimer | null
  finished: Session | null
  toast?: [string, Toast['kind']]
}

function planTimer(intent: TimerIntent, cur: ActiveTimer | null, at: number): TimerPlan | null {
  const rev = (cur?.rev ?? 0) + 1
  switch (intent.kind) {
    case 'select': {
      if (cur && cur.subjectId === intent.subjectId) {
        return cur.runningSince === null ? { active: { ...resumeTimer(cur, at), rev }, finished: null } : null
      }
      const finished = cur ? finishTimer(cur, at) : null
      return {
        active: { ...startTimer(intent.subjectId, at), rev },
        finished,
        toast: finished ? ['已保存上一段，开始新科目', 'success'] : undefined,
      }
    }
    case 'pause':
      return cur && cur.runningSince !== null ? { active: { ...pauseTimer(cur, at), rev }, finished: null } : null
    case 'resume':
      return cur && cur.runningSince === null ? { active: { ...resumeTimer(cur, at), rev }, finished: null } : null
    case 'stop': {
      if (!cur) return null
      const finished = finishTimer(cur, at)
      return { active: null, finished, toast: finished ? ['本段已保存', 'success'] : ['时长太短，未保存', 'info'] }
    }
    case 'overtime': {
      if (!cur) return null
      const c = intent.choice
      if (c.kind === 'keep') return { active: { ...acknowledgeOvertime(cur, at), rev }, finished: null }
      const finished = c.kind === 'endAt' ? finishTimerAt(cur, c.endAt, at) : finishTimerDiscardingRunning(cur, at)
      return { active: null, finished, toast: finished ? ['已保存修正后的记录', 'success'] : ['已丢弃这一段', 'success'] }
    }
  }
}

/**
 * 计时状态转换。时间在用户触发时捕获（排队不会改变时长）；
 * 执行时以数据库中的计时器为准，并与本标签页看到的计时器核对，不一致说明是过期操作，拒绝并刷新。
 * 旧记录结算、新计时器、同步标记在同一个事务里提交，要么全部生效，要么都不生效。
 */
function timerOp(intent: TimerIntent): Promise<boolean> {
  const at = Date.now()
  const epoch = externalEpoch
  return serial(async () => {
    if (epoch !== externalEpoch) {
      showToast('其他窗口已更新计时，已刷新为最新状态，请再操作一次', 'info')
      return false
    }
    const expected = state.active
    const expectedRev = knownTimerRev
    try {
      const result = await rwTx(async () => {
        const current = (await getMeta('activeTimer')) ?? null
        const rev = (await getMeta('timerRev')) ?? 0
        if (!sameTimer(current, expected) || rev !== expectedRev) return { stale: true as const, current, rev }
        const plan = planTimer(intent, current, at)
        if (!plan) return { stale: false as const, plan: null, syncMeta: null, rev }
        let finished = plan.finished
        if (finished) {
          const existing = await db.sessions.get(finished.id)
          finished = { ...finished, updatedAt: nextRevision(existing?.updatedAt, Math.max(at, finished.updatedAt)) }
          await db.sessions.put(finished)
        }
        if (plan.active !== undefined) await setMeta('activeTimer', plan.active)
        await setMeta('timerRev', rev + 1)
        const syncMeta = finished ? await bumpDirtyInTx() : null
        return { stale: false as const, plan: { ...plan, finished }, syncMeta, rev: rev + 1 }
      })
      if (result.stale) {
        adoptTimer(result.current, result.rev)
        setState({ active: result.current })
        showToast('其他窗口已更新计时，已刷新为最新状态，请再操作一次', 'info')
        return false
      }
      const plan = result.plan
      if (!plan) return true
      knownTimerRev = result.rev
      const patch: Partial<AppState> = {}
      if (plan.active !== undefined) patch.active = plan.active
      if (plan.finished) patch.sessions = upsert(state.sessions, [plan.finished])
      setState(patch)
      if (result.syncMeta) publishSyncMeta(result.syncMeta)
      if (plan.toast) showToast(...plan.toast)
      notifyOtherTabs()
      if (plan.finished) scheduleSync()
      return true
    } catch (e) {
      reportSaveError(e)
      return false
    }
  })
}

/** 点科目：没在计时就开始；计时中点另一个科目就结算当前段并开始新科目 */
export function selectSubjectAndStart(subjectId: string): Promise<boolean> {
  return timerOp({ kind: 'select', subjectId })
}

export function pause(): Promise<boolean> {
  return timerOp({ kind: 'pause' })
}

export function resume(): Promise<boolean> {
  return timerOp({ kind: 'resume' })
}

export function stop(): Promise<boolean> {
  return timerOp({ kind: 'stop' })
}

export type OvertimeChoice = { kind: 'keep' } | { kind: 'endAt'; endAt: number } | { kind: 'discard' }

export function resolveOvertime(choice: OvertimeChoice): Promise<boolean> {
  return timerOp({ kind: 'overtime', choice })
}

// ---------- 记录编辑 ----------

export interface EditOptions {
  /** 编辑时打开的版本；数据库里已不是这个版本（其他窗口改过）时拒绝保存 */
  expectedUpdatedAt?: number
}

function sessionOp(
  id: string,
  build: (existing: Session | undefined) => Session | null | 'stale',
  opts: EditOptions,
): Promise<boolean> {
  return serial(async () => {
    try {
      const result = await rwTx(async () => {
        const existing = await db.sessions.get(id)
        if (opts.expectedUpdatedAt !== undefined && existing && existing.updatedAt !== opts.expectedUpdatedAt) {
          return { stale: true as const, existing }
        }
        const row = build(existing)
        if (row === 'stale') return { stale: true as const, existing }
        if (!row) return { stale: false as const, row: null, syncMeta: null }
        await db.sessions.put(row)
        return { stale: false as const, row, syncMeta: await bumpDirtyInTx() }
      })
      if (result.stale) {
        if (result.existing) setState({ sessions: upsert(state.sessions, [result.existing]) })
        showToast('这条记录已在其他窗口修改，已刷新，请重新操作', 'error')
        return false
      }
      if (!result.row) return true
      setState({ sessions: upsert(state.sessions, [result.row]) })
      publishSyncMeta(result.syncMeta!)
      notifyOtherTabs()
      scheduleSync()
      return true
    } catch (e) {
      reportSaveError(e)
      return false
    }
  })
}

export function saveSession(session: Session, opts: EditOptions = {}): Promise<boolean> {
  const at = Date.now()
  const checked = checkSession({ ...session, deleted: false })
  if (!checked.ok) {
    showToast(`记录无效：${checked.reason}`, 'error')
    return Promise.resolve(false)
  }
  return sessionOp(
    session.id,
    (existing) => {
      if (state.active?.sessionId === session.id) return 'stale'
      return { ...checked.value, updatedAt: nextRevision(Math.max(existing?.updatedAt ?? 0, session.updatedAt), at) }
    },
    opts,
  )
}

export function deleteSession(id: string, opts: EditOptions = {}): Promise<boolean> {
  const at = Date.now()
  return sessionOp(
    id,
    (existing) => {
      if (!existing || existing.deleted) return null
      return { ...existing, deleted: true, updatedAt: nextRevision(existing.updatedAt, at) }
    },
    opts,
  )
}

// ---------- 设置 ----------

export function updateSettings(patch: Partial<Settings>): Promise<boolean> {
  const at = Date.now()
  const optimistic = checkSettings({ ...state.settings, ...patch, updatedAt: nextRevision(state.settings.updatedAt, at) })
  if (!optimistic.ok) {
    showToast(`设置无效：${optimistic.reason}`, 'error')
    return Promise.resolve(false)
  }
  setState({ settings: optimistic.value }) // 先更新界面，提交失败时回滚为数据库中的值
  return serial(async () => {
    try {
      const result = await rwTx(async () => {
        const raw = await getMeta('settings')
        const valid = raw ? checkSettings({ ...DEFAULT_SETTINGS, ...raw }) : null
        const stored = valid?.ok ? valid.value : DEFAULT_SETTINGS
        const next = checkSettings({ ...stored, ...patch, updatedAt: nextRevision(raw?.updatedAt ?? stored.updatedAt, at) })
        if (!next.ok) throw new Error(next.reason)
        await setMeta('settings', next.value)
        return { settings: next.value, syncMeta: await bumpDirtyInTx() }
      })
      setState({ settings: result.settings })
      publishSyncMeta(result.syncMeta)
      notifyOtherTabs()
      scheduleSync()
      return true
    } catch (e) {
      reportSaveError(e)
      const stored = await getMeta('settings').catch(() => undefined)
      if (stored) setState({ settings: stored })
      return false
    }
  })
}

export async function setSyncConfig(cfg: SyncConfig | null): Promise<void> {
  // 先让进行中的同步、排队的重试全部失效，关闭后不会再开始新的上传
  invalidateSync()
  const result = await serial(() =>
    rwTx(async () => {
      await setMeta('syncConfig', cfg)
      const cur = (await getMeta('syncMeta')) ?? EMPTY_SYNC_META
      const next: SyncMeta = { ...EMPTY_SYNC_META, ...cur, lastError: null }
      await setMeta('syncMeta', next)
      return next
    }),
  ).catch((e) => {
    reportSaveError(e)
    return null
  })
  if (!result) return
  setState({ syncConfig: cfg })
  publishSyncMeta(result, cfg ? 'idle' : 'disabled')
  notifyOtherTabs()
  if (cfg) await syncNow({ manual: true })
}

// ---------- 导入导出 ----------

export function exportBackupText(): string {
  return JSON.stringify(makeBackup(state.sessions, state.settings, Date.now()), null, 1)
}

/** 导入备份：整个文件校验通过才会写入，有任何损坏记录都整体拒绝 */
export async function importBackupText(text: string): Promise<number> {
  const backup = parseBackup(text) // 文件级问题直接抛错
  if (backup.invalid.length) {
    throw new Error(`备份中 ${describeInvalid(backup.invalid)}，为避免覆盖现有数据，本次没有导入任何内容`)
  }
  return serial(async () => {
    const result = await rwTx(async () => {
      const local = await db.sessions.toArray()
      const { toLocal } = mergeSessions(local, backup.sessions)
      if (toLocal.length) await db.sessions.bulkPut(toLocal)
      const stored = (await getMeta('settings')) ?? DEFAULT_SETTINGS
      const settings = mergeSettings(stored, backup.settings)
      const settingsChanged = settings !== stored
      if (settingsChanged) await setMeta('settings', settings)
      const syncMeta = toLocal.length || settingsChanged ? await bumpDirtyInTx() : null
      return { toLocal, settings, syncMeta }
    })
    setState({ sessions: upsert(state.sessions, result.toLocal), settings: result.settings })
    if (result.syncMeta) {
      publishSyncMeta(result.syncMeta)
      notifyOtherTabs()
      scheduleSync()
    }
    return result.toLocal.length
  })
}

// ---------- GitHub 同步 ----------

const SYNC_DELAY_MS = 1500
const RETRY_BASE_MS = 5000
const RETRY_MAX_MS = 15 * 60_000
const RETRY_AFTER_CAP_MS = HOUR
const MAX_AUTO_RETRIES = 8
const MAX_CONFLICT_RETRIES = 3
const MAX_ROUNDS = 3

/** 云端数据本身有问题（损坏/版本不支持）：不自动重试，也绝不覆盖 */
class PermanentSyncError extends Error {}
const CANCELLED = new DOMException('同步已取消', 'AbortError')

let syncGen = 0
let syncAbort: AbortController | null = null
let syncTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryAttempt = 0
let running: { gen: number; promise: Promise<void> } | null = null
let lastAutoSync = 0

/** 关闭/切换备份配置：取消进行中的请求，清掉排队的同步和重试 */
function invalidateSync() {
  syncGen++
  syncAbort?.abort(CANCELLED)
  syncAbort = null
  clearTimeout(syncTimer)
  clearTimeout(retryTimer)
  syncTimer = undefined
  retryTimer = undefined
  retryAttempt = 0
  running = null
}

function scheduleSync(delay = SYNC_DELAY_MS) {
  if (!state.syncConfig) return
  if (retryTimer !== undefined) return // 正在退避等待，届时会一并推送
  clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = undefined
    void syncNow()
  }, delay)
}

function scheduleRetry(e: unknown) {
  clearTimeout(retryTimer)
  retryTimer = undefined
  if (!state.syncConfig || retryAttempt >= MAX_AUTO_RETRIES) return // 达到上限：等待下次回到前台、联网或手动同步
  const base = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt)
  let delay = base + Math.random() * base * 0.2
  const hinted = e instanceof GitHubError ? e.retryAfterMs : null
  if (hinted !== null) delay = Math.max(delay, Math.min(hinted, RETRY_AFTER_CAP_MS))
  retryAttempt++
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    void syncNow()
  }, delay)
}

/** 等待 p，但取消信号触发时立即结束（即使底层请求不理会信号） */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? CANCELLED)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? CANCELLED)
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        signal.removeEventListener('abort', onAbort)
        reject(e)
      },
    )
  })
}

/** 与 GitHub 私有仓库双向合并同步 */
export function syncNow(opts: { manual?: boolean; throttle?: boolean } = {}): Promise<void> {
  if (!state.syncConfig) return Promise.resolve()
  if (running && running.gen === syncGen) return running.promise
  if (opts.throttle && Date.now() - lastAutoSync < 30_000) return Promise.resolve()
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setState({ sync: { ...state.sync, status: 'offline' } })
    if (opts.manual) showToast('当前离线，联网后会自动备份', 'info')
    return Promise.resolve()
  }
  clearTimeout(syncTimer)
  clearTimeout(retryTimer)
  syncTimer = undefined
  retryTimer = undefined
  if (opts.manual) retryAttempt = 0
  lastAutoSync = Date.now()
  const task: { gen: number; promise: Promise<void> } = { gen: syncGen, promise: Promise.resolve() }
  task.promise = runSync(opts.manual ?? false).finally(() => {
    if (running === task) running = null
  })
  running = task
  return task.promise
}

interface PushPlan {
  /** null = 远端已是最新，不需要上传 */
  text: string | null
  seq: number
}

async function runSync(manual: boolean): Promise<void> {
  const gen = syncGen
  const cfg = state.syncConfig
  if (!cfg) return
  const ac = new AbortController()
  syncAbort = ac
  const alive = () => gen === syncGen && !ac.signal.aborted
  const ensure = () => {
    if (!alive()) throw CANCELLED
  }
  setState({ sync: { ...state.sync, status: 'syncing' } })
  try {
    let clean = false
    for (let round = 0; round < MAX_ROUNDS && !clean; round++) {
      for (let attempt = 0; ; attempt++) {
        const remote = await untilAborted(getFile(cfg, { signal: ac.signal }), ac.signal)
        ensure()
        let parsed: ParsedBackup | null = null
        if (remote) {
          try {
            parsed = parseBackup(remote.text)
          } catch (e) {
            throw new PermanentSyncError(`云端备份无法读取（${errorText(e)}），已暂停上传以免覆盖`)
          }
          if (parsed.invalid.length) {
            throw new PermanentSyncError(`云端备份中 ${describeInvalid(parsed.invalid)}，已暂停上传以免覆盖`)
          }
        }
        // 网络响应回来后，基于数据库里此刻的最新状态重新合并
        const plan = await serial(() => applyRemote(parsed, cfg, gen))
        ensure()
        if (plan.text !== null) {
          const stamp = new Date().toLocaleString('zh-CN', { hour12: false })
          try {
            ensure() // 上传前最后核对一次：配置仍有效
            await untilAborted(putFile(cfg, plan.text, remote?.sha ?? null, `备份学习记录 ${stamp}`, { signal: ac.signal }), ac.signal)
          } catch (e) {
            if (isConflict(e) && attempt < MAX_CONFLICT_RETRIES && alive()) continue // 另一台设备刚更新过，重新拉取合并
            throw e
          }
          ensure()
        }
        clean = await serial(() => finishSync(plan.seq, cfg, gen))
        break
      }
    }
    ensure()
    retryAttempt = 0
    if (!clean) scheduleSync() // 同步期间又有新改动，稍后继续
    if (manual) showToast('已与 GitHub 同步', 'success')
  } catch (e) {
    if (!alive()) return // 本标签页关闭/切换了配置：旧任务静默结束，不改写状态
    if (e === CANCELLED) {
      void reloadFromDb() // 其他标签页改了备份配置：读取最新配置
      return
    }
    const msg = errorText(e)
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    await serial(() => recordSyncError(msg, gen, offline ? 'offline' : 'error')).catch(console.error)
    const permanent = e instanceof PermanentSyncError || (e instanceof GitHubError && !isTransient(e) && !isConflict(e))
    if (!permanent && !offline) scheduleRetry(e)
    if (manual) showToast(`同步失败：${msg}`, 'error')
  } finally {
    if (syncAbort === ac) syncAbort = null
  }
}

/** 拉取部分：在一个事务内读取本地最新数据、合并远端、写回，并据此生成要上传的内容 */
async function applyRemote(parsed: ParsedBackup | null, cfg: SyncConfig, gen: number): Promise<PushPlan> {
  if (gen !== syncGen) throw CANCELLED
  const result = await rwTx(async () => {
    if (!sameConfig(await getMeta('syncConfig'), cfg)) throw CANCELLED // 其他标签页已关闭/切换备份
    const local = await db.sessions.toArray()
    const { merged, toLocal, remoteChanged } = mergeSessions(local, parsed?.sessions ?? [])
    if (toLocal.length) await db.sessions.bulkPut(toLocal)
    const stored = (await getMeta('settings')) ?? DEFAULT_SETTINGS
    const settings = mergeSettings(stored, parsed?.settings ?? null)
    if (settings !== stored) await setMeta('settings', settings)
    const syncMeta = (await getMeta('syncMeta')) ?? EMPTY_SYNC_META
    const settingsAhead = !parsed?.settings || compareSettings(settings, parsed.settings) !== 0
    const needPush = !parsed || remoteChanged || settingsAhead
    return {
      merged,
      settings,
      changed: toLocal.length > 0 || settings !== stored,
      plan: { text: needPush ? JSON.stringify(makeBackup(merged, settings, Date.now())) : null, seq: syncMeta.seq ?? 0 },
    }
  })
  setState({ sessions: result.merged, settings: result.settings })
  if (result.changed) notifyOtherTabs()
  return result.plan
}

/** 完成：只有期间没有新的本地改动（序号不变）才清除待同步标记。返回是否已干净 */
async function finishSync(seq: number, cfg: SyncConfig, gen: number): Promise<boolean> {
  if (gen !== syncGen) throw CANCELLED
  const meta = await rwTx(async () => {
    if (!sameConfig(await getMeta('syncConfig'), cfg)) throw CANCELLED
    const cur = { ...EMPTY_SYNC_META, ...((await getMeta('syncMeta')) ?? {}) }
    const next: SyncMeta = { ...cur, lastSyncAt: Date.now(), dirty: (cur.seq ?? 0) !== seq, lastError: null }
    await setMeta('syncMeta', next)
    return next
  })
  if (gen !== syncGen) throw CANCELLED
  publishSyncMeta(meta, meta.dirty ? 'syncing' : 'ok')
  return !meta.dirty
}

async function recordSyncError(msg: string, gen: number, status: SyncStatus) {
  if (gen !== syncGen) return
  const meta = await rwTx(async () => {
    const cur = { ...EMPTY_SYNC_META, ...((await getMeta('syncMeta')) ?? {}) }
    const next: SyncMeta = { ...cur, lastError: msg } // 保留 dirty：失败后仍待同步
    await setMeta('syncMeta', next)
    return next
  })
  if (gen !== syncGen) return
  publishSyncMeta(meta, status)
}

// ---------- 全局事件 ----------

export function installGlobalListeners() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void reloadFromDb().then(() => (state.sync.dirty ? syncNow() : syncNow({ throttle: true })))
    }
  })
  window.addEventListener('online', () => {
    retryAttempt = 0
    void syncNow()
  })
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel('kaoyan-timer')
      channel.onmessage = () => void reloadFromDb()
    } catch {
      channel = null
    }
  }
}

export const overtimeMs = (s: Settings) => Math.max(0.5, s.overtimeHours) * HOUR
