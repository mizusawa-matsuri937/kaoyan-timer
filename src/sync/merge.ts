import { dayKey, parseDay } from '../domain/dates'
import { getSubject } from '../domain/subjects'
import type { Segment, Session, Settings } from '../domain/types'

export const BACKUP_VERSION = 1

/** 合法时间戳范围：1970-01-01 ~ 2100-01-01（拒绝负数、无穷大、远未来值） */
export const MIN_TIMESTAMP = 0
export const MAX_TIMESTAMP = Date.UTC(2100, 0, 1)

/** 备份文件格式（不包含 Token） */
export interface BackupFile {
  app: 'kaoyan-timer'
  version: number
  exportedAt: number
  settings: Settings | null
  sessions: Session[]
}

export interface InvalidRecord {
  index: number
  reason: string
}

/** parseBackup 的结果：合法记录 + 被隔离的损坏记录（调用方决定是否整体拒绝） */
export interface ParsedBackup extends BackupFile {
  invalid: InvalidRecord[]
}

export interface MergeResult {
  merged: Session[]
  /** 需要写入本地的记录（远端胜出且与本地不同） */
  toLocal: Session[]
  /** 合并结果与远端不同，需要推送 */
  remoteChanged: boolean
}

// ---------- 版本（逻辑时钟） ----------

/**
 * 生成新的版本号：取系统时间，但至少比该记录已见过的版本大 1。
 * 这样系统时钟被往回校正后，新的本地修改也不会变成"旧版本"。
 */
export function nextRevision(previous: number | null | undefined, now = Date.now()): number {
  const prev = Number.isFinite(previous) ? (previous as number) : 0
  return Math.max(Math.floor(now), Math.floor(prev) + 1)
}

// ---------- 校验 ----------

const isTs = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= MIN_TIMESTAMP && v <= MAX_TIMESTAMP

export function isValidDay(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && dayKey(parseDay(v)) === v
}

type Checked<T> = { ok: true; value: T } | { ok: false; reason: string }

function checkSegments(raw: unknown): Checked<Segment[]> {
  if (!Array.isArray(raw)) return { ok: false, reason: 'segments 不是数组' }
  const out: Segment[] = []
  for (const g of raw) {
    const start = (g as Segment)?.start
    const end = (g as Segment)?.end
    if (!isTs(start) || !isTs(end)) return { ok: false, reason: '时间段包含非法时间戳' }
    if (end <= start) return { ok: false, reason: '时间段结束时间不晚于开始时间' }
    out.push({ start, end })
  }
  out.sort((a, b) => a.start - b.start)
  return { ok: true, value: out }
}

/** 校验并规范化一条记录；损坏的记录返回原因，绝不会规范化成"空记录" */
export function checkSession(raw: unknown): Checked<Session> {
  const x = raw as Partial<Session> | null
  if (!x || typeof x !== 'object') return { ok: false, reason: '不是对象' }
  if (typeof x.id !== 'string' || x.id.length === 0 || x.id.length > 200) return { ok: false, reason: 'id 无效' }
  if (typeof x.subjectId !== 'string' || !getSubject(x.subjectId)) return { ok: false, reason: '未知科目' }
  if (!isTs(x.updatedAt)) return { ok: false, reason: 'updatedAt 无效' }
  if (x.deleted !== undefined && typeof x.deleted !== 'boolean') return { ok: false, reason: 'deleted 无效' }
  if (x.source !== undefined && x.source !== 'timer' && x.source !== 'manual') return { ok: false, reason: 'source 无效' }
  if (x.createdAt !== undefined && !isTs(x.createdAt)) return { ok: false, reason: 'createdAt 无效' }
  const deleted = x.deleted === true

  const segs = checkSegments(x.segments)
  let segments: Segment[]
  if (segs.ok) segments = segs.value
  else if (deleted) segments = [] // 墓碑只需要 id 和版本，时间段内容不再参与统计
  else return segs
  if (!deleted && segments.length === 0) return { ok: false, reason: '没有有效的时间段' }

  const startAt = segments[0]?.start ?? (isTs(x.startAt) ? x.startAt : 0)
  return {
    ok: true,
    value: {
      id: x.id,
      subjectId: x.subjectId,
      segments,
      startAt,
      source: x.source === 'manual' ? 'manual' : 'timer',
      createdAt: x.createdAt ?? x.updatedAt,
      updatedAt: x.updatedAt,
      deleted,
    },
  }
}

export function checkSettings(raw: unknown): Checked<Settings> {
  const x = raw as Partial<Settings> | null
  if (!x || typeof x !== 'object') return { ok: false, reason: '设置不是对象' }
  if (!isValidDay(x.examDate)) return { ok: false, reason: '初试日期无效' }
  if (!isValidDay(x.startDate)) return { ok: false, reason: '备考开始日期无效' }
  if (typeof x.overtimeHours !== 'number' || !Number.isFinite(x.overtimeHours) || x.overtimeHours < 0.5 || x.overtimeHours > 24) {
    return { ok: false, reason: '超时提醒时长无效' }
  }
  if (x.keepAwake !== undefined && typeof x.keepAwake !== 'boolean') return { ok: false, reason: '屏幕常亮设置无效' }
  if (!isTs(x.updatedAt)) return { ok: false, reason: '设置的 updatedAt 无效' }
  return {
    ok: true,
    value: {
      examDate: x.examDate,
      startDate: x.startDate,
      overtimeHours: x.overtimeHours,
      keepAwake: x.keepAwake === true,
      updatedAt: x.updatedAt,
    },
  }
}

