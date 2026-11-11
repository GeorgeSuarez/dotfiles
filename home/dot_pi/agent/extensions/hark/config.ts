// Verbatim extraction from agent/extensions/hark/index.ts (decisions Q1-Q16:
// no behavior change). Pure config only: constants + env readers + key/title
// helpers. No process side-effects on import; env is read lazily inside
// functions exactly as in index.ts. index.ts remains canonical until wiring.
// sessionKey/projectLabel are pure here: they take sessionId/leafId/cwd args
// instead of ctx (same join/hash logic, testable without ExtensionContext).

export const MAX_NOTIFICATION_LENGTH = 240;
export const DEFAULT_HARK_TIMEOUT_SECONDS = 900;
export const DEFAULT_HARK_POLL_INTERVAL_MS = 3_000;
export const MIN_HARK_POLL_INTERVAL_MS = 1_000;
export const MAX_HARK_POLL_INTERVAL_MS = 30_000;
export const MAX_HARK_READ_RETRIES = 5;
export const DEFAULT_REPLY_TIMEOUT_SECONDS = 600;
export const MAX_CONSECUTIVE_AUTO_REPLIES = 3;
export const DEFAULT_LIVE_PATCH_INTERVAL_MS = 5_000;
export const DEFAULT_LIVE_DISMISS_AFTER_SECONDS = 120;
export const MAX_ERROR_SNIPPET = 180;

/** Short stable hex digest used to keep idempotency keys unique without leaking text. */
export function shortHash(text: string): string {
	let hash = 0x811c9dc5;

	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}

	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function notificationHash(summary: string): string {
	return shortHash(summary);
}

export function sessionKey(
	prefix: string,
	sessionId: string,
	leafId: string | null | undefined,
	suffix = "leaf",
): string {
	const leaf = leafId ?? suffix;
	const base = `${prefix}:${sessionId}:${leaf}`;

	if (base.length <= 160) return base;

	// Hash the tail instead of naive truncation so long IDs cannot collide.
	return `${base.slice(0, 120)}:${shortHash(base)}`;
}

export function projectLabel(cwd: string): string {
	return cwd.split("/").filter(Boolean).pop() || "Pi";
}

export function harkConfigured(): boolean {
	return Boolean(process.env.PI_HARK_WEBHOOK_URL?.trim());
}

export function harkPollIntervalMs(): number {
	const raw = Number(process.env.PI_HARK_POLL_INTERVAL_MS);

	if (!Number.isFinite(raw)) return DEFAULT_HARK_POLL_INTERVAL_MS;

	return Math.min(MAX_HARK_POLL_INTERVAL_MS, Math.max(MIN_HARK_POLL_INTERVAL_MS, Math.round(raw)));
}

export function replyEnabled(): boolean {
	return process.env.PI_ACTION_REPLY !== "off";
}

export function replyTimeoutSeconds(): number {
	const raw = Number(process.env.PI_ACTION_REPLY_TIMEOUT);

	if (!Number.isFinite(raw)) return DEFAULT_REPLY_TIMEOUT_SECONDS;

	return Math.min(86_400, Math.max(30, Math.round(raw)));
}

export function liveActivityEnabled(): boolean {
	return process.env.PI_HARK_LIVE_ACTIVITY === "on";
}

export function livePatchIntervalMs(): number {
	const raw = Number(process.env.PI_HARK_LIVE_PATCH_MS);

	if (!Number.isFinite(raw)) return DEFAULT_LIVE_PATCH_INTERVAL_MS;

	return Math.min(60_000, Math.max(1_000, Math.round(raw)));
}

export function liveDismissAfterSeconds(): number {
	const raw = Number(process.env.PI_HARK_LIVE_DISMISS_AFTER);

	if (!Number.isFinite(raw)) return DEFAULT_LIVE_DISMISS_AFTER_SECONDS;

	return Math.min(14_400, Math.max(0, Math.round(raw)));
}

export function liveBaseTitle(): string {
	return process.env.PI_HARK_TITLE?.trim() || "Pi";
}
