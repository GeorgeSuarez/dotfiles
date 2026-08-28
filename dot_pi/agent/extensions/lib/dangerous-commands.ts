export interface DangerousCommand {
	pattern: RegExp;
	reason: string;
}

/**
 * Commands that require confirmation before running, shared by the LLM `tool_call`
 * guard (pi-workflow.ts) and the user `!`-command guard (user-bash-guard.ts).
 */
export const dangerousCommands: DangerousCommand[] = [
	{ pattern: /\brm\s+(?:-[^\s]*r|--recursive)/i, reason: "recursive deletion" },
	{ pattern: /\bsudo\b/i, reason: "elevated privileges" },
	{ pattern: /\b(?:git\s+)?reset\s+--hard\b/i, reason: "discarding tracked changes" },
	{ pattern: /\bgit\s+clean\s+-[^\n]*f/i, reason: "deleting untracked files" },
	{ pattern: /\b(?:git\s+)?(?:checkout|restore)\s+--/i, reason: "overwriting working-tree files" },
	{ pattern: /\b(?:chmod|chown)\b[^\n]*\b777\b/i, reason: "opening permissions broadly" },
	{ pattern: /\b(?:mkfs|diskutil\s+erase|dd\s+if=)/i, reason: "disk-level changes" },
	{ pattern: /\b(?:terraform|pulumi)\s+destroy\b/i, reason: "destroying infrastructure" },
	{ pattern: /\bdocker\s+system\s+prune\b/i, reason: "removing Docker resources" },
	{
		pattern: /(?:>|>>|\b(?:cp|mv|rm)\b)[^\n]*(?:^|[\s/])(?:\.env(?:\.[\w.-]+)?|.*\.(?:pem|key|p12|pfx))\b/i,
		reason: "modifying likely secret material",
	},
];

export function matchDangerousCommand(command: string): DangerousCommand | undefined {
	return dangerousCommands.find(({ pattern }) => pattern.test(command));
}
