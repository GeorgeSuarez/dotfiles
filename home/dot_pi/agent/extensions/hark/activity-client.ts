import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { HarkError } from "./hark-client.ts";

export type LiveSymbol = "terminal" | "build" | "success" | "warning";

export type LiveStyle = "standard" | "ring" | "hero" | "terminal" | "steps";

export interface StartLiveActivityInput {
	title: string;
	status: string;
	detail?: string;
	progress?: number;
	symbol?: LiveSymbol;
	style?: LiveStyle;
	accentColor?: string;
	/** Stable caller-side key: address the activity without storing the generated ID. */
	key?: string;
	/** Take the device slot, ending whatever task occupies it. */
	replace?: boolean;
}

export interface UpdateLiveActivityInput {
	title?: string;
	status?: string;
	detail?: string | null;
	progress?: number | null;
	symbol?: LiveSymbol;
	style?: LiveStyle;
	accentColor?: string;
	/** Reject the write unless the activity is still at this sequence. */
	ifSequence?: number;
}

export interface EndLiveActivityInput {
	status?: string;
	detail?: string | null;
	progress?: number | null;
	symbol?: LiveSymbol;
	/** Seconds the finished card lingers, 0 to 14400. */
	dismissAfterSeconds?: number;
}

export interface StartLiveActivityResult {
	activityId: string;
	/** 0 when no device qualified (card not rendered); treat as skip-silently. */
	accepted?: number;
	sequence?: number;
	message?: string;
}

export interface LiveActivityState {
	id: string;
	title?: string;
	status?: string;
	detail?: string | null;
	progress?: number | null;
	symbol?: LiveSymbol;
	style?: LiveStyle;
	sequence?: number;
}

export interface LiveClientOptions {
	webhookUrl?: string;
	fetchImpl?: typeof fetch;
}

const LiveSymbolSchema = Type.Union([
	Type.Literal("terminal"),
	Type.Literal("build"),
	Type.Literal("success"),
	Type.Literal("warning"),
]);

const LiveStyleSchema = Type.Union([
	Type.Literal("standard"),
	Type.Literal("ring"),
	Type.Literal("hero"),
	Type.Literal("terminal"),
	Type.Literal("steps"),
]);

/** Every live-activity webhook response body this client reads. */
const LiveActivityPayloadSchema = Type.Object({
	activityId: Type.Optional(Type.String()),
	id: Type.Optional(Type.String()),
	accepted: Type.Optional(Type.Number()),
	sequence: Type.Optional(Type.Number()),
	message: Type.Optional(Type.String()),
	error: Type.Optional(Type.String()),
	title: Type.Optional(Type.String()),
	status: Type.Optional(Type.String()),
	detail: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	progress: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
	symbol: Type.Optional(LiveSymbolSchema),
	style: Type.Optional(LiveStyleSchema),
});

type LiveActivityPayload = Static<typeof LiveActivityPayloadSchema>;

/** Live-activity request body; a field left undefined is omitted from the JSON. */
interface LiveActivityRequestBody {
	title?: string;
	status?: string;
	detail?: string | null;
	progress?: number | null;
	symbol?: LiveSymbol;
	style?: LiveStyle;
	accentColor?: string;
	key?: string;
	replace?: boolean;
	ifSequence?: number;
	dismissAfterSeconds?: number;
}

function trimWebhookUrl(webhookUrl: string): string {
	return webhookUrl.trim().replace(/\/+$/, "");
}

function activitiesUrl(webhookUrl: string): string {
	return `${trimWebhookUrl(webhookUrl)}/live-activities`;
}

function activityUrl(webhookUrl: string, idOrKey: string, action?: "end"): string {
	return `${activitiesUrl(webhookUrl)}/${encodeURIComponent(idOrKey)}${action ? `/${action}` : ""}`;
}

function clampProgress(value: number | null | undefined): number | null | undefined {
	if (value === null || value === undefined) return value;

	if (!Number.isFinite(value)) return undefined;

	return Math.min(1, Math.max(0, value));
}

function clampDismiss(value: number | undefined): number | undefined {
	if (value === undefined) return undefined;

	if (!Number.isFinite(value)) return undefined;

	return Math.min(14_400, Math.max(0, Math.round(value)));
}

