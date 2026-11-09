import { AnimatePresence, motion } from 'framer-motion'
import { useRegisterSW } from 'virtual:pwa-register/react'

/** 发布新版本后提示刷新（计时状态已持久化，刷新不会丢计时） */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // 每小时检查一次更新
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000)
    },
  })

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          className="card fixed inset-x-4 z-50 mx-auto flex max-w-md items-center gap-3 p-3 pl-4"
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 92px)' }}
        >
          <span className="flex-1 text-sm">有新版本可用</span>
          <button className="text-sm text-muted" onClick={() => setNeedRefresh(false)}>
            稍后
          </button>
          <button
            className="rounded-xl px-3 py-1.5 text-sm font-semibold text-white"
            style={{ background: 'var(--accent)' }}
            onClick={() => void updateServiceWorker(true)}
          >
            更新
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
