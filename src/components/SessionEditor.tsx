import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { segmentsTotal, uuid } from '../domain/timer'
import { formatDurationCN } from '../domain/format'
import { SUBJECTS } from '../domain/subjects'
import type { Session } from '../domain/types'
import { useSkin } from '../skin'
import { deleteSession, saveSession, showToast } from '../store'
import { IconPlus, IconTrash } from './icons'
import { Button, DateTimeField, Sheet, tint } from './ui'

const pad = (n: number) => String(n).padStart(2, '0')
function toInput(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromInput = (v: string) => new Date(v).getTime()

let rowKeySeq = 0
const nextRowKey = () => `r-${++rowKeySeq}`

interface Row {
  key?: string
  start: string
  end: string
  original?: { start: number; end: number }
}

export type EditorTarget = { kind: 'new'; day: string } | { kind: 'edit'; session: Session } | null

function defaultRow(day: string): Row {
  const now = Date.now()
  const [y, m, d] = day.split('-').map(Number)
  const base = new Date(y, m - 1, d, 9, 0).getTime()
  const todayKey = toInput(now).slice(0, 10)
  if (day === todayKey) {
    const end = Math.floor(now / 60000) * 60000
    return { key: nextRowKey(), start: toInput(end - 3600000), end: toInput(end) }
  }
  return { key: nextRowKey(), start: toInput(base), end: toInput(base + 3600000) }
}

/** 补录 / 修改一条学习记录（支持多段平滑收展与时间冲突阻尼摇晃定位） */
export function SessionEditor({ target, onClose }: { target: EditorTarget; onClose: () => void }) {
  // 注意：前 4 个 useState 顺序与测试夹具契约保持一致
  const [subjectId, setSubjectId] = useState('ds')
  const [rows, setRows] = useState<Row[]>([])
  const [confirmDel, setConfirmDel] = useState(false)
  const [saving, setSaving] = useState(false)
  const [shake, setShake] = useState<{ idx: number; seq: number } | null>(null)
  const skin = useSkin()

  const inFlight = useRef(false)
  const draft = useRef<{ target: EditorTarget; id: string | null }>({ target: null, id: null })
  if (draft.current.target !== target) draft.current = { target, id: null }
  const close = () => {
    if (!inFlight.current) onClose()
  }

  const submit = async (action: () => Promise<boolean>, message: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    try {
      if (await action()) {
        showToast(message, 'success')
        if (draft.current.target === target) onClose()
      }
    } catch {
      showToast('保存失败，请重试', 'error')
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!target) return
    setConfirmDel(false)
    setShake(null)
    if (target.kind === 'edit') {
      setSubjectId(target.session.subjectId)
      setRows(
        target.session.segments.map((g) => ({
          key: nextRowKey(),
          start: toInput(g.start),
          end: toInput(g.end),
          original: g,
        })),
      )
    } else {
      setRows([defaultRow(target.day)])
    }
  }, [target])

  const segments = rows.map((r) => ({
    start: r.original && r.start === toInput(r.original.start) ? r.original.start : fromInput(r.start),
    end: r.original && r.end === toInput(r.original.end) ? r.original.end : fromInput(r.end),
  }))
  const invalid = segments.findIndex((g) => !Number.isFinite(g.start) || !Number.isFinite(g.end) || g.end <= g.start)
  const futureIdx = segments.findIndex((g) => g.end > Date.now() + 60000)
  const total = invalid === -1 ? segmentsTotal(segments) : 0

  const flagRow = (idx: number) => setShake({ idx, seq: Date.now() })

  const save = async () => {
    if (!target || inFlight.current) return
    if (invalid !== -1) {
      flagRow(invalid)
      return showToast(`第 ${invalid + 1} 段的结束时间必须晚于开始时间`, 'error')
    }
    const ordered = segments.map((g, i) => ({ ...g, i })).sort((a, b) => a.start - b.start)
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].start < ordered[i - 1].end) {
        flagRow(ordered[i].i)
        return showToast(`第 ${ordered[i - 1].i + 1} 段与第 ${ordered[i].i + 1} 段重叠，请调整时间`, 'error')
      }
    }
    if (futureIdx !== -1) {
      flagRow(futureIdx)
      return showToast('不能记录未来的时间', 'error')
    }
    const now = Date.now()
    const base: Session =
      target.kind === 'edit'
        ? target.session
        : {
            id: (draft.current.id ??= uuid()),
            subjectId,
            segments: [],
            startAt: 0,
            source: 'manual',
            createdAt: now,
            updatedAt: now,
            deleted: false,
          }
    await submit(
      () =>
        saveSession(
          { ...base, subjectId, segments },
          target.kind === 'edit' ? { expectedSession: target.session } : {},
        ),
      target.kind === 'edit' ? '已修改' : '已补录',
    )
  }

  const rowTransition =
    skin === 'terminal'
      ? { duration: 0.12, ease: 'linear' as const }
      : skin === 'brutal'
        ? { type: 'spring' as const, stiffness: 480, damping: 30 }
        : { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const }

  return (
    <Sheet open={!!target} onClose={close} title={target?.kind === 'edit' ? '修改记录' : '补录学习时间'}>
      <div className="section-title mb-2">科目</div>
      <div className="flex flex-wrap gap-2">
        {SUBJECTS.map((s) => {
          const on = s.id === subjectId
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSubjectId(s.id)}
              aria-pressed={on}
              className="chip c"
              style={tint(s.color)}
            >
              {s.name}
            </button>
          )
        })}
      </div>

      <div className="mt-5 mb-2 flex items-center justify-between">
        <span className="section-title">时间段</span>
        <span className="num text-sm font-semibold">{formatDurationCN(total)}</span>
      </div>
      <div>
        <AnimatePresence initial={false}>
          {rows.map((r, i) => {
            const isShaking = shake?.idx === i
            return (
              <motion.div
                key={r.key ?? `seg-${i}`}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={rowTransition}
                className="overflow-hidden"
              >
                <div className="pb-3">
                  <div
                    key={isShaking ? `shake-${shake.seq}` : 'idle'}
                    className={`well p-3 ${isShaking || invalid === i ? 'row-error' : ''} ${isShaking ? 'row-shake' : ''}`.trim()}
                  >
                    <div className="mb-2 flex items-center justify-between text-xs text-muted">
                      <span>第 {i + 1} 段</span>
                      {rows.length > 1 && (
                        <button
                          type="button"
                          className="text-danger"
                          onClick={() => {
                            if (shake?.idx === i) setShake(null)
                            setRows(rows.filter((_, j) => j !== i))
                          }}
                        >
                          移除
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 text-sm">
                      <span className="text-muted">开始</span>
                      <DateTimeField
                        className="!bg-card"
                        value={r.start}
                        onChange={(e) => {
                          if (shake?.idx === i) setShake(null)
                          setRows(rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))
                        }}
                      />
                      <span className="text-muted">结束</span>
                      <DateTimeField
                        className="!bg-card"
                        value={r.end}
                        onChange={(e) => {
                          if (shake?.idx === i) setShake(null)
                          setRows(rows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))
                        }}
                      />
                    </div>
                    {invalid === i && <div className="mt-1.5 text-xs text-danger">结束时间必须晚于开始时间</div>}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
        <button
          type="button"
          onClick={() => {
            const last = rows[rows.length - 1]
            const start = last ? fromInput(last.end) + 10 * 60000 : Date.now() - 3600000
            setRows([...rows, { key: nextRowKey(), start: toInput(start), end: toInput(start + 3600000) }])
          }}
          className="flex w-full items-center justify-center gap-1 rounded-2xl border border-dashed py-2.5 text-sm text-muted"
          style={{ borderColor: 'var(--border)', borderRadius: 'var(--r-ctl)' }}
        >
          <IconPlus size={16} /> 添加一段
        </button>
      </div>

      <div className="mt-6 grid gap-2.5">
        <Button onClick={save} disabled={saving}>
          保存
        </Button>
        {target?.kind === 'edit' && (
          <Button
            variant="danger"
            disabled={saving}
            onClick={async () => {
              if (!confirmDel) return setConfirmDel(true)
              await submit(() => deleteSession(target.session.id, { expectedSession: target.session }), '已删除')
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
