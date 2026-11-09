/** 一段连续计时（毫秒时间戳），暂停期间不在任何 segment 内 */
export interface Segment {
  start: number
  end: number
}

/** 一次学习记录 = 一个科目的若干连续段 */
export interface Session {
  id: string
  subjectId: string
  segments: Segment[]
  /** = segments[0].start，便于排序和索引 */
  startAt: number
  source: 'timer' | 'manual'
  createdAt: number
  updatedAt: number
  /** 墓碑：删除后保留，用于多设备同步 */
  deleted: boolean
}

/** 正在进行中的计时，每次状态变化都会立即写入数据库 */
export interface ActiveTimer {
  sessionId: string
  subjectId: string
  /** 已结束的段 */
  segments: Segment[]
  /** 当前段开始时间；null 表示暂停中 */
  runningSince: number | null
  createdAt: number
  /** 超时提醒确认过的时间点：之后才重新计算是否超时 */
  ackAt: number | null
  /** 修订号：每次状态转换 +1，用于识别其他标签页的过期操作（旧数据没有此字段，按 0 处理） */
  rev?: number
}

export interface Settings {
  /** 初试日期 YYYY-MM-DD */
  examDate: string
  /** 备考起始日期 YYYY-MM-DD */
  startDate: string
  /** 单段连续计时超过多少小时，下次打开时提醒 */
  overtimeHours: number
  keepAwake: boolean
  updatedAt: number
}

export interface SyncConfig {
  owner: string
  repo: string
  token: string
  path: string
}
