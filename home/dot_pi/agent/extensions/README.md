# Pi extensions

These extensions are auto-discovered from `~/.pi/agent/extensions/`.

## Features

| Extension | Capability |
| --- | --- |
| `web.ts` | Web search (Exa/Parallel) + bounded URL fetching in one extension |
| `browser.ts` | `agent-browser` navigation and interaction |
| `pi-workflow.ts` | Project Git/checkpoint/handoff/status workflow (`/project`, `/checkpoint`, `/restore`, `/handoff`, `/stats`) |
| `protected-paths.ts` | Blocks protected-path writes and confirms destructive commands |
| `git-interceptor.ts` | Blocks `git --no-verify` and prefixes Git editor env |
| `test-runner.ts` | Detected repository tests through `run_tests` and `/test` |
| `github.ts` | Read-only GitHub issue, PR, and CI inspection through `gh` |
| `dynamic-tools.ts` | Lazy tool activation through `search_tools` and `/tools` |
| `local-provider.ts` | Dynamic local OpenAI-compatible provider/model discovery |
| `provider-fallback.ts` | Manual model fallback and provider error notifications |
| `status-line.ts` | Enhanced context, token, cost, model, branch, and extension status footer |
| `action-notifications.ts` | Detects LLM responses that require a user action and sends terminal/UI/Hark notifications; provides iPhone questions |
| `cheap-compaction.ts` | Routes auto-compaction summaries to a cheap model (`PI_COMPACTION_MODEL`, default `opencode-go/ox-alpha-free`) instead of the active conversation model |
| `context-pruner.ts` | Replaces oversized old tool results with one-line placeholders before each LLM call; keeps the last `PI_PRUNER_KEEP_TURNS` user turns intact |
| `user-bash-guard.ts` | Applies the shared dangerous-command list to user `!`/`!!` shell commands with confirmation |
| `session-namer.ts` | Auto-names sessions from the first real user message for the `/resume` picker |
| `issue-autocomplete.ts` | `#`-trigger autocomplete of open GitHub issues in GitHub checkouts |
| `ci-watcher.ts` | `/watch` polls GitHub Actions for a branch/PR and injects the result into the session when it completes |
| `presets.ts` | `/preset save|list|off` and `/preset <name>` to switch model + thinking + tools combinations |

## Environment configuration

```sh
# Web search
EXA_API_KEY=...                         # optional
OPENCODE_WEBSEARCH_PROVIDER=parallel    # optional: exa or parallel
PARALLEL_API_KEY=...                    # optional

# Browser
PI_BROWSER_SESSION=my-project
PI_BROWSER_ALLOWED_DOMAINS=github.com,google.com,localhost
PI_LAZY_TOOLS=webfetch,browser,run_tests,github

# Local OpenAI-compatible provider
PI_LOCAL_PROVIDER_URL=http://127.0.0.1:11434/v1
PI_LOCAL_PROVIDER_API_KEY=local
PI_LOCAL_PROVIDER_NAME=ollama
PI_LOCAL_MODELS=llama3.2,qwen2.5-coder

# Cheap-model compaction
PI_COMPACTION_MODEL=opencode-go/ox-alpha-free  # provider/model used for compaction summaries

# Context pruner
PI_PRUNER=off               # optional: disable pruning
PI_PRUNER_KEEP_TURNS=3      # recent user messages left untouched
PI_PRUNER_MIN_CHARS=2000    # only prune tool results larger than this

# CI watcher
PI_CI_WATCH_INTERVAL=60     # default poll interval in seconds

# Manual model fallback targets, in priority order
PI_PROVIDER_FALLBACKS=ollama/qwen2.5-coder,opencode-go/gpt-5.6-luna

# LLM action-required notifications (enabled by default; set off to disable)
PI_ACTION_NOTIFICATIONS=off
PI_ACTION_NOTIFICATIONS_CHANNEL=terminal # terminal, ui, both, hark, or all
PI_HARK_VERBOSITY=actions             # optional: errors (actions + failures), all (also starts + finishes)
PI_HARK_DONE_SUMMARY=off              # optional: disable the done-with-summary Hark push (on by default)
PI_ACTION_REPLY=off                    # optional: disable answering from the iPhone notification
PI_ACTION_REPLY_TIMEOUT=600            # optional: seconds to wait for an iPhone answer (30-86400)
PI_HARK_LIVE_ACTIVITY=on               # optional: Lock Screen run-tracker card (off by default)
PI_HARK_LIVE_DISMISS_AFTER=120         # optional: seconds the finished card lingers (0-14400)
PI_HARK_LIVE_PATCH_MS=5000             # optional: min ms between card updates (1000-60000)
PI_HARK_POLL_INTERVAL_MS=3000           # optional: iPhone poll interval (1000-30000)
PI_HARK_WEBHOOK_URL=...                  # secret Hark service webhook URL
PI_HARK_TITLE=Pi                         # optional Hark sender title
PI_HARK_PROJECT=Pi                       # optional Hark inbox project
PI_HARK_TAP_URL=...                      # optional public/deep-link tap destination
```

## Commands

```text
/project             Show project Git and Pi session context
/checkpoint          Save tracked Git changes as patch in ~/.pi/agent/checkpoints
/checkpoints         List checkpoints for current project
/restore <file>      Validate and apply a saved checkpoint
/handoff [task]      Write .pi/HANDOFF.md from recent conversation
/stats               Show pi-workflow counters
/test [target]       Run repository tests/checks
/github issue ...    Inspect GitHub issues
/watch [ref]         Watch CI for a branch or PR number
/unwatch             Stop watching CI
/preset [name|save|list|off]  Switch model/thinking/tools presets
```
/github pr ...       Inspect pull requests
/github checks ...   Inspect CI checks
/tools               List active tools
/tools browser       Activate tools matching a capability
/providers            Show local provider configuration
/fallback             Switch to the next configured fallback model
/status-line          Toggle the enhanced context and cost footer
/action-notifications [on|off|status|test|channel <name|reset>|reply <on|off>|verbosity <level|reset>|done <on|off>]
                       Toggle, inspect, test, switch the channel, toggle iPhone answers, set Hark verbosity, or toggle done summaries
```

When Hark is configured, the LLM can call `ask_user_on_iphone` for an interactive Hark Pro approval, yes/no, or text response. The tool waits for the iPhone response and returns it to the agent. The webhook URL is a credential and must not be committed or exposed in logs, prompts, session data, or tool results.

With channel `hark` or `all`, a finished run also sends one done push with a short summary of what was done (last two sentences, code stripped). Disable with `PI_HARK_DONE_SUMMARY=off` or `/action-notifications done off`.

With channel `hark` or `all`, settled questions and approvals also go out as interactive Hark prompts automatically: the user's answer is injected back into the session as a user message and the agent continues. Statements stay one-way, timeouts stay silent (no loop fuel), and at most 3 answers in a row are collected before falling back to one-way until the user writes again. Disable with `PI_ACTION_REPLY=off` or `/action-notifications reply off`.

Hark file map: `hark/index.ts` (thin orchestration: tool, command, hooks, session state) + `hark/detection.ts` (marker/heuristic detection) + `hark/config.ts` (env readers, key helpers) + `hark/reply-waiter.ts` (interactive polling) + `hark/live-tracker.ts` (Live Activity card) + `hark/hark-client.ts` + `hark/activity-client.ts` (protocol clients).

The browser extension delegates to `agent-browser`; install it separately and configure an allowed-domain list for safer navigation. `github.ts` requires the GitHub CLI (`gh`) and an authenticated session for private repositories.
