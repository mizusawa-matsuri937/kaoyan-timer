import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconCloud, IconEye, IconEyeOff } from '../components/icons'
import { SkinPicker } from '../components/SkinPicker'
import { Button, SectionTitle, Sheet, Toggle } from '../components/ui'
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

const OVERTIME_OPTIONS = [2, 3, 4, 5, 6, 8] as const

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
  const [showToken, setShowToken] = useState(false)
  const [pastedToken, setPastedToken] = useState(false)
  const [confirmDisableSync, setConfirmDisableSync] = useState(false)

  const commitDate = async (key: 'examDate' | 'startDate', value: string) => {
    if (value && value !== settings[key]) await updateSettings({ [key]: value })
    setDateDraft((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage != null) setUsage(`${(e.usage / 1024).toFixed(0)} KB`)
    })
  }, [count])

  useEffect(() => {
    if (!pastedToken) return
    const timer = setTimeout(() => setPastedToken(false), 1800)
    return () => clearTimeout(timer)
  }, [pastedToken])

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

      {import.meta.env.DEV && import.meta.env.MODE !== 'test' && (
        <>
          <SectionTitle>测试沙盒（仅本地开发可见）</SectionTitle>
          <div className="card p-4 space-y-2.5">
            <p className="text-xs leading-relaxed text-muted">
              用于快速体验全部新增交互：灌入近 20 周学习历史、跨午夜与 12 分钟碎片段，并将今日预置为「差一步满 5h 晋级」挂起态。
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                onClick={async () => {
                  const { applyDevSeedData } = await import('../devSeed')
                  await applyDevSeedData()
                }}
              >
                重置全套测试数据
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  showToast('已保存上一段，开始新科目', 'success', {
                    action: { label: '撤销', onClick: () => showToast('已演示撤销回调', 'info') },
                  })
                  setTimeout(() => showToast('GitHub 自动备份已完成', 'success'), 160)
                  setTimeout(() => showToast('鼠标移入通知栈可扇形展开并暂停倒计时', 'info'), 320)
                }}
              >
                连发 3 条层叠 Toast
              </Button>
              <Button
                variant="secondary"
                onClick={async () => {
                  const { triggerDemoOvertime } = await import('../devSeed')
                  await triggerDemoOvertime()
                }}
              >
                唤出超时防误关弹窗
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const { clearAllDevData } = await import('../devSeed')
                  await clearAllDevData()
                }}
              >
                清空测试数据
              </Button>
            </div>
          </div>
        </>
      )}

      <SectionTitle>外观</SectionTitle>
      <SkinPicker />

      <SectionTitle>考研</SectionTitle>
      <div className="card rows px-4">
        <Row label="初试日期">
          <input
            type="date"
            className="field !w-auto !py-1.5 text-right"
            value={dateDraft.examDate ?? settings.examDate}
            onChange={(e) => setDateDraft((current) => ({ ...current, examDate: e.target.value }))}
            onBlur={(e) => commitDate('examDate', e.currentTarget.value)}
          />
        </Row>
        <Row label="备考开始日期" hint="热度表从这天开始">
          <input
            type="date"
            className="field !w-auto !py-1.5 text-right"
            value={dateDraft.startDate ?? settings.startDate}
            onChange={(e) => setDateDraft((current) => ({ ...current, startDate: e.target.value }))}
            onBlur={(e) => commitDate('startDate', e.currentTarget.value)}
          />
        </Row>
      </div>

      <SectionTitle>计时</SectionTitle>
      <div className="card rows px-4">
        <div className="py-3">
          <div className="text-[15px]">忘记结束提醒</div>
          <div className="text-xs text-muted">单段连续计时超过该时长，回来时询问</div>
          <div className="mt-2.5 grid grid-cols-6 gap-1.5" role="group" aria-label="忘记结束提醒小时数">
            {OVERTIME_OPTIONS.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={settings.overtimeHours === h}
                onClick={() => updateSettings({ overtimeHours: h })}
                className="hour-chip num"
              >
                {h}h
              </button>
            ))}
          </div>
        </div>
        {wakeLockSupported && (
          <Row label="计时时屏幕常亮">
            <Toggle label="计时时屏幕常亮" on={settings.keepAwake} onChange={(v) => updateSettings({ keepAwake: v })} />
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
          <input
            className="field"
            placeholder="GitHub 用户名"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <input
            className="field"
            placeholder="私有仓库名（如 kaoyan-data）"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
          />
          <div className="field-token-wrap">
            <input
              className="field !pr-20"
              type={showToken ? 'text' : 'password'}
              placeholder="Fine-grained Token（github_pat_…）"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onPaste={() => setPastedToken(true)}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <div className="field-token-actions">
              {pastedToken && <span className="token-pasted-badge">已粘贴</span>}
              <button
                type="button"
                className="field-eye"
                aria-label={showToken ? '隐藏 Token' : '显示 Token'}
                onClick={() => setShowToken((v) => !v)}
              >
                {showToken ? <IconEyeOff size={16} /> : <IconEye size={16} />}
              </button>
            </div>
          </div>
          <input
            className="field"
            placeholder="文件名"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
          />
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
            type="button"
            className="mt-3 w-full text-center text-xs text-muted hover:text-danger"
            onClick={() => setConfirmDisableSync(true)}
          >
            关闭自动备份
          </button>
        )}
        <button type="button" className="mt-3 w-full text-left text-sm font-medium text-accent" onClick={() => setShowHelp(!showHelp)}>
          {showHelp ? '收起' : '查看'}设置步骤
        </button>
        <div className="fold" data-open={showHelp ? '' : undefined}>
          <div className="fold-inner">
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-muted">
              <li>
                在 GitHub 新建一个 <b>Private</b> 仓库，比如 <code>kaoyan-data</code>（勾选 Add a README 即可）。
              </li>
              <li>
                打开 Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token。
              </li>
              <li>
                Repository access 选 <b>Only select repositories</b>，只选这个备份仓库。
              </li>
              <li>
                Permissions → Repository permissions → <b>Contents</b> 设为 <b>Read and write</b>，有效期建议选最长或 No
                expiration。
              </li>
              <li>把生成的 Token 粘贴到上面，点「开启备份」。Token 只保存在这台设备上。</li>
              <li>换新手机或数据丢失时：填入同样的信息点「开启备份」，会自动把 GitHub 上的记录恢复回来。</li>
            </ol>
          </div>
        </div>
      </div>

      <SectionTitle>数据</SectionTitle>
      <div className="card rows px-4">
        <Row label="学习记录" hint={usage ? `本地占用约 ${usage}` : undefined}>
          <span className="num text-muted">{count} 条</span>
        </Row>
        <Row label="持久化存储">
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

      <p className="mt-8 text-center text-xs text-faint">考研计时 v{__APP_VERSION__}</p>

      <Sheet open={confirmDisableSync} onClose={() => setConfirmDisableSync(false)} title="关闭自动备份？">
        <p className="mb-4 text-[15px] leading-relaxed text-muted">
          关闭后，本设备后续的学习记录将不再自动同步到 GitHub（仓库里已有的历史备份不会被删除）。确定关闭自动备份吗？
        </p>
        <div className="grid gap-2.5">
          <Button onClick={() => setConfirmDisableSync(false)}>继续保留备份</Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmDisableSync(false)
              void setSyncConfig(null)
              showToast('已关闭 GitHub 自动备份', 'info')
            }}
          >
            确认关闭
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
