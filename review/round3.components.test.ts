import { testLocks } from './fixtures'
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement, ReactNode } from 'react'
import { getFile, putFile } from '../src/sync/github'
import { HOUR, NOW, session } from './fixtures'

// Event-handler / hook calculation unit harness, not a browser render test.
// State slots start at their already-rendered values. Effects/DOM are not simulated.
// Business store and Dexie writes are real; only React scheduling and network are mocked.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, refs: [] as Array<{ current: unknown }>, refCursor: 0, effects: [] as Array<() => unknown>, subscriptions: [] as unknown[] }))
vi.mock('react', async (original) => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const at = hooks.cursor++
    if (!(at in hooks.values)) hooks.values[at] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[at], (value: unknown) => {
      hooks.values[at] = typeof value === 'function' ? value(hooks.values[at]) : value
    }]
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refCursor++] ??= { current: initial },
  useEffect: (fn: () => unknown) => { hooks.effects.push(fn) },
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (subscribe: unknown, snapshot: () => unknown) => { hooks.subscriptions.push(subscribe); return snapshot() },
}))
vi.mock('../src/sync/github', async (original) => ({
  ...await original<typeof import('../src/sync/github')>(), getFile: vi.fn(), putFile: vi.fn(),
}))

type Store = typeof import('../src/store')
type Database = typeof import('../src/db/db')
let store: Store
let database: Database

function findElement(node: ReactNode, label: string): ReactElement<{ onClick: () => unknown; disabled?: boolean }> {
  if (Array.isArray(node)) {
    for (const child of node) { try { return findElement(child, label) } catch { /* try the next child */ } }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const el = node as ReactElement<{ children?: ReactNode; onClick: () => unknown; disabled?: boolean }>
    if (el.props.children === label && typeof el.props.onClick === 'function') return el
    return findElement(el.props.children, label)
  }
  throw new Error(`No handler found for ${label}`)
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  vi.stubGlobal('navigator', { onLine: false, locks: testLocks })
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Live network is forbidden') }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(getFile).mockReset().mockResolvedValue(null)
  vi.mocked(putFile).mockReset().mockResolvedValue('synthetic-sha')
  hooks.effects = []; hooks.subscriptions = []
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() })
  hooks.values = []
  hooks.cursor = 0
  hooks.refs = []
  hooks.refCursor = 0
  vi.resetModules()
  database = await import('../src/db/db')
  await database.db.delete()
  await database.db.open()
  store = await import('../src/store')
  await store.init()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await store.reloadFromDb()
  database.db.close()
  await database.db.delete()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})


function render<T>(fn: () => T): T {
  hooks.cursor = 0; hooks.refCursor = 0; hooks.effects = []
  const tree = fn()
  for (const effect of hooks.effects) effect()
  return tree
}
describe('round3 components', () => {
  it.each([40_000, 25 * 60_000])('T1 preserves untouched milliseconds (%i)', async (duration) => {
    const row = session('precise', { segments: [{ start: NOW - HOUR + 10_123, end: NOW - HOUR + 10_123 + duration }] })
    await store.saveSession(row)
    const saved = (await database.db.sessions.get(row.id))!
    const { SessionEditor } = await import('../src/components/SessionEditor')
    const target = { kind: 'edit' as const, session: saved }
    const draw = () => SessionEditor({ target, onClose: vi.fn() })
    render(draw)
    hooks.values[0] = 'os'
    // Render without re-running the mount effect (same target).
    hooks.cursor = 0; hooks.refCursor = 0
    const tree = draw()
    await findElement(tree, '保存').props.onClick()
    expect((await database.db.sessions.get(row.id))!).toMatchObject({ subjectId: 'os', segments: saved.segments })
  })
  it('T2 an already open correction survives an equivalent refresh/visibility check', async () => {
    await store.selectSubjectAndStart('ds')
    vi.setSystemTime(NOW + 6 * HOUR)
    const { OvertimeDialog } = await import('../src/components/OvertimeDialog')
    render(OvertimeDialog)
    hooks.values[2] = 'endAt'; hooks.values[3] = '2026-11-09T10:30'
    await store.reloadFromDb()
    render(OvertimeDialog)
    expect(hooks.values[2]).toBe('endAt')
    expect(hooks.values[3]).toBe('2026-11-09T10:30')
  })
})

it('T5 subscription function remains stable across renders', () => {
  store.useApp(s => s.active)
  store.useApp(s => s.active)
  expect(hooks.subscriptions[0]).toBe(hooks.subscriptions[1])
})

it('T10 manual overlapping rows are rejected before saving', async () => {
  const local = (ts:number) => { const d=new Date(ts); const p=(n:number)=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}` }
  hooks.values = ['ds',[{start:local(NOW-3*HOUR),end:local(NOW-HOUR)},{start:local(NOW-2*HOUR),end:local(NOW)}],false]
  const {SessionEditor} = await import('../src/components/SessionEditor')
  const close=vi.fn()
  const tree=SessionEditor({target:{kind:'new',day:local(NOW).slice(0,10)},onClose:close})
  await findElement(tree,'保存').props.onClick()
  expect(await database.db.sessions.count()).toBe(0)
  expect(close).not.toHaveBeenCalled()
  expect(store.getState().toast?.text).toMatch(/重叠/)
})
it('T9 date typing does not persist until blur', async () => {
  vi.stubGlobal('__APP_VERSION__','test')
  const {SettingsPage}=await import('../src/pages/SettingsPage')
  const tree=SettingsPage()
  const findDate=(node: ReactNode): ReactElement<{type?:string;children?:ReactNode;onChange:(e:unknown)=>unknown;onBlur?:(e:unknown)=>unknown}>|undefined=>{
    if(Array.isArray(node)) {for(const child of node){const found=findDate(child);if(found)return found}}
    else if(node && typeof node==='object' && 'props' in node){
      const el=node as ReactElement<{type?:string;children?:ReactNode;onChange:(e:unknown)=>unknown;onBlur?:(e:unknown)=>unknown}>
      if(el.props.type==='date') return el
      return findDate(el.props.children)
    }
  }
  const input=findDate(tree)!
  const before=store.getState().settings.examDate
  input.props.onChange({target:{value:'2027-12-20'}})
  await store.reloadFromDb()
  expect(store.getState().settings.examDate).toBe(before)
  await input.props.onBlur!({currentTarget:{value:'2027-12-20'}})
  expect(store.getState().settings.examDate).toBe('2027-12-20')
})

// ---- Follow-up to the round-3 fixes (F2) ----
it('F2 a re-check of the same reminder refreshes the time snapshot but keeps the correction in progress', async () => {
  await store.selectSubjectAndStart('ds')
  vi.setSystemTime(NOW + 6 * HOUR)
  const { OvertimeDialog } = await import('../src/components/OvertimeDialog')
  render(OvertimeDialog)
  expect(hooks.values[1]).toBe(NOW + 6 * HOUR)
  hooks.values[2] = 'endAt'; hooks.values[3] = '2026-11-09T10:30'
  vi.setSystemTime(NOW + 8 * HOUR)
  render(OvertimeDialog)
  expect(hooks.values[1]).toBe(NOW + 8 * HOUR)
  expect(hooks.values[2]).toBe('endAt')
  expect(hooks.values[3]).toBe('2026-11-09T10:30')
})
