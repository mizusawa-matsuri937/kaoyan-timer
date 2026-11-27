import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { DownloadRingButton, PaperPlaneSyncButton, TokenStrengthInput } from './components/ActionFeedback'
import { HoldConfirmButton, SwipeConfirm } from './components/ConfirmControls'
import { NotchSlider } from './components/NotchSlider'
import { OdometerDigit, OdometerText } from './components/Odometer'
import { SkinLoader } from './components/SkinLoader'
import { TideOrb } from './components/TideOrb'
import {
  addDailyGoal,
  addGoalForDay,
  clearDailyGoals,
  getGoalsForDay,
  removeDailyGoal,
  removeGoalForDay,
  seedDailyGoals,
  seedGoalsByDay,
  toggleDailyGoal,
  toggleGoalForDay,
} from './dailyGoals'

describe('dailyGoals 按日期归档的微目标', () => {
  beforeEach(() => {
    clearDailyGoals()
  })

  it('支持添加、去重、最多 6 项、勾选与删除', () => {
    expect(addDailyGoal('  高数错题复盘  ')).toBe(true)
    expect(addDailyGoal('高数错题复盘')).toBe(false) // 重复拒绝
    expect(addDailyGoal('   ')).toBe(false) // 空白拒绝

    seedDailyGoals([
      { text: '目标 1', done: false },
      { text: '目标 2', done: true },
    ])
    expect(addDailyGoal('目标 3')).toBe(true)
    expect(addDailyGoal('目标 4')).toBe(true)
    expect(addDailyGoal('目标 5')).toBe(true)
    expect(addDailyGoal('目标 6')).toBe(true)
    expect(addDailyGoal('目标 7')).toBe(false) // 上限 6 项

    toggleDailyGoal('non-existent')
    removeDailyGoal('non-existent')
  })

  it('支持按历史日期独立存储、查询、勾选与删除，便于热度页回顾', () => {
    seedGoalsByDay({
      '2026-11-25': [
        { text: '数据结构大题', done: true },
        { text: '英语阅读 2 篇', done: false },
      ],
      '2026-11-26': [{ text: '高数错题', done: true }],
    })
    expect(getGoalsForDay('2026-11-25')).toHaveLength(2)
    expect(getGoalsForDay('2026-11-26')).toHaveLength(1)
    expect(getGoalsForDay('2026-11-20')).toHaveLength(0)

    expect(addGoalForDay('2026-11-25', '政治单选')).toBe(true)
    const target = getGoalsForDay('2026-11-25')[1]
    toggleGoalForDay('2026-11-25', target.id)
    expect(getGoalsForDay('2026-11-25')[1].done).toBe(true)

    removeGoalForDay('2026-11-25', target.id)
    expect(getGoalsForDay('2026-11-25')).toHaveLength(2)
  })
})

describe('UI Moments 组件 SSR 与无障碍契约', () => {
  it('OdometerDigit 与 OdometerText 首帧渲染稳定且终端皮肤直出纯等宽文字', () => {
    const single = renderToStaticMarkup(createElement(OdometerDigit, { ch: '7', skin: 'paper' }))
    expect(single).toContain('class="d">7</span>')

    const text = renderToStaticMarkup(createElement(OdometerText, { text: '148.6', value: 148.6, skin: 'brutal' }))
    const digits = [...text.matchAll(/class="d">(\d)</g)].map((m) => m[1]).join('')
    expect(digits).toBe('1486')
    expect(text).toContain('.')

    const termText = renderToStaticMarkup(createElement(OdometerText, { text: '25h 37m', value: 1, skin: 'terminal' }))
    expect(termText).toContain('25h 37m')
    expect(termText).not.toContain('d-strip')
  })

  it('TideOrb 在终端皮肤下自动使用 TUI 矩阵仪表而非液体画布', () => {
    // 默认皮肤是 terminal
    const html = renderToStaticMarkup(
      createElement(TideOrb, { tierPct: 51, todayMs: 5 * 3600000, level: 3, running: true }),
    )
    expect(html).toContain('term-gauge')
    expect(html).toContain('51%')
    expect(html).not.toContain('<canvas')
  })

  it('HoldConfirmButton 与 SwipeConfirm 渲染完整语义标签', () => {
    const hold = renderToStaticMarkup(
      createElement(HoldConfirmButton, { onClick: () => {}, variant: 'danger', children: '按住删除' }),
    )
    expect(hold).toContain('按住删除')
    expect(hold).toContain('hold-confirm-check')

    const swipe = renderToStaticMarkup(
      createElement(SwipeConfirm, { label: '滑动交卷', onConfirm: () => {} }),
    )
    expect(swipe).toContain('滑动交卷')
    expect(swipe).toContain('swipe-confirm-knob')
  })

  it('NotchSlider 渲染原生 range 与全部刻度标签', () => {
    const html = renderToStaticMarkup(
      createElement(NotchSlider<number>, {
        options: [2, 3, 4, 5, 6, 8],
        value: 4,
        onChange: () => {},
        formatLabel: (h) => `${h}h`,
        ariaLabel: '忘记结束提醒小时数',
      }),
    )
    expect(html).toContain('type="range"')
    expect(html).toContain('aria-valuetext="4h"')
    expect(html).toContain('8h')
  })

  it('ActionFeedback 与 SkinLoader 正常渲染', () => {
    const dl = renderToStaticMarkup(createElement(DownloadRingButton, { onDownload: () => {} }))
    expect(dl).toContain('导出备份')

    const plane = renderToStaticMarkup(
      createElement(PaperPlaneSyncButton, { label: '立即同步', syncStatus: 'idle', onClick: () => {} }),
    )
    expect(plane).toContain('立即同步')

    const tok = renderToStaticMarkup(
      createElement(TokenStrengthInput, {
        value: 'github_pat_1234567890abcdefghij',
        onChange: () => {},
        pasted: true,
        onPaste: () => {},
      }),
    )
    expect(tok).toContain('Token 格式完整')
    expect(tok).toContain('已粘贴')

    const loader = renderToStaticMarkup(createElement(SkinLoader, { label: '载入中' }))
    expect(loader).toContain('role="status"')
    expect(loader).toContain('载入中')
  })
})
