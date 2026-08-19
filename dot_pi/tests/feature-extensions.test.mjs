import { describe, expect, test } from "bun:test";
import { htmlToText } from "../agent/extensions/webfetch.ts";

describe("webfetch", () => {
	test("extracts readable HTML text and title", () => {
		expect(htmlToText("<html><title>Docs</title><script>bad()</script><main><h1>Hello</h1><p>World &amp; friends</p></main></html>"))
			.toBe("# Docs\n\n# Hello\nWorld & friends");
	});
});
