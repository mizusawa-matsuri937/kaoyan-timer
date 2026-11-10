/** Config commits and network dispatch share this short, origin-wide critical section.
 * Never await a network response while holding it, or steal a suspended tab's lock.
 */
export class SyncCoordinationError extends Error {}

export async function withSyncConfigLock<T>(
  work: () => Promise<T>,
  options: { signal?: AbortSignal; disabling?: boolean } = {},
): Promise<T> {
  const locks = globalThis.navigator?.locks
  if (!locks) {
    // An unsupported browser cannot dispatch sync requests, but can always disable backup.
    if (options.disabling) return work()
    throw new SyncCoordinationError('此浏览器不支持安全的多窗口备份，请升级浏览器；本地计时和文件备份仍可使用')
  }
  const waiting = new AbortController()
  const abort = () => waiting.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  const timeout = setTimeout(() => waiting.abort(new Error('其他窗口正在处理备份，请稍后重试')), 10_000)
  try {
    return await locks.request('kaoyan-timer/sync-config-dispatch', { signal: waiting.signal }, async () => {
      clearTimeout(timeout) // only bound lock acquisition; never release an unfinished DB write
      return work()
    })
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abort)
  }
}
