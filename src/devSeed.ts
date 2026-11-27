import { db, setMeta } from './db/db'
import { addDays, dayKey, parseDay } from './domain/dates'
import type { ActiveTimer, Segment, Session, Settings } from './domain/types'
import { getState, reloadFromDb, showToast } from './store'

const DEV_CLEARED_KEY = 'kaoyan.devCleared'
const DEV_SEEDED_KEY = 'kaoyan.devSeeded.v1'
const MIN = 60_000
const HOUR = 3_600_000

/** 确定性伪随机数，保证每次生成的 135 天测试数据分布稳定、真实可复现 */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeSession(
  id: string,
  subjectId: string,
  segments: Segment[],
  revBase: number,
  source: 'timer' | 'manual' = 'timer',
): Session {
  const startAt = segments[0].start
  const endAt = segments[segments.length - 1].end
  return {
    id,
    subjectId,
    segments,
    startAt,
    source,
    createdAt: endAt,
    updatedAt: revBase,
    deleted: false,
  }
}

export function buildDemoDataset(now = Date.now()): {
  settings: Settings
  sessions: Session[]
  active: ActiveTimer | null
} {
  const rand = mulberry32(20261127)
  const today = dayKey(now)
  const startDate = addDays(today, -134) // 约 20 周热度矩阵，足够横向滚动与测试贴边防裁切气泡
  const examDate = addDays(today, 28) // 冲刺倒计时 28 天

  const settings: Settings = {
    startDate,
    examDate,
    overtimeHours: 4,
    keepAwake: false,
    updatedAt: now,
  }

  const sessions: Session[] = []
  let seq = 1
  const nextRev = () => now - 500_000 + seq++

  const dailyPool = [
    'ds',
    'co',
    'os',
    'cn',
    'calc',
    'la',
    'prob',
    'english',
    'politics',
  ] as const
  const mockPool = ['mock-408', 'mock-math', 'mock-english', 'mock-politics'] as const

  // 生成过去 134 天的历史记录（覆盖 Lv.0 ~ Lv.4 全部五档热度、周末模考、多段暂停记录与近 18 天连续打卡）
  for (let offset = -134; offset <= -1; offset++) {
    const day = addDays(today, offset)
    const dayStart = parseDay(day).getTime()
    const recentStreak = offset >= -17 // 最近 18 天（含今天）连续不断卡

    // 挑选当天强度档位：0=休息, 1=<1h, 2=1-5h, 3=5-10h, 4=10h+
    const roll = rand()
    let tier: 0 | 1 | 2 | 3 | 4
    if (!recentStreak && roll < 0.13) {
      tier = 0
    } else if (roll < 0.24) {
      tier = 1
    } else if (roll < 0.52) {
      tier = 2
    } else if (roll < 0.86) {
      tier = 3
    } else {
      tier = 4
    }

    // 昨天固定设为高密度多切片样本日，方便一翻页就能测 24h 圆环指尖刻度拨盘与碎片段磁吸
    if (offset === -1) {
      sessions.push(
        makeSession(`demo-y-1`, 'english', [{ start: dayStart + 7.25 * HOUR, end: dayStart + 8.35 * HOUR }], nextRev()),
        makeSession(
          `demo-y-2`,
          'ds',
          [
            { start: dayStart + 8.75 * HOUR, end: dayStart + 10.25 * HOUR },
            { start: dayStart + 10.5 * HOUR, end: dayStart + 11.75 * HOUR },
          ],
          nextRev(),
        ),
        // 11 分钟极短碎片记录：专门测试 24h 圆环磁吸刻度锁定
        makeSession(`demo-y-3`, 'politics', [{ start: dayStart + 13.5 * HOUR, end: dayStart + 13.5 * HOUR + 11 * MIN }], nextRev(), 'manual'),
        makeSession(`demo-y-4`, 'calc', [{ start: dayStart + 14.25 * HOUR, end: dayStart + 17.4 * HOUR }], nextRev()),
        makeSession(`demo-y-5`, 'os', [{ start: dayStart + 19.2 * HOUR, end: dayStart + 21.85 * HOUR }], nextRev()),
      )
      continue
    }

    // 前天固定加入一条跨午夜学习记录（23:15 -> 次日 00:40），便于测试 (跨天) 切分展示
    if (offset === -3) {
      sessions.push(
        makeSession(`demo-cross-1`, 'co', [{ start: dayStart + 9 * HOUR, end: dayStart + 11.8 * HOUR }], nextRev()),
        makeSession(`demo-cross-2`, 'la', [{ start: dayStart + 14.5 * HOUR, end: dayStart + 17.2 * HOUR }], nextRev()),
        makeSession(`demo-cross-midnight`, 'cn', [{ start: dayStart + 23.25 * HOUR, end: dayStart + 24.65 * HOUR }], nextRev()),
      )
      continue
    }

    if (tier === 0) continue

    // 每隔约 18 天的冲刺日安排一场 180 分钟全真模拟测试
    const isMockDay = tier >= 3 && Math.abs(offset) % 18 === 4
    let cursorMin = 7 * 60 + Math.floor(rand() * 75) // 07:00 ~ 08:15 起步

    if (isMockDay) {
      const mockId = mockPool[Math.abs(offset) % mockPool.length]
      const mStart = dayStart + 8.5 * HOUR
      sessions.push(makeSession(`demo-${day}-mock`, mockId, [{ start: mStart, end: mStart + 180 * MIN }], nextRev()))
      cursorMin = 13 * 60 + 40
    }

    const targetMin =
      tier === 1
        ? 25 + Math.floor(rand() * 28) // 25 ~ 53m (<1h)
        : tier === 2
          ? 95 + Math.floor(rand() * 165) // 1h35m ~ 4h20m
          : tier === 3
            ? (isMockDay ? 170 : 320) + Math.floor(rand() * 190) // 5h20m ~ 8h30m
            : (isMockDay ? 440 : 615) + Math.floor(rand() * 95) // 10h15m ~ 11h50m

    let accMin = 0
    let slotIdx = 0
    while (accMin < targetMin && cursorMin < 22 * 60 + 45) {
      const remain = targetMin - accMin
      const durMin = Math.min(remain, 40 + Math.floor(rand() * 95))
      if (durMin < 12) break
      const sStart = dayStart + cursorMin * MIN
      const sEnd = sStart + durMin * MIN
      if (sEnd >= dayStart + 23.8 * HOUR) break

      // 优先让 408 和数学占比更高，贴合真实 408 考研分布
      const pickRoll = rand()
      const subId =
        pickRoll < 0.44
          ? dailyPool[Math.floor(rand() * 4)] // 408 四科
          : pickRoll < 0.75
            ? dailyPool[4 + Math.floor(rand() * 3)] // 数学三科
            : pickRoll < 0.9
              ? 'english'
              : 'politics'

      // 偶发带中间暂停的两段式记录与手动补录标记
      const splitTwo = durMin >= 85 && rand() < 0.22
      const segs: Segment[] = splitTwo
        ? [
            { start: sStart, end: sStart + Math.floor(durMin * 0.52) * MIN },
            { start: sStart + Math.floor(durMin * 0.52) * MIN + 8 * MIN, end: sEnd + 8 * MIN },
          ]
        : [{ start: sStart, end: sEnd }]

      sessions.push(
        makeSession(
          `demo-${day}-${slotIdx++}`,
          subId,
          segs,
          nextRev(),
          rand() < 0.08 ? 'manual' : 'timer',
        ),
      )

      accMin += durMin
      cursorMin += durMin + 22 + Math.floor(rand() * 48)
    }
  }

  // ---------- 今日数据精心编排：已完成 4h 46m (Lv.2) + 18m 已暂停计时（点「结束」立刻跨过 5h 晋级 Lv.3！） ----------
  const todayStart = parseDay(today).getTime()
  const elapsedTodayMs = now - todayStart
  let active: ActiveTimer | null = null

  if (elapsedTodayMs >= 6 * HOUR) {
    // 白天 / 下午 / 晚上打开：按真实早午时段排布 4 段记录（共 286m = 4h46m），含 1 段 12m 碎片段供圆环拨盘测试
    const latestSafeEnd = now - 24 * MIN
    const scale = Math.min(1, (latestSafeEnd - (todayStart + 45 * MIN)) / (8.5 * HOUR))
    const base0 = todayStart + Math.max(30 * MIN, Math.floor(6.8 * HOUR * scale))

    const s1Start = base0
    const s1End = s1Start + 65 * MIN // 英语 1h05m
    const s2Start = s1End + 18 * MIN
    const s2End = s2Start + 135 * MIN // 数据结构 2h15m
    const s3Start = s2End + 22 * MIN
    const s3End = s3Start + 12 * MIN // 政治 12m（极短碎片段）
    const s4Start = s3End + 16 * MIN
    const s4End = Math.min(latestSafeEnd, s4Start + 74 * MIN) // 高数 1h14m

    if (s4End > s4Start + 15 * MIN) {
      sessions.push(
        makeSession('demo-today-1', 'english', [{ start: s1Start, end: s1End }], nextRev()),
        makeSession('demo-today-2', 'ds', [{ start: s2Start, end: s2End }], nextRev()),
        makeSession('demo-today-3', 'politics', [{ start: s3Start, end: s3End }], nextRev(), 'manual'),
        makeSession('demo-today-4', 'calc', [{ start: s4Start, end: s4End }], nextRev()),
      )
    }

    // 挂起一段 18 分钟的「操作系统」专注：点「继续」测图标形变，点「结束」立刻跨过 5h 门槛触发晋级高光 + 5s 撤销 Toast！
    const aStart = now - 20 * MIN
    const aEnd = now - 2 * MIN
    active = {
      sessionId: 'demo-active-os',
      subjectId: 'os',
      segments: [{ start: aStart, end: aEnd }],
      runningSince: null,
      createdAt: aStart,
      ackAt: null,
      rev: 1,
    }
  } else if (elapsedTodayMs >= 30 * MIN) {
    // 若恰好在凌晨刚过午夜打开，也保证不产生未来时间戳
    const aStart = now - 22 * MIN
    const aEnd = now - 4 * MIN
    active = {
      sessionId: 'demo-active-os',
      subjectId: 'os',
      segments: [{ start: aStart, end: aEnd }],
      runningSince: null,
      createdAt: aStart,
      ackAt: null,
      rev: 1,
    }
  }

  return { settings, sessions, active }
}

