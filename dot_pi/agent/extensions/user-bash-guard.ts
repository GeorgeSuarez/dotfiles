import { createLocalBashOperations, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findProtectedTarget, matchDangerousCommand } from "./lib/dangerous-commands.ts";

/**
 * Applies the shared dangerous-command + protected-path list to the user's own
 * `!`/`!!` commands. The LLM-side `tool_call` guard (protected-paths.ts)
 * only covers agent-run bash; without this hook the user's own shell commands
 * bypass the single source of truth in lib/dangerous-commands.ts.
 */

function blockedResult(output: string) {
	return { result: { output, exitCode: 1, cancelled: false, truncated: false } };
}

export default function userBashGuard(pi: ExtensionAPI) {
	pi.on("user_bash", async (event, ctx) => {
		const protectedTarget = findProtectedTarget(event.command, ctx.cwd);
		const risky = protectedTarget
			? { reason: `targets protected path "${protectedTarget}"` }
			: matchDangerousCommand(event.command);
		if (!risky) return undefined;

		if (!ctx.hasUI) return blockedResult(`Blocked: ${risky.reason}; no interactive confirmation is available`);

		const local = createLocalBashOperations();
		const approved = await ctx.ui.confirm(
			`Dangerous command: ${risky.reason}`,
			`${event.command}\n\nRun anyway?`,
		);
		if (!approved) return blockedResult("Blocked by user");
		return { operations: local };
	});
}
