import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { HarkLiveTracker } from "../agent/extensions/hark/live-tracker.ts";
import { sessionKey } from "../agent/extensions/hark/config.ts";

const KEYS = [
	"PI_HARK_LIVE_ACTIVITY",
	"PI_HARK_TITLE",
	"PI_HARK_LIVE_PATCH_MS",
	"PI_HARK_LIVE_DISMISS_AFTER",
	"PI_HARK_WEBHOOK_URL",
];

const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => {
	process.env.PI_HARK_LIVE_ACTIVITY = "on";
	delete process.env.PI_HARK_TITLE;
	delete process.env.PI_HARK_LIVE_PATCH_MS;
	delete process.env.PI_HARK_LIVE_DISMISS_AFTER;
});

afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

function makeFakes({ accepted = 1 } = {}) {
	const calls = { start: [], update: [], end: [] };

	const fns = {
		startActivity: async (input, options) => {
			calls.start.push({ input, options });

			return { activityId: "act-1", accepted };
		},
		updateActivity: async (id, patch, options) => {
			calls.update.push({ id, patch, options });

			return {};
		},
		endActivity: async (id, input, options) => {
			calls.end.push({ id, input, options });
		},
	};

	return { calls, fns };
}

const identity = () => ({ sessionId: "sess-1", leafId: "leaf-1", cwd: "/Users/x/myproj" });
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("hark live tracker", () => {
	test("start uses replace:true + stable key + constant payload", async () => {
		const { calls, fns } = makeFakes();
		const tracker = new HarkLiveTracker(identity(), fns);
		await tracker.start();
		const key = sessionKey("pi-run", "sess-1", "leaf-1");
		expect(calls.start).toHaveLength(1);
		expect(calls.start[0].input.key).toBe(key);
		expect(calls.start[0].input.replace).toBe(true);
		expect(calls.start[0].input.title).toBe("Pi · myproj");
		expect(calls.start[0].input.status).toBe("Running");
		expect(calls.start[0].input.style).toBe("terminal");
		expect(calls.start[0].options.idempotencyKey).toBe(`${key}:start`);
		await tracker.start();
		expect(calls.start).toHaveLength(2);
		expect(calls.start[1].input).toEqual(calls.start[0].input);
	});

	test("throttle coalesces rapid patches, force bypasses", async () => {
		const { calls, fns } = makeFakes();
		const tracker = new HarkLiveTracker(identity(), fns);
		await tracker.start();
		await tracker.patch("Running bash");
		await tracker.patch("Running edit");
		expect(calls.update).toHaveLength(1);
		await tracker.patch("Running edit", undefined, true);
		expect(calls.update).toHaveLength(2);
		expect(calls.update[0].id).toBe("act-1");
	});

	test("noteTool counts tools and patches with tool-count detail", async () => {
		const { calls, fns } = makeFakes();
		const tracker = new HarkLiveTracker(identity(), fns);
		await tracker.start();
		tracker.noteTool("bash");
		await flush();
		expect(tracker.toolCalls).toBe(1);
		expect(calls.update).toHaveLength(1);
		expect(calls.update[0].patch.status).toBe("Running bash");
		expect(calls.update[0].patch.detail).toBe("1 tool call");
		tracker.noteTool("edit");
		await flush();
		expect(tracker.toolCalls).toBe(2);
		expect(tracker.toolDetail()).toBe("2 tool calls");
	});

	test("accepted:0 disables silently (no patch/end calls)", async () => {
		const { calls, fns } = makeFakes({ accepted: 0 });
		const tracker = new HarkLiveTracker(identity(), fns);
		await tracker.start();
		expect(tracker.usable).toBe(false);
		await tracker.patch("Running bash");
		await tracker.end("Done", "success");
		expect(calls.update).toHaveLength(0);
		expect(calls.end).toHaveLength(0);
	});

	test("end only once; patch after end is a no-op", async () => {
		const { calls, fns } = makeFakes();
		const tracker = new HarkLiveTracker(identity(), fns);
		await tracker.start();
		await tracker.end("Done", "success");
		await tracker.end("Done", "success");
		expect(calls.end).toHaveLength(1);
		expect(calls.end[0].input.status).toBe("Done");
		expect(calls.end[0].input.symbol).toBe("success");
		expect(calls.end[0].input.progress).toBe(1);
		expect(calls.end[0].input.dismissAfterSeconds).toBe(120);
		expect(tracker.ended).toBe(true);
		await tracker.patch("Running late");
		expect(calls.update).toHaveLength(0);
	});

	test("no client (no webhook) stays silently disabled", async () => {
		delete process.env.PI_HARK_WEBHOOK_URL;
		const tracker = new HarkLiveTracker(identity());
		await tracker.start();
		expect(tracker.usable).toBe(false);
		await tracker.patch("x");
		await tracker.end("Done", "success");
	});

	test("throwing client never rejects", async () => {
		const bad = {
			startActivity: async () => { throw new Error("boom"); },
			updateActivity: async () => { throw new Error("boom"); },
			endActivity: async () => { throw new Error("boom"); },
		};

		const tracker = new HarkLiveTracker(identity(), bad);
		await tracker.start();
		await tracker.patch("x");
		tracker.noteTool("bash");
		await tracker.end("Done", "success");
		await flush();
		expect(tracker.usable).toBe(false);
	});
});
