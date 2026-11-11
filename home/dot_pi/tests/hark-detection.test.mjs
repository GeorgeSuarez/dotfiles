import { describe, expect, test } from "bun:test";
import { detectActionRequired, doneSummary } from "../agent/extensions/hark/detection.ts";

describe("hark detection", () => {
	test("marker path", () => {
		const result = detectActionRequired("Done.\n[[PI_ACTION_REQUIRED: Please approve the deploy]]");
		expect(result?.source).toBe("marker");
		expect(result?.summary).toContain("approve");
	});

	test("NO_ACTION guard", () => {
		expect(detectActionRequired("No action is required. Thanks!")).toBeUndefined();
		expect(detectActionRequired("Done [[PI_ACTION_REQUIRED: none]]")).toBeUndefined();
	});

	test("trailing-question heuristic", () => {
		const mid = detectActionRequired("Should I refactor this? I decided to keep it. All done.");
		expect(mid).toBeUndefined();
		const tail = detectActionRequired("All done. Which option should you choose?");
		expect(tail?.source).toBe("heuristic");
		expect(tail?.summary).toContain("choose");
	});

	test("action-word sentence", () => {
		const result = detectActionRequired("All done. Please confirm the plan.");
		expect(result?.source).toBe("heuristic");
		expect(result?.summary).toContain("confirm");
	});

	test("doneSummary declarative tail", () => {
		const summary = doneSummary("Did it work? Yes. Deployed the fix. Updated the docs.");
		expect(summary).toContain("Deployed the fix.");
		expect(summary).not.toContain("?");
	});

	test("code-fence stripping", () => {
		expect(detectActionRequired("```\nPlease confirm the deploy\n```\nAll done.")).toBeUndefined();
		const summary = doneSummary("```\ncode here\n```\nDeployed the fix.");
		expect(summary).toContain("Deployed the fix.");
		expect(summary).not.toContain("code here");
	});
});
