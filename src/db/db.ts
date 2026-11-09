import Dexie, { type Table } from 'dexie'
import type { ActiveTimer, Session, Settings, SyncConfig } from '../domain/types'

export interface SyncMeta {
  lastSyncAt: number | null
  /** 本地有尚未推送到 GitHub 的改动 */
  dirty: boolean
  lastError: string | null
}

export interface MetaMap {
  activeTimer: ActiveTimer | null
  settings: Settings
  syncConfig: SyncConfig | null
  syncMeta: SyncMeta
}

type MetaRow = { key: keyof MetaMap; value: unknown }

class KaoyanDB extends Dexie {
  sessions!: Table<Session, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super('kaoyan-timer')
    // ⚠️ 以后修改结构时只能新增 version(2)…，不要改 version(1)，Dexie 会自动迁移
    this.version(1).stores({
      sessions: 'id, startAt, updatedAt, subjectId',
      meta: 'key',
    })
  }
}

export const db = new KaoyanDB()

export async function getMeta<K extends keyof MetaMap>(key: K): Promise<MetaMap[K] | undefined> {
  const row = await db.meta.get(key)
  return row?.value as MetaMap[K] | undefined
}

export async function setMeta<K extends keyof MetaMap>(key: K, value: MetaMap[K]): Promise<void> {
  await db.meta.put({ key, value })
}

/** 申请持久化存储，降低浏览器清理数据的可能 */
export async function requestPersist(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
