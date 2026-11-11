export const ACTION_MARKER = /\[\[\s*PI_ACTION_REQUIRED\s*:\s*([\s\S]*?)\s*\]\]/i;
export const ACTION_MARKER_GLOBAL = /\[\[\s*PI_ACTION_REQUIRED\s*:\s*[\s\S]*?\s*\]\]\s*/gi;

import { MAX_NOTIFICATION_LENGTH } from "./config.ts";

export const MARKER_INSTRUCTION_SENTINEL = "PI_ACTION_REQUIRED";

/**
 * Approval-gated verbs only. Deliberately excludes generic build verbs
 * (run/open/add/update/create/check/commit/push/...) that fired on
 * nearly every assistant reply in the previous broad list.
 */
export const ACTION_WORDS = [
	"please",
	"you need to",
	"you must",
	"you should",
	"confirm",
	"approve",
	"decide",
	"choose",
	"select",
	"provide",
	"enter",
	"paste",
	"review",
	"install",
	"execute",
	"configure",
];

const SECOND_PERSON = /\b(you|your|yours)\b/i;
const QUESTION_WORD = /^(which|what|when|where|who|why|how|should|can|could|would|do|does|did|is|are|will|may)\b/i;

const NO_ACTION =
	/\b(?:no action(?:s)? (?:is|are) required|nothing for you to do|you do not need to do anything|you don't need to do anything)\b/i;

const NO_ACTION_MARKER = /^(?:none|nothing|no action(?: is required)?)$/i;

export interface ActionRequired {
	summary: string;
	source: "marker" | "heuristic";
}

function removeCode(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`[^`\n]*`/g, "");
}

function cleanSummary(text: string): string {
	const cleaned = text
		// oxlint-disable-next-line eslint/no-control-regex -- strip terminal control characters from notification text.
		.replace(/[\u0000-\u001f\u007f\u001b]/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^(?:\s*(?:[>\-•*]|\d+[.)])+\s+)+/, "")
		.trim();

	return cleaned.length > MAX_NOTIFICATION_LENGTH
		? `${cleaned.slice(0, MAX_NOTIFICATION_LENGTH - 1).trimEnd()}…`
		: cleaned;
}

function splitSentences(text: string): string[] {
	return text.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
}

function sentenceContaining(text: string, expression: RegExp): string | undefined {
	return splitSentences(text).find((candidate) => expression.test(candidate));
}

function actionPattern(): RegExp {
	return new RegExp(`\\b(?:${ACTION_WORDS.join("|")})\\b`, "i");
}

function isOptionalSuggestion(text: string): boolean {
	return /\b(?:if you(?:'d| would) like|if you want|optionally|feel free|you may want to|consider)\b/i.test(text);
}

function isActionQuestion(sentence: string): boolean {
	return actionPattern().test(sentence) || SECOND_PERSON.test(sentence) || QUESTION_WORD.test(sentence);
}

/**
 * Detects an action request in finalized assistant text.
 *
 * The marker is the reliable path. The heuristic is intentionally conservative:
 * it ignores fenced/inline code, checks explicit no-action language first, and
 * only treats a question as actionable when it appears among the last two
 * sentences (mid-task rhetorical questions do not alert).
 */
export function detectActionRequired(text: string): ActionRequired | undefined {
	const marker = ACTION_MARKER.exec(text);

	if (marker) {
		const summary = cleanSummary(marker[1] ?? "");

		if (NO_ACTION_MARKER.test(summary)) return undefined;

		if (summary) return { summary, source: "marker" };
	}

	const readable = removeCode(text);

	if (NO_ACTION.test(readable)) return undefined;

	const sentences = splitSentences(readable);
	const tail = sentences.slice(-2);
	const question = tail.find((candidate) => /\?\s*$/.test(candidate));

	if (question && !isOptionalSuggestion(question) && isActionQuestion(question)) {
		return { summary: cleanSummary(question), source: "heuristic" };
	}

	const action = sentenceContaining(readable, actionPattern());

	if (action && !isOptionalSuggestion(action)) return { summary: cleanSummary(action), source: "heuristic" };

	return undefined;
}

/**
 * Short "what was done" summary for the settle ping: the last two declarative
 * sentences, code and markers stripped. Deterministic — no LLM call.
 */
export function doneSummary(text: string): string | undefined {
	const readable = removeCode(text.replace(ACTION_MARKER_GLOBAL, " "));
	const sentences = splitSentences(readable).filter((sentence) => !/\?\s*$/.test(sentence));
	const tail = (sentences.length > 0 ? sentences : splitSentences(readable)).slice(-2);

	if (tail.length === 0) return undefined;
	const summary = cleanSummary(tail.join(" "));

	return summary ? summary : undefined;
}

export function doneSummaryEnabled(): boolean {
	return process.env.PI_HARK_DONE_SUMMARY !== "off";
}
