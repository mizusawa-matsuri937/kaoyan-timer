import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { SyncStatus } from '../store'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * #07 · 导出备份变形进度环按钮（参考 UI Moments Download Ring）：
 * 点击后宽按钮弹簧收缩成圆环、绘制真实打包进度，完成后切完成态画勾并展回原样。
 */
export function DownloadRingButton({
  label = '导出备份',
  onDownload,
  className = '',
}: {
  label?: string
  onDownload: () => Promise<void> | void
  className?: string
}) {
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle')
  const [progress, setProgress] = useState(0)
  const rafRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const run = async () => {
    if (busyRef.current) return
    busyRef.current = true

    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      try {
        await onDownload()
        setPhase('done')
        timerRef.current = setTimeout(() => {
          setPhase('idle')
          busyRef.current = false
        }, 1200)
      } catch {
        setPhase('idle')
        busyRef.current = false
      }
      return
    }

    setPhase('loading')
    setProgress(0)
    const start = performance.now()
    const minVisualMs = 560

    let downloadDone = false
    let failed = false
    const work = Promise.resolve()
      .then(() => onDownload())
      .then(
        () => {
          downloadDone = true
        },
        () => {
          failed = true
          downloadDone = true
        },
      )

    const tick = (now: number) => {
      const elapsed = now - start
      const target = downloadDone ? Math.min(1, elapsed / minVisualMs) : Math.min(0.84, elapsed / (minVisualMs * 1.15))
      setProgress(target)
      if (target < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        if (failed) {
          setPhase('idle')
          busyRef.current = false
          return
        }
        setPhase('done')
        timerRef.current = setTimeout(() => {
          setPhase('idle')
          setProgress(0)
          busyRef.current = false
        }, 1450)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    await work
  }

  const CIRC = 81.7
  const dashOffset = CIRC * (1 - progress)

  return (
    <div className={`dl-ring-slot ${className}`.trim()}>
      <button
        type="button"
        className="btn btn-secondary dl-ring-btn"
        data-state={phase}
        aria-label={phase === 'loading' ? '正在打包备份' : phase === 'done' ? '备份已导出' : label}
        onClick={() => void run()}
      >
        <span className="dl-ring-label">
          <svg viewBox="0 0 20 20" aria-hidden>
            <path d="M10 3v10m0 0-4-4m4 4 4-4M4 16.5h12" />
          </svg>
          <span>{label}</span>
        </span>
        <svg className="dl-ring-svg" viewBox="0 0 32 32" aria-hidden>
          <circle className="track" cx={16} cy={16} r={13} />
          <circle className="arc" cx={16} cy={16} r={13} style={{ strokeDashoffset: dashOffset }} />
        </svg>
        <svg className="dl-ring-check" viewBox="0 0 20 20" aria-hidden>
          <path d="M4.5 10.5l3.5 3.5 7.5-8" />
        </svg>
      </button>
    </div>
  )
}

/**
 * #07 · 纸飞机起飞同步按钮（参考 UI Moments Paper Plane）：
 * 点击后纸飞机后仰蓄力并向右上呼啸起飞，文字无缝切换为「已备份」，结束后滑翔归位。
 */
export function PaperPlaneSyncButton({
  label,
  doneLabel = '已备份',
  syncStatus,
  disabled,
  variant = 'primary',
  onClick,
}: {
  label: string
  doneLabel?: string
  syncStatus: SyncStatus
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  onClick: () => Promise<void> | void
}) {
  const planeRef = useRef<HTMLSpanElement>(null)
  const animRef = useRef<Animation | null>(null)
  const [sentFlash, setSentFlash] = useState(false)
  const prevStatusRef = useRef<SyncStatus>(syncStatus)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const glideBack = () => {
    animRef.current?.cancel()
    animRef.current = null
    const el = planeRef.current
    if (el && typeof el.animate === 'function' && !prefersReducedMotion()) {
      const a = el.animate(
        [
          { transform: 'translate(-44px, 14px) rotate(10deg) scale(0.6)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1.15)' },
      )
      animRef.current = a
      a.onfinish = () => {
        if (animRef.current === a) animRef.current = null
      }
    }
  }

  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = syncStatus
    if (prev === 'syncing' && syncStatus !== 'syncing') {
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current)
        safetyTimerRef.current = null
      }
      if (syncStatus === 'ok') {
        setSentFlash(true)
        if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
        resetTimerRef.current = setTimeout(() => {
          setSentFlash(false)
          glideBack()
        }, 1600)
      } else {
        setSentFlash(false)
        glideBack()
      }
    }
  }, [syncStatus])

  useEffect(() => {
    return () => {
      animRef.current?.cancel()
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current)
    }
  }, [])

  const handleClick = () => {
    if (disabled) return
    const el = planeRef.current
    if (el && typeof el.animate === 'function' && !prefersReducedMotion()) {
      animRef.current?.cancel()
      animRef.current = el.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: 'translate(-4px, 3px) rotate(9deg)', opacity: 1, offset: 0.22 },
          { transform: 'translate(58px, -38px) rotate(-14deg) scale(0.48)', opacity: 0 },
        ],
        { duration: 500, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' },
      )
      // 若离线或被拦截未进入 syncing 状态，兜底让纸飞机滑翔归位
      if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current)
      safetyTimerRef.current = setTimeout(() => {
        if (prevStatusRef.current !== 'syncing') glideBack()
      }, 900)
    }
    void onClick()
  }

  const syncing = syncStatus === 'syncing'

  return (
    <button
      type="button"
      disabled={disabled || syncing}
      data-done={sentFlash ? '' : undefined}
      data-syncing={syncing ? '' : undefined}
      className={`btn btn-${variant} plane-btn`}
      onClick={handleClick}
    >
      <span ref={planeRef} className="plane-ico" aria-hidden>
        <svg viewBox="0 0 20 20">
          <path d="M17.5 2.5 9 11M17.5 2.5l-5 15-3.5-6.5L2.5 7.5l15-5Z" />
        </svg>
      </span>
      <span className="plane-swap">
        <span>{syncing ? '同步中…' : label}</span>
        <span aria-hidden={!sentFlash}>{doneLabel}</span>
      </span>
    </button>
  )
}

