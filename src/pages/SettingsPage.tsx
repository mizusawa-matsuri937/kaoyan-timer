import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCloud } from '../components/icons'
import { SkinPicker } from '../components/SkinPicker'
import { Button, SectionTitle } from '../components/ui'
import { dayKey } from '../domain/dates'
import { wakeLockSupported } from '../hooks/useWakeLock'
import {
  exportBackupText,
  importBackupText,
  setSyncConfig,
  showToast,
  syncNow,
  updateSettings,
  useApp,
  type SyncStatus,
} from '../store'

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div>
        <div className="text-[15px]">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="toggle" />
  )
}

const STATUS_TEXT: Record<SyncStatus, string> = {
  disabled: '未开启',
  idle: '待同步',
  syncing: '同步中…',
  ok: '已备份',
  error: '同步失败',
  offline: '离线，联网后自动补上',
}

const isStandalone =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true)

export function SettingsPage() {
  const settings = useApp((s) => s.settings)
  const sync = useApp((s) => s.sync)
  const cfg = useApp((s) => s.syncConfig)
  const persisted = useApp((s) => s.persisted)
  const count = useApp((s) => s.sessions.filter((x) => !x.deleted).length)

  const [owner, setOwner] = useState(cfg?.owner ?? '')
  const [repo, setRepo] = useState(cfg?.repo ?? 'kaoyan-data')
  const [token, setToken] = useState(cfg?.token ?? '')
  const [path, setPath] = useState(cfg?.path ?? 'data.json')
  const [showHelp, setShowHelp] = useState(!cfg)
  const [usage, setUsage] = useState<string | null>(null)
  const [dateDraft, setDateDraft] = useState<Partial<Record<'examDate' | 'startDate', string>>>({})
  const commitDate = async (key: 'examDate' | 'startDate', value: string) => {
    if (value && value !== settings[key]) await updateSettings({ [key]: value })
    setDateDraft(current => { const next = { ...current }; delete next[key]; return next })
  }
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage != null) setUsage(`${(e.usage / 1024).toFixed(0)} KB`)
    })
  }, [count])

  const saveCfg = async () => {
    if (!owner.trim() || !repo.trim() || !token.trim()) return showToast('请填写用户名、仓库名和 Token', 'error')
    await setSyncConfig({ owner: owner.trim(), repo: repo.trim(), token: token.trim(), path: path.trim() || 'data.json' })
  }

  const doExport = async () => {
    const text = exportBackupText()
    const name = `kaoyan-backup-${dayKey(Date.now())}.json`
    const file = new File([text], name, { type: 'application/json' })
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name })
        return
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  const doImport = async (f: File) => {
    try {
      const n = await importBackupText(await f.text())
      showToast(n ? `已导入 ${n} 条记录` : '没有新的记录需要导入', 'success')
    } catch (e) {
      showToast(`导入失败：${(e as Error).message}`, 'error')
    }
  }

  const statusColor =
    sync.status === 'ok' ? 'var(--accent)' : sync.status === 'error' ? 'var(--danger)' : 'var(--muted)'

  return (
    <div className="px-4 pb-8">
      <h1 className="page-title">设置</h1>

      {!isStandalone && (
        <div className="note mt-3 p-4 text-sm leading-relaxed">
          <b>建议添加到主屏幕使用：</b>在 Safari 中点「分享」→「添加到主屏幕」，之后都从主屏幕图标打开。
          主屏幕 App 的数据不会被 Safari 自动清理，而且和浏览器标签页里的数据是<b>分开存的</b>。
        </div>
      )}

      <SectionTitle>外观</SectionTitle>
      <SkinPicker />
      <p className="mt-2 px-1 text-xs text-faint">外观设置只保存在这台设备上。</p>

      <SectionTitle>考研</SectionTitle>
      <div className="card rows px-4">
        <Row label="初试日期">
          <input
            type="date"
            className="field !w-auto !py-1.5 text-right"
            value={dateDraft.examDate ?? settings.examDate}
            onChange={(e) => setDateDraft(current => ({ ...current, examDate: e.target.value }))}
            onBlur={(e) => commitDate('examDate', e.currentTarget.value)}
          />
        </Row>
        <Row label="备考开始日期" hint="热度表从这天开始">
          <input
            type="date"
            className="field !w-auto !py-1.5 text-right"
            value={dateDraft.startDate ?? settings.startDate}
            onChange={(e) => setDateDraft(current => ({ ...current, startDate: e.target.value }))}
            onBlur={(e) => commitDate('startDate', e.currentTarget.value)}
          />
        </Row>
      </div>

      <SectionTitle>计时</SectionTitle>
      <div className="card rows px-4">
        <Row label="忘记结束提醒" hint="单段连续计时超过该时长，回来时询问">
          <select
            className="field !w-auto !py-1.5"
            value={settings.overtimeHours}
            onChange={(e) => updateSettings({ overtimeHours: Number(e.target.value) })}
          >
            {[2, 3, 4, 5, 6, 8].map((h) => (
              <option key={h} value={h}>
                {h} 小时
              </option>
            ))}
          </select>
        </Row>
        {wakeLockSupported && (
          <Row label="计时时屏幕常亮">
            <Toggle on={settings.keepAwake} onChange={(v) => updateSettings({ keepAwake: v })} />
          </Row>
        )}
      </div>

      <SectionTitle
        right={
          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: statusColor }}>
            <IconCloud size={14} /> {STATUS_TEXT[sync.status]}
          </span>
        }
      >
        GitHub 自动备份
      </SectionTitle>
      <div className="card p-4">
        {cfg && (
          <div className="well mb-4 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">上次备份</span>
              <span className="num">
                {sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString('zh-CN', { hour12: false }) : '还没有'}
              </span>
            </div>
            {sync.dirty && <div className="mt-1 text-xs text-muted">有本地改动等待上传</div>}
            {sync.lastError && sync.status !== 'ok' && (
              <div className="mt-1 text-xs break-all text-danger">{sync.lastError}</div>
            )}
          </div>
        )}
        <div className="grid gap-2.5">
          <input className="field" placeholder="GitHub 用户名" value={owner} onChange={(e) => setOwner(e.target.value)} autoCapitalize="off" autoCorrect="off" />
          <input className="field" placeholder="私有仓库名（如 kaoyan-data）" value={repo} onChange={(e) => setRepo(e.target.value)} autoCapitalize="off" autoCorrect="off" />
          <input className="field" type="password" placeholder="Fine-grained Token（github_pat_…）" value={token} onChange={(e) => setToken(e.target.value)} autoCapitalize="off" autoCorrect="off" />
          <input className="field" placeholder="文件名" value={path} onChange={(e) => setPath(e.target.value)} autoCapitalize="off" autoCorrect="off" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <Button onClick={saveCfg} disabled={sync.status === 'syncing'}>
            {cfg ? '保存并同步' : '开启备份'}
          </Button>
          <Button variant="secondary" onClick={() => syncNow({ manual: true })} disabled={!cfg || sync.status === 'syncing'}>
            立即同步
          </Button>
        </div>
        {cfg && (
          <button
            className="mt-3 w-full text-center text-xs text-muted"
            onClick={() => {
              if (confirm('关闭后不再自动备份（GitHub 上已有的备份不会删除）。确定关闭？')) void setSyncConfig(null)
            }}
          >
            关闭自动备份
          </button>
        )}
        <button className="mt-3 w-full text-left text-sm font-medium text-accent" onClick={() => setShowHelp(!showHelp)}>
          {showHelp ? '收起' : '查看'}设置步骤
        </button>
        {showHelp && (
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-muted">
            <li>在 GitHub 新建一个 <b>Private</b> 仓库，比如 <code>kaoyan-data</code>（勾选 Add a README 即可）。</li>
            <li>
              打开 Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token。
            </li>
            <li>Repository access 选 <b>Only select repositories</b>，只选这个备份仓库。</li>
            <li>
              Permissions → Repository permissions → <b>Contents</b> 设为 <b>Read and write</b>，有效期建议选最长或 No
              expiration。
            </li>
            <li>把生成的 Token 粘贴到上面，点「开启备份」。Token 只保存在这台设备上。</li>
            <li>换新手机或数据丢失时：填入同样的信息点「开启备份」，会自动把 GitHub 上的记录恢复回来。</li>
          </ol>
        )}
      </div>

      <SectionTitle>数据</SectionTitle>
      <div className="card rows px-4">
        <Row label="学习记录" hint={usage ? `本地占用约 ${usage}` : undefined}>
          <span className="num text-muted">{count} 条</span>
        </Row>
        <Row label="持久化存储" hint="浏览器已承诺不自动清理本站数据">
          <span className="text-sm" style={{ color: persisted ? 'var(--accent)' : 'var(--muted)' }}>
            {persisted ? '已开启' : '未授予'}
          </span>
        </Row>
        <div className="grid grid-cols-2 gap-2.5 py-3">
          <Button variant="secondary" onClick={doExport}>
            导出备份
          </Button>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            导入备份
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImport(f)
              e.target.value = ''
            }}
          />
        </div>
      </div>
      <p className="mt-2 px-1 text-xs leading-relaxed text-faint">
        导入是合并而不是覆盖：已有的记录不会丢，同一条记录保留较新的版本。
      </p>

      <p className="mt-8 text-center text-xs text-faint">考研计时 v{__APP_VERSION__} · 数据仅保存在本机与你的 GitHub</p>
    </div>
  )
}
