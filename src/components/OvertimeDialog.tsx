import { useEffect, useState } from 'react'
import { formatDurationCN } from '../domain/format'
import { getSubject } from '../domain/subjects'
import { isOvertime } from '../domain/timer'
import { overtimeMs, resolveOvertime, useApp } from '../store'
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

  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (isOvertime(active, now, overtimeMs(settings))) {
        setSnapshotNow(now)
        setMode('choose')
        setOpen(true)
      }
    }
    check()
    document.addEventListener('visibilitychange', check)
    return () => document.removeEventListener('visibilitychange', check)
  }, [active, settings])

  if (!active || active.runningSince === null) return null
  const since = active.runningSince
  const subject = getSubject(active.subjectId)
  const runFor = snapshotNow - since

  const close = () => setOpen(false)

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
            onClick={() => {
              resolveOvertime({ kind: 'keep' })
              close()
            }}
          >
            一直在学，全部保留并继续计时
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setEndInput(toLocalInput(Math.min(snapshotNow, since + 60 * 60000)))
              setMode('endAt')
            }}
          >
            设置实际结束时间
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              resolveOvertime({ kind: 'discard' })
              close()
            }}
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
            <Button variant="secondary" onClick={() => setMode('choose')}>
              返回
            </Button>
            <Button
              onClick={() => {
                const t = new Date(endInput).getTime()
                if (!Number.isFinite(t)) return
                const endAt = Math.min(Math.max(t, since), snapshotNow)
                resolveOvertime({ kind: 'endAt', endAt })
                close()
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
