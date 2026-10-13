# Pi extensions

This file documents the extensions tracked by the dotfiles repo for `~/.pi/agent/extensions/`. Pi auto-discovers TypeScript extensions in that directory.

## Repo-managed extensions

| File | Capability |
| --- | --- |
| `web-tools.ts` | Registers `websearch` and `webfetch`. Search uses Exa by default or Parallel; fetch accepts HTTP(S), bounds output, and converts HTML to readable text. |
| `browser.ts` | Registers `browser` and delegates page interaction to the `agent-browser` CLI. |
| `ci-watcher.ts` | `/watch [branch-or-pr] [interval-seconds]` and `/unwatch` poll the latest GitHub Actions run using `gh`. |
| `git-interceptor.ts` | Blocks `git --no-verify` and sets non-interactive Git editor environment variables. |
| `herdr-agent-state.ts` | Reports Pi session state to Herdr; Herdr installs and may overwrite this file. |
| `save-md/save-md.ts` | `/save-md <name>` saves the latest assistant text response as a new Markdown file in the current working directory. |
| `startup-header.ts` | Shows Pi version, model, working directory, context files, MCP servers, tools, and extensions in the TUI header. |
| `status-line.ts` | Shows context, usage, cost, Git branch, model, and extension status in the footer; toggle with `/status-line`. |
| `whimiscal.ts` | Supplies custom working messages. |

The live `~/.pi/agent/extensions/` directory may also contain runtime-installed modules that are not tracked here. Check the actual directory before assuming those features or commands are available on another machine.

## Environment configuration

- Web search defaults to Exa. Set `OPENCODE_WEBSEARCH_PROVIDER=exa|parallel` to choose explicitly; `OPENCODE_ENABLE_PARALLEL` or `OPENCODE_EXPERIMENTAL_PARALLEL` also selects Parallel.
- `EXA_API_KEY` and `PARALLEL_API_KEY` are optional provider credentials.
- `PI_BROWSER_SESSION` selects an `agent-browser` session. `PI_BROWSER_ALLOWED_DOMAINS` is an optional comma-separated host allowlist; an empty value does not restrict hosts in this extension.
- `PI_CI_WATCH_INTERVAL` sets the default CI poll interval in seconds (default 60; minimum 15).
- `PI_STATUS_LINE=off` disables the enhanced footer; it is enabled by default.
- Herdr supplies `HERDR_ENV`, `HERDR_SOCKET_PATH`, and `HERDR_PANE_ID` for its integration. Do not set these manually for normal use.

Keep API keys and other credentials in the environment or an approved credential store; never put literal secrets in this README, tests, or source.
