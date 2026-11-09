import type { SyncConfig } from '../domain/types'

/** GitHub Contents API 的极简封装：读写私有仓库中的一个 JSON 文件 */

export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function apiUrl(cfg: SyncConfig): string {
  const path = cfg.path.split('/').map(encodeURIComponent).join('/')
  return `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`
}

function headers(cfg: SyncConfig, accept = 'application/vnd.github+json'): HeadersInit {
  return {
    Accept: accept,
    Authorization: `Bearer ${cfg.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function errorFrom(res: Response): Promise<GitHubError> {
  let msg = `${res.status}`
  try {
    const body = await res.json()
    if (body?.message) msg = `${res.status} ${body.message}`
  } catch {
    /* ignore */
  }
  if (res.status === 401) msg = 'Token 无效或已过期（401）'
  else if (res.status === 403) msg = `没有权限或请求过于频繁（${msg}）`
  else if (res.status === 404) msg = '找不到仓库，请检查用户名、仓库名和 Token 权限（404）'
  return new GitHubError(res.status, msg)
}

export interface RemoteFile {
  sha: string
  text: string
}

/** 读取文件；不存在返回 null */
export async function getFile(cfg: SyncConfig): Promise<RemoteFile | null> {
  const res = await fetch(apiUrl(cfg), { headers: headers(cfg), cache: 'no-store' })
  if (res.status === 404) {
    // 区分"文件不存在"和"仓库不存在/无权限"
    const repoRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`,
      { headers: headers(cfg), cache: 'no-store' },
    )
    if (repoRes.ok) return null
    throw await errorFrom(repoRes)
  }
  if (!res.ok) throw await errorFrom(res)
  const body = await res.json()
  if (body.encoding === 'base64' && body.content) {
    return { sha: body.sha, text: base64ToUtf8(body.content) }
  }
  // 文件超过 1MB 时 Contents API 不返回内容，改用 raw 格式读取
  const raw = await fetch(apiUrl(cfg), { headers: headers(cfg, 'application/vnd.github.raw+json'), cache: 'no-store' })
  if (!raw.ok) throw await errorFrom(raw)
  return { sha: body.sha, text: await raw.text() }
}

/** 写入文件。sha 不匹配（被另一台设备抢先更新）时抛出 409/422 */
export async function putFile(cfg: SyncConfig, text: string, sha: string | null, message: string): Promise<string> {
  const res = await fetch(apiUrl(cfg), {
    method: 'PUT',
    headers: { ...headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: utf8ToBase64(text), ...(sha ? { sha } : {}) }),
  })
  if (!res.ok) throw await errorFrom(res)
  const body = await res.json()
  return body.content.sha as string
}

export function isConflict(e: unknown): boolean {
  return e instanceof GitHubError && (e.status === 409 || e.status === 422)
}
