import { useEffect, useState } from 'react'
import { segmentsTotal, uuid } from '../domain/timer'
import { formatDurationCN } from '../domain/format'
import { SUBJECTS } from '../domain/subjects'
import type { Session } from '../domain/types'
import { deleteSession, saveSession, showToast } from '../store'
import { IconPlus, IconTrash } from './icons'
import { Button, Sheet } from './ui'

const pad = (n: number) => String(n).padStart(2, '0')
function toInput(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromInput = (v: string) => new Date(v).getTime()

interface Row {
  start: string
  end: string
}

export type EditorTarget = { kind: 'new'; day: string } | { kind: 'edit'; session: Session } | null

function defaultRow(day: string): Row {
  const now = Date.now()
  const [y, m, d] = day.split('-').map(Number)
  const base = new Date(y, m - 1, d, 9, 0).getTime()
  const todayKey = toInput(now).slice(0, 10)
  if (day === todayKey) {
    const end = Math.floor(now / 60000) * 60000
    return { start: toInput(end - 3600000), end: toInput(end) }
  }
  return { start: toInput(base), end: toInput(base + 3600000) }
}

/** 补录 / 修改一条学习记录（支持多段，每段即一次连续学习） */
export function SessionEditor({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  const [subjectId, setSubjectId] = useState('ds')
  const [rows, setRows] = useState<Row[]>([])
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    if (!target) return
    setConfirmDel(false)
    if (target.kind === 'edit') {
      setSubjectId(target.session.subjectId)
      setRows(target.session.segments.map((g) => ({ start: toInput(g.start), end: toInput(g.end) })))
    } else {
      setRows([defaultRow(target.day)])
    }
  }, [target])

  const segments = rows.map((r) => ({ start: fromInput(r.start), end: fromInput(r.end) }))
  const invalid = segments.findIndex((g) => !Number.isFinite(g.start) || !Number.isFinite(g.end) || g.end <= g.start)
  const future = segments.some((g) => g.end > Date.now() + 60000)
  const total = invalid === -1 ? segmentsTotal(segments) : 0

  const save = () => {
    if (!target) return
    if (invalid !== -1) return showToast(`第 ${invalid + 1} 段的结束时间必须晚于开始时间`, 'error')
    if (future) return showToast('不能记录未来的时间', 'error')
    const now = Date.now()
    const base: Session =
      target.kind === 'edit'
        ? target.session
        : { id: uuid(), subjectId, segments: [], startAt: 0, source: 'manual', createdAt: now, updatedAt: now, deleted: false }
    saveSession({ ...base, subjectId, segments })
    showToast(target.kind === 'edit' ? '已修改' : '已补录', 'success')
    onClose()
  }

  return (
    <Sheet open={!!target} onClose={onClose} title={target?.kind === 'edit' ? '修改记录' : '补录学习时间'}>
      <div className="mb-2 text-[13px] font-semibold text-muted">科目</div>
      <div className="flex flex-wrap gap-2">
        {SUBJECTS.map((s) => {
          const on = s.id === subjectId
          return (
            <button
              key={s.id}
              onClick={() => setSubjectId(s.id)}
              className="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                background: on ? s.color : 'var(--card-2)',
                color: on ? '#fff' : 'var(--text)',
              }}
            >
              {s.name}
            </button>
          )
        })}
      </div>

      <div className="mt-5 mb-2 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-muted">时间段（暂停会分成多段）</span>
        <span className="num text-sm font-semibold">{formatDurationCN(total)}</span>
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-2xl bg-card-2 p-3">
            <div className="mb-2 flex items-center justify-between text-xs text-muted">
              <span>第 {i + 1} 段</span>
              {rows.length > 1 && (
                <button className="text-danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  移除
                </button>
              )}
            </div>
            <div className="grid grid-cols-[2.5rem_1fr] items-center gap-2 text-sm">
              <span className="text-muted">开始</span>
              <input
                type="datetime-local"
                className="field !bg-card"
                value={r.start}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
              />
              <span className="text-muted">结束</span>
              <input
                type="datetime-local"
                className="field !bg-card"
                value={r.end}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
              />
            </div>
            {invalid === i && <div className="mt-1.5 text-xs text-danger">结束时间必须晚于开始时间</div>}
          </div>
        ))}
        <button
          onClick={() => {
            const last = rows[rows.length - 1]
            const start = last ? fromInput(last.end) + 10 * 60000 : Date.now() - 3600000
            setRows([...rows, { start: toInput(start), end: toInput(start + 3600000) }])
          }}
          className="flex w-full items-center justify-center gap-1 rounded-2xl border border-dashed py-2.5 text-sm text-muted"
          style={{ borderColor: 'var(--line)' }}
        >
          <IconPlus size={16} /> 添加一段
        </button>
      </div>

      <div className="mt-6 grid gap-2.5">
        <Button onClick={save}>保存</Button>
        {target?.kind === 'edit' && (
          <Button
            variant="danger"
            onClick={() => {
              if (!confirmDel) return setConfirmDel(true)
              deleteSession(target.session.id)
              showToast('已删除', 'success')
              onClose()
            }}
          >
            <span className="inline-flex items-center gap-1.5">
              <IconTrash size={16} /> {confirmDel ? '再点一次确认删除' : '删除这条记录'}
            </span>
          </Button>
        )}
      </div>
    </Sheet>
  )
}
