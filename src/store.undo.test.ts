import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOUR } from './domain/aggregate'
import { elapsed, segmentsTotal } from './domain/timer'

const T0 = new Date('2026-11-26T09:00:00').getTime()

type Store = typeof import('./store')
type Database = typeof import('./db/db')
let store: Store
let database: Database

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(T0)
  vi.stubGlobal('navigator', { onLine: false })
  vi.resetModules()
  database = await import('./db/db')
  await database.db.delete()
  await database.db.open()
  store = await import('./store')
  await store.init()
})

afterEach(async () => {
  await store.reloadFromDb()
  database.db.close()
  await database.db.delete()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('计时误触 5 秒撤销机制', () => {
  it('点击结束后的 5 秒内可一键撤销，原记录转为墓碑且计时不丢毫秒', async () => {
    await store.selectSubjectAndStart('ds')
    vi.setSystemTime(T0 + 40 * 60_000)
    await store.stop()

    const toast = store.getState().toast
    expect(toast?.text).toBe('本段已保存')
    expect(toast?.action?.label).toBe('撤销')
    expect(store.getState().active).toBeNull()

    // 3 秒后点击撤销
    vi.advanceTimersByTime(3000)
    expect(store.getState().toast).not.toBeNull()
    toast!.action!.onClick()
    await store.reloadFromDb()

    const restored = store.getState().active!
    expect(restored.subjectId).toBe('ds')
    expect(restored.runningSince).toBe(T0)
    expect(elapsed(restored, Date.now())).toBe(40 * 60_000 + 3000)

    // 误存的残段已被标记为 deleted 墓碑，最终正常结束时只留下一条完整记录
    expect(store.getState().sessions.filter((s) => !s.deleted)).toHaveLength(0)
    expect(store.getState().sessions.filter((s) => s.deleted)).toHaveLength(1)

    vi.setSystemTime(T0 + HOUR)
    await store.stop()
    const visible = store.getState().sessions.filter((s) => !s.deleted)
    expect(visible).toHaveLength(1)
    expect(segmentsTotal(visible[0].segments)).toBe(HOUR)
  })

  it('日常专注中误触切换科目可在 5 秒内撤销回原科目，不留下新科目碎片', async () => {
    await store.selectSubjectAndStart('calc')
    vi.setSystemTime(T0 + 25 * 60_000)
    await store.selectSubjectAndStart('os')

    expect(store.getState().active?.subjectId).toBe('os')
    const undo = store.getState().toast?.action
    expect(undo?.label).toBe('撤销')

    vi.advanceTimersByTime(2000)
    undo!.onClick()
    await store.reloadFromDb()

    const restored = store.getState().active!
    expect(restored.subjectId).toBe('calc')
    expect(elapsed(restored, Date.now())).toBe(25 * 60_000 + 2000)
    expect(store.getState().sessions.filter((s) => !s.deleted)).toHaveLength(0)
  })

  it('超过 5 秒自动收起撤销提示；若期间已有新操作则拒绝旧撤销', async () => {
    await store.selectSubjectAndStart('ds')
    vi.setSystemTime(T0 + 10 * 60_000)
    await store.stop()
    const staleUndo = store.getState().toast!.action!.onClick

    // 满 5 秒后自动消失
    vi.advanceTimersByTime(5000)
    expect(store.getState().toast).toBeNull()

    // 若用户已经重新开始了另一门课，再调用旧撤销回调不会覆盖新计时
    await store.selectSubjectAndStart('english')
    staleUndo()
    await store.reloadFromDb()
    expect(store.getState().active?.subjectId).toBe('english')
    expect(store.getState().sessions.filter((s) => !s.deleted)).toHaveLength(1)
  })

  it('Sonner 层叠通知：后台普通提示不会顶掉 5 秒撤销条，且支持悬停暂停与恢复倒计时', async () => {
    await store.selectSubjectAndStart('ds')
    vi.setSystemTime(T0 + 30 * 60_000)
    await store.stop()

    const undoToast = store.getState().toasts.find((t) => !!t.action)
    expect(undoToast).toBeDefined()

    // 连发多条普通提示，含撤销动作的通知始终保留在层叠栈内
    store.showToast('后台备份已完成', 'success')
    store.showToast('第一条提示', 'info')
    store.showToast('第二条提示', 'info')
    expect(store.getState().toasts.length).toBeLessThanOrEqual(3)
    expect(store.getState().toasts.some((t) => t.id === undoToast!.id)).toBe(true)

    // 前进 3 秒后悬停暂停，即便过 10 秒也不会自动消失
    vi.advanceTimersByTime(3000)
    store.pauseToasts()
    vi.advanceTimersByTime(10_000)
    expect(store.getState().toasts.some((t) => t.id === undoToast!.id)).toBe(true)

    // 移开指针恢复倒计时：剩余约 2 秒后自动收起
    store.resumeToasts()
    vi.advanceTimersByTime(1500)
    expect(store.getState().toasts.some((t) => t.id === undoToast!.id)).toBe(true)
    vi.advanceTimersByTime(600)
    expect(store.getState().toasts.some((t) => t.id === undoToast!.id)).toBe(false)
  })
})
