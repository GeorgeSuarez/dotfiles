import { afterEach, describe, expect, test } from "bun:test";
import { Check } from "typebox/value";
import websearch, { parseSearchResponse, selectProvider } from "../agent/extensions/websearch.ts";

const originalFetch = globalThis.fetch;
const originalProvider = process.env.OPENCODE_WEBSEARCH_PROVIDER;
const originalParallel = process.env.OPENCODE_ENABLE_PARALLEL;

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalProvider === undefined) delete process.env.OPENCODE_WEBSEARCH_PROVIDER;
	else process.env.OPENCODE_WEBSEARCH_PROVIDER = originalProvider;
	if (originalParallel === undefined) delete process.env.OPENCODE_ENABLE_PARALLEL;
	else process.env.OPENCODE_ENABLE_PARALLEL = originalParallel;
});

describe("websearch response parsing", () => {
	test("parses direct MCP JSON", () => {
		expect(
			parseSearchResponse(
				JSON.stringify({ result: { content: [{ type: "text", text: "search results" }] } }),
			),
		).toBe("search results");
	});

	test("parses MCP JSON delivered as SSE", () => {
		expect(
			parseSearchResponse(
				`event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: "search results" }] } })}\n\n`,
			),
		).toBe("search results");
	});

	test("returns undefined for empty and done responses", () => {
		expect(parseSearchResponse("data: [DONE]\n\n")).toBeUndefined();
		expect(parseSearchResponse(JSON.stringify({ result: { content: [] } }))).toBeUndefined();
	});
});

describe("websearch tool", () => {
	test("registers the OpenCode-compatible schema and sends Exa defaults", async () => {
		const tools = [];
		websearch({ registerTool: (tool) => tools.push(tool) });
		expect(tools).toHaveLength(1);
		expect(tools[0].name).toBe("websearch");
		expect(Check(tools[0].parameters, { query: "pi" })).toBe(true);
		expect(Check(tools[0].parameters, { query: "pi", numResults: 21 })).toBe(false);

		let request;
		globalThis.fetch = async (_input, init) => {
			request = init;
			return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "results" }] } }), {
				status: 200,
			});
		};

		const result = await tools[0].execute(
			"call-1",
			{ query: "pi" },
			undefined,
			undefined,
			{
				model: undefined,
				sessionManager: { getSessionId: () => "session-1" },
			},
		);
		const body = JSON.parse(String(request.body));
		expect(body).toMatchObject({
			jsonrpc: "2.0",
			method: "tools/call",
			params: {
				name: "web_search_exa",
				arguments: { query: "pi", type: "auto", numResults: 8, livecrawl: "fallback" },
			},
		});
		expect(result.content[0].text).toBe("results");
		expect(result.details).toEqual({ provider: "exa", query: "pi" });
	});

	test("honors the provider override and maps Parallel arguments", async () => {
		process.env.OPENCODE_WEBSEARCH_PROVIDER = "parallel";
		let requestUrl = "";
		let request;
		globalThis.fetch = async (input, init) => {
			requestUrl = String(input);
			request = init;
			return new Response('data: {"result":{"content":[{"text":"parallel results"}]}}\n\n');
		};

		const tools = [];
		websearch({ registerTool: (tool) => tools.push(tool) });
		const result = await tools[0].execute(
			"call-2",
			{ query: "pi" },
			undefined,
			undefined,
			{ model: undefined, sessionManager: { getSessionId: () => "session-2" } },
		);
		const body = JSON.parse(String(request.body));
		expect(requestUrl).toBe("https://search.parallel.ai/mcp");
		expect(body.params).toMatchObject({
			name: "web_search",
			arguments: { objective: "pi", search_queries: ["pi"], session_id: "session-2" },
		});
		expect(result.content[0].text).toBe("parallel results");
	});

	test("uses Exa by default", () => {
		delete process.env.OPENCODE_WEBSEARCH_PROVIDER;
		delete process.env.OPENCODE_ENABLE_PARALLEL;
		expect(selectProvider()).toBe("exa");
	});
});