/** 写入全套演示数据并刷新全局 Store */
export async function applyDevSeedData(silent = false): Promise<void> {
  try {
    localStorage.removeItem(DEV_CLEARED_KEY)
    localStorage.setItem(DEV_SEEDED_KEY, '1')
  } catch {
    /* ignore */
  }
  const { settings, sessions, active } = buildDemoDataset(Date.now())
  await db.transaction('rw', db.sessions, db.meta, async () => {
    await db.sessions.clear()
    await db.sessions.bulkPut(sessions)
    await setMeta('settings', settings)
    await setMeta('activeTimer', active)
    await setMeta('timerRev', (active?.rev ?? 0) + 1)
  })
  await reloadFromDb()
  if (!silent) {
    showToast(`已灌入 ${sessions.length} 条学习记录（点计时页「结束」可立测跨级高光！）`, 'success')
  }
}

/** 首次在本地开发环境加载演示种子（或数据库为空且未手动清空）时，自动灌入丰富测试数据 */
export async function maybeAutoSeedDev(): Promise<void> {
  let alreadySeeded = false
  try {
    if (localStorage.getItem(DEV_CLEARED_KEY) === '1') return
    alreadySeeded = localStorage.getItem(DEV_SEEDED_KEY) === '1'
  } catch {
    /* ignore */
  }
  const cur = getState()
  if (!cur.loaded) return
  const visibleCount = cur.sessions.filter((s) => !s.deleted).length
  if (!alreadySeeded || (visibleCount === 0 && !cur.active)) {
    await applyDevSeedData(true)
  }
}

