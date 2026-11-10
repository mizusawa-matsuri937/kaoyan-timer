import { useEffect, useRef, useState } from 'react'
import { formatDurationCN } from '../domain/format'
import { getSubject } from '../domain/subjects'
import { isOvertime } from '../domain/timer'
import { overtimeMs, resolveOvertime, showToast, useApp, type OvertimeChoice } from '../store'
import { Button, Sheet } from './ui'

const pad = (n: number) => String(n).padStart(2, '0')
function toLocalInput(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "忘记点结束"提醒：打开 App / 回到前台时，如果当前段连续运行超过阈值则弹出 */
export function OvertimeDialog() {
  const active = useApp((s) => s.active)
  const settings = useApp((s) => s.settings)
  const [open, setOpen] = useState(false)
  const [snapshotNow, setSnapshotNow] = useState(0)
  const [mode, setMode] = useState<'choose' | 'endAt'>('choose')
  const [endInput, setEndInput] = useState('')
  const [saving, setSaving] = useState(false)
  const inFlight = useRef(false)
  const submit = async (choice: OvertimeChoice) => {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    try {
      if (await resolveOvertime(choice)) setOpen(false)
    } catch {
      showToast('保存失败，请重试', 'error')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const reminder = useRef<string | null>(null)
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (isOvertime(active, now, overtimeMs(settings))) {
        const key = [active?.sessionId, active?.runningSince, active?.ackAt].join('/')
        // 时间快照每次检查都刷新（否则面板开着切走再回来，可选的结束时间上限停在第一次弹出时）；
        // 模式和已输入的时间只在出现新的提醒时才重置。
        setSnapshotNow(now)
        if (reminder.current !== key) {
          reminder.current = key
          setMode('choose')
          setOpen(true)
        }
      } else {
        reminder.current = null
        setOpen(false)
      }
    }
    check()
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [active?.sessionId, active?.runningSince, active?.ackAt, settings.overtimeHours])

  if (!active || active.runningSince === null) return null
  const since = active.runningSince
  const subject = getSubject(active.subjectId)
  const runFor = snapshotNow - since

  return (
    <Sheet open={open} onClose={() => {}} title="还在学习吗？">
      <p className="mb-4 text-[15px] leading-relaxed text-muted">
        <b style={{ color: subject?.color }}>{subject?.name}</b> 已经连续计时{' '}
        <b className="text-ink">{formatDurationCN(runFor)}</b>
        （从 {new Date(since).toLocaleString('zh-CN', { hour12: false, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 开始），是不是忘记点结束了？
      </p>
      {mode === 'choose' ? (
        <div className="grid gap-2.5">
          <Button
            disabled={saving}
            onClick={() => submit({ kind: 'keep' })}
          >
            一直在学，全部保留并继续计时
          </Button>
          <Button
            variant="secondary"
            disabled={saving}
            onClick={() => {
              setEndInput(toLocalInput(Math.min(snapshotNow, since + 60 * 60000)))
              setMode('endAt')
            }}
          >
            设置实际结束时间
          </Button>
          <Button
            variant="danger"
            disabled={saving}
            onClick={() => submit({ kind: 'discard' })}
          >
            丢弃这一段
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          <label className="text-sm text-muted">实际结束时间</label>
          <input
            type="datetime-local"
            className="field"
            value={endInput}
            min={toLocalInput(since)}
            max={toLocalInput(snapshotNow)}
            onChange={(e) => setEndInput(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" disabled={saving} onClick={() => setMode('choose')}>
              返回
            </Button>
            <Button
              disabled={saving}
              onClick={() => {
                const t = new Date(endInput).getTime()
                if (!Number.isFinite(t)) return
                const endAt = Math.min(Math.max(t, since), snapshotNow)
                return submit({ kind: 'endAt', endAt })
              }}
            >
              保存并结束
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
