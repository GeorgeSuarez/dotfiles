import { describe, expect, test } from "bun:test";
import { htmlToText } from "../agent/extensions/web-tools.ts";
import actionNotifications, { assistantText, detectActionRequired, doneSummary, errorSnippet, harkVerbosity, inferReplyType, isAnswerable, liveActivityEnabled, setHarkVerbosityOverride, verbosityAllows } from "../agent/extensions/hark/index.ts";
import { createActivityClient } from "../agent/extensions/hark/activity-client.ts";
import { createHarkClient } from "../agent/extensions/hark/hark-client.ts";

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

	test("prefers explicit no-action language over questions", () => {
		expect(detectActionRequired("Should I proceed? Nothing for you to do right now."))
			.toBeUndefined();
	});

	test("ignores mid-text questions, only the closing sentences count", () => {
		expect(detectActionRequired("Should I use tabs? I went with tabs. The build passed with no issues."))
			.toBeUndefined();
	});

	test("keeps leading counts in summaries", () => {
		expect(detectActionRequired("Done. [[PI_ACTION_REQUIRED: 3 files need review.]]"))
			.toEqual({ source: "marker", summary: "3 files need review." });
	});

	test("extracts only assistant text content", () => {
		expect(assistantText({ content: [
			{ type: "text", text: "Please confirm." },
			{ type: "toolCall", id: "call", name: "test", arguments: {} },
		] })).toBe("Please confirm.");
	});

	test("summarizes finished work for the done push", () => {
		expect(doneSummary("Fixed the flaky test and restarted the worker. All green."))
			.toBe("Fixed the flaky test and restarted the worker. All green.");
		expect(doneSummary("Fixed the bug. Tests pass. Should I use tabs?"))
			.toBe("Fixed the bug. Tests pass.");
		expect(doneSummary("Done.\n```sh\nrm -rf /\n```\n[[PI_ACTION_REQUIRED: none]]"))
			.toBe("Done.");
		expect(doneSummary("")).toBeUndefined();
		expect(doneSummary("```js\nfoo()\n```")).toBeUndefined();
	});

	test("sends a done Hark notification with summary after the agent settles", async () => {
		const previousValues = {
			enabled: process.env.PI_ACTION_NOTIFICATIONS,
			channel: process.env.PI_ACTION_NOTIFICATIONS_CHANNEL,
			webhook: process.env.PI_HARK_WEBHOOK_URL,
			reply: process.env.PI_ACTION_REPLY,
			fetch: globalThis.fetch,
		};
		const requests = [];
		process.env.PI_ACTION_NOTIFICATIONS = "on";
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "hark";
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		process.env.PI_ACTION_REPLY = "off";
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
			expect(requests[0].init.headers["Idempotency-Key"]).toMatch(/^pi-action:session-1:leaf-1:\d+:[0-9a-f]+$/);
		} finally {
			if (previousValues.enabled === undefined) delete process.env.PI_ACTION_NOTIFICATIONS;
			else process.env.PI_ACTION_NOTIFICATIONS = previousValues.enabled;
			if (previousValues.channel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousValues.channel;
			if (previousValues.webhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousValues.webhook;
			if (previousValues.reply === undefined) delete process.env.PI_ACTION_REPLY;
			else process.env.PI_ACTION_REPLY = previousValues.reply;
			globalThis.fetch = previousValues.fetch;
		}
	});

	test("sends a done Hark notification with summary after the agent settles", async () => {
		const previousValues = {
			enabled: process.env.PI_ACTION_NOTIFICATIONS,
			channel: process.env.PI_ACTION_NOTIFICATIONS_CHANNEL,
			webhook: process.env.PI_HARK_WEBHOOK_URL,
			done: process.env.PI_HARK_DONE_SUMMARY,
			fetch: globalThis.fetch,
		};
		const requests = [];
		process.env.PI_ACTION_NOTIFICATIONS = "on";
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "hark";
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		delete process.env.PI_HARK_DONE_SUMMARY;
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			return new Response(JSON.stringify({ ok: true, eventId: "evt_done", delivered: 1 }), { status: 200 });
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
					content: [{ type: "text", text: "Fixed the flaky test and updated the docs. All green." }],
				},
			}, ctx);
			await handlers.get("agent_settled")({}, ctx);

			expect(requests).toHaveLength(1);
			expect(requests[0].url).toBe("https://hark.ryan.ceo/hooks/test-token");
			expect(JSON.parse(requests[0].init.body).body).toBe("Pi done in Pi: Fixed the flaky test and updated the docs. All green.");
			expect(requests[0].init.headers["Idempotency-Key"]).toMatch(/^pi-done:session-1:leaf-1:\d+:[0-9a-f]+$/);
		} finally {
			if (previousValues.enabled === undefined) delete process.env.PI_ACTION_NOTIFICATIONS;
			else process.env.PI_ACTION_NOTIFICATIONS = previousValues.enabled;
			if (previousValues.channel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousValues.channel;
			if (previousValues.webhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousValues.webhook;
			if (previousValues.done === undefined) delete process.env.PI_HARK_DONE_SUMMARY;
			else process.env.PI_HARK_DONE_SUMMARY = previousValues.done;
			globalThis.fetch = previousValues.fetch;
		}
	});

	test("skips the done Hark notification when PI_HARK_DONE_SUMMARY=off", async () => {
		const previousValues = {
			enabled: process.env.PI_ACTION_NOTIFICATIONS,
			channel: process.env.PI_ACTION_NOTIFICATIONS_CHANNEL,
			webhook: process.env.PI_HARK_WEBHOOK_URL,
			done: process.env.PI_HARK_DONE_SUMMARY,
			fetch: globalThis.fetch,
		};
		const requests = [];
		process.env.PI_ACTION_NOTIFICATIONS = "on";
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "hark";
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		process.env.PI_HARK_DONE_SUMMARY = "off";
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			return new Response(JSON.stringify({ ok: true, eventId: "evt_done", delivered: 1 }), { status: 200 });
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
					content: [{ type: "text", text: "Fixed the flaky test. All green." }],
				},
			}, ctx);
			await handlers.get("agent_settled")({}, ctx);

			expect(requests).toHaveLength(0);
		} finally {
			if (previousValues.enabled === undefined) delete process.env.PI_ACTION_NOTIFICATIONS;
			else process.env.PI_ACTION_NOTIFICATIONS = previousValues.enabled;
			if (previousValues.channel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousValues.channel;
			if (previousValues.webhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousValues.webhook;
			if (previousValues.done === undefined) delete process.env.PI_HARK_DONE_SUMMARY;
			else process.env.PI_HARK_DONE_SUMMARY = previousValues.done;
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
			expect(result.content[0].text).toBe("User response: approved (approve)");
			expect(result.details).toMatchObject({ status: "approved", action: "approve" });
		} finally {
			if (previousWebhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousWebhook;
			globalThis.fetch = previousFetch;
		}
	});

	test("answers a settled question from the iPhone notification", async () => {
		const previousValues = {
			enabled: process.env.PI_ACTION_NOTIFICATIONS,
			channel: process.env.PI_ACTION_NOTIFICATIONS_CHANNEL,
			webhook: process.env.PI_HARK_WEBHOOK_URL,
			reply: process.env.PI_ACTION_REPLY,
			fetch: globalThis.fetch,
		};
		const requests = [];
		const sent = [];
		process.env.PI_ACTION_NOTIFICATIONS = "on";
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "hark";
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		delete process.env.PI_ACTION_REPLY;
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			if (init.method === "POST") {
				return new Response(JSON.stringify({ ok: true, eventId: "evt_reply", delivered: 1 }), { status: 200 });
			}
			return new Response(JSON.stringify({
				ok: true,
				event: { id: "evt_reply", response: { status: "yes", action: "yes", text: null } },
			}), { status: 200 });
		};

		try {
			const handlers = new Map();
			actionNotifications({
				on: (event, handler) => handlers.set(event, handler),
				registerCommand: () => {},
				registerTool: () => {},
				sendUserMessage: (content, options) => { sent.push({ content, options }); },
			});
			const ctx = {
				hasUI: false,
				mode: "json",
				sessionManager: { getSessionId: () => "session-1", getLeafId: () => "leaf-1" },
			};
			await handlers.get("message_end")({
				message: { role: "assistant", content: [{ type: "text", text: "Is the build green?" }] },
			}, ctx);
			await handlers.get("agent_settled")({}, ctx);

			// Interactive push replaces the one-way buzz: one POST with a response
			// contract, plus the immediate read that resolves the answer.
			expect(requests).toHaveLength(2);
			expect(requests[0].init.method).toBe("POST");
			const payload = JSON.parse(requests[0].init.body);
			expect(payload.response).toMatchObject({ type: "yes_no" });
			expect(requests[0].init.headers["Idempotency-Key"]).toMatch(/^pi-reply:session-1:leaf-1:\d+:[0-9a-f]+$/);
			expect(sent).toHaveLength(1);
			expect(sent[0].content).toContain("yes (yes)");
			expect(sent[0].content).toContain("Is the build green?");
			expect(sent[0].options).toMatchObject({ deliverAs: "followUp" });
		} finally {
			if (previousValues.enabled === undefined) delete process.env.PI_ACTION_NOTIFICATIONS;
			else process.env.PI_ACTION_NOTIFICATIONS = previousValues.enabled;
			if (previousValues.channel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousValues.channel;
			if (previousValues.webhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousValues.webhook;
			if (previousValues.reply === undefined) delete process.env.PI_ACTION_REPLY;
			else process.env.PI_ACTION_REPLY = previousValues.reply;
			globalThis.fetch = previousValues.fetch;
		}
	});

	test("keeps statements one-way and stays silent on expiry", async () => {
		const previousFetch = globalThis.fetch;
		const previousWebhook = process.env.PI_HARK_WEBHOOK_URL;
		const previousChannel = process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "hark";
		delete process.env.PI_ACTION_REPLY;
		const requests = [];
		const sent = [];
		let readStatus = "approved";
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			if (init.method === "POST") {
				return new Response(JSON.stringify({ ok: true, eventId: "evt_x", delivered: 1 }), { status: 200 });
			}
			return new Response(JSON.stringify({
				ok: true,
				event: { id: "evt_x", response: { status: readStatus, action: "approve", text: null } },
			}), { status: 200 });
		};

		try {
			const handlers = new Map();
			actionNotifications({
				on: (event, handler) => handlers.set(event, handler),
				registerCommand: () => {},
				registerTool: () => {},
				sendUserMessage: (content, options) => { sent.push({ content, options }); },
			});
			const ctx = {
				hasUI: false,
				mode: "json",
				sessionManager: { getSessionId: () => "session-1", getLeafId: () => "leaf-1" },
			};

			// A statement is not answerable: plain one-way push, nothing injected.
			await handlers.get("message_end")({
				message: { role: "assistant", content: [{ type: "text", text: "Please review the staged migration." }] },
			}, ctx);
			await handlers.get("agent_settled")({}, ctx);
			expect(requests).toHaveLength(1);
			expect(JSON.parse(requests[0].init.body).response).toBeUndefined();
			expect(sent).toHaveLength(0);

			// An expired iPhone answer injects nothing (no loop fuel).
			readStatus = "expired";
			await handlers.get("agent_start")({}, ctx);
			await handlers.get("message_end")({
				message: { role: "assistant", content: [{ type: "text", text: "Is the build green?" }] },
			}, ctx);
			await handlers.get("agent_settled")({}, ctx);
			expect(sent).toHaveLength(0);
		} finally {
			globalThis.fetch = previousFetch;
			if (previousWebhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousWebhook;
			if (previousChannel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousChannel;
		}
	});

	test("falls back to one-way when Hark Pro is missing", async () => {
		const previousFetch = globalThis.fetch;
		const previousWebhook = process.env.PI_HARK_WEBHOOK_URL;
		const previousChannel = process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "hark";
		delete process.env.PI_ACTION_REPLY;
		const requests = [];
		const sent = [];
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			if (init.method === "POST" && JSON.parse(init.body).response) {
				return new Response(JSON.stringify({ error: "Interactive responses require Hark Pro" }), { status: 402 });
			}
			return new Response(JSON.stringify({ ok: true, eventId: "evt_1", delivered: 1 }), { status: 200 });
		};

		try {
			const handlers = new Map();
			actionNotifications({
				on: (event, handler) => handlers.set(event, handler),
				registerCommand: () => {},
				registerTool: () => {},
				sendUserMessage: (content, options) => { sent.push({ content, options }); },
			});
			const ctx = {
				hasUI: false,
				mode: "json",
				sessionManager: { getSessionId: () => "session-1", getLeafId: () => "leaf-1" },
			};
			await handlers.get("message_end")({
				message: { role: "assistant", content: [{ type: "text", text: "Is the build green?" }] },
			}, ctx);
			await handlers.get("agent_settled")({}, ctx);

			// Interactive attempt first, then the one-way fallback; nothing injected.
			expect(requests).toHaveLength(2);
			expect(JSON.parse(requests[0].init.body).response).toBeDefined();
			expect(JSON.parse(requests[1].init.body)).toMatchObject({ body: "Pi needs your attention: Is the build green?" });
			expect(sent).toHaveLength(0);
		} finally {
			globalThis.fetch = previousFetch;
			if (previousWebhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousWebhook;
			if (previousChannel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousChannel;
		}
	});

	test("classifies which summaries are answerable", () => {
		expect(isAnswerable("Approve the deployment.")).toBe(true);
		expect(isAnswerable("Which environment should I use?")).toBe(true);
		expect(isAnswerable("The migration is staged.")).toBe(false);
		expect(inferReplyType("Approve the deployment.")).toBe("approval");
		expect(inferReplyType("Is the build green?")).toBe("yes_no");
		expect(inferReplyType("Which environment should I use?")).toBe("text");
	});

	test("parses Hark verbosity levels", () => {
		const previousVerbosity = process.env.PI_HARK_VERBOSITY;
		try {
			delete process.env.PI_HARK_VERBOSITY;
			setHarkVerbosityOverride(undefined);
			expect(harkVerbosity()).toBe("actions");
			expect(verbosityAllows("action")).toBe(true);
			expect(verbosityAllows("error")).toBe(false);
			expect(verbosityAllows("lifecycle")).toBe(false);

			process.env.PI_HARK_VERBOSITY = "errors";
			expect(harkVerbosity()).toBe("errors");
			expect(verbosityAllows("error")).toBe(true);
			expect(verbosityAllows("action")).toBe(true);
			expect(verbosityAllows("lifecycle")).toBe(false);

			process.env.PI_HARK_VERBOSITY = "all";
			expect(harkVerbosity()).toBe("all");
			expect(verbosityAllows("error")).toBe(true);
			expect(verbosityAllows("action")).toBe(true);
			expect(verbosityAllows("lifecycle")).toBe(true);

			process.env.PI_HARK_VERBOSITY = "noisy";
			expect(harkVerbosity()).toBe("actions");

			setHarkVerbosityOverride("errors");
			expect(harkVerbosity()).toBe("errors");
		} finally {
			setHarkVerbosityOverride(undefined);
			if (previousVerbosity === undefined) delete process.env.PI_HARK_VERBOSITY;
			else process.env.PI_HARK_VERBOSITY = previousVerbosity;
		}
	});

	test("truncates tool error snippets", () => {
		expect(errorSnippet("boom")).toBe("boom");
		expect(errorSnippet(undefined)).toBe("");
		expect(errorSnippet(null)).toBe("");
		expect(errorSnippet({ code: 1 })).toBe('{"code":1}');
		const long = errorSnippet("x".repeat(500));
		expect(long.length).toBeLessThanOrEqual(180);
		expect(long.endsWith("…")).toBe(true);
	});

	test("sends lifecycle pushes when verbosity is all", async () => {
		const previousValues = {
			enabled: process.env.PI_ACTION_NOTIFICATIONS,
			channel: process.env.PI_ACTION_NOTIFICATIONS_CHANNEL,
			webhook: process.env.PI_HARK_WEBHOOK_URL,
			verbosity: process.env.PI_HARK_VERBOSITY,
			fetch: globalThis.fetch,
		};
		const requests = [];
		process.env.PI_ACTION_NOTIFICATIONS = "on";
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "hark";
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		process.env.PI_HARK_VERBOSITY = "all";
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			return new Response(JSON.stringify({ ok: true, eventId: "evt_lifecycle", delivered: 1 }), { status: 200 });
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
				cwd: "/Users/tester/my-project",
				sessionManager: { getSessionId: () => "session-1", getLeafId: () => "leaf-1" },
			};
			await handlers.get("agent_start")({}, ctx);
			await handlers.get("agent_settled")({}, ctx);

			expect(requests).toHaveLength(2);
			expect(JSON.parse(requests[0].init.body).body).toBe("Pi started in my-project");
			expect(JSON.parse(requests[1].init.body).body).toBe("Pi finished in my-project");
			expect(requests[0].init.headers["Idempotency-Key"]).toMatch(/^pi-lifecycle:session-1:leaf-1:\d+:[0-9a-f]+$/);
		} finally {
			if (previousValues.enabled === undefined) delete process.env.PI_ACTION_NOTIFICATIONS;
			else process.env.PI_ACTION_NOTIFICATIONS = previousValues.enabled;
			if (previousValues.channel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousValues.channel;
			if (previousValues.webhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousValues.webhook;
			if (previousValues.verbosity === undefined) delete process.env.PI_HARK_VERBOSITY;
			else process.env.PI_HARK_VERBOSITY = previousValues.verbosity;
			globalThis.fetch = previousValues.fetch;
		}
	});

	test("stays quiet on lifecycle when verbosity is actions", async () => {
		const previousValues = {
			channel: process.env.PI_ACTION_NOTIFICATIONS_CHANNEL,
			webhook: process.env.PI_HARK_WEBHOOK_URL,
			verbosity: process.env.PI_HARK_VERBOSITY,
			fetch: globalThis.fetch,
		};
		const requests = [];
		delete process.env.PI_HARK_VERBOSITY;
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "hark";
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			return new Response(JSON.stringify({ ok: true, eventId: "evt_x", delivered: 1 }), { status: 200 });
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
				sessionManager: { getSessionId: () => "session-1", getLeafId: () => "leaf-1" },
			};
			await handlers.get("agent_start")({}, ctx);
			await handlers.get("agent_settled")({}, ctx);
			expect(requests).toHaveLength(0);
		} finally {
			if (previousValues.channel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousValues.channel;
			if (previousValues.webhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousValues.webhook;
			if (previousValues.verbosity === undefined) delete process.env.PI_HARK_VERBOSITY;
			else process.env.PI_HARK_VERBOSITY = previousValues.verbosity;
			globalThis.fetch = previousValues.fetch;
		}
	});

	test("alerts on tool failure only when verbosity allows errors", async () => {
		const previousValues = {
			channel: process.env.PI_ACTION_NOTIFICATIONS_CHANNEL,
			webhook: process.env.PI_HARK_WEBHOOK_URL,
			verbosity: process.env.PI_HARK_VERBOSITY,
			fetch: globalThis.fetch,
		};
		const requests = [];
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "hark";
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			return new Response(JSON.stringify({ ok: true, eventId: "evt_err", delivered: 1 }), { status: 200 });
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
				cwd: "/Users/tester/my-project",
				sessionManager: { getSessionId: () => "session-1", getLeafId: () => "leaf-1" },
			};

			// Default verbosity (actions): tool failures stay silent.
			delete process.env.PI_HARK_VERBOSITY;
			await handlers.get("tool_execution_end")({ toolCallId: "call-1", toolName: "bash", result: "boom", isError: true }, ctx);
			await handlers.get("tool_execution_end")({ toolCallId: "call-2", toolName: "bash", result: "ok", isError: false }, ctx);
			expect(requests).toHaveLength(0);

			// Errors verbosity: failures buzz with a bounded snippet.
			process.env.PI_HARK_VERBOSITY = "errors";
			await handlers.get("tool_execution_end")({ toolCallId: "call-3", toolName: "bash", result: "boom", isError: true }, ctx);
			expect(requests).toHaveLength(1);
			expect(JSON.parse(requests[0].init.body).body).toBe("bash failed in my-project: boom");
			expect(requests[0].init.headers["Idempotency-Key"]).toMatch(/^pi-error:session-1:leaf-1:\d+:[0-9a-f]+$/);
		} finally {
			if (previousValues.channel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousValues.channel;
			if (previousValues.webhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousValues.webhook;
			if (previousValues.verbosity === undefined) delete process.env.PI_HARK_VERBOSITY;
			else process.env.PI_HARK_VERBOSITY = previousValues.verbosity;
			globalThis.fetch = previousValues.fetch;
		}
	});

	test("skips the finished push when an action is detected", async () => {
		const previousValues = {
			channel: process.env.PI_ACTION_NOTIFICATIONS_CHANNEL,
			webhook: process.env.PI_HARK_WEBHOOK_URL,
			verbosity: process.env.PI_HARK_VERBOSITY,
			reply: process.env.PI_ACTION_REPLY,
			fetch: globalThis.fetch,
		};
		const requests = [];
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "hark";
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		process.env.PI_HARK_VERBOSITY = "all";
		process.env.PI_ACTION_REPLY = "off";
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			return new Response(JSON.stringify({ ok: true, eventId: "evt_1", delivered: 1 }), { status: 200 });
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
				sessionManager: { getSessionId: () => "session-1", getLeafId: () => "leaf-1" },
			};
			await handlers.get("message_end")({
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Done. [[PI_ACTION_REQUIRED: Approve the deployment.]]" }],
				},
			}, ctx);
			await handlers.get("agent_settled")({}, ctx);

			// Only the action push; no redundant "finished" push alongside it.
			expect(requests).toHaveLength(1);
			expect(JSON.parse(requests[0].init.body).body).toBe("Pi needs your attention: Approve the deployment.");
		} finally {
			if (previousValues.channel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousValues.channel;
			if (previousValues.webhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousValues.webhook;
			if (previousValues.verbosity === undefined) delete process.env.PI_HARK_VERBOSITY;
			else process.env.PI_HARK_VERBOSITY = previousValues.verbosity;
			if (previousValues.reply === undefined) delete process.env.PI_ACTION_REPLY;
			else process.env.PI_ACTION_REPLY = previousValues.reply;
			globalThis.fetch = previousValues.fetch;
		}
	});

	test("switches Hark verbosity from the command", async () => {
		const previousVerbosity = process.env.PI_HARK_VERBOSITY;
		delete process.env.PI_HARK_VERBOSITY;
		const notices = [];
		try {
			const commands = new Map();
			actionNotifications({
				on: () => {},
				registerCommand: (name, command) => commands.set(name, command),
				registerTool: () => {},
			});
			const ctx = { ui: { notify: (message) => notices.push(message) } };
			await commands.get("action-notifications").handler("verbosity all", ctx);
			expect(harkVerbosity()).toBe("all");
			expect(notices[0]).toContain("everything");
			await commands.get("action-notifications").handler("verbosity reset", ctx);
			expect(harkVerbosity()).toBe("actions");
			await commands.get("action-notifications").handler("verbosity noisy", ctx);
			expect(harkVerbosity()).toBe("actions");
			expect(notices[notices.length - 1]).toContain("Usage");
		} finally {
			setHarkVerbosityOverride(undefined);
			if (previousVerbosity === undefined) delete process.env.PI_HARK_VERBOSITY;
			else process.env.PI_HARK_VERBOSITY = previousVerbosity;
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

describe("live activities", () => {
	test("parses the enabled flag", () => {
		const previous = process.env.PI_HARK_LIVE_ACTIVITY;
		try {
			delete process.env.PI_HARK_LIVE_ACTIVITY;
			expect(liveActivityEnabled()).toBe(false);
			process.env.PI_HARK_LIVE_ACTIVITY = "on";
			expect(liveActivityEnabled()).toBe(true);
			process.env.PI_HARK_LIVE_ACTIVITY = "yes";
			expect(liveActivityEnabled()).toBe(false);
		} finally {
			if (previous === undefined) delete process.env.PI_HARK_LIVE_ACTIVITY;
			else process.env.PI_HARK_LIVE_ACTIVITY = previous;
		}
	});

	test("drives start, update, and end routes", async () => {
		const requests = [];
		const client = createActivityClient({
			webhookUrl: "https://hark.ryan.ceo/hooks/test-token",
			fetchImpl: async (url, init) => {
				requests.push({ url, init });
				if (init.method === "POST" && url.endsWith("/live-activities")) {
					return new Response(JSON.stringify({ ok: true, activityId: "act_1", accepted: 1, sequence: 0 }), { status: 201 });
				}
				if (init.method === "PATCH") {
					return new Response(JSON.stringify({ ok: true, sequence: 3 }), { status: 200 });
				}
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			},
		});

		const started = await client.startActivity(
			{ title: "Pi", status: "Running", style: "terminal", key: "pi-run:s:l", replace: true },
			{ idempotencyKey: "pi-run:s:l:start" },
		);
		expect(started).toMatchObject({ activityId: "act_1", accepted: 1 });
		expect(requests[0].url).toBe("https://hark.ryan.ceo/hooks/test-token/live-activities");
		expect(requests[0].init.headers["Idempotency-Key"]).toBe("pi-run:s:l:start");
		expect(JSON.parse(requests[0].init.body)).toMatchObject({ key: "pi-run:s:l", replace: true });

		const updated = await client.updateActivity("act_1", { status: "Running bash", detail: "2 tool calls" });
		expect(updated).toEqual({ sequence: 3 });
		expect(requests[1].init.method).toBe("PATCH");
		expect(JSON.parse(requests[1].init.body)).toEqual({ status: "Running bash", detail: "2 tool calls" });

		await client.endActivity("act_1", { status: "Done", progress: 1, symbol: "success", dismissAfterSeconds: 60 });
		expect(requests[2].url).toBe("https://hark.ryan.ceo/hooks/test-token/live-activities/act_1/end");
		expect(JSON.parse(requests[2].init.body)).toMatchObject({ status: "Done", progress: 1 });

		const state = await client.getActivity("act_1");
		expect(requests[3].init.method).toBe("GET");
		expect(state.id).toBe("act_1");
	});

	test("tracks a run from start to settle with throttled updates", async () => {
		const previous = {
			live: process.env.PI_HARK_LIVE_ACTIVITY,
			webhook: process.env.PI_HARK_WEBHOOK_URL,
			channel: process.env.PI_ACTION_NOTIFICATIONS_CHANNEL,
			reply: process.env.PI_ACTION_REPLY,
			fetch: globalThis.fetch,
		};
		process.env.PI_HARK_LIVE_ACTIVITY = "on";
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "terminal";
		process.env.PI_ACTION_REPLY = "off";
		const requests = [];
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			if (init.method === "POST" && url.endsWith("/live-activities")) {
				return new Response(JSON.stringify({ ok: true, activityId: "act_7", accepted: 1 }), { status: 201 });
			}
			return new Response(JSON.stringify({ ok: true, sequence: 1 }), { status: 200 });
		};

		try {
			const handlers = new Map();
			actionNotifications({
				on: (event, handler) => handlers.set(event, handler),
				registerCommand: () => {},
				registerTool: () => {},
				sendUserMessage: () => {},
			});
			const ctx = {
				hasUI: false,
				mode: "json",
				cwd: "/Users/x/TrailFinder",
				sessionManager: { getSessionId: () => "s", getLeafId: () => "l" },
			};
			await handlers.get("agent_start")({}, ctx);
			// Handlers fire-and-forget the tracker; drain microtasks before asserting.
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(requests).toHaveLength(1);
			expect(JSON.parse(requests[0].init.body)).toMatchObject({
				title: "Pi · TrailFinder",
				status: "Running",
				key: "pi-run:s:l",
				replace: true,
			});

			await handlers.get("tool_execution_start")({ toolCallId: "1", toolName: "bash", args: {} }, ctx);
			await handlers.get("tool_execution_start")({ toolCallId: "2", toolName: "grep", args: {} }, ctx);
			await new Promise((resolve) => setTimeout(resolve, 0));
			// Second immediate update is throttled into the shared rate budget.
			const patches = requests.filter((r) => r.init.method === "PATCH");
			expect(patches).toHaveLength(1);
			expect(JSON.parse(patches[0].init.body)).toMatchObject({ status: "Running bash" });

			await handlers.get("message_end")({
				message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
			}, ctx);
			await handlers.get("agent_settled")({}, ctx);
			const ends = requests.filter((r) => r.url.endsWith("/end"));
			expect(ends).toHaveLength(1);
			expect(JSON.parse(ends[0].init.body)).toMatchObject({ status: "Done", symbol: "success", progress: 1 });
		} finally {
			if (previous.live === undefined) delete process.env.PI_HARK_LIVE_ACTIVITY;
			else process.env.PI_HARK_LIVE_ACTIVITY = previous.live;
			if (previous.webhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previous.webhook;
			if (previous.channel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previous.channel;
			if (previous.reply === undefined) delete process.env.PI_ACTION_REPLY;
			else process.env.PI_ACTION_REPLY = previous.reply;
			globalThis.fetch = previous.fetch;
		}
	});

	test("stays silent when no device accepts the activity", async () => {
		const previousFetch = globalThis.fetch;
		const previousLive = process.env.PI_HARK_LIVE_ACTIVITY;
		const previousWebhook = process.env.PI_HARK_WEBHOOK_URL;
		const previousChannel = process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
		process.env.PI_HARK_LIVE_ACTIVITY = "on";
		process.env.PI_HARK_WEBHOOK_URL = "https://hark.ryan.ceo/hooks/test-token";
		process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = "terminal";
		const requests = [];
		globalThis.fetch = async (url, init) => {
			requests.push({ url, init });
			return new Response(JSON.stringify({ ok: true, activityId: "act_9", accepted: 0 }), { status: 201 });
		};

		try {
			const handlers = new Map();
			actionNotifications({
				on: (event, handler) => handlers.set(event, handler),
				registerCommand: () => {},
				registerTool: () => {},
				sendUserMessage: () => {},
			});
			const ctx = {
				hasUI: false,
				mode: "json",
				cwd: "/repo",
				sessionManager: { getSessionId: () => "s", getLeafId: () => "l" },
			};
			await handlers.get("agent_start")({}, ctx);
			await new Promise((resolve) => setTimeout(resolve, 0));
			await handlers.get("tool_execution_start")({ toolCallId: "1", toolName: "bash", args: {} }, ctx);
			await handlers.get("message_end")({
				message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
			}, ctx);
			await handlers.get("agent_settled")({}, ctx);
			// Only the start attempt; no updates, no end.
			expect(requests).toHaveLength(1);
		} finally {
			globalThis.fetch = previousFetch;
			if (previousLive === undefined) delete process.env.PI_HARK_LIVE_ACTIVITY;
			else process.env.PI_HARK_LIVE_ACTIVITY = previousLive;
			if (previousWebhook === undefined) delete process.env.PI_HARK_WEBHOOK_URL;
			else process.env.PI_HARK_WEBHOOK_URL = previousWebhook;
			if (previousChannel === undefined) delete process.env.PI_ACTION_NOTIFICATIONS_CHANNEL;
			else process.env.PI_ACTION_NOTIFICATIONS_CHANNEL = previousChannel;
		}
	});
});

describe("webfetch", () => {
	test("extracts readable HTML text and title", () => {
		expect(htmlToText("<html><title>Docs</title><script>bad()</script><main><h1>Hello</h1><p>World &amp; friends</p></main></html>"))
			.toBe("# Docs\n\n# Hello\nWorld & friends");
	});
});