/** 一键把当前计时器起点拨回 5 小时前，方便立即测试「超时未关提醒弹窗」与锁定防误关阻尼微震 */
export async function triggerDemoOvertime(): Promise<void> {
  const now = Date.now()
  const since = now - 5 * HOUR - 12 * MIN
  const cur = getState()
  const nextRev = ((cur.active?.rev ?? 0) + 2)
  const overtimeActive: ActiveTimer = {
    sessionId: 'demo-overtime-test',
    subjectId: cur.active?.subjectId ?? 'ds',
    segments: [],
    runningSince: since,
    createdAt: since,
    ackAt: null,
    rev: nextRev,
  }
  await db.transaction('rw', db.sessions, db.meta, async () => {
    await setMeta('activeTimer', overtimeActive)
    await setMeta('timerRev', nextRev)
  })
  await reloadFromDb()
}

/** 清空本地测试数据（同时记录标记，避免刷新页面时又自动重灌） */
export async function clearAllDevData(): Promise<void> {
  try {
    localStorage.setItem(DEV_CLEARED_KEY, '1')
  } catch {
    /* ignore */
  }
  await db.transaction('rw', db.sessions, db.meta, async () => {
    await db.sessions.clear()
    await setMeta('activeTimer', null)
    await setMeta('timerRev', Date.now() % 100000)
  })
  await reloadFromDb()
  showToast('已清空本地测试数据', 'info')
}
