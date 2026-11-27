import { AnimatePresence, motion, useDragControls, type Transition } from 'framer-motion'
import { memo, useEffect, type CSSProperties, type InputHTMLAttributes, type MouseEvent, type ReactNode } from 'react'
import { useSkin, type SkinId, type TransitionOrigin } from '../skin'
import { dismissToast, useApp } from '../store'

/** 把科目色交给 CSS：配合 .c 类，由当前皮肤决定怎么用这个颜色 */
export const tint = (color: string) => ({ '--c': color }) as CSSProperties

const SHEET_TRANSITION: Record<SkinId, Transition> = {
  terminal: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
  brutal: { type: 'spring', damping: 28, stiffness: 460, mass: 0.9 },
  paper: { duration: 0.38, ease: [0.22, 1, 0.36, 1] },
}

const TOAST_TRANSITION: Record<SkinId, Transition> = {
  terminal: { duration: 0.12, ease: 'linear' },
  brutal: { type: 'spring', damping: 22, stiffness: 520 },
  paper: { duration: 0.28, ease: [0.22, 1, 0.36, 1] },
}

export function clickOrigin(e: MouseEvent<HTMLElement>): TransitionOrigin {
  if (e.clientX !== 0 || e.clientY !== 0) return { x: e.clientX, y: e.clientY }
  const r = e.currentTarget.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** 底部弹出面板 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
}) {
  const skin = useSkin()
  const controls = useDragControls()
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay fixed inset-0 z-50 flex items-end justify-center" initial="hidden" animate="show" exit="hidden">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'var(--backdrop)' }}
            variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
            transition={{ duration: skin === 'paper' ? 0.26 : 0.16 }}
            onClick={onClose}
          />
          <motion.div
            className="sheet safe-bottom relative w-full max-w-lg"
            style={{ maxHeight: '88dvh' }}
            variants={{ hidden: { y: '100%' }, show: { y: 0 } }}
            transition={SHEET_TRANSITION[skin]}
            drag="y"
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose()
            }}
          >
            <div className="touch-none" onPointerDown={(e) => controls.start(e)}>
              <div className="flex justify-center pt-2.5 pb-1">
                <div className="sheet-handle" />
              </div>
              {title && <div className="sheet-title px-5 pt-1 pb-3">{title}</div>}
            </div>
            <div className="overflow-y-auto overscroll-contain px-5 pb-6" style={{ maxHeight: 'calc(88dvh - 70px)' }}>
              {children}
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

export function ToastHost() {
  const toast = useApp((s) => s.toast)
  const skin = useSkin()
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ top: 'max(env(safe-area-inset-top), 12px)' }}>
      <AnimatePresence mode="popLayout">
        {toast && (
          <motion.div
            key={toast.id}
            initial={skin === 'brutal' ? { opacity: 0, y: -18, scale: 0.92 } : { opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.96 }}
            transition={TOAST_TRANSITION[skin]}
            className="toast pointer-events-auto"
            data-kind={toast.kind}
          >
            <span className="dot" />
            <span>{toast.text}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-act"
                onClick={() => {
                  const fn = toast.action?.onClick
                  dismissToast()
                  fn?.()
                }}
              >
                {toast.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
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
  className = '',
  compact = false,
}: {
  label: string
  value: ReactNode
  unit?: string
  color: string
  icon?: ReactNode
  footer?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div className={`card stat c ${className}`} style={tint(color)} data-compact={compact ? '' : undefined}>
      <div className="stat-label">
        {icon ?? <span className="dot" />}
        {label}
      </div>
      <div className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </div>
      {footer}
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
