import { AnimatePresence, motion } from 'framer-motion'
import { useState, type FormEvent } from 'react'
import { addDailyGoal, removeDailyGoal, toggleDailyGoal, useDailyGoals } from '../dailyGoals'
import { useSkin } from '../skin'
import { IconClose, IconPlus } from './icons'

const QUICK_PRESETS = ['高数错题复盘', '408 真题一套', '英语阅读 2 篇', '政治选择题 1 章'] as const

/**
 * #10D · 今日微目标划掉清单（参考 UI Moments Stroke Checklist）：
 * - 勾选时：复选框弹性缩放 + SVG 勾号沿 stroke-dashoffset 流畅描绘 + 文字钢笔横向划掉；
 * - 默认收起在轻巧折叠栏里，不抢占计时器首屏注意力，点「添加」或快捷预设即可 1 秒记下今日 3–5 项核心任务。
 */
export function DailyGoalsCard() {
  const goals = useDailyGoals()
  const skin = useSkin()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const doneCount = goals.filter((g) => g.done).length
  const allDone = goals.length > 0 && doneCount === goals.length

  const rowTransition =
    skin === 'terminal'
      ? { duration: 0.12, ease: 'linear' as const }
      : skin === 'brutal'
        ? { type: 'spring' as const, stiffness: 480, damping: 30 }
        : { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const }

  const submitDraft = (e: FormEvent) => {
    e.preventDefault()
    if (addDailyGoal(draft)) {
      setDraft('')
      if (goals.length + 1 >= 6) setAdding(false)
    }
  }

  return (
    <section className="card goals-card mt-3" data-all-done={allDone ? '' : undefined}>
      <div className="goals-head">
        <div className="flex items-center gap-2 min-w-0">
          <span className="section-title">今日微目标</span>
          {goals.length > 0 && (
            <span className="goals-badge num" data-complete={allDone ? '' : undefined}>
              {allDone ? (skin === 'terminal' ? '[ALL DONE]' : `✓ ${doneCount}/${goals.length}`) : `${doneCount}/${goals.length}`}
            </span>
          )}
        </div>
        {goals.length < 6 && (
          <button
            type="button"
            className="goals-add-btn"
            aria-expanded={adding}
            onClick={() => setAdding((v) => !v)}
          >
            <IconPlus size={14} />
            <span>{adding ? '收起' : '添加'}</span>
          </button>
        )}
      </div>

      {goals.length > 0 && (
        <fieldset className="stroke-list">
          <legend className="sr-only">今日微目标清单</legend>
          <AnimatePresence initial={false}>
            {goals.map((g) => (
              <motion.div
                key={g.id}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={rowTransition}
                className="overflow-hidden"
              >
                <div className="stroke-row">
                  <label className="stroke-item">
                    <input type="checkbox" checked={g.done} onChange={() => toggleDailyGoal(g.id)} />
                    <span className="stroke-box" aria-hidden>
                      <svg viewBox="0 0 16 16">
                        <path d="M3.5 8.5l3 3 6-7" />
                      </svg>
                    </span>
                    <span className="stroke-text">{g.text}</span>
                  </label>
                  <button
                    type="button"
                    className="stroke-del"
                    aria-label={`移除「${g.text}」`}
                    onClick={() => removeDailyGoal(g.id)}
                  >
                    <IconClose size={13} />
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </fieldset>
      )}

      {goals.length === 0 && !adding && (
        <div className="goals-empty">
          {QUICK_PRESETS.slice(0, 3).map((preset) => (
            <button key={preset} type="button" className="goals-preset" onClick={() => addDailyGoal(preset)}>
              + {preset}
            </button>
          ))}
        </div>
      )}

      <AnimatePresence initial={false}>
        {adding && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={rowTransition}
            className="overflow-hidden"
          >
            <form className="goals-form" onSubmit={submitDraft}>
              <input
                type="text"
                className="field !py-1.5 !text-sm"
                placeholder="写一个今天要啃下的小目标（如：高数 30 题）"
                maxLength={28}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="submit" className="btn btn-primary !py-1.5 !px-3 !text-sm shrink-0" disabled={!draft.trim()}>
                加入
              </button>
            </form>
            <div className="goals-presets-row">
              {QUICK_PRESETS.filter((p) => !goals.some((g) => g.text === p)).map((preset) => (
                <button key={preset} type="button" className="goals-preset" onClick={() => addDailyGoal(preset)}>
                  + {preset}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