/**
 * 解析并校验备份 JSON。
 * - 文件级问题（不是 JSON、不是本应用、版本不支持、设置损坏）直接抛错；
 * - 单条记录损坏时隔离到 invalid，不会进入 sessions。
 */
export function parseBackup(text: string): ParsedBackup {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('不是有效的 JSON 文件')
  }
  if (!raw || typeof raw !== 'object' || raw.app !== 'kaoyan-timer' || !Array.isArray(raw.sessions)) {
    throw new Error('不是有效的考研计时备份文件')
  }
  // 早期备份都带 version:1；缺省时按 1 处理。更新的版本需要先升级应用。
  const version = raw.version === undefined ? BACKUP_VERSION : raw.version
  if (version !== BACKUP_VERSION) {
    throw new Error(`备份文件版本 ${String(version)} 不受支持（当前支持 ${BACKUP_VERSION}），请先更新应用`)
  }
  let settings: Settings | null = null
  if (raw.settings !== undefined && raw.settings !== null) {
    const s = checkSettings(raw.settings)
    if (!s.ok) throw new Error(`备份中的设置已损坏：${s.reason}`)
    settings = s.value
  }
  const sessions: Session[] = []
  const invalid: InvalidRecord[] = []
  ;(raw.sessions as unknown[]).forEach((row, index) => {
    const r = checkSession(row)
    if (r.ok) sessions.push(r.value)
    else invalid.push({ index, reason: r.reason })
  })
  return {
    app: 'kaoyan-timer',
    version: BACKUP_VERSION,
    exportedAt: isTs(raw.exportedAt) ? raw.exportedAt : 0,
    settings,
    sessions,
    invalid,
  }
}

export function describeInvalid(invalid: InvalidRecord[]): string {
  const first = invalid[0]
  return `${invalid.length} 条记录已损坏（第 ${first.index + 1} 条：${first.reason}）`
}

export function makeBackup(sessions: Session[], settings: Settings | null, now: number): BackupFile {
  return {
    app: 'kaoyan-timer',
    version: BACKUP_VERSION,
    exportedAt: now,
    settings,
    sessions: [...sessions].sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id)),
  }
}

// ---------- 合并（确定性、可交换） ----------

function canonicalSession(s: Session): string {
  return JSON.stringify([s.id, s.subjectId, s.segments.map((g) => [g.start, g.end]), s.startAt, s.source, s.createdAt, s.updatedAt, !!s.deleted])
}

function canonicalSettings(s: Settings): string {
  return JSON.stringify([s.examDate, s.startDate, s.overtimeHours, !!s.keepAwake, s.updatedAt])
}

/**
 * 同一 id 的两个版本谁胜出（>0 表示 a 胜出，0 表示内容完全相同）：
 * 1. updatedAt（逻辑时钟）大的胜出；
 * 2. 相同时删除墓碑胜出（删除不会被同版本的普通记录复活）；
 * 3. 仍相同时按规范化内容的字典序决胜，保证两端合并结果一致。
 */
export function compareSessions(a: Session, b: Session): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1
  if (!!a.deleted !== !!b.deleted) return a.deleted ? 1 : -1
  const ka = canonicalSession(a)
  const kb = canonicalSession(b)
  return ka === kb ? 0 : ka > kb ? 1 : -1
}

export function compareSettings(a: Settings, b: Settings): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? 1 : -1
  const ka = canonicalSettings(a)
  const kb = canonicalSettings(b)
  return ka === kb ? 0 : ka > kb ? 1 : -1
}

export function mergeSessions(local: Session[], remote: Session[]): MergeResult {
  const localById = new Map<string, Session>()
  for (const s of local) {
    const cur = localById.get(s.id)
    if (!cur || compareSessions(s, cur) > 0) localById.set(s.id, s)
  }
  const remoteById = new Map<string, Session>()
  for (const r of remote) {
    const cur = remoteById.get(r.id)
    if (!cur || compareSessions(r, cur) > 0) remoteById.set(r.id, r)
  }

  const byId = new Map(localById)
  const toLocal: Session[] = []
  for (const [id, r] of remoteById) {
    const l = localById.get(id)
    if (!l || compareSessions(r, l) > 0) {
      byId.set(id, r)
      toLocal.push(r)
    }
  }
  let remoteChanged = false
  for (const [id, m] of byId) {
    const r = remoteById.get(id)
    if (!r || compareSessions(m, r) !== 0) {
      remoteChanged = true
      break
    }
  }
  return { merged: [...byId.values()], toLocal, remoteChanged }
}

/** 设置合并：版本大的胜出，相同版本按内容决胜；返回值与本地相同则原样返回本地对象 */
export function mergeSettings(local: Settings, remote: Settings | null): Settings {
  if (!remote) return local
  const c = compareSettings(remote, local)
  if (c > 0) return { ...local, ...remote }
  return local
}
