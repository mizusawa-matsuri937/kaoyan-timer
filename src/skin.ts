import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

/**
 * 外观：皮肤 + 明暗模式。纯外观偏好，只存在本机 localStorage，不进数据库也不参与同步。
 * 样式全部由 <html data-skin="…" data-mode="light|dark"> 上的设计令牌驱动（见 index.css）。
 */
export type SkinId = 'terminal' | 'brutal' | 'paper'
export type ModeId = 'system' | 'light' | 'dark'

export const SKINS: Array<{ id: SkinId; name: string; hint: string }> = [
  { id: 'terminal', name: '终端极客', hint: '等宽字体' },
  { id: 'brutal', name: '新粗野', hint: '粗描边硬阴影' },
  { id: 'paper', name: '纸感文艺', hint: '暖纸衬线' },
]

export const MODES: Array<{ value: ModeId; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

// index.html 里的首屏脚本读的是同样的键
const SKIN_KEY = 'kaoyan.skin'
const MODE_KEY = 'kaoyan.mode'
const DEFAULT_SKIN: SkinId = 'terminal'
const DEFAULT_MODE: ModeId = 'system'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** 浏览器状态栏颜色，与各皮肤的 --bg 保持一致 */
const THEME_COLOR: Record<SkinId, { light: string; dark: string }> = {
  terminal: { light: '#ffffff', dark: '#0d1117' },
  brutal: { light: '#fff4d6', dark: '#25262f' },
  paper: { light: '#f5f0e6', dark: '#1a1816' },
}

const isSkin = (v: unknown): v is SkinId => SKINS.some((s) => s.id === v)
const isMode = (v: unknown): v is ModeId => MODES.some((m) => m.value === v)

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // 隐私模式等
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 存不下也不影响本次使用 */
  }
}

const stored = { skin: read(SKIN_KEY), mode: read(MODE_KEY) }
let skin: SkinId = isSkin(stored.skin) ? stored.skin : DEFAULT_SKIN
let mode: ModeId = isMode(stored.mode) ? stored.mode : DEFAULT_MODE
const listeners = new Set<() => void>()
let systemDark: MediaQueryList | null = null

function apply() {
  const dark = mode === 'system' ? (systemDark ?? window.matchMedia(DARK_QUERY)).matches : mode === 'dark'
  const root = document.documentElement
  root.dataset.skin = skin
  root.dataset.mode = dark ? 'dark' : 'light'
  // 明暗可以手动指定，所以两条带 media 的 theme-color 都写成当前实际颜色
  const color = THEME_COLOR[skin][dark ? 'dark' : 'light']
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', color)
}

function commit() {
  apply()
  for (const l of listeners) l()
}

let vtSeq = 0

/**
 * 用户自己换皮肤 / 明暗时，带一段整屏过渡（View Transitions：前后两帧是浏览器截的图，过渡期间页面不重排）。
 * 用哪种过渡由 CSS 令牌 --m-vt 决定（见 motion.css）；浏览器不支持、令牌是 none、或系统开了减弱动态效果时直接切换。
 */
function commitAnimated() {
  const root = document.documentElement
  const kind = () => getComputedStyle(root).getPropertyValue('--m-vt').trim()
  if (
    typeof document.startViewTransition !== 'function' ||
    !kind() ||
    kind() === 'none' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    commit()
    return
  }
  const vt = document.startViewTransition(() => {
    // 新画面要在这个回调里同步画完，所以让 React 立刻提交
    flushSync(commit)
    // 换完再读一次：过渡的样式跟随「换成的」那套皮肤
    root.dataset.vt = kind()
  })
  // 过渡还没播完又换了一次时，前一次会被浏览器跳过：不算错误，也别把后一次的标记清掉
  const seq = ++vtSeq
  const done = () => {
    if (seq === vtSeq) delete root.dataset.vt
  }
  vt.ready.catch(() => {})
  vt.finished.then(done, done)
}

/** 启动时调用一次：应用外观，并跟随系统明暗变化和其他标签页的切换 */
export function initSkin() {
  apply()
  // 引用留在模块作用域，避免 MediaQueryList 被回收后监听失效；
  // 回到前台时再核对一次，兜住后台期间系统明暗变了却没收到事件的情况
  const follow = () => {
    if (mode === 'system') apply()
  }
  systemDark = window.matchMedia(DARK_QUERY)
  systemDark.addEventListener('change', follow)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') follow()
  })
  window.addEventListener('storage', (e) => {
    if (e.key === SKIN_KEY) {
      const next = isSkin(e.newValue) ? e.newValue : DEFAULT_SKIN
      if (next === skin) return
      skin = next
    } else if (e.key === MODE_KEY) {
      const next = isMode(e.newValue) ? e.newValue : DEFAULT_MODE
      if (next === mode) return
      mode = next
    } else {
      return
    }
    commit()
  })
}

export function setSkin(next: SkinId) {
  if (next === skin) return
  skin = next
  write(SKIN_KEY, next)
  commitAnimated()
}

export function setMode(next: ModeId) {
  if (next === mode) return
  mode = next
  write(MODE_KEY, next)
  commitAnimated()
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
const skinSnapshot = () => skin
const modeSnapshot = () => mode

export function useSkin(): SkinId {
  return useSyncExternalStore(subscribe, skinSnapshot)
}

export function useMode(): ModeId {
  return useSyncExternalStore(subscribe, modeSnapshot)
}
