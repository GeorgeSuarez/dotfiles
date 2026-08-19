import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

const Parameters = Type.Object({
	operation: StringEnum(["issue", "pull_request", "checks"] as const, { description: "GitHub read operation" }),
	number: Type.Optional(Type.Integer({ minimum: 1, description: "Issue or pull request number" })),
	query: Type.Optional(Type.String({ description: "Search query for issue or pull request lists" })),
	repo: Type.Optional(Type.String({ description: "Repository in owner/name form" })),
});
type Params = Static<typeof Parameters>;

function argsFor(params: Params): string[] {
	const repo = params.repo ? ["--repo", params.repo] : [];
	if (params.operation === "issue") {
		return params.number
			? ["issue", "view", String(params.number), "--json", "number,title,state,url,body,labels", ...repo]
			: ["issue", "list", "--limit", "20", ...(params.query ? ["--search", params.query] : []), "--json", "number,title,state,url,labels", ...repo];
	}
	if (params.operation === "pull_request") {
		return params.number
			? ["pr", "view", String(params.number), "--json", "number,title,state,url,author,body,files,statusCheckRollup", ...repo]
			: ["pr", "list", "--limit", "20", ...(params.query ? ["--search", params.query] : []), "--json", "number,title,state,url,author", ...repo];
	}
	return ["pr", "checks", ...(params.number ? [String(params.number)] : []), ...repo];
}

export default function github(pi: ExtensionAPI) {
	pi.registerTool({
		name: "github",
		label: "GitHub",
		description: "Inspect GitHub issues, pull requests, and CI checks through the read-only gh CLI integration.",
		promptSnippet: "Inspect GitHub issues, pull requests, or CI checks",
		promptGuidelines: ["Use github for repository issues, pull requests, and CI status; it does not mutate GitHub."],
		parameters: Parameters,
		execute: async (_toolCallId, params, signal) => {
			const result = await pi.exec("gh", argsFor(params), { signal, timeout: 30_000 });
			const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)";
			if (result.code !== 0) throw new Error(`GitHub command failed (is gh authenticated?): ${output}`);
			return {
				content: [{ type: "text", text: output.slice(0, 50_000) }],
				details: { operation: params.operation, number: params.number, repo: params.repo },
			};
		},
	});

	pi.registerCommand("github", {
		description: "Inspect GitHub: /github issue|pr|checks [number|query]",
		handler: async (args, ctx: ExtensionContext) => {
			const [operation = "checks", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const number = rest.length === 1 && /^\d+$/.test(rest[0]) ? Number(rest[0]) : undefined;
			const query = number === undefined && rest.length > 0 ? rest.join(" ") : undefined;
			const normalized = operation === "pr" ? "pull_request" : operation;
			if (!["issue", "pull_request", "checks"].includes(normalized)) {
				ctx.ui.notify("Usage: /github issue|pr|checks [number or search query]", "warning");
				return;
			}
			try {
				const result = await pi.exec("gh", argsFor({ operation: normalized as Params["operation"], number, query }), { timeout: 30_000 });
				const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
				ctx.ui.notify(output.slice(0, 4000) || "(no output)", result.code === 0 ? "info" : "error");
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
