import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { findProtectedTarget, isProtectedPath, matchDangerousCommand } from "./lib/dangerous-commands.ts";

interface GuardResult {
	kind: "protected-path" | "destructive-command";
	reason: string;
}

function shorten(command: string, maxLength = 600): string {
	return command.length <= maxLength ? command : `${command.slice(0, maxLength - 1)}…`;
}

async function confirmDestructive(
	ctx: ExtensionContext,
	command: string,
	guard: GuardResult,
): Promise<{ block: true; reason: string } | undefined> {
	if (!ctx.hasUI) {
		return {
			block: true,
			reason: `Destructive command blocked because Pi has no UI for confirmation: ${guard.reason}`,
		};
	}

	const confirmed = await ctx.ui.confirm(
		"Allow destructive command?",
		`${guard.reason}\n\n${shorten(command)}`,
	);
	if (confirmed) return undefined;

	return { block: true, reason: `Blocked by user: ${guard.reason}` };
}

export default function protectedPaths(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const path = event.input.path;
			if (isProtectedPath(path, ctx.cwd)) {
				if (ctx.hasUI) ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
				return {
					block: true,
					reason: `Path "${path}" is protected. Edit the guard configuration if this change is intentional.`,
				};
			}
			return undefined;
		}

		if (!isToolCallEventType("bash", event)) return undefined;

		const command = event.input.command;
		const protectedTarget = findProtectedTarget(command, ctx.cwd);
		if (protectedTarget) {
			const reason = `A mutating command targets protected path "${protectedTarget}".`;
			if (ctx.hasUI) ctx.ui.notify(`Blocked command targeting a protected path: ${reason}`, "warning");
			return { block: true, reason };
		}

		const dangerous = matchDangerousCommand(command);
		if (dangerous) {
			return confirmDestructive(ctx, command, {
				kind: "destructive-command",
				reason: dangerous.reason,
			});
		}

		return undefined;
	});
}
