import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { useSkin } from '../skin'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * 方案 4A · 长按蓄力确认按钮（参考 UI Moments Hold to Confirm）：
 * - 按住 durationMs（默认 1050ms）底色渐进充能，超过 52% 后轻微震颤提示「即将触发」；
 * - 中途松手以 3.2× 速度倒流撤回，并温和提示「继续按住以确认」；
 * - 满格后收缩成圆章并画出 SVG 对勾，随即触发 onClick。
 * - 支持键盘 Space / Enter 长按，且对外暴露 `onClick` 与 `children` 保持语义与测试契约一致。
 */
export function HoldConfirmButton({
  children,
  onClick,
  variant = 'danger',
  disabled = false,
  durationMs = 1050,
  icon,
  hint = '长按蓄力确认，松手撤回',
  shortTapHint = '请继续按住 1 秒以确认',
  className = '',
}: {
  children: ReactNode
  onClick: () => unknown
  variant?: 'danger' | 'primary' | 'secondary'
  disabled?: boolean
  durationMs?: number
  icon?: ReactNode
  hint?: string
  shortTapHint?: string
  className?: string
}) {
  const skin = useSkin()
  const btnRef = useRef<HTMLButtonElement>(null)
  const fillRef = useRef<HTMLSpanElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const progRef = useRef<Animation | null>(null)
  const trembleRef = useRef<Animation | null>(null)
  const startedAtRef = useRef(0)
  const onClickRef = useRef(onClick)
  onClickRef.current = onClick

  const [holding, setHolding] = useState(false)
  const [done, setDone] = useState(false)
  const [statusHint, setStatusHint] = useState<string | null>(null)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      progRef.current?.cancel()
      trembleRef.current?.cancel()
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  const flashHint = (msg: string) => {
    setStatusHint(msg)
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current)
    hintTimerRef.current = setTimeout(() => setStatusHint(null), 1600)
  }

  const startHold = () => {
    if (disabled || done) return
    if (progRef.current && progRef.current.playbackRate > 0) return
    const fill = fillRef.current
    startedAtRef.current = performance.now()
    setHolding(true)
    setStatusHint(null)

    if (!fill || typeof fill.animate !== 'function' || prefersReducedMotion()) {
      // 无 WAAPI 或减弱动效时使用定时器完成蓄力
      const timer = setTimeout(() => {
        setHolding(false)
        setDone(true)
        void onClickRef.current()
        resetTimerRef.current = setTimeout(() => setDone(false), 1200)
      }, prefersReducedMotion() ? 220 : durationMs)
      resetTimerRef.current = timer
      return
    }

    if (progRef.current) {
      progRef.current.updatePlaybackRate(1)
      progRef.current.play()
    } else {
      const anim = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
        duration: durationMs,
        easing: skin === 'terminal' ? 'steps(16, end)' : 'cubic-bezier(0.45, 0, 0.6, 1)',
        fill: 'forwards',
      })
      anim.onfinish = () => {
        if (anim.playbackRate < 0) {
          anim.cancel()
          if (progRef.current === anim) progRef.current = null
          return
        }
        trembleRef.current?.cancel()
        trembleRef.current = null
        setHolding(false)
        setDone(true)
        navigator.vibrate?.(12)
        void onClickRef.current()
        resetTimerRef.current = setTimeout(() => {
          setDone(false)
          anim.cancel()
          if (progRef.current === anim) progRef.current = null
        }, 1400)
      }
      progRef.current = anim
    }

    const label = labelRef.current
    if (label && typeof label.animate === 'function' && skin !== 'terminal') {
      trembleRef.current?.cancel()
      trembleRef.current = label.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-0.9px)' },
          { transform: 'translateX(0.9px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 96, iterations: Infinity, delay: durationMs * 0.52 },
      )
    }
  }

  const releaseHold = () => {
    if (done) return
    setHolding(false)
    trembleRef.current?.cancel()
    trembleRef.current = null

    if (!progRef.current) {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current)
        resetTimerRef.current = null
        if (performance.now() - startedAtRef.current < 260) flashHint(shortTapHint)
      }
      return
    }
    if (progRef.current.playbackRate < 0) return
    if (performance.now() - startedAtRef.current < 260) flashHint(shortTapHint)
    progRef.current.updatePlaybackRate(-3.2)
  }

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    startHold()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault()
      startHold()
    }
  }

  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      releaseHold()
    }
  }

  return (
    <div className={`hold-confirm-wrap ${className}`.trim()}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        data-variant={variant}
        data-holding={holding ? '' : undefined}
        data-done={done ? '' : undefined}
        className={`btn btn-${variant} hold-confirm-btn`}
        onPointerDown={onPointerDown}
        onPointerUp={releaseHold}
        onPointerCancel={releaseHold}
        onLostPointerCapture={releaseHold}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={releaseHold}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span ref={fillRef} className="hold-confirm-fill" aria-hidden />
        <span ref={labelRef} className="hold-confirm-label">
          {icon}
          <span>{children}</span>
        </span>
        <svg className="hold-confirm-check" viewBox="0 0 24 24" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </button>
      <div className="hold-confirm-hint" aria-live="polite">
        {statusHint ?? (holding ? '继续按住以完成确认…' : hint)}
      </div>
    </div>
  )
}

