export type GroupId = 'cs408' | 'math' | 'english' | 'politics'

export interface Group {
  id: GroupId
  name: string
  color: string
}

export interface Subject {
  id: string
  name: string
  short: string
  group: GroupId
  color: string
  /** 模拟测试项：整张卷子的考试时长（分钟）。计时面板据此显示倒计时，时长计入所在的科目组 */
  examMinutes?: number
}

/** 考研初试每科都是 180 分钟 */
const EXAM_MINUTES = 180

export const GROUPS: Group[] = [
  { id: 'cs408', name: '408', color: '#6366f1' },
  { id: 'math', name: '数学', color: '#f59e0b' },
  { id: 'english', name: '英语', color: '#0ea5e9' },
  { id: 'politics', name: '政治', color: '#ef4444' },
]

// 科目 id 一经使用就不要再改，历史记录靠它关联
export const SUBJECTS: Subject[] = [
  { id: 'ds', name: '数据结构', short: '数据结构', group: 'cs408', color: '#6366f1' },
  { id: 'co', name: '计算机组成原理', short: '计组', group: 'cs408', color: '#8b5cf6' },
  { id: 'os', name: '操作系统', short: '操作系统', group: 'cs408', color: '#a855f7' },
  { id: 'cn', name: '计算机网络', short: '计网', group: 'cs408', color: '#3b82f6' },
  { id: 'mock-408', name: '408 模拟测试', short: '408 模拟', group: 'cs408', color: '#d946ef', examMinutes: EXAM_MINUTES },
  { id: 'calc', name: '高等数学', short: '高数', group: 'math', color: '#f59e0b' },
  { id: 'la', name: '线性代数', short: '线代', group: 'math', color: '#f97316' },
  { id: 'prob', name: '概率论', short: '概率论', group: 'math', color: '#eab308' },
  { id: 'mock-math', name: '数学模拟测试', short: '数学模拟', group: 'math', color: '#84cc16', examMinutes: EXAM_MINUTES },
  { id: 'english', name: '英语', short: '英语', group: 'english', color: '#0ea5e9' },
  { id: 'mock-english', name: '英语模拟测试', short: '英语模拟', group: 'english', color: '#14b8a6', examMinutes: EXAM_MINUTES },
  { id: 'politics', name: '政治', short: '政治', group: 'politics', color: '#ef4444' },
  { id: 'mock-politics', name: '政治模拟测试', short: '政治模拟', group: 'politics', color: '#ec4899', examMinutes: EXAM_MINUTES },
]

const SUBJECT_MAP = new Map(SUBJECTS.map((s) => [s.id, s]))
const GROUP_MAP = new Map(GROUPS.map((g) => [g.id, g]))

export function getSubject(id: string): Subject | undefined {
  return SUBJECT_MAP.get(id)
}

export function getGroup(id: GroupId): Group {
  return GROUP_MAP.get(id)!
}

export function subjectsOf(group: GroupId): Subject[] {
  return SUBJECTS.filter((s) => s.group === group)
}