/**
 * #07 · Token 眨眼显隐 + 4 段格式自检条（参考 UI Moments Strength Meter）：
 * 切换明暗文时眼皮真实眨动 + 斜线收放；下方 4 段校验条随输入实时评估 GitHub Token 格式。
 */
export function TokenStrengthInput({
  value,
  onChange,
  pasted,
  onPaste,
}: {
  value: string
  onChange: (next: string) => void
  pasted: boolean
  onPaste: () => void
}) {
  const [show, setShow] = useState(false)
  const [focused, setFocused] = useState(false)
  const eyeRef = useRef<HTMLButtonElement>(null)

  const trimmed = value.trim()
  let score = 0
  if (trimmed.length > 0) score = 1
  if (trimmed.length >= 16) score = 2
  if (/^(github_pat_|ghp_)/.test(trimmed)) score = Math.max(score, 3)
  if (/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(trimmed)) score = 4

  const levels: Array<[label: string, tone: string]> = [
    ['未填写', 'var(--faint)'],
    ['长度过短', 'var(--danger)'],
    ['建议使用 github_pat_ 前缀', '#d97706'],
    ['格式接近，请确认完整粘贴', 'var(--accent)'],
    ['Token 格式完整 ✓', 'var(--accent)'],
  ]
  const [gradeLabel, tone] = levels[score]

  const toggleShow = () => {
    const next = !show
    setShow(next)
    const eye = eyeRef.current
    if (eye && !prefersReducedMotion()) {
      eye.querySelectorAll<SVGElement>('.token-eye-lid').forEach((lid) => {
        if (typeof lid.animate === 'function') {
          lid.animate([{ transform: 'scaleY(1)' }, { transform: 'scaleY(0.1)' }, { transform: 'scaleY(1)' }], {
            duration: 240,
            easing: 'ease-in-out',
          })
        }
      })
    }
  }

  return (
    <div className="token-strength" style={{ '--token-tone': tone } as CSSProperties}>
      <div className="field-token-wrap">
        <input
          className="field !pr-20"
          type={show ? 'text' : 'password'}
          placeholder="Fine-grained Token（github_pat_…）"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <div className="field-token-actions">
          {pasted && <span className="token-pasted-badge">已粘贴</span>}
          <button
            ref={eyeRef}
            type="button"
            className="field-eye token-eye-btn"
            aria-pressed={show}
            aria-label={show ? '隐藏 Token' : '显示 Token'}
            onClick={toggleShow}
          >
            <svg viewBox="0 0 20 20" aria-hidden>
              <path className="token-eye-lid" d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10Z" />
              <circle className="token-eye-lid" cx={10} cy={10} r={2.4} />
              <path className="token-eye-slash" d="M3.5 3.5l13 13" />
            </svg>
          </button>
        </div>
      </div>
      {(focused || trimmed.length > 0) && (
        <div className="token-meter-wrap">
          <div className="token-meter" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <i key={i} data-on={i < score ? '' : undefined} style={{ '--n': i } as CSSProperties} />
            ))}
          </div>
          <div className="token-meter-note">
            <span>Token 格式校验</span>
            <strong>{gradeLabel}</strong>
          </div>
        </div>
      )}
    </div>
  )
}
