import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  HIGH_FROM,
  MEDIUM_FROM,
  bar,
  envItems,
  hhmm,
  layoutFor,
  levelColor,
  parseApi,
  shortDir,
} from '../hooks/register'
import type { Env } from '../types'

const NOW = Date.parse('2026-10-06T10:00:00Z')

test('bar fills proportionally and clamps', () => {
  expect(bar(50, 10)).toBe('\u2588'.repeat(5) + '\u2591'.repeat(5))
  expect(bar(140, 4)).toBe('\u2588'.repeat(4))
  expect(bar(-3, 4)).toBe('\u2591'.repeat(4))
})

test('parseApi reads the usage endpoint body', () => {
  const parsed = parseApi(
    JSON.stringify({
      five_hour: { utilization: 42.5, resets_at: '2026-10-06T14:00:00Z' },
      seven_day: { utilization: 13, resets_at: null },
      seven_day_opus: null,
    }),
  )
  expect(parsed?.fiveHour).toEqual({ pct: 42.5, resetsAt: '2026-10-06T14:00:00Z' })
  expect(parsed?.sevenDay).toEqual({ pct: 13, resetsAt: undefined })
  expect(parseApi('{}')).toBe(undefined)
  expect(parseApi('not json')).toBe(undefined)
})

test('hhmm prints the time in the given zone', () => {
  expect(hhmm('2026-10-06T14:00:00Z', 'Europe/Rome')).toBe('16:00')
  expect(hhmm(undefined)).toBe('')
})

test('levelColor: blue unused, green low, yellow medium, red high', () => {
  expect(levelColor(0)).toBe('blue')
  expect(levelColor(0.4)).toBe('blue')
  expect(levelColor(1)).toBe('green')
  expect(levelColor(MEDIUM_FROM - 1)).toBe('green')
  expect(levelColor(MEDIUM_FROM)).toBe('yellow')
  expect(levelColor(HIGH_FROM - 1)).toBe('yellow')
  expect(levelColor(HIGH_FROM)).toBe('red')
  expect(levelColor(100)).toBe('red')
})

test('layoutFor shrinks the bars, then drops extras, then bars', () => {
  expect(layoutFor(200)).toEqual({ barWidth: 20, isCompact: false, hasExtras: true })
  const mid = layoutFor(90)
  expect(mid.barWidth).toBeLessThan(20)
  expect(mid.barWidth).toBeGreaterThanOrEqual(4)
  expect(mid.hasExtras).toBe(true)
  expect(layoutFor(60).hasExtras).toBe(false)
  expect(layoutFor(60).barWidth).toBeGreaterThanOrEqual(4)
  expect(layoutFor(30)).toEqual({ barWidth: 0, isCompact: true, hasExtras: false })
})

test('shortDir and envItems', () => {
  const home = 'C:/Users/me'
  expect(shortDir(home, home)).toBe('~')
  expect(shortDir('C:/Users/me/a/b/c', home)).toBe('~/\u2026/b/c')
  expect(shortDir('C:/Users/me/a', home)).toBe('~/a')
  expect(shortDir('/srv/x/y/z')).toBe('\u2026/y/z')
  const all: Env = { cwd: '/srv/x/y/z', model: 'opus', effort: 'high', thinking: 'on' }
  expect(envItems(all, 200).map(i => i.label)).toEqual(['dir', 'model', 'effort', 'thinking'])
  expect(envItems(all, 24).length).toBeLessThan(4)
})

for (const surface of ['terminal', 'desktop'] as const) {
  // Seeds the state the way the engine does: through the events the hooks listen to.
  const seed = async ($: Engine, on: On) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.cwd', () => ({ value: '/srv/proj/app' }))
    on('session.model', () => ({ value: 'opus' }))
    on('config.list', () => ({ value: [] }))
    on('settings.read', () => ({ value: { effortLevel: 'high', alwaysThinkingEnabled: true } }))
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await $.turn.start({ text: '', turnId: 't1' })
    await $.session.measure({
      context: { window: 200000, tokens: 170000, percent: 85 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-06T14:00:00Z' },
        { kind: 'seven_day', percentUsed: 60, resetsAt: '2026-10-09T14:00:00Z' },
      ],
      changed: ['context', 'rateLimits'],
    })
  }
  const draw = async ($: Engine, columns: number) => {
    const band = await $.ui.mount({
      plugin: 'usage-bars',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: columns } as never,
    })

    return JSON.stringify(await band.drawn())
  }

  test(`the band draws placeholders before any reading (${surface})`, async ($, on) => {
    mock.clock(on, { now: NOW })
    const band = await $.ui.mount({
      plugin: 'usage-bars',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never,
    })
    const text = JSON.stringify(await band.drawn())
    expect(text.includes('--')).toBe(true)
  })

  test(`colors follow the fill and the layout follows the width (${surface})`, async ($, on) => {
    await seed($, on)
    const wide = await draw($, 160)
    expect(wide.includes('"red"')).toBe(true)
    expect(wide.includes('"green"')).toBe(true)
    expect(wide.includes('"yellow"')).toBe(true)
    expect(wide.includes('█'.repeat(17) + '░'.repeat(3))).toBe(true)
    expect(wide.includes('\u2591')).toBe(true)
    expect(wide.includes('proj/app')).toBe(true)
    expect(wide.includes('opus')).toBe(true)
    const narrow = await draw($, 30)
    expect(narrow.includes('\u2588')).toBe(false)
    expect(narrow.includes('85%')).toBe(true)
    expect(narrow.includes('30%')).toBe(true)
  })
}