/**
 * 方案 4B · 右滑确认轨道（参考 UI Moments Swipe to Confirm）：
 * - 用于全真 180 分钟模考「交卷结束」或「中断模考并切换」，彻底杜绝手滑误触；
 * - 拖拽滑块实时跟手并拉出进度底色，未达 85% 弹簧回弹，到底自动锁止并旋转 morph 成勾触发 onConfirm。
 */
export function SwipeConfirm({
  label,
  doneLabel = '已确认',
  onConfirm,
  tone = 'accent',
  disabled = false,
  className = '',
}: {
  label: string
  doneLabel?: string
  onConfirm: () => unknown
  tone?: 'accent' | 'danger'
  disabled?: boolean
  className?: string
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<{ id: number; startX: number; x: number } | null>(null)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dragging, setDragging] = useState(false)
  const [done, setDone] = useState(false)
  const [x, setX] = useState(0)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  const maxOffset = () => {
    const track = trackRef.current
    const knob = knobRef.current
    if (!track || !knob) return 180
    return Math.max(40, track.clientWidth - knob.offsetWidth - 8)
  }

  const triggerConfirm = () => {
    if (done || disabled) return
    setX(maxOffset())
    setDone(true)
    navigator.vibrate?.(12)
    void onConfirm()
    resetTimerRef.current = setTimeout(() => {
      setDone(false)
      setX(0)
    }, 1500)
  }

  const onKnobPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (done || disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { id: e.pointerId, startX: e.clientX, x: 0 }
    setDragging(true)
  }

  const onKnobPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const st = dragRef.current
    if (!st || st.id !== e.pointerId) return
    const next = Math.max(0, Math.min(maxOffset(), e.clientX - st.startX))
    st.x = next
    setX(next)
  }

  const finishDrag = (e: PointerEvent<HTMLButtonElement>) => {
    const st = dragRef.current
    if (!st || st.id !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (st.x >= maxOffset() * 0.84) {
      triggerConfirm()
    } else {
      setX(0)
    }
  }

  return (
    <div
      ref={trackRef}
      className={`swipe-confirm ${className}`.trim()}
      data-tone={tone}
      data-drag={dragging ? '' : undefined}
      data-done={done ? '' : undefined}
      style={{ '--sx': `${x.toFixed(1)}px` } as React.CSSProperties}
    >
      <span className="swipe-confirm-fill" aria-hidden />
      <span className="swipe-confirm-cue" aria-hidden>
        <span>{label}</span>
        <span className="swipe-confirm-arrows">
          <i style={{ '--n': 0 } as React.CSSProperties} />
          <i style={{ '--n': 1 } as React.CSSProperties} />
          <i style={{ '--n': 2 } as React.CSSProperties} />
        </span>
      </span>
      <span className="swipe-confirm-done" aria-live="polite">
        {done ? doneLabel : ''}
      </span>
      <button
        ref={knobRef}
        type="button"
        disabled={disabled}
        className="swipe-confirm-knob"
        aria-label={label}
        onPointerDown={onKnobPointerDown}
        onPointerMove={onKnobPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClick={(e) => {
          // 键盘 Enter / Space 触发无障碍确认
          if (e.detail === 0 && !done && !disabled) triggerConfirm()
        }}
      >
        <svg className="swipe-ico-go" viewBox="0 0 20 20" aria-hidden>
          <path d="M4 10h12m-4-4 4 4-4 4" />
        </svg>
        <svg className="swipe-ico-done" viewBox="0 0 20 20" aria-hidden>
          <path d="M4.5 10.5l3.5 3.5 7.5-8" />
        </svg>
      </button>
    </div>
  )
}
