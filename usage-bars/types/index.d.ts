export type Window = { pct: number; resetsAt?: string }

export type Usage = {
  /** Context fill of the last response, 0-100; absent before the first one. */
  ctxPct?: number
  /** Input tokens of the last response. */
  ctxTokens?: number
  fiveHour?: Window
  sevenDay?: Window
  /** When the rate-limit figures were read, ms since the epoch. */
  limitsAt?: number
  /** Where they came from: the usage API, this session's last response, or the store of an earlier one. */
  source?: 'api' | 'session' | 'cache'
}

/** What row 2 shows: where the session runs and how the model is set. */
export type Env = {
  cwd?: string
  /** The user's home directory, to print the folder `~`-relative. */
  home?: string
  model?: string
  effort?: string
  /** `on`, `off`, or whatever the config row holds. */
  thinking?: string
}

declare module 'claude-code' {
  interface PluginState {
    'usage-bars': { usage: Usage; env: Env }
  }
}
