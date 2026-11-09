import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { useEffect, type ReactNode } from 'react'
import { alpha, lighten } from '../lib/color'
import { useApp } from '../store'

/** 底部弹出面板（毛玻璃） */
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
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial="hidden" animate="show" exit="hidden">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'var(--backdrop)', WebkitBackdropFilter: 'blur(2px)', backdropFilter: 'blur(2px)' }}
            variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="relative w-full max-w-lg rounded-t-[2rem] safe-bottom"
            style={{
              maxHeight: '88dvh',
              background: 'var(--sheet-bg)',
              WebkitBackdropFilter: 'blur(30px) saturate(170%)',
              backdropFilter: 'blur(30px) saturate(170%)',
              borderTop: '1px solid var(--card-border)',
              boxShadow: '0 -12px 50px rgba(0,0,0,.22), inset 0 1px 0 var(--card-highlight)',
            }}
            variants={{ hidden: { y: '100%' }, show: { y: 0 } }}
            transition={{ type: 'spring', damping: 32, stiffness: 380 }}
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
                <div className="h-1.5 w-10 rounded-full" style={{ background: 'var(--faint)', opacity: 0.45 }} />
              </div>
              {title && <div className="px-5 pt-1 pb-3 text-lg font-semibold">{title}</div>}
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
  id,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
  id: string
}) {
  return (
    <div className="glass-flat flex rounded-2xl p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="relative flex-1 rounded-xl py-1.5 text-sm font-medium transition-colors"
          style={{ color: value === o.value ? 'var(--text)' : 'var(--muted)' }}
        >
          {value === o.value && (
            <motion.div
              layoutId={`seg-${id}`}
              className="absolute inset-0 rounded-xl"
              style={{
                background: 'var(--seg-pill)',
                border: '1px solid var(--card-border)',
                boxShadow: '0 2px 10px rgba(0,0,0,.08), inset 0 1px 0 var(--card-highlight)',
              }}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

/** 带高光与彩色弥散投影的流体按钮背景 */
export function fluidFill(color: string): React.CSSProperties {
  return {
    background: `linear-gradient(180deg, ${lighten(color, 0.18)} 0%, ${color} 55%, ${color} 100%)`,
    boxShadow: `inset 0 1px 1px rgba(255,255,255,0.35), 0 12px 30px -10px ${alpha(color, 0.75)}, 0 2px 6px ${alpha(color, 0.25)}`,
    color: '#fff',
  }
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
  const styles: Record<string, React.CSSProperties> = {
    primary: fluidFill('#22a04b'),
    secondary: {
      background: 'var(--card-2)',
      border: '1px solid var(--line)',
      boxShadow: 'inset 0 1px 0 var(--card-highlight)',
      color: 'var(--text)',
    },
    danger: {
      background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
      border: '1px solid color-mix(in srgb, var(--danger) 18%, transparent)',
      color: 'var(--danger)',
    },
    ghost: { background: 'transparent', color: 'var(--accent)' },
  }
  return (
    <motion.button
      type={type}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={{ type: 'spring', damping: 20, stiffness: 500 }}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-2xl px-4 py-3 text-[15px] font-semibold transition-opacity disabled:opacity-40 ${className}`}
      style={styles[variant]}
    >
      {children}
    </motion.button>
  )
}

export function ToastHost() {
  const toast = useApp((s) => s.toast)
  const dot = toast?.kind === 'error' ? 'var(--danger)' : toast?.kind === 'success' ? 'var(--accent)' : 'var(--accent-2)'
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ top: 'max(env(safe-area-inset-top), 12px)' }}>
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -16, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.97 }}
            transition={{ type: 'spring', damping: 24, stiffness: 380 }}
            className="mt-2 flex items-center gap-2 rounded-full py-2.5 pr-4 pl-3.5 text-sm font-medium"
            style={{
              background: 'var(--card-strong)',
              WebkitBackdropFilter: 'blur(24px) saturate(170%)',
              backdropFilter: 'blur(24px) saturate(170%)',
              border: '1px solid var(--card-border)',
              boxShadow: 'var(--shadow-float), inset 0 1px 0 var(--card-highlight)',
              color: toast.kind === 'error' ? 'var(--danger)' : 'var(--text)',
            }}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot, boxShadow: `0 0 8px ${dot}` }} />
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-[13px] font-semibold tracking-wide text-muted">{children}</h2>
      {right}
    </div>
  )
}

/** 流光小卡片：精致标签 + 大号数字，内部带斜向彩色光晕 */
export function GlowStat({
  label,
  value,
  unit,
  color,
  icon,
  valueColor,
  className = '',
  compact = false,
}: {
  label: string
  value: ReactNode
  unit?: string
  color: string
  icon?: ReactNode
  valueColor?: string
  className?: string
  compact?: boolean
}) {
  return (
    <div className={`card overflow-hidden ${compact ? 'px-3 py-3' : 'px-4 py-3.5'} ${className}`}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 90% at 100% 0%, ${alpha(color, 0.22)} 0%, transparent 60%), linear-gradient(135deg, ${alpha(color, 0.08)} 0%, transparent 55%)`,
        }}
      />
      <div className="relative flex items-center gap-1.5 text-[12px] font-medium text-muted">
        {icon ?? <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />}
        {label}
      </div>
      <div
        className={`num relative mt-1 leading-none font-bold tracking-tight whitespace-nowrap ${compact ? 'text-[21px]' : 'text-[28px]'}`}
        style={{ color: valueColor }}
      >
        {value}
        {unit && <span className="ml-1 text-sm font-semibold text-muted">{unit}</span>}
      </div>
    </div>
  )
}

/** 流光进度条 */
export function GlowBar({ pct, color, height = 8 }: { pct: number; color: string; height?: number }) {
  return (
    <div className="overflow-hidden rounded-full" style={{ height, background: 'var(--card-2)' }}>
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{
          width: `${Math.max(0, Math.min(100, pct))}%`,
          background: `linear-gradient(90deg, ${alpha(color, 0.55)} 0%, ${color} 70%, ${lighten(color, 0.25)} 100%)`,
          boxShadow: pct > 0 ? `0 0 10px ${alpha(color, 0.45)}` : undefined,
        }}
      />
    </div>
  )
}