async function responsePayload(response: Response): Promise<LiveActivityPayload> {
	try {
		const parsed: unknown = await response.json();

		return Check(LiveActivityPayloadSchema, parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function errorMessage(payload: LiveActivityPayload, fallback: string): string {
	return payload.error !== undefined && payload.error.length > 0 ? payload.error : fallback;
}

/** JSON request headers; an idempotency key appears only when the caller supplies one. */
type ActivityRequestHeaders = {
	"Content-Type": string;
	"Idempotency-Key"?: string;
};

function jsonHeaders(idempotencyKey: string | undefined): ActivityRequestHeaders {
	const headers: ActivityRequestHeaders = { "Content-Type": "application/json" };

	if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

	return headers;
}

export function createActivityClient(options: LiveClientOptions = {}): LiveActivityClient | undefined {
	const webhookUrl = options.webhookUrl?.trim() || process.env.PI_HARK_WEBHOOK_URL?.trim();

	if (!webhookUrl) return undefined;

	const fetchImpl = options.fetchImpl ?? globalThis.fetch;

	if (!fetchImpl) throw new Error("Hark live activities require fetch support");

	async function request(url: string, init: RequestInit): Promise<LiveActivityPayload> {
		let response: Response;

		try {
			response = await fetchImpl(url, init);
		} catch {
			throw new HarkError("Hark live activity request failed", 503);
		}

		const payload = await responsePayload(response);

		if (!response.ok) {
			throw new HarkError(errorMessage(payload, `Hark live activity request failed with HTTP ${response.status}`), response.status);
		}

		return payload;
	}

	function post(
		url: string,
		body: LiveActivityRequestBody,
		idempotencyKey: string | undefined,
		signal: AbortSignal | undefined,
	) {
		return request(url, {
			method: "POST",
			headers: jsonHeaders(idempotencyKey),
			body: JSON.stringify(body),
			signal: signal ?? AbortSignal.timeout(10_000),
		});
	}

	return {
		async startActivity(input, options) {
			const body: LiveActivityRequestBody = { title: input.title, status: input.status };

			if (input.detail !== undefined) body.detail = input.detail;

			if (input.progress !== undefined) body.progress = clampProgress(input.progress);

			if (input.symbol) body.symbol = input.symbol;

			if (input.style) body.style = input.style;

			if (input.accentColor) body.accentColor = input.accentColor;

			if (input.key) body.key = input.key;

			if (input.replace !== undefined) body.replace = input.replace;

			const payload = await post(
				activitiesUrl(webhookUrl),
				body,
				options?.idempotencyKey,
				options?.signal,
			);

			const activityId = payload.activityId ?? payload.id;

			if (!activityId) throw new HarkError("Hark did not return a live activity ID", 502);

			return {
				activityId,
				accepted: payload.accepted,
				sequence: payload.sequence,
				message: payload.message,
			};
		},

		async getActivity(idOrKey, signal) {
			const payload = await request(activityUrl(webhookUrl, idOrKey), {
				method: "GET",
				signal: signal ?? AbortSignal.timeout(10_000),
			});

			return {
				id: payload.id ?? idOrKey,
				title: payload.title,
				status: payload.status,
				detail: payload.detail,
				progress: payload.progress,
				symbol: payload.symbol,
				style: payload.style,
				sequence: payload.sequence,
			};
		},

		async updateActivity(idOrKey, patch, options) {
			const body: LiveActivityRequestBody = {};

			if (patch.title !== undefined) body.title = patch.title;

			if (patch.status !== undefined) body.status = patch.status;

			if (patch.detail !== undefined) body.detail = patch.detail;

			if (patch.progress !== undefined) body.progress = clampProgress(patch.progress);

			if (patch.symbol) body.symbol = patch.symbol;

			if (patch.style) body.style = patch.style;

			if (patch.accentColor) body.accentColor = patch.accentColor;

			if (patch.ifSequence !== undefined) body.ifSequence = patch.ifSequence;

			const payload = await request(activityUrl(webhookUrl, idOrKey), {
				method: "PATCH",
				headers: jsonHeaders(options?.idempotencyKey),
				body: JSON.stringify(body),
				signal: options?.signal ?? AbortSignal.timeout(10_000),
			});

			return { sequence: payload.sequence };
		},

		async endActivity(idOrKey, input, options) {
			const body: LiveActivityRequestBody = {};

			if (input?.status !== undefined) body.status = input.status;

			if (input?.detail !== undefined) body.detail = input.detail;

			if (input?.progress !== undefined) body.progress = clampProgress(input.progress);

			if (input?.symbol) body.symbol = input.symbol;

			if (input?.dismissAfterSeconds !== undefined) {
				body.dismissAfterSeconds = clampDismiss(input.dismissAfterSeconds);
			}

			await post(activityUrl(webhookUrl, idOrKey, "end"), body, options?.idempotencyKey, options?.signal);
		},
	};
}

export interface LiveActivityClient {
	startActivity(
		input: StartLiveActivityInput,
		options?: { idempotencyKey?: string; signal?: AbortSignal },
	): Promise<StartLiveActivityResult>;
	getActivity(idOrKey: string, signal?: AbortSignal): Promise<LiveActivityState>;
	updateActivity(
		idOrKey: string,
		patch: UpdateLiveActivityInput,
		options?: { idempotencyKey?: string; signal?: AbortSignal },
	): Promise<{ sequence?: number }>;
	endActivity(
		idOrKey: string,
		input?: EndLiveActivityInput,
		options?: { idempotencyKey?: string; signal?: AbortSignal },
	): Promise<void>;
}
