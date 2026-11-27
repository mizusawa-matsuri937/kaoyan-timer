import { AnimatePresence, motion, useDragControls, type Transition } from 'framer-motion'
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useSkin, type SkinId, type TransitionOrigin } from '../skin'
import { dismissToast, pauseToasts, resumeToasts, useApp, type Toast } from '../store'
import { IconClose } from './icons'

/** 把科目色交给 CSS：配合 .c 类，由当前皮肤决定怎么用这个颜色 */
export const tint = (color: string) => ({ '--c': color }) as CSSProperties

const SHEET_TRANSITION: Record<SkinId, Transition> = {
  terminal: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
  brutal: { type: 'spring', damping: 28, stiffness: 460, mass: 0.9 },
  paper: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
}

const TOAST_TRANSITION: Record<SkinId, Transition> = {
  terminal: { duration: 0.12, ease: 'linear' },
  brutal: { type: 'spring', damping: 24, stiffness: 520 },
  paper: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
}

export function clickOrigin(e: MouseEvent<HTMLElement>): TransitionOrigin {
  if (e.clientX !== 0 || e.clientY !== 0) return { x: e.clientX, y: e.clientY }
  const r = e.currentTarget.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** 底部弹出面板（支持无障碍焦点闭环、ESC 关闭，以及不可关闭时的物理阻尼微震） */
export function Sheet({
  open,
  onClose,
  title,
  dismissible = true,
  flushBody = false,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  dismissible?: boolean
  flushBody?: boolean
  children: ReactNode
}) {
  const skin = useSkin()
  const titleId = useId()
  const controls = useDragControls()
  const sheetRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [nudgeSeq, setNudgeSeq] = useState(0)

  const triggerNudge = () => setNudgeSeq((n) => n + 1)

  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const prevOverflow = document.body?.style ? document.body.style.overflow : ''
    const prevFocus = document.activeElement as HTMLElement | null
    if (document.body?.style) document.body.style.overflow = 'hidden'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (dismissible) onCloseRef.current()
        else triggerNudge()
      }
    }
    if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown)

    return () => {
      if (document.body?.style) document.body.style.overflow = prevOverflow
      if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown)
      prevFocus?.focus?.()
    }
  }, [open, dismissible])

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay fixed inset-0 z-50 flex items-end justify-center" initial="hidden" animate="show" exit="hidden">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'var(--backdrop)' }}
            variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
            transition={{ duration: skin === 'paper' ? 0.26 : 0.16 }}
            onClick={() => (dismissible ? onClose() : triggerNudge())}
          />
          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            className="sheet safe-bottom relative w-full max-w-lg"
            style={{ maxHeight: '88dvh' }}
            variants={{ hidden: { y: '100%' }, show: { y: 0 } }}
            transition={SHEET_TRANSITION[skin]}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: dismissible ? 0.6 : 0.14 }}
            onDragEnd={(_, info) => {
              if (!dismissible) {
                if (info.offset.y > 18) triggerNudge()
                return
              }
              if (info.offset.y > 120 || info.velocity.y > 600) onClose()
            }}
          >
            <div key={nudgeSeq || undefined} className={nudgeSeq > 0 ? 'sheet-nudge' : undefined}>
              <div className="touch-none" onPointerDown={(e) => controls.start(e)}>
                <div className="flex justify-center pt-2.5 pb-1">
                  <div className="sheet-handle" data-locked={!dismissible ? '' : undefined} />
                </div>
                {title && (
                  <div id={titleId} className="sheet-title px-5 pt-1 pb-3">
                    {title}
                  </div>
                )}
              </div>
              {flushBody ? (
                <div className="overflow-hidden" style={{ height: 'min(calc(84dvh - 70px), 680px)' }}>
                  {children}
                </div>
              ) : (
                <div className="overflow-y-auto overscroll-contain px-5 pb-6" style={{ maxHeight: 'calc(88dvh - 70px)' }}>
                  {children}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T, origin?: TransitionOrigin) => void
}) {
  // 选中项的底色是一块会滑动的滑块（.seg::before），位置由这两个变量决定
  const index = options.findIndex((o) => o.value === value)
  return (
    <div className="seg" style={{ '--seg-n': options.length, '--seg-i': index } as CSSProperties} data-none={index < 0 ? '' : undefined}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={(e) => onChange(o.value, clickOrigin(e))}
          aria-pressed={value === o.value}
          className="seg-item"
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** 三皮肤专属开关：纸感/新粗野支持按压果冻液滴拉伸与开花星芒；终端极客采用地道字符反显块 */
export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  const skin = useSkin()
  const [bloomSeq, setBloomSeq] = useState(0)

  const handleClick = () => {
    const next = !on
    if (next && skin !== 'terminal') setBloomSeq((s) => s + 1)
    onChange(next)
  }

  if (skin === 'terminal') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={handleClick}
        className="toggle-tui num"
      >
        {on ? '[ ON* ]' : '[ OFF ]'}
      </button>
    )
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={handleClick}
      className="toggle"
    >
      <span className="toggle-thumb" />
      {bloomSeq > 0 && (
        <svg key={bloomSeq} className="toggle-bloom" viewBox="0 0 64 40" fill="none" aria-hidden>
          <circle cx="46" cy="20" r="13" stroke="var(--accent)" strokeWidth="2" strokeDasharray="2.5 5.5" />
        </svg>
      )}
    </button>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  className = '',
  disabled,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  className?: string
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`btn btn-${variant} ${className}`}>
      {children}
    </button>
  )
}

