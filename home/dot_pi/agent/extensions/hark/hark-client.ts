import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

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

/** The state an interactive notification settles into, as Hark reports it. */
const HarkResponseStateSchema = Type.Object({
	status: Type.Union([
		Type.Literal("pending"),
		Type.Literal("approved"),
		Type.Literal("denied"),
		Type.Literal("yes"),
		Type.Literal("no"),
		Type.Literal("replied"),
		Type.Literal("expired"),
		Type.Literal("canceled"),
	]),
	action: Type.Optional(
		Type.Union([
			Type.Literal("approve"),
			Type.Literal("deny"),
			Type.Literal("yes"),
			Type.Literal("no"),
			Type.Literal("reply"),
		]),
	),
	text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	correlationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	respondedAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	expiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

export type HarkResponseState = Static<typeof HarkResponseStateSchema>;

/** Every webhook response body: send results and the event envelope reads return. */
const HarkWebhookPayloadSchema = Type.Object({
	eventId: Type.Optional(Type.String()),
	delivered: Type.Optional(Type.Number()),
	idempotent: Type.Optional(Type.Boolean()),
	message: Type.Optional(Type.String()),
	error: Type.Optional(Type.String()),
	event: Type.Optional(
		Type.Object({
			id: Type.Optional(Type.String()),
			response: Type.Optional(HarkResponseStateSchema),
		}),
	),
});

type HarkWebhookPayload = Static<typeof HarkWebhookPayloadSchema>;

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

async function responsePayload(response: Response): Promise<HarkWebhookPayload> {
	try {
		const parsed: unknown = await response.json();

		return Check(HarkWebhookPayloadSchema, parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function errorMessage(payload: HarkWebhookPayload, fallback: string): string {
	return payload.error !== undefined && payload.error.length > 0 ? payload.error : fallback;
}

function resultFromPayload(payload: HarkWebhookPayload): HarkSendResult {
	return {
		eventId: payload.eventId,
		delivered: payload.delivered,
		idempotent: payload.idempotent,
		message: payload.message,
	};
}

function eventFromPayload(payload: HarkWebhookPayload, fallbackEventId: string): HarkEventResult {
	const response = payload.event?.response;

	if (!response) throw new HarkError("Hark returned an invalid interactive response", 502);

	return { eventId: payload.event?.id ?? fallbackEventId, response };
}

export function createHarkClient(options: HarkClientOptions = {}): HarkClient | undefined {
	const webhookUrl = options.webhookUrl?.trim() || process.env.PI_HARK_WEBHOOK_URL?.trim();

	if (!webhookUrl) return undefined;

	const fetchImpl = options.fetchImpl ?? globalThis.fetch;

	if (!fetchImpl) throw new Error("Hark requires fetch support");

	async function request(url: string, init: RequestInit): Promise<HarkWebhookPayload> {
		let response: Response;

		try {
			response = await fetchImpl(url, init);
		} catch {
			throw new HarkError("Hark request failed", 503);
		}

		const payload = await responsePayload(response);

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
