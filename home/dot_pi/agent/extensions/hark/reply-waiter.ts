// Verbatim extraction from agent/extensions/hark/index.ts (decisions Q1-Q16,
// Q8: no behavior/number changes). Pure waiter + question builder only.
// The offerReply injection (pi.sendUserMessage) STAYS in index.ts.
// Shared timeouts imported from ./config.ts — no duplication drift.
import {
	createHarkClient,
	HarkError,
	type HarkEventResult,
	type HarkResponseType,
} from "./hark-client.ts";
import { MAX_HARK_READ_RETRIES, harkPollIntervalMs } from "./config.ts";

export { DEFAULT_REPLY_TIMEOUT_SECONDS, MAX_CONSECUTIVE_AUTO_REPLIES } from "./config.ts";

const APPROVAL_REQUEST_LANGUAGE = /\b(approv(?:e|es|ed|al)|confirm|deny|accept|reject|proceed|merge|deploy|ship it)\b/i;
const YES_NO_LEAD = /^(is|are|was|were|do|does|did|can|could|should|would|will|shall|have|has|had|may)\b/i;

/** Only answerable items get an interactive prompt; statements stay one-way. */
export function isAnswerable(summary: string): boolean {
	const text = summary.trim();

	return /\?\s*$/.test(text) || APPROVAL_REQUEST_LANGUAGE.test(text);
}

export function inferReplyType(summary: string): HarkResponseType {
	const text = summary.trim();

	if (APPROVAL_REQUEST_LANGUAGE.test(text)) return "approval";

	if (/\?\s*$/.test(text) && (YES_NO_LEAD.test(text) || /\bor\b/i.test(text))) return "yes_no";

	return "text";
}

function waitForSignal(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new Error("Aborted"));

			return;
		}

		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);

		const onAbort = () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
			reject(signal?.reason ?? new Error("Aborted"));
		};

		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export function responseText(event: HarkEventResult): string {
	const response = event.response;

	if (response.status === "replied") return response.text?.trim() ? `replied: ${response.text}` : "replied";

	if (response.action) return `${response.status} (${response.action})`;

	return response.status;
}

function isTransientReadError(error: Error): boolean {
	if (error instanceof HarkError) return error.status === 429 || error.status >= 500;

	// Network-level failures (no HTTP status) are worth one retry cycle.
	return /fetch|network|timeout|econn|socket/i.test(error.message);
}

export async function waitForHarkResponse(
	client: NonNullable<ReturnType<typeof createHarkClient>>,
	eventId: string,
	timeoutSeconds: number,
	signal: AbortSignal,
	onProgress?: (elapsedSeconds: number) => void,
): Promise<HarkEventResult> {
	const pollIntervalMs = harkPollIntervalMs();
	const deadline = Date.now() + timeoutSeconds * 1_000;
	const startedAt = Date.now();
	let consecutiveFailures = 0;

	const readWithRetry = async (): Promise<HarkEventResult | undefined> => {
		try {
			const result = await client.readResponse(eventId, signal);
			consecutiveFailures = 0;

			return result;
		} catch (error) {
			if (
				signal.aborted ||
				!(error instanceof Error) ||
				!isTransientReadError(error) ||
				consecutiveFailures >= MAX_HARK_READ_RETRIES
			) {
				throw error;
			}

			consecutiveFailures += 1;

			return undefined;
		}
	};

	let latest = await client.readResponse(eventId, signal);

	while (latest.response.status === "pending" && Date.now() < deadline) {
		await waitForSignal(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())), signal);
		const next = await readWithRetry().catch(() => null);

		if (next) latest = next;
		// Progress even through transient blips so long waits are visible.
		onProgress?.(Math.round((Date.now() - startedAt) / 1_000));
	}

	if (latest.response.status === "pending") {
		await client.cancelResponse(eventId).catch(() => undefined);

		return {
			...latest,
			response: { ...latest.response, status: "expired", action: undefined, text: null },
		};
	}

	return latest;
}

export interface InteractiveQuestion {
	question: string;
	responseType: HarkResponseType;
	timeoutSeconds: number;
	correlationId: string;
	idempotencyKey: string;
	signal?: AbortSignal;
}

export function sendInteractiveQuestion(
	client: NonNullable<ReturnType<typeof createHarkClient>>,
	question: InteractiveQuestion,
) {
	return client.sendInteractive(
		{
			title: process.env.PI_HARK_TITLE?.trim() || "Pi",
			project: process.env.PI_HARK_PROJECT?.trim() || "Pi",
			url: process.env.PI_HARK_TAP_URL?.trim() || undefined,
			body: question.question.slice(0, 2_000),
			summary: question.question.slice(0, 500),
			response: { type: question.responseType, expiresInSeconds: question.timeoutSeconds, correlationId: question.correlationId },
		},
		{ idempotencyKey: question.idempotencyKey, signal: question.signal ?? AbortSignal.timeout(10_000) },
	);
}
