# Pi extensions

This file documents the extensions tracked by the dotfiles repo for `~/.pi/agent/extensions/`. Pi auto-discovers TypeScript extensions in that directory.

## Repo-managed extensions

| File | Capability |
| --- | --- |
| `web-tools.ts` | Registers `websearch` and `webfetch`. Search uses Exa by default or Parallel; fetch accepts HTTP(S), bounds output, and converts HTML to readable text. |
| `browser.ts` | Registers `browser` and delegates page interaction to the `agent-browser` CLI. |
| `continue-after-compaction.ts` | After every successful compaction, steers a continuation prompt that re-reads the session JSONL and resumes the unfinished task. |
| `git-interceptor.ts` | Blocks `git --no-verify` and sets non-interactive Git editor environment variables. |
| `herdr-agent-state.ts` | Reports Pi session state to Herdr; Herdr installs and may overwrite this file. |
| `pi-skill-toggle/src/index.ts` | `/toggle-skills` opens an overlay that writes `disable-model-invocation` into skill frontmatter, hiding a skill from automatic model selection without deleting it. |
| `save-md/save-md.ts` | `/save-md <name>` saves the latest assistant text response as a new Markdown file in the current working directory. |
| `startup-header.ts` | Shows Pi version, model, working directory, context files, MCP servers, tools, and extensions in the TUI header. |
| `status-line.ts` | Shows context, usage, cost, Git branch, model, and extension status in the footer; toggle with `/status-line`. |
| `whimiscal.ts` | Supplies custom working messages. |
| `worker-configuration-guard.ts` | Blocks agent writes, edits, and shell mutations of Wrangler's generated `worker-configuration.d.ts`; the fix is `wrangler types`. |

## Package extensions

`save-md/` and `pi-skill-toggle/` are npm-workspace packages, each with its own `package.json`, `tsconfig.json`, and `README.md`. A package whose entry point is not `<dir>/index.ts` declares it under the `pi.extensions` key. Package dependencies are declared per package; the root `package.json` only carries the shared Pi SDK dependencies.

The live `~/.pi/agent/extensions/` directory may also contain runtime-installed modules that are not tracked here. Check the actual directory before assuming those features or commands are available on another machine.

## Environment configuration

- Web search defaults to Exa. Set `OPENCODE_WEBSEARCH_PROVIDER=exa|parallel` to choose explicitly; `OPENCODE_ENABLE_PARALLEL` or `OPENCODE_EXPERIMENTAL_PARALLEL` also selects Parallel.
- `EXA_API_KEY` and `PARALLEL_API_KEY` are optional provider credentials.
- `PI_BROWSER_SESSION` selects an `agent-browser` session. `PI_BROWSER_ALLOWED_DOMAINS` is an optional comma-separated host allowlist; an empty value does not restrict hosts in this extension.
- `PI_STATUS_LINE=off` disables the enhanced footer; it is enabled by default.
- `PI_CODING_AGENT_DIR` overrides the `user` skill root that `pi-skill-toggle` scans; it defaults to `~/.pi/agent`.
- Herdr supplies `HERDR_ENV`, `HERDR_SOCKET_PATH`, and `HERDR_PANE_ID` for its integration. Do not set these manually for normal use.

Keep API keys and other credentials in the environment or an approved credential store; never put literal secrets in this README, tests, or source.
