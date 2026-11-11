import { describe, expect, test } from "bun:test";
import {
	inferReplyType,
	isAnswerable,
	responseText,
	sendInteractiveQuestion,
	waitForHarkResponse,
} from "../agent/extensions/hark/reply-waiter.ts";

process.env.PI_HARK_POLL_INTERVAL_MS = "1000";

const pending = (eventId = "e1") => ({ eventId, response: { status: "pending" } });

function fakeClient(impl) {
	return {
		readCalls: 0,
		cancelCalls: 0,
		...impl,
	};
}

describe("hark reply-waiter", () => {
	test("timeout→expired calls cancelResponse", async () => {
		const client = fakeClient({
			async readResponse(eventId) {
				this.readCalls += 1;

				return pending(eventId);
			},
			async cancelResponse() {
				this.cancelCalls += 1;
			},
		});

		const result = await waitForHarkResponse(client, "e1", 0, new AbortController().signal);
		expect(result.response.status).toBe("expired");
		expect(client.cancelCalls).toBe(1);
	});

	test("transient 429/5xx retried then success", async () => {
		const failures = [{ status: 429 }, { status: 429 }, { status: 500 }];

		const client = fakeClient({
			async readResponse(eventId) {
				this.readCalls += 1;

				if (this.readCalls === 1) return pending(eventId);

				if (failures.length > 0) throw failures.shift();

				return { eventId, response: { status: "approved", action: "approve" } };
			},
			async cancelResponse() {
				this.cancelCalls += 1;
			},
		});

		const seen = [];
		const result = await waitForHarkResponse(client, "e1", 30, new AbortController().signal, (s) => seen.push(s));
		expect(result.response.status).toBe("approved");
		expect(responseText(result)).toBe("approved (approve)");
		// 1 initial + 3 transient + 1 success = 5 reads (within ≤5 retry budget)
		expect(client.readCalls).toBe(5);
		expect(client.cancelCalls).toBe(0);
		expect(seen.length).toBeGreaterThan(0);
	});

	test("402 passthrough uncaught", async () => {
		const client = fakeClient({
			async readResponse() {
				this.readCalls += 1;
				throw { status: 402 };
			},
			async cancelResponse() {
				this.cancelCalls += 1;
			},
		});

		let caught;

		try {
			await waitForHarkResponse(client, "e1", 30, new AbortController().signal);
		} catch (error) {
			caught = error;
		}

		expect(caught?.status).toBe(402);
		expect(client.cancelCalls).toBe(0);
	});

	test("isAnswerable/inferReplyType matrix", () => {
		expect(isAnswerable("Please approve the deploy")).toBe(true);
		expect(inferReplyType("Please approve the deploy")).toBe("approval");
		expect(isAnswerable("Is the build green?")).toBe(true);
		expect(inferReplyType("Is the build green?")).toBe("yes_no");
		expect(isAnswerable("Tea or coffee?")).toBe(true);
		expect(inferReplyType("Tea or coffee?")).toBe("yes_no");
		expect(isAnswerable("Deployed the fix.")).toBe(false);
		expect(inferReplyType("Deployed the fix.")).toBe("text");
		expect(isAnswerable("Please confirm the plan.")).toBe(true);
		expect(inferReplyType("Please confirm the plan.")).toBe("approval");
	});

	test("sendInteractiveQuestion builds bounded payload", async () => {
		let sent;

		const client = {
			async sendInteractive(notification, options) {
				sent = { notification, options };

				return { eventId: "e9" };
			},
		};

		const question = "Q".repeat(3_000);

		const result = await sendInteractiveQuestion(client, {
			question,
			responseType: "text",
			timeoutSeconds: 600,
			correlationId: "corr",
			idempotencyKey: "key",
		});

		expect(result.eventId).toBe("e9");
		expect(sent.notification.body.length).toBe(2_000);
		expect(sent.notification.summary.length).toBe(500);
		expect(sent.notification.response).toEqual({ type: "text", expiresInSeconds: 600, correlationId: "corr" });
	});
});
