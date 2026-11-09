import type { Session, Settings } from '../domain/types'

export const BACKUP_VERSION = 1

/** 备份文件格式（不包含 Token） */
export interface BackupFile {
  app: 'kaoyan-timer'
  version: number
  exportedAt: number
  settings: Settings | null
  sessions: Session[]
}

export interface MergeResult {
  merged: Session[]
  /** 需要写入本地的记录（远端更新的） */
  toLocal: Session[]
  /** 合并结果与远端不同，需要推送 */
  remoteChanged: boolean
}

function isValidSession(s: unknown): s is Session {
  const x = s as Session
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.subjectId === 'string' &&
    Array.isArray(x.segments) &&
    x.segments.every((g) => typeof g?.start === 'number' && typeof g?.end === 'number') &&
    typeof x.updatedAt === 'number'
  )
}

function normalize(s: Session): Session {
  const segments = s.segments.filter((g) => g.end > g.start).sort((a, b) => a.start - b.start)
  return {
    id: s.id,
    subjectId: s.subjectId,
    segments,
    startAt: segments[0]?.start ?? s.startAt ?? 0,
    source: s.source === 'manual' ? 'manual' : 'timer',
    createdAt: s.createdAt ?? s.updatedAt,
    updatedAt: s.updatedAt,
    deleted: !!s.deleted,
  }
}

/** 解析并校验备份 JSON，格式不对直接抛错，绝不会用坏数据覆盖本地 */
export function parseBackup(text: string): BackupFile {
  const raw = JSON.parse(text)
  if (!raw || raw.app !== 'kaoyan-timer' || !Array.isArray(raw.sessions)) {
    throw new Error('不是有效的考研计时备份文件')
  }
  const sessions = (raw.sessions as unknown[]).filter(isValidSession).map(normalize)
  return {
    app: 'kaoyan-timer',
    version: Number(raw.version) || BACKUP_VERSION,
    exportedAt: Number(raw.exportedAt) || 0,
    settings: raw.settings && typeof raw.settings.examDate === 'string' ? raw.settings : null,
    sessions,
  }
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

/**
 * 按 id 合并，updatedAt 新的胜出（删除墓碑同样参与比较），相同时以本地为准
 */
export function mergeSessions(local: Session[], remote: Session[]): MergeResult {
  const byId = new Map<string, Session>()
  for (const s of local) byId.set(s.id, s)

  const toLocal: Session[] = []
  let remoteChanged = false
  const remoteIds = new Set<string>()

  for (const r of remote) {
    remoteIds.add(r.id)
    const l = byId.get(r.id)
    if (!l || r.updatedAt > l.updatedAt) {
      byId.set(r.id, r)
      toLocal.push(r)
    } else if (l.updatedAt > r.updatedAt) {
      remoteChanged = true
    }
  }
  for (const s of local) if (!remoteIds.has(s.id)) remoteChanged = true

  return { merged: [...byId.values()], toLocal, remoteChanged }
}

export function mergeSettings(local: Settings, remote: Settings | null): Settings {
  if (remote && remote.updatedAt > local.updatedAt) return { ...local, ...remote }
  return local
}