/**
 * 占满一行的日期时间输入框。
 * iOS Safari 的原生日期输入框不按 border-box 算宽度，直接给它 width:100% 加内边距会超出容器，
 * 所以边框和内边距交给外层 label，输入框本身零内边距、零边框，怎么算都是同一个宽度。
 */
export function DateTimeField({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <label className={`field field-box ${className}`}>
      <input type="datetime-local" {...props} />
    </label>
  )
}

function ToastItem({
  toast,
  index,
  skin,
  onHoldChange,
}: {
  toast: Toast
  index: number
  skin: SkinId
  onHoldChange: (holding: boolean) => void
}) {
  const [dragY, setDragY] = useState(0)
  const startYRef = useRef<number | null>(null)

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    startYRef.current = e.clientY
    onHoldChange(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (startYRef.current === null) return
    const dy = e.clientY - startYRef.current
    setDragY(dy < 0 ? dy : dy * 0.18)
  }

  const finishPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (startYRef.current === null) return
    const dy = e.clientY - startYRef.current
    startYRef.current = null
    onHoldChange(false)
    if (dy < -22) {
      dismissToast(toast.id)
    } else {
      setDragY(0)
    }
  }

  return (
    <motion.div
      layout
      initial={skin === 'brutal' ? { opacity: 0, y: -18, scale: 0.92 } : { opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.95 }}
      transition={TOAST_TRANSITION[skin]}
      className="toast-slot pointer-events-auto"
      style={{ '--toast-idx': index, zIndex: 30 - index } as CSSProperties}
    >
      <div
        className="toast select-none"
        data-kind={toast.kind}
        data-has-bar={toast.action ? '' : undefined}
        style={dragY !== 0 ? { transform: `translateY(${dragY.toFixed(1)}px)`, transition: 'none' } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={() => {
          startYRef.current = null
          setDragY(0)
          onHoldChange(false)
        }}
      >
        <span className="dot" />
        <span className="min-w-0 flex-1 truncate">{toast.text}</span>
        {toast.action && (
          <button
            type="button"
            className="toast-act"
            onClick={() => {
              const fn = toast.action?.onClick
              dismissToast(toast.id)
              fn?.()
            }}
          >
            {toast.action.label}
          </button>
        )}
        <button
          type="button"
          className="toast-close"
          aria-label="关闭通知"
          onClick={() => dismissToast(toast.id)}
        >
          <IconClose size={13} />
        </button>
        {toast.action && (
          <span
            className="toast-progress"
            style={{ animationDuration: `${toast.durationMs}ms` }}
            aria-hidden
          />
        )}
      </div>
    </motion.div>
  )
}

export function ToastHost() {
  const toasts = useApp((s) => s.toasts)
  const skin = useSkin()
  const [hovered, setHovered] = useState(false)
  const [holding, setHolding] = useState(false)

  const paused = toasts.length > 0 && (hovered || holding)
  useEffect(() => {
    if (toasts.length === 0) {
      setHovered(false)
      setHolding(false)
      return
    }
    if (paused) pauseToasts()
    else resumeToasts()
  }, [paused, toasts.length])

  // 最新一条排在最前 (index = 0)，旧消息依次向后层叠
  const visible = [...toasts].reverse()

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4"
      style={{ top: 'max(env(safe-area-inset-top), 12px)' }}
    >
      <div
        className="toast-stack"
        data-paused={paused ? '' : undefined}
        data-expanded={paused && visible.length > 1 ? '' : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <AnimatePresence mode="popLayout">
          {visible.map((t, idx) => (
            <ToastItem key={t.id} toast={t} index={idx} skin={skin} onHoldChange={setHolding} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="sec-head">
      <h2 className="section-title">{children}</h2>
      {right}
    </div>
  )
}

/** 数据小卡：标签 + 大号数字。color 是这项数据的代表色，具体怎么上色由皮肤决定 */
export function Stat({
  label,
  value,
  unit,
  color,
  icon,
  footer,
  badge,
  overlay,
  className = '',
  compact = false,
}: {
  label: string
  value: ReactNode
  unit?: string
  color: string
  icon?: ReactNode
  footer?: ReactNode
  badge?: ReactNode
  overlay?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div className={`card stat c ${className}`} style={tint(color)} data-compact={compact ? '' : undefined}>
      <div className="stat-head">
        <div className="stat-label">
          {icon ?? <span className="dot" />}
          {label}
        </div>
        {badge}
      </div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {footer}
      {overlay}
    </div>
  )
}

/** 进度条；不传 color 时用主题强调色 */
export const Bar = memo(function Bar({ pct, color, height }: { pct: number; color?: string; height?: number }) {
  const clamped = Math.round(Math.max(0, Math.min(100, pct)) * 100) / 100
  const style = { ...(color ? tint(color) : null), ...(height ? { '--bar-h': `${height}px` } : null) } as CSSProperties
  return (
    <div className={`bar ${color ? 'c' : ''}`} style={style}>
      <i style={{ width: `${clamped}%` }} />
    </div>
  )
})
