import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Env, Usage, Window } from '../types'

// The account-wide figures /usage shows: every session's and device's spend, not
// only what this session's last response saw.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const POLL_MS = 120_000
// A fetch after a turn is skipped when the last one is younger than this.
const MIN_GAP_MS = 30_000
const STALE_MS = 10 * 60_000
const BAR_WIDTH = 20
const MIN_BAR = 4
const STORE_KEY = 'last'

// Fill thresholds shared by the three bars: blue below LOW_FROM (unused), green
// up to MEDIUM_FROM, yellow up to HIGH_FROM, red from there.
export const LOW_FROM = 1
export const MEDIUM_FROM = 50
export const HIGH_FROM = 80

const usage = atom({ plugin: 'usage-bars', key: 'usage' } as const, {} as Usage)
const env = atom({ plugin: 'usage-bars', key: 'env' } as const, {} as Env)

export const levelColor = (pct: number): 'blue' | 'green' | 'yellow' | 'red' => {
  if (pct < LOW_FROM) return 'blue'
  if (pct < MEDIUM_FROM) return 'green'
  if (pct < HIGH_FROM) return 'yellow'

  return 'red'
}

export type Layout = { barWidth: number; isCompact: boolean; hasExtras: boolean }

// Cells of row 1 besides the three bars: labels, percents, separators and the
// "(Nm fa)" suffix; "full" adds the token count and the reset times.
const FULL_OVERHEAD = 4 + 10 + 3 + 11 + 3 + 11 + 6 + 9
const SLIM_OVERHEAD = 4 + 5 + 3 + 5 + 3 + 5 + 6 + 9

/** Sizes row 1 to `columns`: 20-cell bars, then shrinking, then no extras, then percentages only. */
export const layoutFor = (columns: number): Layout => {
  const full = Math.floor((columns - FULL_OVERHEAD) / 3)
  if (full >= MIN_BAR) return { barWidth: Math.min(BAR_WIDTH, full), isCompact: false, hasExtras: true }
  const slim = Math.floor((columns - SLIM_OVERHEAD) / 3)
  if (slim >= MIN_BAR) return { barWidth: Math.min(BAR_WIDTH, slim), isCompact: false, hasExtras: false }

  return { barWidth: 0, isCompact: true, hasExtras: false }
}

/** `~`-relative under `home`, then at most the last two segments. */
export const shortDir = (cwd: string, home?: string): string => {
  const norm = (x: string) => x.replace(/\\/g, '/').replace(/\/+$/, '')
  const dir = norm(cwd)
  const h = home ? norm(home) : ''
  if (h !== '' && dir.toLowerCase() === h.toLowerCase()) return '~'
  const isUnderHome = h !== '' && dir.toLowerCase().startsWith(`${h.toLowerCase()}/`)
  const parts = (isUnderHome ? dir.slice(h.length + 1) : dir).split('/').filter(Boolean)
  const tail = parts.slice(-2).join('/')
  if (isUnderHome) return parts.length > 2 ? `~/…/${tail}` : `~/${tail}`

  return parts.length > 2 ? `…/${tail}` : dir
}

export type Item = { label: string; value: string; color: string }

/** Keeps the items that fit `columns`, in order; the folder's start is cut to fit what is left. */
export const fitRow = (items: Item[], columns: number): Item[] => {
  const out: Item[] = []
  let used = 0
  for (const item of items) {
    const sep = out.length > 0 ? 3 : 0
    const room = columns - used - sep - item.label.length - 1
    if (room >= item.value.length) {
      out.push(item)
      used += sep + item.label.length + 1 + item.value.length
    } else if (item.label === 'dir' && room >= 6) {
      out.push({ ...item, value: `…${item.value.slice(item.value.length - (room - 1))}` })
      used = columns
    }
  }

  return out
}

/** Row 2's items: kept by priority (model, folder, effort, thinking), shown folder first. */
export const envItems = (v: Env, columns: number): Item[] => {
  const items: Item[] = []
  if (v.model) items.push({ label: 'model', value: v.model, color: 'magenta' })
  if (v.cwd) items.push({ label: 'dir', value: shortDir(v.cwd, v.home), color: 'cyan' })
  if (v.effort) items.push({ label: 'effort', value: v.effort, color: 'yellow' })
  if (v.thinking) items.push({ label: 'thinking', value: v.thinking, color: v.thinking === 'off' ? 'gray' : 'green' })
  const order = ['dir', 'model', 'effort', 'thinking']

  return fitRow(items, columns).sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
}

export const bar = (pct: number, width = BAR_WIDTH): string => {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** HH:MM in the machine's own time zone, or in `timeZone` when given. */
export const hhmm = (iso?: string, timeZone?: string): string => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''

  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  })
}

const toWindow = (raw: unknown): Window | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const pct = r.utilization ?? r.used_percentage ?? r.percentUsed
  if (typeof pct !== 'number') return undefined
  const resetsAt = typeof r.resets_at === 'string' ? r.resets_at : undefined

  return { pct, resetsAt }
}

/** Reads the usage API's body: `{ five_hour: { utilization, resets_at }, seven_day: ... }`. */
export const parseApi = (text: string): Pick<Usage, 'fiveHour' | 'sevenDay'> | undefined => {
  try {
    const body = JSON.parse(text) as Record<string, unknown>
    const fiveHour = toWindow(body.five_hour)
    const sevenDay = toWindow(body.seven_day)

    return fiveHour || sevenDay ? { fiveHour, sevenDay } : undefined
  } catch {
    return undefined
  }
}

