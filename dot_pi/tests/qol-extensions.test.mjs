import { describe, expect, test } from "bun:test";
import { matchDangerousCommand } from "../agent/extensions/lib/dangerous-commands.ts";
import { DEFAULT_PRUNE_OPTIONS, pruneMessages } from "../agent/extensions/context-pruner.ts";
import { slugifySessionName } from "../agent/extensions/session-namer.ts";

describe("dangerous command matcher", () => {
	test("flags destructive commands with their reason", () => {
		expect(matchDangerousCommand("rm -rf /tmp/x")?.reason).toBe("recursive deletion");
		expect(matchDangerousCommand("sudo apt install")?.reason).toBe("elevated privileges");
		expect(matchDangerousCommand("git reset --hard origin/main")?.reason).toBe("discarding tracked changes");
	});

	test("flags writes to likely secret material", () => {
		expect(matchDangerousCommand("cp server.pem backup/")?.reason).toBe("modifying likely secret material");
		expect(matchDangerousCommand("echo x > .env")?.reason).toBe("modifying likely secret material");
	});

	test("ignores safe commands", () => {
		expect(matchDangerousCommand("ls -la")).toBeUndefined();
		expect(matchDangerousCommand("rm single-file.txt")).toBeUndefined();
		expect(matchDangerousCommand("git status")).toBeUndefined();
	});
});

describe("context pruner", () => {
	const toolResult = (text, opts = {}) => ({
		role: "toolResult",
		toolName: opts.toolName ?? "bash",
		isError: opts.isError ?? false,
		content: [{ type: "text", text }],
	});
	const user = (text) => ({ role: "user", content: text });

	test("prunes oversized old tool results and keeps recent turns intact", () => {
		const messages = [
			toolResult("x".repeat(3000), { toolName: "read" }),
			user("first"),
			toolResult("y".repeat(3000)),
			user("second"),
			toolResult("kept"),
			user("third"),
			user("fourth"),
		];
		const pruned = pruneMessages(messages, { keepUserTurns: 2, minChars: 2000 });
		expect(pruned[0].content[0].text).toContain("pruned by context-pruner: read result, 3000 chars");
		expect(pruned[2].content[0].text).toContain("pruned by context-pruner: bash result, 3000 chars");
		expect(pruned[4].content[0].text).toBe("kept");
		expect(pruned[5]).toBe(messages[5]);
	});

	test("never prunes error results", () => {
		const messages = [toolResult("e".repeat(3000), { isError: true }), user("a"), user("b"), user("c"), user("d")];
		expect(pruneMessages(messages, DEFAULT_PRUNE_OPTIONS)[0].content[0].text).toBe("e".repeat(3000));
	});

	test("leaves small results and short histories alone", () => {
		const short = [user("only one turn"), toolResult("s".repeat(3000))];
		expect(pruneMessages(short, DEFAULT_PRUNE_OPTIONS)).toBe(short);

		const small = [user("a"), toolResult("small"), user("b"), user("c"), user("d")];
		expect(pruneMessages(small, DEFAULT_PRUNE_OPTIONS)[1].content[0].text).toBe("small");
	});
});

describe("session name slug", () => {
	test("keeps the first words and strips markdown", () => {
		expect(slugifySessionName("## Fix **auth** bug\n\nin the login flow please")).toBe("Fix auth bug in the login");
	});

	test("drops fenced code blocks and caps length", () => {
		expect(slugifySessionName("```\nrm -rf /\n```")).toBe("");
		expect(slugifySessionName("word ".repeat(40)).length).toBeLessThanOrEqual(60);
	});
});
