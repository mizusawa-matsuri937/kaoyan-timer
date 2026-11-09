import { describe, expect, it } from 'vitest'
import type { Session, Settings } from '../domain/types'
import { makeBackup, mergeSessions, mergeSettings, parseBackup } from './merge'

const s = (id: string, updatedAt: number, extra: Partial<Session> = {}): Session => ({
  id,
  subjectId: 'ds',
  segments: [{ start: 1000, end: 5000 }],
  startAt: 1000,
  source: 'timer',
  createdAt: 0,
  updatedAt,
  deleted: false,
  ...extra,
})

describe('mergeSessions', () => {
  it('两边各自新增：都保留，并需要推送', () => {
    const r = mergeSessions([s('a', 1)], [s('b', 1)])
    expect(r.merged.map((x) => x.id).sort()).toEqual(['a', 'b'])
    expect(r.toLocal.map((x) => x.id)).toEqual(['b'])
    expect(r.remoteChanged).toBe(true)
  })

  it('远端更新的版本覆盖本地', () => {
    const r = mergeSessions([s('a', 1)], [s('a', 2, { subjectId: 'os' })])
    expect(r.merged[0].subjectId).toBe('os')
    expect(r.toLocal).toHaveLength(1)
    expect(r.remoteChanged).toBe(false)
  })

  it('本地删除（墓碑更新）同步到远端', () => {
    const r = mergeSessions([s('a', 3, { deleted: true })], [s('a', 2)])
    expect(r.merged[0].deleted).toBe(true)
    expect(r.toLocal).toHaveLength(0)
    expect(r.remoteChanged).toBe(true)
  })

  it('完全一致时无需任何操作', () => {
    const r = mergeSessions([s('a', 1)], [s('a', 1)])
    expect(r.toLocal).toHaveLength(0)
    expect(r.remoteChanged).toBe(false)
  })
})

describe('备份文件', () => {
  const settings: Settings = {
    examDate: '2027-12-25',
    startDate: '2026-11-09',
    overtimeHours: 4,
    keepAwake: false,
    updatedAt: 5,
  }

  it('导出再导入保持一致', () => {
    const backup = makeBackup([s('b', 1), s('a', 2)], settings, 99)
    const parsed = parseBackup(JSON.stringify(backup))
    expect(parsed.sessions.map((x) => x.id)).toEqual(['a', 'b'])
    expect(parsed.settings).toEqual(settings)
  })

  it('格式错误时抛错，不会产生数据', () => {
    expect(() => parseBackup('{"foo":1}')).toThrow()
    expect(() => parseBackup('not json')).toThrow()
  })

  it('过滤掉损坏的记录', () => {
    const text = JSON.stringify({ app: 'kaoyan-timer', version: 1, sessions: [s('a', 1), { id: 3 }, null] })
    expect(parseBackup(text).sessions).toHaveLength(1)
  })

  it('设置按 updatedAt 合并', () => {
    expect(mergeSettings(settings, { ...settings, examDate: '2027-12-20', updatedAt: 9 }).examDate).toBe('2027-12-20')
    expect(mergeSettings(settings, { ...settings, examDate: '2027-12-20', updatedAt: 1 }).examDate).toBe('2027-12-25')
  })
})
