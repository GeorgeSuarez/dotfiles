import { createLocalBashOperations, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { matchDangerousCommand } from "./lib/dangerous-commands.ts";

/**
 * Applies the shared dangerous-command list to the user's own `!`/`!!` commands.
 * The LLM-side `tool_call` guard (pi-workflow.ts) only covers agent-run bash;
 * without this hook the user's own shell commands bypass the list entirely.
 */

function blockedResult(output: string) {
	return { result: { output, exitCode: 1, cancelled: false, truncated: false } };
}

export default function userBashGuard(pi: ExtensionAPI) {
	pi.on("user_bash", async (event, ctx) => {
		const risky = matchDangerousCommand(event.command);
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