const fromSession = (limits: SessionRateLimit[]): Pick<Usage, 'fiveHour' | 'sevenDay'> => {
  const pick = (kind: string): Window | undefined => {
    const l = limits.find(x => x.kind === kind)

    return l && { pct: l.percentUsed, resetsAt: l.resetsAt }
  }

  return { fiveHour: pick('five_hour'), sevenDay: pick('seven_day') }
}

let lastFetch = 0
let isFetching = false
let poll: { cancel: () => void } | undefined

async function save($: EngineInterface, patch: Partial<Usage>) {
  const next = await update($, usage, u => ({ ...u, ...patch }))
  if (patch.fiveHour || patch.sevenDay) {
    const { fiveHour, sevenDay, limitsAt } = await read($, usage)
    await $.store.set(STORE_KEY, { fiveHour, sevenDay, limitsAt })
  }

  return next
}

async function refresh($: EngineInterface, force = false) {
  const now = await $.clock.now()
  if (isFetching || (!force && now - lastFetch < MIN_GAP_MS)) return
  isFetching = true
  lastFetch = now
  try {
    const auth = await $.session.authorize()
    if (!auth) return
    const res = await $.http.fetch(USAGE_URL, {
      auth: auth.handle,
      headers: { 'anthropic-beta': 'oauth-2025-04-20' },
    })
    const parsed = res.ok ? parseApi(res.text) : undefined
    if (parsed) await save($, { ...parsed, limitsAt: now, source: 'api' })
  } catch {
    // Offline or refused: the session's own readings stand.
  } finally {
    isFetching = false
  }
}

// The session's own figures: the context on every response, and the limits its
// last response carried, as fresh as the API's at that moment.
async function measure($: EngineInterface, limits: SessionRateLimit[], ctx: { percent?: number; tokens?: number }) {
  const patch: Partial<Usage> = { ctxPct: ctx.percent, ctxTokens: ctx.tokens }
  if (limits.length > 0) {
    Object.assign(patch, fromSession(limits), { limitsAt: await $.clock.now(), source: 'session' })
  }
  await save($, patch)
}

// Folder, model, effort and thinking: from the session, the /config rows and the
// merged settings. Written to state only when something changed.
async function readEnv($: EngineInterface) {
  const prev = await read($, env)
  const next: Env = { ...prev }
  try {
    next.cwd = await $.session.cwd()
    next.model = await $.session.model()
    next.home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
    const rows = await $.config.list()
    const settings = await $.settings.read()
    const row = (re: RegExp) => rows.find(r => re.test(r.key))?.value
    const effort = row(/effort/i) ?? settings.effortLevel
    next.effort = typeof effort === 'string' || typeof effort === 'number' ? String(effort) : undefined
    const thinking = row(/thinking/i) ?? settings.alwaysThinkingEnabled
    if (typeof thinking === 'boolean') next.thinking = thinking ? 'on' : 'off'
    else next.thinking = typeof thinking === 'string' && thinking !== '' ? thinking : undefined
  } catch {
    // Keep what was read so far.
  }
  if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, env, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Bars from the last reading any session stored, so they never start empty.
    const cached = (await $.store.get(STORE_KEY)) as Usage | undefined
    if (cached && !(await read($, usage)).limitsAt) {
      await update($, usage, u => ({ ...u, ...cached, source: 'cache' as const }))
    }
    await readEnv($)
    const { context, rateLimits } = await $.session.usage()
    await measure($, rateLimits, context)
    void refresh($, true)
    poll?.cancel()
    poll = $.clock.every(POLL_MS, () => void refresh($, true))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await readEnv($)

    return next(e)
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    await readEnv($).catch(() => undefined)

    return result
  })

  on('session.measure', async ($, e, next) => {
    await measure($, e.rateLimits, e.context)
    void refresh($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const u = await read($, usage)
    const v = await read($, env)
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const columns = Math.max(1, e.props.bodyColumns)
    const lay = layoutFor(columns)
    const isStale = !u.limitsAt || now - u.limitsAt > STALE_MS || u.source === 'cache'
    const age = u.limitsAt ? Math.round((now - u.limitsAt) / 60_000) : undefined

    const meter = (label: string, pct: number | undefined, extra: string) => {
      const color = pct === undefined ? 'gray' : levelColor(pct)
      const text = pct === undefined ? '--' : `${Math.round(pct)}%${extra}`

      return (
        <Text color={color} bold={!isStale && pct !== undefined} dimColor={isStale || pct === undefined}>
          {label} {lay.isCompact ? '' : `${bar(pct ?? 0, lay.barWidth)} `}
          {text}
        </Text>
      )
    }
    const reset = (w?: Window) => (lay.hasExtras && w?.resetsAt ? ` ${hhmm(w.resetsAt)}` : '')
    const tokens = u.ctxTokens !== undefined && lay.hasExtras ? ` ${Math.round(u.ctxTokens / 1000)}K` : ''
    const sep = <Text dimColor>{lay.isCompact ? ' · ' : ' | '}</Text>
    const row2 = envItems(v, columns)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {meter('ctx', u.ctxPct ?? 0, tokens)}
          {sep}
          {meter('5h', u.fiveHour?.pct, reset(u.fiveHour))}
          {sep}
          {meter('7d', u.sevenDay?.pct, reset(u.sevenDay))}
          {isStale && age !== undefined ? <Text dimColor> ({age}m fa)</Text> : null}
        </Box>
        {row2.length > 0 ? (
          <Box flexDirection="row">
            {row2.map((it, k) => (
              <Box key={it.label} flexDirection="row">
                {k > 0 ? <Text dimColor> | </Text> : null}
                <Text dimColor>{it.label} </Text>
                <Text color={it.color}>{it.value}</Text>
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    )
  })
}
