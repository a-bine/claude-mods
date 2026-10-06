# claude-mods

Mods for [Claude Code](https://claude.com/claude-code): plugins of function hooks that change the terminal UI.

## usage-bars

Two rows above the prompt:

- **Row 1:** bars for the context window, the 5-hour limit and the 7-day limit, with the reset times. Each bar is colored by fill: blue when it is unused, green below 50%, yellow below 80%, red from 80% up.
- **Row 2:** the current folder, the model, the effort level and thinking.

The limits are read every 2 minutes, and after each turn, from the account's usage endpoint (the figures `/usage` shows). They count every session and device, not only this session's last response. If that call fails, the bars fall back to the session's own readings. The last reading is cached, so the bars are never empty at startup. A reading older than 10 minutes is drawn dim, with its age.

The layout follows the terminal's width. On a wide window the bars are 20 cells, with reset times and token count. Narrower, the bars shrink and the extras go. On a very narrow one only the percentages are left.

## copy-markdown

A small `⧉ md` button on each reply copies the **whole reply as its original markdown** to the clipboard: tables, code blocks, diffs and mermaid come through intact. It works on replies split by tool calls too. `/copy-md [n]` copies the n-th last reply from the keyboard.

Clicking needs mouse support, which you get with the fullscreen TUI (`"tui": "fullscreen"`). Without it, use `/copy-md`.

## Install

At a Claude Code prompt:

```
/plugin install usage-bars --marketplace a-bine/claude-mods
/plugin install copy-markdown --marketplace a-bine/claude-mods
```

Answer `y` to add the marketplace, then pick a scope.

`usage-bars` replaces a `statusLine` you may have in `settings.json`. Remove that setting so the figures are not shown twice.

## Develop

```
claude plugin validate <mod>
claude plugin test <mod>
claude --plugin-dir ./<mod>   # run a working copy
```

## Notes

- The usage endpoint (`api.anthropic.com/api/oauth/usage`) is not a documented API and may change. If it does, the bars keep working on the session's own readings. The request goes through `$.session.authorize()`, so the mod never sees the credential.
- These mods use the Claude Code mod API, which may change between releases. They were written against 2.1.291.

## License

MIT
