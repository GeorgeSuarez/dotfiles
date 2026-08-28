import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ponytail: prune heuristic is by message age + char count, not token-budgeted;
// if auto-compaction still fires often, track token counts and prune to a budget.

export interface PruneOptions {
	/** Number of most-recent user messages whose context is left untouched. */
	keepUserTurns: number;
	/** Only prune tool results larger than this many characters. */
	minChars: number;
}

export const DEFAULT_PRUNE_OPTIONS: PruneOptions = { keepUserTurns: 3, minChars: 2000 };

function textLength(content: unknown): number {
	if (typeof content === "string") return content.length;
	if (!Array.isArray(content)) return 0;
	let total = 0;
	for (const part of content) {
		if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
			total += String((part as { text?: unknown }).text ?? "").length;
		}
	}
	return total;
}

interface PrunableMessage {
	role: string;
	content?: unknown;
	isError?: boolean;
	toolName?: string;
}

/**
 * Replace oversized tool results older than `keepUserTurns` user messages with
 * one-line placeholders. Error results are never pruned — they may explain the
 * current state. Returns the input array unchanged when there is nothing to do.
 */
export function pruneMessages<T extends PrunableMessage>(messages: T[], options: PruneOptions = DEFAULT_PRUNE_OPTIONS): T[] {
	const userIndexes: number[] = [];
	messages.forEach((message, index) => {
		if (message.role === "user") userIndexes.push(index);
	});
	const cutoffIndex = userIndexes.length > options.keepUserTurns ? userIndexes[userIndexes.length - 1 - options.keepUserTurns] : -1;
	if (cutoffIndex <= 0) return messages;

	return messages.map((message, index) => {
		if (index >= cutoffIndex) return message;
		if (message.role !== "toolResult" || message.isError) return message;
		const length = textLength(message.content);
		if (length <= options.minChars) return message;
		const toolName = message.toolName ?? "tool";
		return {
			...message,
			content: [{ type: "text", text: `[pruned by context-pruner: ${toolName} result, ${length} chars]` }],
		};
	});
}

function intEnv(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

export default function contextPruner(pi: ExtensionAPI) {
	pi.on("context", async (event) => {
		if (process.env.PI_PRUNER === "off") return undefined;
		const messages = pruneMessages(event.messages, {
			keepUserTurns: intEnv("PI_PRUNER_KEEP_TURNS", DEFAULT_PRUNE_OPTIONS.keepUserTurns),
			minChars: intEnv("PI_PRUNER_MIN_CHARS", DEFAULT_PRUNE_OPTIONS.minChars),
		});
		return { messages };
	});
}
