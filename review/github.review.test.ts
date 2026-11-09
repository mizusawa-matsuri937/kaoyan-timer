import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFile, GitHubError, isConflict, putFile } from '../src/sync/github'
import { config, deferred, MIN } from './fixtures'

const fetchMock = vi.fn<typeof fetch>()
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})
const fileResponse = (text: string, sha = 'test-sha') => json({
  sha, encoding: 'base64', content: Buffer.from(text).toString('base64'),
})

beforeEach(() => {
  fetchMock.mockReset().mockRejectedValue(new Error('Unexpected mocked network request'))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('GitHub transport (all HTTP calls mocked)', () => {
  it('decodes UTF-8 Chinese/emoji and wrapped base64', async () => {
    const text = '{"note":"数学 📚 / 考研"}'
    fetchMock.mockResolvedValue(json({ sha: 'sha-a', encoding: 'base64',
      content: Buffer.from(text).toString('base64').replace(/.{8}/g, '$&\n') }))
    expect(await getFile(config)).toEqual({ sha: 'sha-a', text })
  })

  it('treats a missing file in an accessible repository as a new backup', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'Not Found' }, 404))
      .mockResolvedValueOnce(json({ id: 123 }))
    expect(await getFile(config)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not treat an inaccessible repository as an empty backup', async () => {
    fetchMock.mockResolvedValue(json({ message: 'Not Found' }, 404))
    await expect(getFile(config)).rejects.toMatchObject({ status: 404 })
  })

  it.each([401, 403, 429, 500, 502, 503])('propagates HTTP %i without silently replacing data', async (status) => {
    fetchMock.mockResolvedValue(json({ message: 'simulated failure' }, status))
    await expect(getFile(config)).rejects.toMatchObject({ status })
  })

  it('handles a non-JSON server error', async () => {
    fetchMock.mockResolvedValue(new Response('Bad gateway', { status: 502 }))
    await expect(getFile(config)).rejects.toMatchObject({ status: 502 })
  })

  it('reads raw content after a metadata response with encoding=none', async () => {
    fetchMock.mockResolvedValueOnce(json({ sha: 'sha-large', encoding: 'none', content: '' }))
      .mockResolvedValueOnce(new Response('{"large":true}'))
    expect(await getFile(config)).toEqual({ sha: 'sha-large', text: '{"large":true}' })
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Accept: 'application/vnd.github.raw+json' })
  })

  it('uploads and round-trips a 3 MB UTF-8 payload without argument-stack overflow', async () => {
    const text = '考研📚'.repeat(300_000)
    fetchMock.mockResolvedValue(json({ content: { sha: 'sha-written' } }))
    expect(await putFile(config, text, 'sha-before', 'test')).toBe('sha-written')
    const request = fetchMock.mock.calls[0][1]!
    const body = JSON.parse(request.body as string)
    expect(Buffer.from(body.content, 'base64').toString('utf8')).toBe(text)
    expect(body.sha).toBe('sha-before')
  })

  it('omits sha when creating a file', async () => {
    fetchMock.mockResolvedValue(json({ content: { sha: 'created' } }))
    await putFile(config, '{}', null, 'test')
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).not.toHaveProperty('sha')
  })

  it('escapes repository and path components', async () => {
    fetchMock.mockResolvedValue(fileResponse('{}'))
    await getFile({ ...config, owner: 'a/b', repo: 'r#x', path: '备份/a b.json' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/a%2Fb/r%23x/contents/%E5%A4%87%E4%BB%BD/a%20b.json')
  })

  it('classifies conflict responses separately from permission errors', () => {
    expect(isConflict(new GitHubError(409, 'Conflict'))).toBe(true)
    expect(isConflict(new GitHubError(422, 'Validation'))).toBe(true)
    expect(isConflict(new GitHubError(401, 'Unauthorized'))).toBe(false)
    expect(isConflict(new TypeError('network'))).toBe(false)
  })

  it('[R4] a stalled fetch must settle or abort within a 15-minute safety budget', async () => {
    vi.useFakeTimers()
    const gate = deferred<Response>()
    // Honour an AbortSignal if production code provides one.
    fetchMock.mockImplementation((_url, opts) => {
      opts?.signal?.addEventListener('abort', () => gate.reject(new DOMException('Timed out', 'AbortError')))
      return gate.promise
    })
    let settled = false
    const task = getFile(config).then(() => { settled = true }, () => { settled = true })
    await vi.advanceTimersByTimeAsync(15 * MIN)
    const settledWithinBudget = settled
    gate.resolve(fileResponse('{}'))
    await task
    expect(settledWithinBudget).toBe(true)
  })
})
