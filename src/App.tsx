import { Activity, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OvertimeDialog } from './components/OvertimeDialog'
import { TabBar, type TabId } from './components/TabBar'
import { ToastHost } from './components/ui'
import { UpdatePrompt } from './components/UpdatePrompt'
import { HeatmapPage } from './pages/HeatmapPage'
import { SettingsPage } from './pages/SettingsPage'
import { TimerPage } from './pages/TimerPage'
import { useExamAlarm } from './hooks/useExamAlarm'
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

// 页面元素只创建一次：切换标签时引用不变，React 不会重新渲染页面本身，只切换可见性
const PAGES: Array<{ id: TabId; node: ReactNode }> = [
  { id: 'timer', node: <TimerPage /> },
  { id: 'heat', node: <HeatmapPage /> },
  {
    id: 'stats',
    node: (
      <Suspense fallback={<div className="p-8 text-center text-sm text-muted">加载中…</div>}>
        <StatsPage />
      </Suspense>
    ),
  },
  { id: 'settings', node: <SettingsPage /> },
]

export function App() {
  const loaded = useApp((s) => s.loaded)
  const fatal = useApp((s) => s.fatal)
  const running = useApp((s) => !!s.active && s.active.runningSince !== null)
  const [tab, setTab] = useState<TabId>(loadTab)
  useExamAlarm()
  // 页面切走后不卸载，各自的纵向滚动位置也要记住（所有页面共用 window 的滚动条）
  const scrollTops = useRef<Partial<Record<TabId, number>>>({})

  const changeTab = (next: TabId) => {
    if (next === tab) {
      // 再点一次当前标签 = 回到顶部
      window.scrollTo({ top: 0 })
      return
    }
    scrollTops.current[tab] = window.scrollY
    setTab(next)
  }

  useLayoutEffect(() => {
    window.scrollTo({ top: scrollTops.current[tab] ?? 0 })
  }, [tab])

  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab)
    } catch {
      /* ignore */
    }
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
      {/*
        四个页面一直挂着，只有当前页可见：切回来不用重建节点，页内状态（范围选择、热度表滚到哪）也都还在。
        隐藏的页面由 React 用空闲时间预渲染，副作用（每秒的计时刷新等）在隐藏期间是停掉的。
        错误边界一页一个，某一页出错不会连带其他页。
      */}
      {PAGES.map(({ id, node }) => (
        <Activity key={id} mode={tab === id ? 'visible' : 'hidden'}>
          <ErrorBoundary resetKey={tab}>
            <main className="page-in">{node}</main>
          </ErrorBoundary>
        </Activity>
      ))}
      <TabBar tab={tab} onChange={changeTab} running={running} />
      <OvertimeDialog />
      <UpdatePrompt />
      <ToastHost />
    </div>
  )
}
