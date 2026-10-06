import type { EngineInterface, Register, RenderSurface, UiPressArgument } from 'claude-code'

import { nthLastReply, replyContaining } from './reply'
import type { Row } from './reply'

async function readRows($: EngineInterface): Promise<Row[]> {
  const rows = await $.session.messages()
  return 'deny' in rows ? [] : (rows as Row[])
}

async function copyMarkdown($: EngineInterface, markdown: string, surface: RenderSurface | undefined): Promise<void> {
  const result = await $.ui.copy({ text: markdown, surface })
  if (result.isCopied) {
    $.ui.toast(`Copied reply as markdown (${markdown.length} chars)`)
  } else {
    $.ui.toast(`Copy failed: ${result.reason}`)
  }
}

async function copyWholeReply($: EngineInterface, blockText: string, surface: RenderSurface | undefined): Promise<void> {
  const rows = await readRows($)
  await copyMarkdown($, replyContaining(rows, blockText), surface)
}

async function drawAssistant($: EngineInterface, e: any, next: any): Promise<any> {
  if (!e.props.isFirstOfReply || e.props.isSummary || e.props.text.trim() === '') return next(e)
  const drawn = await next(e)
  const { Box, Text, Button } = $.ui.resolve(e)
  const blockText: string = e.props.text
  const surface: RenderSurface = e.surface
  return (
    <Box key="copy-md" flexDirection="column">
      {drawn}
      {/* Always drawn, dim: a hidden Box can never be hovered, so a reveal-only
          control in a scope of its own would never show. It brightens while the
          pointer is over the reply. */}
      <Box position="absolute" top={0} right={0}>
        <Button
          key="copy-md-button"
          plain
          label="⧉ md"
          dimColor
          hover={{ dimColor: false, color: 'cyan' }}
          onPress={(press: UiPressArgument) => copyWholeReply($, blockText, press.surface ?? surface)}
        />
      </Box>
    </Box>
  )
}

async function runCopyCommand($: EngineInterface, e: any): Promise<{ text: string }> {
  const arg = String(e.args ?? '').trim()
  const n = arg === '' ? 1 : Number.parseInt(arg, 10)
  if (!Number.isInteger(n) || n < 1) return { text: 'Usage: /copy-md [n]  (n-th last reply, default 1)' }
  const markdown = nthLastReply(await readRows($), n)
  if (markdown === undefined) return { text: `No reply number ${n} found.` }
  const [surface] = await $.session.surfaces()
  const result = await $.ui.copy({ text: markdown, surface })
  return { text: result.isCopied ? `Copied reply ${n} as markdown (${markdown.length} chars).` : `Copy failed: ${result.reason}` }
}

async function registerCommand($: EngineInterface, e: any, next: any): Promise<any> {
  await $.command.register({ name: 'copy-md', description: 'Copy the n-th last reply as markdown', argumentHint: '[n]' })
  return next(e)
}

export const register: Register = on => {
  on('session.start', registerCommand)
  on('command.run', { command: 'copy-md' }, runCopyCommand)
  on('ui.render', { component: 'AssistantMessage' }, drawAssistant)
}
