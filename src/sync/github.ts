import type { SyncConfig } from '../domain/types'

/** GitHub Contents API 的极简封装：读写私有仓库中的一个 JSON 文件 */

export class GitHubError extends Error {
  status: number
  /** 服务器要求的重试等待（Retry-After / 限流重置时间），毫秒 */
  retryAfterMs: number | null
  /** 是否是限流（403/429 且带限流信息） */
  rateLimited: boolean
  constructor(status: number, message: string, retryAfterMs: number | null = null, rateLimited = false) {
    super(message)
    this.status = status
    this.retryAfterMs = retryAfterMs
    this.rateLimited = rateLimited
  }
}

/** 单次请求（含读取响应体）的最长等待时间 */
export const GET_TIMEOUT_MS = 30_000
export const PUT_TIMEOUT_MS = 60_000

export interface RequestOptions {
  /** 外部取消信号（例如关闭备份） */
  signal?: AbortSignal
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

/** 解析 Retry-After（秒数或 HTTP 日期）以及 GitHub 的 x-ratelimit-reset */
function retryAfterFrom(res: Response): { ms: number | null; limited: boolean } {
  const h = res.headers
  const ra = h?.get?.('retry-after')
  if (ra) {
    const secs = Number(ra)
    if (Number.isFinite(secs)) return { ms: Math.max(0, secs * 1000), limited: true }
    const at = Date.parse(ra)
    if (Number.isFinite(at)) return { ms: Math.max(0, at - Date.now()), limited: true }
  }
  if (h?.get?.('x-ratelimit-remaining') === '0') {
    const reset = Number(h.get('x-ratelimit-reset'))
    return { ms: Number.isFinite(reset) ? Math.max(0, reset * 1000 - Date.now()) : null, limited: true }
  }
  return { ms: null, limited: res.status === 429 }
}

async function errorFrom(res: Response): Promise<GitHubError> {
  let msg = `${res.status}`
  try {
    const body = await res.json()
    if (body?.message) msg = `${res.status} ${body.message}`
  } catch {
    /* ignore */
  }
  const { ms, limited } = retryAfterFrom(res)
  if (res.status === 401) msg = 'Token 无效或已过期（401）'
  else if (res.status === 403) msg = limited ? `请求过于频繁，稍后自动重试（${msg}）` : `没有权限或请求过于频繁（${msg}）`
  else if (res.status === 404) msg = '找不到仓库，请检查用户名、仓库名和 Token 权限（404）'
  else if (res.status === 429) msg = `请求过于频繁，稍后自动重试（${msg}）`
  return new GitHubError(res.status, msg, ms, limited)
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('请求已取消', 'AbortError')
}

/**
 * 发起一次请求并读取响应体，整个过程受超时与外部取消约束。
 * 即使底层 fetch 不理会 AbortSignal，也会在超时/取消时立即结束。
 */
async function request<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  opts: RequestOptions | undefined,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  const outer = opts?.signal
  if (outer?.aborted) throw abortReason(outer)
  const ac = new AbortController()
  const onOuterAbort = () => ac.abort(abortReason(outer!))
  outer?.addEventListener('abort', onOuterAbort)
  const timer = setTimeout(() => ac.abort(new DOMException('网络请求超时', 'TimeoutError')), timeoutMs)
  let onAbort: (() => void) | undefined
  try {
    const work = (async () => read(await fetch(url, { ...init, signal: ac.signal })))()
    work.catch(() => {}) // 超时先结束时，避免底层 Promise 之后的拒绝变成未处理
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(abortReason(ac.signal))
      ac.signal.addEventListener('abort', onAbort)
    })
    return await Promise.race([work, aborted])
  } finally {
    clearTimeout(timer)
    if (onAbort) ac.signal.removeEventListener('abort', onAbort)
    outer?.removeEventListener('abort', onOuterAbort)
  }
}

export interface RemoteFile {
  sha: string
  text: string
}

type FirstRead =
  | { kind: 'missing' }
  | { kind: 'error'; error: GitHubError }
  | { kind: 'ok'; body: { sha: string; encoding?: string; content?: string } }

/** 读取文件；不存在返回 null */
export async function getFile(cfg: SyncConfig, opts?: RequestOptions): Promise<RemoteFile | null> {
  const first = await request<FirstRead>(apiUrl(cfg), { headers: headers(cfg), cache: 'no-store' }, GET_TIMEOUT_MS, opts, async (res) => {
    if (res.status === 404) return { kind: 'missing' }
    if (!res.ok) return { kind: 'error', error: await errorFrom(res) }
    return { kind: 'ok', body: await res.json() }
  })
  if (first.kind === 'error') throw first.error
  if (first.kind === 'missing') {
    // 区分"文件不存在"和"仓库不存在/无权限"
    const repoError = await request(
      `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`,
      { headers: headers(cfg), cache: 'no-store' },
      GET_TIMEOUT_MS,
      opts,
      async (res) => (res.ok ? null : await errorFrom(res)),
    )
    if (repoError) throw repoError
    return null
  }
  const body = first.body
  if (body.encoding === 'base64' && body.content) {
    return { sha: body.sha, text: base64ToUtf8(body.content) }
  }
  // 文件超过 1MB 时 Contents API 不返回内容，改用 raw 格式读取
  const text = await request(
    apiUrl(cfg),
    { headers: headers(cfg, 'application/vnd.github.raw+json'), cache: 'no-store' },
    GET_TIMEOUT_MS,
    opts,
    async (res) => {
      if (!res.ok) throw await errorFrom(res)
      return res.text()
    },
  )
  return { sha: body.sha, text }
}

/** 写入文件。sha 不匹配（被另一台设备抢先更新）时抛出 409/422 */
export async function putFile(
  cfg: SyncConfig,
  text: string,
  sha: string | null,
  message: string,
  opts?: RequestOptions,
): Promise<string> {
  return request(
    apiUrl(cfg),
    {
      method: 'PUT',
      headers: { ...headers(cfg), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: utf8ToBase64(text), ...(sha ? { sha } : {}) }),
    },
    PUT_TIMEOUT_MS,
    opts,
    async (res) => {
      if (!res.ok) throw await errorFrom(res)
      const body = await res.json()
      return body.content.sha as string
    },
  )
}

export function isConflict(e: unknown): boolean {
  return e instanceof GitHubError && (e.status === 409 || e.status === 422)
}

/** 用户/配置主动取消（不是网络故障） */
export function isAbort(e: unknown): boolean {
  return (e as { name?: string })?.name === 'AbortError'
}

/** 可以自动退避重试的暂时性故障：网络错误、超时、5xx、限流 */
export function isTransient(e: unknown): boolean {
  if (e instanceof GitHubError) {
    if (e.rateLimited) return true
    return e.status === 408 || e.status === 429 || (e.status >= 500 && e.status <= 599)
  }
  const name = (e as { name?: string })?.name
  return e instanceof TypeError || name === 'TimeoutError' || name === 'NetworkError'
}
