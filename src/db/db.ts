import Dexie, { type Table } from 'dexie'
import type { ActiveTimer, Session, Settings, SyncConfig } from '../domain/types'

export interface SyncMeta {
  lastSyncAt: number | null
  /** 本地有尚未推送到 GitHub 的改动 */
  dirty: boolean
  lastError: string | null
  /** 本地改动序号：每次本地数据改动 +1，同步完成时据此判断期间是否又有新改动（旧数据没有此字段，按 0 处理） */
  seq?: number
}

export interface MetaMap {
  activeTimer: ActiveTimer | null
  /** 计时状态修订号：任何标签页每做一次计时状态转换 +1（含开始/结束，计时器为 null 时也保留），用于识别过期操作 */
  timerRev: number
  settings: Settings
  syncConfig: SyncConfig | null
  /** Local configuration generation; also detects disable/re-enable with identical credentials. */
  syncConfigRev: number
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
