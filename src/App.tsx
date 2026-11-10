import { lazy, Suspense, useEffect, useState } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OvertimeDialog } from './components/OvertimeDialog'
import { TabBar, type TabId } from './components/TabBar'
import { ToastHost } from './components/ui'
import { UpdatePrompt } from './components/UpdatePrompt'
import { HeatmapPage } from './pages/HeatmapPage'
import { SettingsPage } from './pages/SettingsPage'
import { TimerPage } from './pages/TimerPage'
import { useApp } from './store'

// 图表库较大，按需加载
const StatsPage = lazy(() => import('./pages/StatsPage').then((m) => ({ default: m.StatsPage })))

const TAB_KEY = 'kaoyan.tab'
function loadTab(): TabId {
  try {
    const t = localStorage.getItem(TAB_KEY)
    if (t === 'timer' || t === 'heat' || t === 'stats' || t === 'settings') return t
  } catch {
    /* 隐私模式等 */
  }
  return 'timer'
}

export function App() {
  const loaded = useApp((s) => s.loaded)
  const fatal = useApp((s) => s.fatal)
  const running = useApp((s) => !!s.active && s.active.runningSince !== null)
  const [tab, setTab] = useState<TabId>(loadTab)

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab)
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0 })
  }, [tab])

  if (fatal) {
    return (
      <div className="card m-4 mt-16 p-5">
        <div className="text-lg font-semibold">无法打开数据库</div>
        <p className="mt-2 text-sm text-muted">{fatal}</p>
        <p className="mt-2 text-sm text-muted">请确认没有在无痕模式下打开，然后刷新重试。</p>
      </div>
    )
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-t-transparent" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-full max-w-lg safe-top" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 96px)' }}>
      <ErrorBoundary resetKey={tab}>
        <main key={tab} className="page-in">
          {tab === 'timer' && <TimerPage />}
          {tab === 'heat' && <HeatmapPage />}
          {tab === 'stats' && (
            <Suspense fallback={<div className="p-8 text-center text-sm text-muted">加载中…</div>}>
              <StatsPage />
            </Suspense>
          )}
          {tab === 'settings' && <SettingsPage />}
        </main>
      </ErrorBoundary>
      <TabBar tab={tab} onChange={setTab} running={running} />
      <OvertimeDialog />
      <UpdatePrompt />
      <ToastHost />
    </div>
  )
}
