import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

function compactNumber(value: number | null | undefined): string {
	if (value === null || value === undefined) return "?";
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return String(value);
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
					const contextLabel = context
						? `${compactNumber(context.tokens)}/${compactNumber(context.contextWindow)} ${percent === null ? "?" : `${percent.toFixed(0)}%`}`
						: "?";
					const contextColor: "success" | "warning" | "error" =
						percent !== null && percent >= 90 ? "error" : percent !== null && percent >= 75 ? "warning" : "success";

					const branch = footerData.getGitBranch();
					const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no-model";
					const thinking = ctx.thinkingLevel && ctx.thinkingLevel !== "off" ? ` ${ctx.thinkingLevel}` : "";
					const extensionStatuses = [...footerData.getExtensionStatuses().values()].filter(Boolean);
					const branchPart = branch ? theme.fg("accent", `git:${branch}`) : theme.fg("dim", "git:-");
					const contextPart = theme.fg(contextColor, `ctx ${contextLabel}`);
					const costPart = theme.fg("muted", `$${usage.cost.toFixed(3)}`);
					const modelPart = theme.fg("text", `${model}${thinking}`);
					const separator = theme.fg("dim", " · ");

					const detailLeft = [
						branchPart,
						contextPart,
						theme.fg("dim", `↑${compactNumber(usage.input)} ↓${compactNumber(usage.output)}`),
						costPart,
					].join(separator);
					const statusPart = extensionStatuses.length > 0
						? `${extensionStatuses.slice(0, 2).join(separator)}${extensionStatuses.length > 2 ? separator + theme.fg("dim", `+${extensionStatuses.length - 2}`) : ""}`
						: "";
					const right = [statusPart, modelPart].filter(Boolean).join(separator);
					const full = right ? `${detailLeft}${separator}${right}` : detailLeft;

					if (visibleWidth(full) <= width) return [full];

					const compact = `${branch ? theme.fg("accent", branch) : "-"}${separator}${contextPart}${separator}${costPart}${separator}${modelPart}`;
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
