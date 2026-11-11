import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

/**
 * Non-interactive git settings. `GIT_SEQUENCE_EDITOR` is the variable git reads
 * for interactive rebase todo editing; `GIT_EDITOR` is only its fallback, so a
 * `sequence.editor` config value would otherwise win and block the command.
 */
const GIT_ENV_PREFIX =
  "export GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true GIT_MERGE_AUTOEDIT=no\n";

/**
 * `git` as a command word at the start of a shell segment, allowing leading env
 * assignments (`HUSKY=0 git …`) and wrappers. Matching the bare substring "git"
 * also hits "digit", "legit", "grep git" and "cat .gitignore".
 */
const GIT_COMMAND_RE =
  /(?:^|[\n;&|({]\s*)(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:sudo\s+|command\s+)?(?:env\s+\S+\s+)*git\s/;

/** Long-form, inline config, and husky bypasses. */
const HOOK_BYPASS_RE = /--no-verify\b|-c\s+core\.hooksPath\b|(?:^|[\s;&|])HUSKY=0\b/;

/** Tokens after which `-n` is message content, not a flag. */
const COMMIT_MESSAGE_FLAG_RE =
  /^-(m|F|C|t)$|^--(message|file|reuse-message|template|author)\b/;

/**
 * `git commit -n` is the documented shorthand for `--no-verify`. Scoped to
 * commit because `git merge -n` means `--no-commit`, which is legitimate, and
 * bounded at the message flags so a message like "-n is fine" cannot trip it.
 */
function commitSkipsHooks(command: string): boolean {
  const tokens = command.split(/[\s;&|]+/);

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "git") continue;
    let j = i + 1;

    while (j < tokens.length && (tokens[j] ?? "").startsWith("-")) j += 1;

    if (tokens[j] !== "commit") continue;

    for (let k = j + 1; k < tokens.length; k++) {
      const token = tokens[k] ?? "";

      if (token === "--" || COMMIT_MESSAGE_FLAG_RE.test(token)) break;

      if (/^-[a-zA-Z]*n[a-zA-Z]*$/.test(token)) return true;
    }
  }

  return false;
}

const BLOCK_REASON =
  "BLOCKED: skipping git hooks is not allowed (--no-verify, commit -n, an " +
  "inline core.hooksPath override, or HUSKY=0). Git hooks exist for a reason. " +
  "Do not attempt to bypass them. Instead: fix the underlying issue that is " +
  "causing the hook to fail, or ask the user for help.";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (!isToolCallEventType("bash", event)) return;
    const command = event.input.command;

    if (!GIT_COMMAND_RE.test(command)) return;

    if (HOOK_BYPASS_RE.test(command) || commitSkipsHooks(command)) {
      return { block: true, reason: BLOCK_REASON };
    }

    event.input.command = GIT_ENV_PREFIX + command;
  });
}
