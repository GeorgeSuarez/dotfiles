export type HarkResponseType = "approval" | "yes_no" | "text";

export interface HarkNotification {
	body: string;
	title?: string;
	imageUrl?: string;
	url?: string;
	project?: string;
	summary?: string;
	bodyFormat?: "text" | "markdown";
}

export interface HarkInteractiveNotification extends HarkNotification {
	response: {
		type: HarkResponseType;
		expiresInSeconds: number;
		correlationId?: string;
	};
}

export interface HarkSendResult {
	eventId?: string;
	delivered?: number;
	idempotent?: boolean;
	message?: string;
}

export interface HarkResponseState {
	status: "pending" | "approved" | "denied" | "yes" | "no" | "replied" | "expired" | "canceled";
	action?: "approve" | "deny" | "yes" | "no" | "reply";
	text?: string | null;
	correlationId?: string | null;
	respondedAt?: string | null;
	expiresAt?: string | null;
}

export interface HarkEventResult {
	eventId: string;
	response: HarkResponseState;
}

export interface HarkClientOptions {
	webhookUrl?: string;
	fetchImpl?: typeof fetch;
}

export class HarkError extends Error {
	readonly status: number;
	readonly code?: string;

	constructor(message: string, status: number, code?: string) {
		super(message);
		this.name = "HarkError";
		this.status = status;
		this.code = code;
	}
}

function trimWebhookUrl(webhookUrl: string): string {
	return webhookUrl.trim().replace(/\/+$/, "");
}

function eventUrl(webhookUrl: string, eventId: string, action?: "cancel"): string {
	return `${trimWebhookUrl(webhookUrl)}/events/${encodeURIComponent(eventId)}${action ? `/${action}` : ""}`;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
	try {
		const value: unknown = await response.json();
		return value && typeof value === "object" ? value as Record<string, unknown> : {};
	} catch {
		return {};
	}
}

function errorMessage(payload: Record<string, unknown>, fallback: string): string {
	const error = payload.error;
	return typeof error === "string" && error.length > 0 ? error : fallback;
}

function resultFromPayload(payload: Record<string, unknown>): HarkSendResult {
	return {
		eventId: typeof payload.eventId === "string" ? payload.eventId : undefined,
		delivered: typeof payload.delivered === "number" ? payload.delivered : undefined,
		idempotent: payload.idempotent === true ? true : undefined,
		message: typeof payload.message === "string" ? payload.message : undefined,
	};
}

function eventFromPayload(payload: Record<string, unknown>, fallbackEventId: string): HarkEventResult {
	const event = payload.event;
	const response = event && typeof event === "object"
		? (event as Record<string, unknown>).response
		: undefined;
	if (!response || typeof response !== "object") {
		throw new HarkError("Hark returned an invalid interactive response", 502);
	}

	const state = response as Record<string, unknown>;
	const statuses = new Set<HarkResponseState["status"]>([
		"pending",
		"approved",
		"denied",
		"yes",
		"no",
		"replied",
		"expired",
		"canceled",
	]);
	const status = state.status;
	if (typeof status !== "string" || !statuses.has(status as HarkResponseState["status"])) {
		throw new HarkError("Hark returned an unknown interactive response status", 502);
	}

	const action = state.action;
	return {
		eventId: typeof event === "object" && event && typeof (event as Record<string, unknown>).id === "string"
			? (event as Record<string, unknown>).id as string
			: fallbackEventId,
		response: {
			status: status as HarkResponseState["status"],
			action: typeof action === "string" ? action as HarkResponseState["action"] : undefined,
			text: typeof state.text === "string" || state.text === null ? state.text : undefined,
			correlationId: typeof state.correlationId === "string" || state.correlationId === null ? state.correlationId : undefined,
			respondedAt: typeof state.respondedAt === "string" || state.respondedAt === null ? state.respondedAt : undefined,
			expiresAt: typeof state.expiresAt === "string" || state.expiresAt === null ? state.expiresAt : undefined,
		},
	};
}

export function createHarkClient(options: HarkClientOptions = {}): HarkClient | undefined {
	const webhookUrl = options.webhookUrl?.trim() || process.env.PI_HARK_WEBHOOK_URL?.trim();
	if (!webhookUrl) return undefined;

	const fetchImpl = options.fetchImpl ?? globalThis.fetch;
	if (!fetchImpl) throw new Error("Hark requires fetch support");

	async function request(url: string, init: RequestInit): Promise<Record<string, unknown>> {
		let response: Response;
		try {
			response = await fetchImpl(url, init);
		} catch {
			throw new HarkError("Hark request failed", 503);
		}

		const payload = await responseJson(response);
		if (!response.ok) {
			throw new HarkError(errorMessage(payload, `Hark request failed with HTTP ${response.status}`), response.status);
		}
		return payload;
	}

	return {
		async send(notification, { idempotencyKey, signal }) {
			const payload = await request(trimWebhookUrl(webhookUrl), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": idempotencyKey,
				},
				body: JSON.stringify(notification),
				signal: signal ?? AbortSignal.timeout(10_000),
			});
			return resultFromPayload(payload);
		},

		async sendInteractive(notification, { idempotencyKey, signal }) {
			const payload = await request(trimWebhookUrl(webhookUrl), {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": idempotencyKey,
				},
				body: JSON.stringify(notification),
				signal: signal ?? AbortSignal.timeout(10_000),
			});
			const result = resultFromPayload(payload);
			if (!result.eventId) throw new HarkError("Hark did not return an interactive event ID", 502);
			return result;
		},

		async readResponse(eventId, signal) {
			const payload = await request(eventUrl(webhookUrl, eventId), {
				method: "GET",
				signal: signal ?? AbortSignal.timeout(10_000),
			});
			return eventFromPayload(payload, eventId);
		},

		async cancelResponse(eventId) {
			await request(eventUrl(webhookUrl, eventId, "cancel"), {
				method: "POST",
				signal: AbortSignal.timeout(10_000),
			});
		},
	};
}

export interface HarkClient {
	send(
		notification: HarkNotification,
		options: { idempotencyKey: string; signal?: AbortSignal },
	): Promise<HarkSendResult>;
	sendInteractive(
		notification: HarkInteractiveNotification,
		options: { idempotencyKey: string; signal?: AbortSignal },
	): Promise<HarkSendResult>;
	readResponse(eventId: string, signal?: AbortSignal): Promise<HarkEventResult>;
	cancelResponse(eventId: string): Promise<void>;
}
