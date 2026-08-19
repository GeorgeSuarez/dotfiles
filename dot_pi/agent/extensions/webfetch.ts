import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

const MAX_BYTES = 50 * 1024;
const TIMEOUT_MS = 25_000;
const Parameters = Type.Object({
	url: Type.String({ description: "HTTP or HTTPS URL to fetch" }),
	format: Type.Optional(
		StringEnum(["auto", "markdown", "text", "raw"] as const, {
			description: "Output format. Auto converts HTML pages to readable text.",
		}),
	),
});
type Params = Static<typeof Parameters>;

function decodeEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'");
}

export function htmlToText(html: string): string {
	const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	const body = html
		.replace(/<(script|style|noscript|template|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
		.replace(/<h1[^>]*>/gi, "\n# ")
		.replace(/<h2[^>]*>/gi, "\n## ")
		.replace(/<h3[^>]*>/gi, "\n### ")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|article|section|h[1-6]|li|tr|blockquote)>/gi, "\n")
		.replace(/<[^>]+>/g, " ");
	const text = decodeEntities(body)
		.replace(/[ \t]+/g, " ")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return [title ? `# ${decodeEntities(title.trim())}` : "", text].filter(Boolean).join("\n\n");
}

async function readBounded(response: Response, signal: AbortSignal): Promise<{ text: string; truncated: boolean }> {
	if (!response.body) {
		const raw = await response.text();
		const bytes = new TextEncoder().encode(raw);
		return { text: new TextDecoder().decode(bytes.slice(0, MAX_BYTES)), truncated: bytes.byteLength > MAX_BYTES };
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	let truncated = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (signal.aborted) throw new DOMException("Fetch aborted", "AbortError");
			const remaining = MAX_BYTES - total;
			if (value.byteLength > remaining) {
				if (remaining > 0) chunks.push(value.slice(0, remaining));
				total = MAX_BYTES;
				truncated = true;
				await reader.cancel("response truncated");
				break;
			}
			total += value.byteLength;
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const data = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { text: new TextDecoder().decode(data), truncated };
}

function validateUrl(input: string): URL {
	const url = new URL(input);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Only HTTP and HTTPS URLs are supported");
	}
	return url;
}

export default function webfetch(pi: ExtensionAPI) {
	pi.registerTool({
		name: "webfetch",
		label: "Web Fetch",
		description: "Fetch a web page or API response and return bounded, readable content with its source URL.",
		promptSnippet: "Fetch and read a specific web page or API URL",
		promptGuidelines: [
			"Use webfetch after websearch when you need authoritative content from a specific URL.",
			"Preserve the fetched source URL when citing webfetch results.",
		],
		parameters: Parameters,
		execute: async (_toolCallId, params, signal) => {
			const url = validateUrl(params.url);
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
			const onAbort = () => controller.abort();
			signal?.addEventListener("abort", onAbort, { once: true });
			try {
				const response = await fetch(url, {
					headers: { Accept: "text/markdown, text/html, application/json, text/plain;q=0.9, */*;q=0.1" },
					signal: controller.signal,
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const fetched = await readBounded(response, controller.signal);
				const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
				const format = params.format ?? "auto";
				const text = format === "raw" || format === "text" || (format === "auto" && !contentType.includes("html"))
					? fetched.text
					: htmlToText(fetched.text);
				return {
					content: [{ type: "text", text: `Source: ${url}${fetched.truncated ? " (response truncated)" : ""}\n\n${text}` }],
					details: { url: url.toString(), contentType, truncated: fetched.truncated },
				};
			} catch (error) {
				throw new Error(`Unable to fetch ${url}: ${error instanceof Error ? error.message : String(error)}`);
			} finally {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
			}
		},
	});
}
