import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

const EXA_URL = "https://mcp.exa.ai/mcp";
const PARALLEL_URL = "https://search.parallel.ai/mcp";
const MAX_NUM_RESULTS = 20;
const MAX_CONTEXT_CHARACTERS = 50_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 25_000;

const NO_RESULTS = "No search results found. Please try a different query.";
const SEARCH_FAILURE = (query: string) => `Unable to search the web for ${query}`;

const WebSearchParameters = Type.Object({
	query: Type.String({ description: "Websearch query" }),
	numResults: Type.Optional(
		Type.Number({
			minimum: 1,
			maximum: MAX_NUM_RESULTS,
			description: `Number of search results to return (default: 8, maximum: ${MAX_NUM_RESULTS})`,
		}),
	),
	livecrawl: Type.Optional(
		StringEnum(["fallback", "preferred"] as const, {
			description:
			"Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
		}),
	),
	type: Type.Optional(
		StringEnum(["auto", "fast", "deep"] as const, {
			description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
		}),
	),
	contextMaxCharacters: Type.Optional(
		Type.Number({
			minimum: 1,
			maximum: MAX_CONTEXT_CHARACTERS,
			description: `Maximum characters for context string optimized for models (default: 10000, maximum: ${MAX_CONTEXT_CHARACTERS})`,
		}),
	),
});

type WebSearchParameters = Static<typeof WebSearchParameters>;
type Provider = "exa" | "parallel";

type McpPayload = {
	result?: {
		content?: Array<{ text?: unknown }>;
	};
};

function truthy(value: string | undefined): boolean {
	return value !== undefined && !["", "0", "false", "no", "off"].includes(value.toLowerCase());
}

/**
 * Keep provider selection compatible with OpenCode's environment contract.
 * Exa is the safe default because its hosted endpoint works without a key.
 */
export function selectProvider(): Provider {
	const override = process.env.OPENCODE_WEBSEARCH_PROVIDER;
	if (override === "exa" || override === "parallel") return override;
	if (truthy(process.env.OPENCODE_ENABLE_PARALLEL) || truthy(process.env.OPENCODE_EXPERIMENTAL_PARALLEL)) {
		return "parallel";
	}
	return "exa";
}

function exaUrl(): string {
	const apiKey = process.env.EXA_API_KEY;
	if (!apiKey) return EXA_URL;
	const url = new URL(EXA_URL);
	url.searchParams.set("exaApiKey", apiKey);
	return url.toString();
}

function modelName(ctx: ExtensionContext): string | undefined {
	const model = ctx.model;
	if (!model) return undefined;
	return model.id.slice(0, 100);
}

function requestBody(provider: Provider, params: WebSearchParameters, ctx: ExtensionContext): string {
	const args =
		provider === "exa"
			? {
					query: params.query,
					type: params.type ?? "auto",
					numResults: params.numResults ?? 8,
					livecrawl: params.livecrawl ?? "fallback",
					...(params.contextMaxCharacters === undefined
						? {}
						: { contextMaxCharacters: params.contextMaxCharacters }),
				}
			: {
					objective: params.query,
					search_queries: [params.query],
					session_id: ctx.sessionManager.getSessionId(),
					...(modelName(ctx) ? { model_name: modelName(ctx) } : {}),
				};

	return JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: {
			name: provider === "exa" ? "web_search_exa" : "web_search",
			arguments: args,
		},
	});
}

async function readBody(response: Response, signal: AbortSignal): Promise<string> {
	const contentLength = Number(response.headers.get("content-length"));
	if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
		throw new Error("Search response exceeded the maximum size");
	}

	if (!response.body) {
		const text = await response.text();
		if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
			throw new Error("Search response exceeded the maximum size");
		}
		return text;
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			if (signal.aborted) throw new DOMException("The search request was aborted", "AbortError");
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > MAX_RESPONSE_BYTES) {
				await reader.cancel("response too large");
				throw new Error("Search response exceeded the maximum size");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(bytes);
}

function payloadText(payload: string): string | undefined {
	const trimmed = payload.trim();
	if (!trimmed.startsWith("{")) return undefined;
	const data = JSON.parse(trimmed) as McpPayload;
	return data.result?.content?.find((item) => typeof item.text === "string" && item.text.length > 0)?.text as
		| string
		| undefined;
}

/** Parse the plain JSON and SSE response forms returned by hosted MCP servers. */
export function parseSearchResponse(body: string): string | undefined {
	const trimmed = body.trim();
	const direct = trimmed ? payloadText(trimmed) : undefined;
	if (direct) return direct;

	for (const line of body.split("\n")) {
		if (!line.startsWith("data: ")) continue;
		const text = payloadText(line.slice(6));
		if (text) return text;
	}
	return undefined;
}

async function fetchSearch(
	provider: Provider,
	params: WebSearchParameters,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
): Promise<string | undefined> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	const abortParent = () => controller.abort();
	if (signal?.aborted) controller.abort();
	signal?.addEventListener("abort", abortParent, { once: true });

	try {
		const headers: Record<string, string> = {
			Accept: "application/json, text/event-stream",
			"Content-Type": "application/json",
		};
		if (provider === "parallel") {
			headers["User-Agent"] = "pi-websearch/1";
			if (process.env.PARALLEL_API_KEY) {
				headers.Authorization = `Bearer ${process.env.PARALLEL_API_KEY}`;
			}
		}

		const response = await fetch(provider === "exa" ? exaUrl() : PARALLEL_URL, {
			method: "POST",
			headers,
			body: requestBody(provider, params, ctx),
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`Search request failed with HTTP ${response.status}`);
		return parseSearchResponse(await readBody(response, controller.signal));
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abortParent);
	}
}

export default function websearch(pi: ExtensionAPI) {
	pi.registerTool({
		name: "websearch",
		label: "Web Search",
		description: `Search the web using a hosted search provider. Use this for current information beyond your knowledge cutoff. The current year is ${new Date().getFullYear()}; include it when searching for recent events or data.`,
		promptSnippet: "Search the web for current information",
		promptGuidelines: [
			"Use websearch for current or external information beyond the local workspace.",
			"Use the returned source context as evidence and preserve source URLs when citing findings.",
		],
		parameters: WebSearchParameters,
		execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
			const query = params.query.trim();
			if (!query) throw new Error("Websearch query cannot be empty");

			const normalized = { ...params, query };
			const provider = selectProvider();
			try {
				const result = await fetchSearch(provider, normalized, ctx, signal);
				return {
					content: [{ type: "text", text: result ?? NO_RESULTS }],
					details: { provider, query },
				};
			} catch {
				return {
					content: [{ type: "text", text: SEARCH_FAILURE(query) }],
					details: { provider, query, error: true },
				};
			}
		},
	});
}
