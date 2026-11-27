import { beforeEach, describe, expect, it } from 'vitest'
import {
  getSubjectOrder,
  isDefaultSubjectOrder,
  orderedGroups,
  orderedSubjects,
  resetSubjectOrder,
  setGroupOrder,
  setScopeSubjectOrder,
} from './subjectOrder'

describe('自定义科目与科目组排序', () => {
  beforeEach(() => {
    resetSubjectOrder()
  })

  it('默认顺序包含全部科目组与科目，且标记为默认状态', () => {
    const cur = getSubjectOrder()
    expect(isDefaultSubjectOrder(cur)).toBe(true)
    expect(orderedGroups(cur).map((g) => g.id)).toEqual(['cs408', 'math', 'english', 'politics'])
    expect(orderedSubjects(cur, 'cs408').map((s) => s.id)).toEqual(['ds', 'co', 'os', 'cn'])
    expect(orderedSubjects(cur, 'mock').map((s) => s.id)).toHaveLength(4)
  })

  it('支持拖拽重排组内科目与调整组顺序，未知 ID 自动忽略、缺失 ID 自动补齐，并可一键恢复默认', () => {
    setGroupOrder(['math', 'english', 'cs408', 'politics'])
    setScopeSubjectOrder('cs408', ['os', 'ds', 'unknown-id'])

    const updated = getSubjectOrder()
    expect(isDefaultSubjectOrder(updated)).toBe(false)
    expect(orderedGroups(updated).map((g) => g.id)).toEqual(['math', 'english', 'cs408', 'politics'])
    expect(orderedSubjects(updated, 'cs408').map((s) => s.id)).toEqual(['os', 'ds', 'co', 'cn'])

    resetSubjectOrder()
    const restored = getSubjectOrder()
    expect(isDefaultSubjectOrder(restored)).toBe(true)
    expect(orderedGroups(restored).map((g) => g.id)).toEqual(['cs408', 'math', 'english', 'politics'])
  })
})
