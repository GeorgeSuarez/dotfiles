import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function compactNumber(value: number | null | undefined): string {
	if (value === null || value === undefined) return "?";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
}

function contextColorFor(percent: number | null): "success" | "warning" | "error" {
	if (percent === null) return "success";
	if (percent >= 90) return "error";
	if (percent >= 75) return "warning";
	return "success";
}

function sessionUsage(ctx: ExtensionContext): { input: number; output: number; cost: number } {
	let input = 0;
	let output = 0;
	let cost = 0;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const usage = (entry.message as AssistantMessage).usage;
		input += usage.input;
		output += usage.output;
		cost += usage.cost.total;
	}
	return { input, output, cost };
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
					const percentLabel = percent === null ? "?" : `${percent.toFixed(0)}%`;
					const contextLabel = context
						? `${compactNumber(context.tokens)}/${compactNumber(context.contextWindow)} ${percentLabel}`
						: "?";
					const contextColor = contextColorFor(percent);

					const cwd = process.cwd().replace(new RegExp(`^${process.env.HOME}`), "~");
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
					let statusPart = "";
					if (extensionStatuses.length > 0) {
						const overflow = extensionStatuses.length - 2;
						statusPart = extensionStatuses.slice(0, 2).join(separator);
						if (overflow > 0) statusPart += separator + theme.fg("dim", `+${overflow}`);
					}
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
