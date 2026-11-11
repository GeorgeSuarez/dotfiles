import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";

function compactNumber(value: number | null | undefined): string {
	if (value === null || value === undefined) return "?";

	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;

	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;

	return String(value);
}

/** Shorten a path under the home directory, without mangling siblings such as
 * `/home/me2` into `~2` (the boundary bug pi fixed in its own core). */
function shortenHome(value: string): string {
	const home = process.env.HOME ?? homedir();

	if (!home) return value;

	if (value === home) return "~";

	return value.startsWith(`${home}/`) ? `~${value.slice(home.length)}` : value;
}

interface SessionUsage {
	input: number;
	output: number;
	cost: number;
}

let usageCache: { key: string; usage: SessionUsage } | undefined;

/**
 * The footer renders on every frame, so the branch walk is memoized. Session
 * entries are append-only, so the leaf id plus the branch length identifies the
 * contents; a branch switch changes the leaf id.
 */
function sessionUsage(ctx: ExtensionContext): SessionUsage {
	const branch = ctx.sessionManager.getBranch();
	const key = `${ctx.sessionManager.getLeafId() ?? ""}:${branch.length}`;

	if (usageCache?.key === key) return usageCache.usage;

	let input = 0;
	let output = 0;
	let cost = 0;

	for (const entry of branch) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = entry.message.usage;
		input += usage.input;
		output += usage.output;
		cost += usage.cost.total;
	}

	const usage = { input, output, cost };
	usageCache = { key, usage };

	return usage;
}

type ContextUsage = NonNullable<ReturnType<ExtensionContext["getContextUsage"]>>;

/** "used/window pct", or "?" before pi knows the context window. */
function formatContextLabel(context: ContextUsage | undefined, percent: number | null): string {
	if (!context) return "?";
	const size = `${compactNumber(context.tokens)}/${compactNumber(context.contextWindow)}`;

	return `${size} ${percent === null ? "?" : `${percent.toFixed(0)}%`}`;
}

/** Green under 75%, amber from 75%, red from 90%. */
function contextColorFor(percent: number | null): "success" | "warning" | "error" {
	if (percent === null) return "success";

	if (percent >= 90) return "error";

	if (percent >= 75) return "warning";

	return "success";
}

/** First two extension statuses, then a dimmed "+n" tail. */
function formatExtensionStatuses(
	statuses: string[],
	separator: string,
	dim: (text: string) => string,
): string {
	if (statuses.length === 0) return "";
	const shown = statuses.slice(0, 2).join(separator);

	if (statuses.length <= 2) return shown;

	return `${shown}${separator}${dim(`+${statuses.length - 2}`)}`;
}

export default function statusLine(pi: ExtensionAPI) {
	let enabled = process.env.PI_STATUS_LINE !== "off";

	function install(ctx: ExtensionContext): void {
		if (!enabled) {
			ctx.ui.setFooter(undefined);

			return;
		}

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					const usage = sessionUsage(ctx);
					const context = ctx.getContextUsage();
					const percent = context?.percent ?? null;
					const contextLabel = formatContextLabel(context, percent);
					const contextColor = contextColorFor(percent);

					const cwd = shortenHome(ctx.cwd);
					const branch = footerData.getGitBranch();
					const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no-model";
					const thinkingLevel = ctx.thinkingLevel && ctx.thinkingLevel !== "off" ? ctx.thinkingLevel : null;
					const extensionStatuses = [...footerData.getExtensionStatuses().values()].filter(Boolean);
					const branchPart = branch ? theme.bold(theme.fg("customMessageLabel", `⎇ ${branch}`)) : theme.fg("dim", "⎇ -");
					const cwdPart = theme.fg("syntaxFunction", cwd);
					const contextPart = theme.fg(contextColor, `ctx ${contextLabel}`);
					const costPart = theme.fg("success", `$${usage.cost.toFixed(3)}`);
					const modelPart = theme.bold(theme.fg("mdHeading", model));
					const thinkingPart = thinkingLevel ? ` ${theme.fg("thinkingMedium", thinkingLevel)}` : "";
					const separator = theme.fg("borderMuted", " · ");

					const detailLeft = [
						cwdPart,
						branchPart,
						contextPart,
						theme.fg("syntaxNumber", `↑${compactNumber(usage.input)} ↓${compactNumber(usage.output)}`),
						costPart,
					].join(separator);

					const statusPart = formatExtensionStatuses(extensionStatuses, separator, (text) =>
						theme.fg("dim", text),
					);

					const right = [statusPart, modelPart].filter(Boolean).join(separator);
					const full = right ? `${detailLeft}${separator}${right}${thinkingPart}` : `${detailLeft}${thinkingPart}`;

					if (visibleWidth(full) <= width) return [full];

					const compact = `${cwdPart}${separator}${branch ? theme.fg("customMessageLabel", branch) : "-"}${separator}${contextPart}${separator}${costPart}${separator}${modelPart}`;

					return [truncateToWidth(compact, width, "…")];
				},
			};
		});
	}

	pi.registerCommand("status-line", {
		description: "Toggle the enhanced context and cost status line",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			install(ctx);
			ctx.ui.notify(`Enhanced status line ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});

	pi.on("session_start", (_event, ctx) => install(ctx));
}
