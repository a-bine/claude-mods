import { expect, test } from 'claude-code/testing'

import { joinBlocks, nthLastReply, replies, replyContaining } from '../hooks/reply'
import type { Row } from '../hooks/reply'

const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |'

const ROWS: Row[] = [
  { role: 'user', text: 'first question' },
  { role: 'assistant', text: 'Old answer' },
  { role: 'user', text: 'show me a table' },
  { role: 'assistant', text: `Here it is:\n\n${TABLE}` },
  { role: 'user', text: '', toolResults: [{}] },
  { role: 'assistant', text: 'And after the tool call, **bold** done.' },
]

test('joinBlocks keeps markdown verbatim and separates with blank lines', () => {
  expect(joinBlocks(['a', '', '  ', TABLE])).toBe(`a\n\n${TABLE}`)
})

test('replies are split on real user turns, not tool results', () => {
  expect(replies(ROWS).length).toBe(2)
})

test('replyContaining rebuilds the whole reply from any of its blocks', () => {
  const whole = `Here it is:\n\n${TABLE}\n\nAnd after the tool call, **bold** done.`
  expect(replyContaining(ROWS, `Here it is:\n\n${TABLE}`)).toBe(whole)
  expect(replyContaining(ROWS, 'And after the tool call, **bold** done.')).toBe(whole)
  expect(replyContaining(ROWS, 'Old answer')).toBe('Old answer')
})

test('replyContaining falls back to the block itself', () => {
  expect(replyContaining(ROWS, 'still streaming')).toBe('still streaming')
})

test('nthLastReply', () => {
  expect(nthLastReply(ROWS, 2)).toBe('Old answer')
  expect(nthLastReply(ROWS, 3)).toBeUndefined()
  expect(nthLastReply(ROWS, 0)).toBeUndefined()
})

test('the copy control copies the whole reply as markdown on every surface', async ($, on) => {
  const copies: string[] = []
  on('session.messages', () => ({ value: ROWS.map(r => ({ toolUses: [], ...r })) as never }))
  on('ui.copy', (_$, e) => {
    copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return Text({ children: 'engine drawing' }) as never
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'copy-markdown',
      surface,
      component: 'AssistantMessage',
      props: { text: `Here it is:\n\n${TABLE}`, isFirstOfReply: true },
    })
    await ui.press({ key: 'copy-md-button' })
    await ui.unmount()
  }
  const whole = `Here it is:\n\n${TABLE}\n\nAnd after the tool call, **bold** done.`
  expect(copies).toEqual([whole, whole])
})

test('only the first block of a reply gets a control', async ($, on) => {
  on('ui.render', ($$, e) => {
    const { Text } = $$.ui.resolve(e)
    return Text({ children: 'engine drawing' }) as never
  })
  const ui = await $.ui.mount({
    plugin: 'copy-markdown',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text: 'later block', isFirstOfReply: false },
  })
  expect(await ui.find({ key: 'copy-md-button' })).toBeUndefined()
  await ui.unmount()
})
