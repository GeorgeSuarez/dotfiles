import { describe, expect, test, afterEach } from "bun:test";
import {
	sessionKey,
	shortHash,
	harkPollIntervalMs,
	replyTimeoutSeconds,
	liveDismissAfterSeconds,
} from "../agent/extensions/hark/config.ts";

const ENV_KEYS = ["PI_HARK_POLL_INTERVAL_MS", "PI_ACTION_REPLY_TIMEOUT", "PI_HARK_LIVE_DISMISS_AFTER"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe("hark config: sessionKey", () => {
	test("short key is verbatim prefix:session:leaf", () => {
		expect(sessionKey("pi-run", "sess1", "leafA")).toBe("pi-run:sess1:leafA");
	});

	test("null leafId falls back to suffix", () => {
		expect(sessionKey("pi-run", "sess1", null)).toBe("pi-run:sess1:leaf");
		expect(sessionKey("pi-run", "sess1", undefined, "custom")).toBe("pi-run:sess1:custom");
	});

	test("key sanitize rule: short keys keep prefix:session:leaf shape, no mangling", () => {
		const key = sessionKey("pi-reply", "abc-123_XYZ", "leaf-9_0");
		expect(key).toBe("pi-reply:abc-123_XYZ:leaf-9_0");
		expect(key).toMatch(/^[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
	});

	test("160-char bound with hash tail", () => {
		const long = "s".repeat(200);
		const key = sessionKey("pi-run", long, "leafB");
		expect(key.length).toBeLessThanOrEqual(160);
		expect(key).toMatch(/:[0-9a-f]{8}$/);
		const base = `pi-run:${long}:leafB`;
		expect(key).toBe(`${base.slice(0, 120)}:${shortHash(base)}`);
	});

	test("boundary: 160 chars untouched, 161 hashed", () => {
		const prefix = "p";
		// base = "p:" + session + ":" + "l" -> session len for exactly 160
		const at160 = "s".repeat(160 - prefix.length - 1 - 1 - 1);
		expect(sessionKey(prefix, at160, "l")).toHaveLength(160);
		const over = `s`.repeat(161 - prefix.length - 1 - 1 - 1);
		expect(sessionKey(prefix, over, "l")).toMatch(/:[0-9a-f]{8}$/);
	});
});

describe("hark config: clamps", () => {
	test("poll-interval clamp 1000-30000 default 3000", () => {
		delete process.env.PI_HARK_POLL_INTERVAL_MS;
		expect(harkPollIntervalMs()).toBe(3000);
		process.env.PI_HARK_POLL_INTERVAL_MS = "not-a-number";
		expect(harkPollIntervalMs()).toBe(3000);
		process.env.PI_HARK_POLL_INTERVAL_MS = "10";
		expect(harkPollIntervalMs()).toBe(1000);
		process.env.PI_HARK_POLL_INTERVAL_MS = "999999";
		expect(harkPollIntervalMs()).toBe(30000);
		process.env.PI_HARK_POLL_INTERVAL_MS = "5000";
		expect(harkPollIntervalMs()).toBe(5000);
	});

	test("reply-timeout clamp 30-86400 default 600", () => {
		delete process.env.PI_ACTION_REPLY_TIMEOUT;
		expect(replyTimeoutSeconds()).toBe(600);
		process.env.PI_ACTION_REPLY_TIMEOUT = "bogus";
		expect(replyTimeoutSeconds()).toBe(600);
		process.env.PI_ACTION_REPLY_TIMEOUT = "5";
		expect(replyTimeoutSeconds()).toBe(30);
		process.env.PI_ACTION_REPLY_TIMEOUT = "9999999";
		expect(replyTimeoutSeconds()).toBe(86400);
		process.env.PI_ACTION_REPLY_TIMEOUT = "1200";
		expect(replyTimeoutSeconds()).toBe(1200);
	});

	test("dismiss clamp 0-14400 default 120", () => {
		delete process.env.PI_HARK_LIVE_DISMISS_AFTER;
		expect(liveDismissAfterSeconds()).toBe(120);
		process.env.PI_HARK_LIVE_DISMISS_AFTER = "NaN-bogus";
		expect(liveDismissAfterSeconds()).toBe(120);
		process.env.PI_HARK_LIVE_DISMISS_AFTER = "-5";
		expect(liveDismissAfterSeconds()).toBe(0);
		process.env.PI_HARK_LIVE_DISMISS_AFTER = "999999";
		expect(liveDismissAfterSeconds()).toBe(14400);
		process.env.PI_HARK_LIVE_DISMISS_AFTER = "300";
		expect(liveDismissAfterSeconds()).toBe(300);
	});
});
