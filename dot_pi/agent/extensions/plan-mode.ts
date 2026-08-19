import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

const BLOCKED_TOOLS = new Set(["edit", "write", "browser", "github"]);
const SAFE_BASH = /^(?:git\s+(?:status|diff|log|show|branch|ls-files|rev-parse)|(?:pwd|ls|find|rg|grep|head|tail|cat|sed|awk|wc|file|stat|npm\s+(?:test|run\s+(?:test|lint|typecheck|check))|pnpm\s+(?:test|run\s+(?:test|lint|typecheck|check))|yarn\s+(?:test|lint|typecheck|check)|bun\s+(?:test|run\s+(?:test|lint|typecheck|check))))\b/i;

interface PersistedState {
	enabled: boolean;
}

function assistantText(message: unknown): string {
	const candidate = message as { role?: string; content?: unknown };
	if (candidate.role !== "assistant" || !Array.isArray(candidate.content)) return "";
	return candidate.content
		.filter((item): item is { type: "text"; text: string } => {
			const block = item as { type?: unknown; text?: unknown };
			return block.type === "text" && typeof block.text === "string";
		})
		.map((item) => item.text)
		.join("\n");
}

export default function planMode(pi: ExtensionAPI) {
	let enabled = false;
	let previousTools: string[] | undefined;

	function status(ctx: ExtensionContext): void {
		ctx.ui.setStatus("plan-mode", enabled ? ctx.ui.theme.fg("warning", "⏸ plan") : undefined);
	}

	function setEnabled(next: boolean, ctx: ExtensionContext): void {
		if (next === enabled) {
			ctx.ui.notify(`Plan mode is already ${next ? "enabled" : "disabled"}`, "info");
			return;
		}
		if (next) {
			previousTools = pi.getActiveTools();
			pi.setActiveTools(previousTools.filter((name) => !BLOCKED_TOOLS.has(name)));
			ctx.ui.notify("Plan mode enabled: write and interactive browser tools are disabled", "info");
		} else {
			pi.setActiveTools(previousTools ?? pi.getActiveTools());
			previousTools = undefined;
			ctx.ui.notify("Plan mode disabled: full tool access restored", "info");
		}
		enabled = next;
		status(ctx);
		pi.appendEntry<PersistedState>("plan-mode-state", { enabled });
	}

	function restore(ctx: ExtensionContext): void {
		const entry = [...ctx.sessionManager.getBranch()]
			.reverse()
			.find((item) => item.type === "custom" && item.customType === "plan-mode-state");
		if (entry?.type === "custom" && (entry.data as Partial<PersistedState>)?.enabled) {
			enabled = true;
			previousTools = pi.getActiveTools();
			pi.setActiveTools(previousTools.filter((name) => !BLOCKED_TOOLS.has(name)));
		}
		status(ctx);
	}

	pi.registerCommand("plan", {
		description: "Toggle read-only plan mode (usage: /plan [on|off])",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			setEnabled(value === "on" ? true : value === "off" ? false : !enabled, ctx);
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => setEnabled(!enabled, ctx),
	});

	pi.on("session_start", (_event, ctx) => restore(ctx));

	pi.on("tool_call", (event) => {
		if (!enabled) return;
		if (BLOCKED_TOOLS.has(event.toolName)) {
			return { block: true, reason: `Plan mode blocked ${event.toolName}; run /plan off before making changes.` };
		}
		if (event.toolName === "bash" && typeof event.input.command === "string" && !SAFE_BASH.test(event.input.command.trim())) {
			return { block: true, reason: "Plan mode only permits allowlisted read-only shell commands." };
		}
	});

	pi.on("context", (event) => ({
		messages: event.messages.filter((message) => (message as { customType?: string }).customType !== "plan-mode-context"),
	}));

	pi.on("before_agent_start", () => {
		if (!enabled) return;
		return {
			message: {
				customType: "plan-mode-context",
				content: "[PLAN MODE ACTIVE]\nExplore the repository and produce a numbered implementation plan. Do not edit files, run mutating commands, submit forms, or deploy anything. Use read-only tools and clearly state assumptions.",
				display: false,
			},
		};
	});

	pi.on("turn_end", (event, ctx) => {
		if (!enabled) return;
		const text = assistantText(event.message);
		const steps = [...text.matchAll(/^\s*\d+[.)]\s+(.+)$/gm)].map((match) => match[1]);
		if (steps.length > 0) ctx.ui.setWidget("plan-steps", steps.map((step) => `☐ ${step}`));
	});
}
