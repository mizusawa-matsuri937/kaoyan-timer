import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SkinId } from '../skin'
import { TimerDisplay } from './TimerDisplay'

const MIN = 60000
const EXAM = 180 * MIN

function render(props: { ms: number; active: boolean; skin: SkinId; examMs?: number }) {
  const html = renderToStaticMarkup(createElement(TimerDisplay, props))
  const digits = [...html.matchAll(/class="d(?:-sep)?">(.)</g)].map((m) => m[1]).join('')
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const lit = (html.match(/data-on=""/g) ?? []).length
  return { html, digits, text, lit }
}

describe('TimerDisplay 普通科目', () => {
  it('正计时，一行 = 1 小时', () => {
    const r = render({ ms: 90 * MIN, active: true, skin: 'terminal' })
    expect(r.digits).toBe('01:30:00')
    expect(r.text).toContain('第 2 小时 · 50%')
    expect(r.text).toContain('每格 2 分钟')
    expect(r.lit).toBe(15)
  })
})

describe('TimerDisplay 模拟测试倒计时', () => {
  for (const skin of ['terminal', 'brutal', 'paper'] as const) {
    it(`${skin}：未开始时显示整场时长`, () => {
      const r = render({ ms: 0, active: false, skin, examMs: EXAM })
      expect(r.digits).toBe('03:00:00')
      expect(r.text).toContain('180 分钟')
    })

    it(`${skin}：进行中显示剩余时间，向上取整到秒`, () => {
      expect(render({ ms: 0, active: true, skin, examMs: EXAM }).digits).toBe('03:00:00')
      expect(render({ ms: 400, active: true, skin, examMs: EXAM }).digits).toBe('03:00:00')
      expect(render({ ms: 1000, active: true, skin, examMs: EXAM }).digits).toBe('02:59:59')
      const r = render({ ms: 45 * MIN, active: true, skin, examMs: EXAM })
      expect(r.digits).toBe('02:15:00')
      expect(r.text).toContain('已用 00:45:00')
    })

    it(`${skin}：到点后显示超出的时长`, () => {
      expect(render({ ms: EXAM, active: true, skin, examMs: EXAM }).digits).toBe('00:00:00')
      const r = render({ ms: EXAM + 5 * MIN + 7000, active: true, skin, examMs: EXAM })
      expect(r.digits).toBe('00:05:07')
      expect(r.text).toContain('已超时 00:05:07')
    })
  }

  it('终端皮肤：一行 30 格代表整场考试，超时后全满', () => {
    const half = render({ ms: 90 * MIN, active: true, skin: 'terminal', examMs: EXAM })
    expect(half.lit).toBe(15)
    expect(half.text).toContain('每格 6 分钟')
    expect(half.text).toContain('50%')
    expect(render({ ms: EXAM + MIN, active: true, skin: 'terminal', examMs: EXAM }).lit).toBe(30)
  })

  it('圆环皮肤：一圈代表整场考试，不出现「第 N 小时」的套圈', () => {
    const r = render({ ms: 150 * MIN, active: true, skin: 'paper', examMs: EXAM })
    expect(r.html).not.toContain('dial-lap')
    expect(r.text).not.toContain('小时')
  })
})
