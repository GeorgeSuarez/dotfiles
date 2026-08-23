# Pi extensions

These extensions are auto-discovered from `~/.pi/agent/extensions/`.

## Features

| Extension | Capability |
| --- | --- |
| `websearch.ts` | OpenCode-compatible Exa/Parallel web search |
| `webfetch.ts` | Bounded URL fetching and HTML-to-text extraction |
| `browser.ts` | `agent-browser` navigation and interaction |
| `git-checkpoint.ts` | Automatic and manual Git checkpoints |
| `test-runner.ts` | Detected repository tests through `run_tests` and `/test` |
| `github.ts` | Read-only GitHub issue, PR, and CI inspection through `gh` |
| `dynamic-tools.ts` | Lazy tool activation through `search_tools` and `/tools` |
| `local-provider.ts` | Dynamic local OpenAI-compatible provider/model discovery |
| `provider-fallback.ts` | Manual model fallback and provider error notifications |
| `status-line.ts` | Enhanced context, token, cost, model, branch, and extension status footer |
| `action-notifications.ts` | Detects LLM responses that require a user action and sends terminal/UI/Hark notifications; provides iPhone questions |

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

# Manual model fallback targets, in priority order
PI_PROVIDER_FALLBACKS=ollama/qwen2.5-coder,opencode-go/gpt-5.6-luna

# LLM action-required notifications
PI_ACTION_NOTIFICATIONS=off              # optional: disable by default
PI_ACTION_NOTIFICATIONS_CHANNEL=terminal # terminal, ui, both, hark, or all
PI_HARK_WEBHOOK_URL=...                  # secret Hark service webhook URL
PI_HARK_TITLE=Pi                         # optional Hark sender title
PI_HARK_PROJECT=Pi                       # optional Hark inbox project
PI_HARK_TAP_URL=...                      # optional public/deep-link tap destination
```

## Commands

```text
/plan [on|off]       Toggle read-only planning mode
/checkpoint          Save current Git changes
/checkpoints         List session checkpoints
/rollback            Restore the latest checkpoint
/test [target]       Run repository tests/checks
/github issue ...    Inspect GitHub issues
/github pr ...       Inspect pull requests
/github checks ...   Inspect CI checks
/tools               List active tools
/tools browser       Activate tools matching a capability
/providers            Show local provider configuration
/fallback             Switch to the next configured fallback model
/status-line          Toggle the enhanced context and cost footer
/action-notifications [on|off|status|test]
                       Toggle, inspect, or test action-required notifications
```

When Hark is configured, the LLM can call `ask_user_on_iphone` for an interactive Hark Pro approval, yes/no, or text response. The tool waits for the iPhone response and returns it to the agent. The webhook URL is a credential and must not be committed or exposed in logs, prompts, session data, or tool results.

The browser extension delegates to `agent-browser`; install it separately and configure an allowed-domain list for safer navigation. `github.ts` requires the GitHub CLI (`gh`) and an authenticated session for private repositories.
