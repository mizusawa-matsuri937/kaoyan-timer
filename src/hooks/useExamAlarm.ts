import { useEffect } from 'react'
import { getSubject } from '../domain/subjects'
import { examTimeLeft } from '../domain/timer'
import { showToast, useApp } from '../store'

/**
 * 模拟测试到点提醒：考试时长用完的那一刻弹一条提示并震动，计时本身不停。
 * 挂在 App 上而不是计时页里，这样停在别的标签页时也能提醒。
 * 暂停会取消、继续会按剩余时间重新安排；已经超时后再打开不会重复提醒。
 */
export function useExamAlarm() {
  const active = useApp((s) => s.active)
  useEffect(() => {
    const subject = active && getSubject(active.subjectId)
    if (!subject) return
    const left = examTimeLeft(active, (subject.examMinutes ?? 0) * 60000, Date.now())
    if (left === null) return
    const timer = setTimeout(() => {
      showToast(`${subject.name}时间到`, 'info')
      // 只有部分浏览器支持震动（iOS Safari 不支持），不支持时静默忽略
      navigator.vibrate?.([300, 150, 300])
    }, left)
    return () => clearTimeout(timer)
  }, [active])
}
