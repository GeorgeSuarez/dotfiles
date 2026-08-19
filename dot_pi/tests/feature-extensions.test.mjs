import { describe, expect, test } from "bun:test";
import { htmlToText } from "../agent/extensions/webfetch.ts";
import actionNotifications, { assistantText, detectActionRequired } from "../agent/extensions/action-notifications.ts";
import { createHarkClient } from "../agent/extensions/lib/hark-client.ts";

describe("action notifications", () => {
	test("prefers the explicit action marker", () => {
		expect(detectActionRequired("The build is ready. [[PI_ACTION_REQUIRED: Run the migration and reply with the result.]]"))
			.toEqual({ source: "marker", summary: "Run the migration and reply with the result." });
	});

	test("treats an explicit no-action marker as authoritative", () => {
		expect(detectActionRequired("Which environment should I use? [[PI_ACTION_REQUIRED: none]]")).toBeUndefined();
	});

	test("detects a direct question but ignores code examples", () => {
		expect(detectActionRequired("I updated the config.\n\n```sh\nPlease run this command?\n```\n\nWhich environment should I use?"))
			.toEqual({ source: "heuristic", summary: "Which environment should I use?" });
	});

	test("does not alert for completed work or optional suggestions", () => {
		expect(detectActionRequired("No action is required from you."))	.toBeUndefined();
		expect(detectActionRequired("If you'd like, you may want to review the diff."))	.toBeUndefined();
	});

	test("extracts only assistant text content", () => {
		expect(assistantText({ content: [
			{ type: "text", text: "Please confirm." },
			{ type: "toolCall", id: "call", name: "test", arguments: {} },
		] })).toBe("Please confirm.");
	});

	test("sends an action-required Hark notification after the agent settles", async () => {
		const previousValues = {
			enabled: process.env.PI_ACTION_NOTIFICATIONS,
			channel: process.env.PI_ACTION_NOTIFICATIONS_CHANNEL,
			webhook: process.env.PI_HARK_WEBHOOK_URL,
			fetch: globalThis.fetch,
		};
		const requests = [];
		process.env.PI_ACTION_NOTIFICATIONS = "on";
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "hark";
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			return new Response(JSON.stringify({ ok: true, eventId: "evt_action", delivered: 1 }), { status: 200 });
		};

		try {
			const handlers = new Map();
			actionNotifications({
				on: (event, handler) => handlers.set(event, handler),
				registerCommand: () => {},
				registerTool: () => {},
			});
			const ctx = {
				hasUI: false,
				mode: "json",
				sessionManager: {
					getSessionId: () => "session-1",
					getLeafId: () => "leaf-1",
				},
			};
			await handlers.get("message_end")({
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Done. [[PI_ACTION_REQUIRED: Approve the deployment.]]" }],
				},
			}, ctx);
			await handlers.get("agent_settled")({}, ctx);

			expect(requests).toHaveLength(1);
			expect(requests[0].url).toBe("https://hark.ryan.ceo/hooks/test-token");
			expect(JSON.parse(requests[0].init.body).body).toBe("Pi needs your attention: Approve the deployment.");
			expect(requests[0].init.headers["Idempotency-Key"]).toBe("pi-action:session-1:leaf-1");
		} finally {
			if (previousValues.enabled === undefined) delete process.env.PI_ACTION_NOTIFICATIONS;
			else process.env.PI_ACTION_NOTIFICATIONS = previousValues.enabled;
			if (previousValues.channel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousValues.channel;
			if (previousValues.webhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousValues.webhook;
			globalThis.fetch = previousValues.fetch;
		}
	});

	test("returns an iPhone approval to the LLM", async () => {
		const previousWebhook = process.env.PI_HARK_WEBHOOK_URL;
		const previousFetch = globalThis.fetch;
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		globalThis.fetch = async (url, init) => {
			if (init.method === "POST" && url.endsWith("/hooks/test-token")) {
				return new Response(JSON.stringify({ ok: true, eventId: "evt_question", delivered: 1 }), { status: 200 });
			}
			return new Response(JSON.stringify({
				ok: true,
				event: { id: "evt_question", response: { status: "approved", action: "approve", text: null } },
			}), { status: 200 });
		};

		try {
			let tool;
			actionNotifications({
				on: () => {},
				registerCommand: () => {},
				registerTool: (value) => { tool = value; },
			});
			const result = await tool.execute(
				"call-1",
				{ question: "Deploy this commit?", responseType: "approval", timeoutSeconds: 30 },
				undefined,
				undefined,
				{ sessionManager: { getSessionId: () => "session-1" } },
			);
			expect(result.content[0].text).toBe("User response: approve");
			expect(result.details).toMatchObject({ status: "approved", action: "approve" });
		} finally {
			if (previousWebhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousWebhook;
			globalThis.fetch = previousFetch;
		}
	});

	test("registers the command and lifecycle handlers", () => {
		const handlers = new Map();
		const commands = new Map();
		const tools = new Map();
		const previousWebhook = process.env.PI_HARK_WEBHOOK_URL;
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		try {
			actionNotifications({
				on: (event, handler) => handlers.set(event, handler),
				registerCommand: (name, command) => commands.set(name, command),
				registerTool: (tool) => tools.set(tool.name, tool),
			});
		} finally {
			if (previousWebhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousWebhook;
		}
		expect(commands.has("action-notifications")).toBe(true);
		expect(tools.has("ask_user_on_iphone")).toBe(true);
		expect(handlers.has("before_agent_start")).toBe(true);
		expect(handlers.has("message_end")).toBe(true);
		expect(handlers.has("agent_settled")).toBe(true);
	});
});

describe("Hark client", () => {
	test("sends a bounded notification with an idempotency key", async () => {
		const requests = [];
		const client = createHarkClient({
			webhookUrl: "https://hark.ryan.ceo/hooks/test-token",
			fetchImpl: async (url, init) => {
				requests.push({ url, init });
				return new Response(JSON.stringify({ ok: true, eventId: "evt_1", delivered: 1 }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			},
		});

		expect(client).toBeDefined();
		const result = await client.send(
			{ title: "Pi", body: "Action required", summary: "Action required" },
			{ idempotencyKey: "pi-action:test" },
		);

		expect(result).toEqual({ eventId: "evt_1", delivered: 1, idempotent: undefined, message: undefined });
		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe("https://hark.ryan.ceo/hooks/test-token");
		expect(requests[0].init.headers["Idempotency-Key"]).toBe("pi-action:test");
		expect(JSON.parse(requests[0].init.body)).toEqual({
			title: "Pi",
			body: "Action required",
			summary: "Action required",
		});
	});

	test("reads an interactive response and can cancel it", async () => {
		const urls = [];
		const client = createHarkClient({
			webhookUrl: "https://hark.ryan.ceo/hooks/test-token",
			fetchImpl: async (url) => {
				urls.push(url);
				if (url.endsWith("/events/evt_2")) {
					return new Response(JSON.stringify({
						ok: true,
						event: { id: "evt_2", response: { status: "approved", action: "approve", text: null } },
					}), { status: 200 });
				}
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			},
		});

		const result = await client.readResponse("evt_2");
		await client.cancelResponse("evt_2");
		expect(result.response).toMatchObject({ status: "approved", action: "approve", text: null });
		expect(urls).toEqual([
			"https://hark.ryan.ceo/hooks/test-token/events/evt_2",
			"https://hark.ryan.ceo/hooks/test-token/events/evt_2/cancel",
		]);
	});
});

describe("webfetch", () => {
	test("extracts readable HTML text and title", () => {
		expect(htmlToText("<html><title>Docs</title><script>bad()</script><main><h1>Hello</h1><p>World &amp; friends</p></main></html>"))
			.toBe("# Docs\n\n# Hello\nWorld & friends");
	});
});
