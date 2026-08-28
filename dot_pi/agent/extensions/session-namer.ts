import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export function slugifySessionName(text: string): string {
	const cleaned = text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/[#>*_`~[\]()]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned.split(" ").slice(0, 6).join(" ").slice(0, 60).trim();
}

function firstUserText(ctx: ExtensionContext): string | undefined {
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const content = (entry.message as { content: unknown }).content;
		const text =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content
							.filter((part): part is { type: "text"; text: string } => Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text"))
							.map((part) => part.text)
							.join(" ")
					: "";
		const trimmed = text.trim();
		if (trimmed && !trimmed.startsWith("/")) return trimmed;
	}
	return undefined;
}

/**
 * Names the session from the first real user message so `/resume` and `pi -r`
 * pickers show meaningful names instead of first-message previews.
 */
export default function sessionNamer(pi: ExtensionAPI) {
	pi.on("turn_end", async (_event, ctx) => {
		if (pi.getSessionName()) return;
		const text = firstUserText(ctx);
		if (!text) return;
		const name = slugifySessionName(text);
		if (name) pi.setSessionName(name);
	});
}
