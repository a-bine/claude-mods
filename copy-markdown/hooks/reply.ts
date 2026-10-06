// Pure helpers: no `$`, so they are unit-testable.

export type Row = {
  role: 'user' | 'assistant'
  text: string
  toolResults?: readonly unknown[]
}

/** A user row that starts a new turn: real text, not a tool result. */
function isTurnStart(row: Row): boolean {
  return row.role === 'user' && !(row.toolResults && row.toolResults.length > 0) && row.text.trim() !== ''
}

/** Join text blocks with blank lines; markdown (tables included) is kept verbatim. */
export function joinBlocks(blocks: readonly string[]): string {
  return blocks.filter(b => b.trim() !== '').join('\n\n')
}

/** Replies in order, each the list of its non-empty assistant texts. */
export function replies(rows: readonly Row[]): string[][] {
  const out: string[][] = []
  let current: string[] | null = null
  for (const row of rows) {
    if (isTurnStart(row)) {
      current = null
    } else if (row.role === 'assistant') {
      if (current === null) {
        current = []
        out.push(current)
      }
      if (row.text.trim() !== '') current.push(row.text)
    }
  }
  return out.filter(r => r.length > 0)
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function contains(haystack: string, needle: string): boolean {
  const n = norm(needle)
  if (n === '') return false
  const h = norm(haystack)
  return h.includes(n) || h.includes(n.slice(0, 80))
}

/**
 * The whole reply a block belongs to, as markdown. The newest reply whose first
 * text row holds the block wins, then the newest holding it anywhere; when none
 * does (a reply still streaming) the block's own text is returned.
 */
export function replyContaining(rows: readonly Row[], blockText: string): string {
  const all = replies(rows)
  for (let i = all.length - 1; i >= 0; i--) {
    const r = all[i]
    if (r && r[0] !== undefined && contains(r[0], blockText)) return joinBlocks(r)
  }
  for (let i = all.length - 1; i >= 0; i--) {
    const r = all[i]
    if (r && r.some(t => contains(t, blockText))) return joinBlocks(r)
  }
  return blockText
}

/** The n-th last reply (1 = newest) as markdown, or undefined. */
export function nthLastReply(rows: readonly Row[], n: number): string | undefined {
  const all = replies(rows)
  const r = all[all.length - n]
  return n >= 1 && r ? joinBlocks(r) : undefined
}
