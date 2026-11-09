import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { useEffect, type ReactNode } from 'react'
import { useApp } from '../store'

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
            style={{ background: 'var(--backdrop)' }}
            variants={{ hidden: { opacity: 0 }, show: { opacity: 1 } }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="relative w-full max-w-lg rounded-t-[1.75rem] bg-card safe-bottom"
            style={{ maxHeight: '88dvh', boxShadow: '0 -8px 40px rgba(0,0,0,.18)' }}
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
                <div className="h-1.5 w-10 rounded-full" style={{ background: 'var(--faint)', opacity: 0.4 }} />
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
    <div className="flex rounded-2xl bg-card-2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="relative flex-1 rounded-xl py-1.5 text-sm font-medium"
          style={{ color: value === o.value ? 'var(--text)' : 'var(--muted)' }}
        >
          {value === o.value && (
            <motion.div
              layoutId={`seg-${id}`}
              className="absolute inset-0 rounded-xl bg-card"
              style={{ boxShadow: '0 1px 4px rgba(0,0,0,.08)' }}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            />
          )}
          <span className="relative">{o.label}</span>
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
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: '#fff' },
    secondary: { background: 'var(--card-2)', color: 'var(--text)' },
    danger: { background: 'color-mix(in srgb, var(--danger) 12%, transparent)', color: 'var(--danger)' },
    ghost: { background: 'transparent', color: 'var(--accent)' },
  }
  return (
    <motion.button
      type={type}
      whileTap={disabled ? undefined : { scale: 0.96 }}
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
  return (
    <div className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" style={{ top: 'max(env(safe-area-inset-top), 12px)' }}>
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: 'spring', damping: 26, stiffness: 380 }}
            className="mt-2 rounded-2xl px-4 py-2.5 text-sm font-medium backdrop-blur-xl"
            style={{
              background: toast.kind === 'error' ? 'var(--danger)' : 'color-mix(in srgb, var(--text) 88%, transparent)',
              color: 'var(--bg)',
              boxShadow: '0 8px 30px rgba(0,0,0,.2)',
            }}
          >
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
