import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

const DEFAULT_LAZY_TOOLS = new Set(["webfetch", "browser", "run_tests", "github"]);
const Parameters = Type.Object({
	query: Type.String({ description: "Capability or task to search for" }),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Maximum tools to activate" })),
});
type Params = Static<typeof Parameters>;

function terms(query: string): string[] {
	return query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function configuredLazyTools(): Set<string> {
	const value = process.env.PI_LAZY_TOOLS;
	return value === undefined ? DEFAULT_LAZY_TOOLS : new Set(value.split(",").map((name) => name.trim()).filter(Boolean));
}

function matches(pi: ExtensionAPI, query: string, limit: number): string[] {
	const tokens = terms(query);
	return pi.getAllTools()
		.filter((tool) => tool.name !== "search_tools")
		.map((tool) => {
			const haystack = `${tool.name} ${tool.description} ${(tool.promptGuidelines ?? []).join(" ")}`.toLowerCase();
			const score = tokens.reduce((total, token) => total + (haystack.includes(token) ? 1 : 0), 0);
			return { name: tool.name, score };
		})
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
		.slice(0, limit)
		.map((item) => item.name);
}

function activate(pi: ExtensionAPI, names: string[]): string[] {
	const active = pi.getActiveTools();
	const added = names.filter((name) => !active.includes(name));
	if (added.length > 0) pi.setActiveTools([...new Set([...active, ...added])]);
	return added;
}

export default function dynamicTools(pi: ExtensionAPI) {
	pi.registerTool({
		name: "search_tools",
		label: "Search Tools",
		description: "Find and activate an extension tool for a capability that is not currently active.",
		promptSnippet: "Find and activate an additional Pi tool",
		promptGuidelines: ["Use search_tools when the required capability is not present in the active tool list."],
		parameters: Parameters,
		execute: async (_toolCallId, params: Params) => {
			const names = matches(pi, params.query, params.limit ?? 3);
			if (names.length === 0) return { content: [{ type: "text", text: `No tools matched: ${params.query}` }], details: { matches: [], added: [] } };
			const added = activate(pi, names);
			return {
				content: [{ type: "text", text: added.length ? `Activated: ${added.join(", ")}` : `Already active: ${names.join(", ")}` }],
				details: { matches: names, added },
			};
		},
	});

	function configure(ctx: ExtensionContext, query?: string): void {
		if (!query) {
			ctx.ui.notify(`Active tools: ${pi.getActiveTools().join(", ")}`, "info");
			return;
		}
		const names = matches(pi, query, 5);
		const added = activate(pi, names);
		ctx.ui.notify(names.length ? `${added.length ? "Activated" : "Already active"}: ${names.join(", ")}` : `No tools matched: ${query}`, names.length ? "info" : "warning");
	}

	pi.registerCommand("tools", {
		description: "List active tools or activate tools matching a query",
		handler: async (args, ctx) => configure(ctx, args.trim() || undefined),
	});

	pi.on("session_start", (_event, ctx) => {
		const lazy = configuredLazyTools();
		const available = new Set(pi.getAllTools().map((tool) => tool.name));
		const names = [...lazy].filter((name) => available.has(name));
		const active = pi.getActiveTools().filter((name) => !names.includes(name));
		pi.setActiveTools([...new Set([...active, "search_tools"])]);
		ctx.ui.setStatus("dynamic-tools", ctx.ui.theme.fg("muted", `tools ${active.length}/${available.size}`));
	});
}
