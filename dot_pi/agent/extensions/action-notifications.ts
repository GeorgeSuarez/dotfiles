import { StringEnum, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	createHarkClient,
	type HarkEventResult,
	type HarkResponseType,
} from "./lib/hark-client.ts";

const ACTION_MARKER = /\[\[\s*PI_ACTION_REQUIRED\s*:\s*([\s\S]*?)\s*\]\]/i;
const ACTION_MARKER_GLOBAL = /\[\[\s*PI_ACTION_REQUIRED\s*:\s*[\s\S]*?\s*\]\]\s*/gi;
const MAX_NOTIFICATION_LENGTH = 240;
const DEFAULT_HARK_TIMEOUT_SECONDS = 900;
const HARK_POLL_INTERVAL_MS = 2_000;

const ACTION_WORDS = [
	"please",
	"you need to",
	"you must",
	"you should",
	"run",
	"install",
	"execute",
	"provide",
	"enter",
	"paste",
	"choose",
	"select",
	"confirm",
	"approve",
	"open",
	"click",
	"set up",
	"configure",
	"add",
	"update",
	"create",
	"review",
	"check",
	"commit",
	"push",
	"merge",
	"upload",
	"download",
];

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
		.replace(/[\u0000-\u001f\u007f\u001b]/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^[\s>*\-•\d.)]+/, "")
		.trim();
	return cleaned.length > MAX_NOTIFICATION_LENGTH
		? `${cleaned.slice(0, MAX_NOTIFICATION_LENGTH - 1).trimEnd()}…`
		: cleaned;
}

function sentenceContaining(text: string, expression: RegExp): string | undefined {
	const candidates = text.split(/(?<=[.!?])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
	return candidates.find((candidate) => expression.test(candidate));
}

function isOptionalSuggestion(text: string): boolean {
	return /\b(?:if you(?:'d| would) like|if you want|optionally|feel free|you may want to|consider)\b/i.test(text);
}

/**
 * Detects an action request in finalized assistant text.
 *
 * The marker is the reliable path. The heuristic is intentionally conservative
 * and ignores fenced/inline code so example commands do not create alerts.
 */
export function detectActionRequired(text: string): ActionRequired | undefined {
	const marker = ACTION_MARKER.exec(text);
	if (marker) {
		const summary = cleanSummary(marker[1] ?? "");
		if (/^(?:none|nothing|no action(?: is required)?)$/i.test(summary)) return undefined;
		if (summary) return { summary, source: "marker" };
	}

	const readable = removeCode(text);
	const question = sentenceContaining(readable, /\?\s*$/);
	const action = sentenceContaining(
		readable,
		new RegExp(`\\b(?:${ACTION_WORDS.join("|")})\\b`, "i"),
	);
	const noAction = /\b(?:no action(?:s)? (?:is|are) required|nothing for you to do|you do not need to do anything|you don't need to do anything)\b/i.test(readable);

	if (question) return { summary: cleanSummary(question), source: "heuristic" };
	if (action && !isOptionalSuggestion(action)) return { summary: cleanSummary(action), source: "heuristic" };
	if (noAction) return undefined;
	return undefined;
}

export function assistantText(message: Pick<AssistantMessage, "content">): string {
	return message.content
		.filter((part): part is Extract<AssistantMessage["content"][number], { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function withoutActionMarkers(message: AssistantMessage): AssistantMessage {
	return {
		...message,
		content: message.content.map((part) =>
			part.type === "text"
				? { ...part, text: part.text.replace(ACTION_MARKER_GLOBAL, "").trimEnd() }
				: part,
		),
	};
}

function terminalSafe(text: string): string {
	return text.replace(/[\u0000-\u001f\u007f\u001b;]/g, " ").replace(/\s+/g, " ").trim();
}

function notifyOsc777(title: string, body: string): void {
	process.stdout.write(`\x1b]777;notify;${terminalSafe(title)};${terminalSafe(body)}\x07`);
}

function notifyOsc99(title: string, body: string): void {
	process.stdout.write(`\x1b]99;i=pi-action:d=0;${terminalSafe(title)}\x1b\\`);
	process.stdout.write(`\x1b]99;i=pi-action:p=body;${terminalSafe(body)}\x1b\\`);
}

function notifyTerminal(title: string, body: string): void {
	if (process.env.KITTY_WINDOW_ID) notifyOsc99(title, body);
	else notifyOsc777(title, body);
}

type NotificationChannel = "terminal" | "ui" | "both" | "hark" | "all";

function notificationChannel(): NotificationChannel {
	const value = process.env.PI_ACTION_NOTIFICATIONS_CHANNEL?.trim().toLowerCase();
	if (value === "ui" || value === "both" || value === "hark" || value === "all") return value;
	return "terminal";
}

function channelDescription(channel: NotificationChannel): string {
	return channel === "both" ? "terminal + Pi UI" : channel === "all" ? "terminal + Pi UI + Hark" : channel;
}

function harkConfigured(): boolean {
	return Boolean(process.env.PI_HARK_WEBHOOK_URL?.trim());
}

function sessionKey(ctx: ExtensionContext, prefix: string, suffix = "leaf"): string {
	const sessionId = ctx.sessionManager.getSessionId();
	const leafId = ctx.sessionManager.getLeafId() ?? suffix;
	return `${prefix}:${sessionId}:${leafId}`.slice(0, 200);
}

async function notifyHark(ctx: ExtensionContext, summary: string): Promise<void> {
	const client = createHarkClient();
	if (!client) {
		if (ctx.hasUI) ctx.ui.notify("Hark notifications are selected but PI_HARK_WEBHOOK_URL is not set", "warning");
		return;
	}

	try {
		await client.send(
			{
				title: process.env.PI_HARK_TITLE?.trim() || "Pi",
				project: process.env.PI_HARK_PROJECT?.trim() || "Pi",
				url: process.env.PI_HARK_TAP_URL?.trim() || undefined,
				body: `Pi needs your attention: ${summary}`,
				summary,
			},
			{ idempotencyKey: sessionKey(ctx, "pi-action") },
		);
	} catch (error) {
		const status = typeof error === "object" && error && "status" in error
			? ` (HTTP ${(error as { status: unknown }).status})`
			: "";
		if (ctx.hasUI) ctx.ui.notify(`Unable to send the Hark notification${status}`, "warning");
	}
}

async function notifyUser(ctx: ExtensionContext, summary: string): Promise<void> {
	const body = `Action required: ${summary}`;
	const channel = notificationChannel();
	const useTerminal = ctx.mode === "tui" && (channel === "terminal" || channel === "both" || channel === "all");
	const useUi = ctx.hasUI && (channel === "ui" || channel === "both" || channel === "all");
	const useHark = channel === "hark" || channel === "all";

	if (useTerminal) notifyTerminal("Pi", body);
	if (useUi) ctx.ui.notify(body, "warning");
	if (useHark) await notifyHark(ctx, summary);
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

function responseText(event: HarkEventResult): string {
	const response = event.response;
	if (response.status === "replied") return response.text ?? "";
	if (response.action) return response.action;
	return response.status;
}

async function waitForHarkResponse(
	client: NonNullable<ReturnType<typeof createHarkClient>>,
	eventId: string,
	timeoutSeconds: number,
	signal: AbortSignal,
): Promise<HarkEventResult> {
	const deadline = Date.now() + timeoutSeconds * 1_000;
	let latest = await client.readResponse(eventId, signal);

	while (latest.response.status === "pending" && Date.now() < deadline) {
		await waitForSignal(Math.min(HARK_POLL_INTERVAL_MS, Math.max(1, deadline - Date.now())), signal);
		latest = await client.readResponse(eventId, signal);
	}

	if (latest.response.status === "pending") {
		await client.cancelResponse(eventId).catch(() => undefined);
		return {
			...latest,
			response: { ...latest.response, status: "canceled", action: undefined, text: null },
		};
	}
	return latest;
}

export default function actionNotifications(pi: ExtensionAPI) {
	let enabled = process.env.PI_ACTION_NOTIFICATIONS !== "off";
	let latestAssistantText = "";

	if (harkConfigured()) {
		pi.registerTool({
		name: "ask_user_on_iphone",
		label: "Ask User on iPhone",
		description: "Ask the user an approval, yes/no, or text question through Hark on their iPhone and wait for the response.",
		parameters: Type.Object({
			question: Type.String({ minLength: 1, maxLength: 1_800, description: "The question to send to the user's iPhone" }),
			responseType: Type.Optional(StringEnum(["approval", "yes_no", "text"] as const)),
			timeoutSeconds: Type.Optional(Type.Integer({ minimum: 30, maximum: 86_400, description: "How long to wait, in seconds" })),
		}),
		executionMode: "sequential",

		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const client = createHarkClient();
			if (!client) {
				throw new Error("Hark is not configured; set PI_HARK_WEBHOOK_URL before using ask_user_on_iphone");
			}

			const timeoutSeconds = params.timeoutSeconds ?? DEFAULT_HARK_TIMEOUT_SECONDS;
			const operationSignal = signal ?? new AbortController().signal;
			const responseType = (params.responseType ?? "text") as HarkResponseType;
			const correlationId = `pi-${ctx.sessionManager.getSessionId()}-${toolCallId}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
			const idempotencyKey = `pi-question:${ctx.sessionManager.getSessionId()}:${toolCallId}`.replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 200);
			const event = await client.sendInteractive(
				{
					title: process.env.PI_HARK_TITLE?.trim() || "Pi",
					project: process.env.PI_HARK_PROJECT?.trim() || "Pi",
					url: process.env.PI_HARK_TAP_URL?.trim() || undefined,
					body: params.question.trim(),
					summary: params.question.trim().slice(0, 500),
					response: { type: responseType, expiresInSeconds: timeoutSeconds, correlationId },
				},
				{ idempotencyKey, signal: operationSignal },
			);

			if (!event.eventId) throw new Error("Hark did not return an event ID");

			try {
				const result = await waitForHarkResponse(client, event.eventId, timeoutSeconds, operationSignal);
				return {
					content: [{ type: "text", text: `User response: ${responseText(result)}` }],
					details: {
						status: result.response.status,
						action: result.response.action,
						text: result.response.text,
						correlationId: result.response.correlationId,
					},
				};
			} catch (error) {
				if (!operationSignal.aborted) throw error;
				await client.cancelResponse(event.eventId).catch(() => undefined);
				return {
					content: [{ type: "text", text: "The iPhone question was cancelled." }],
					details: { status: "canceled" },
				};
			}
		},
		});
	}

	pi.registerCommand("action-notifications", {
		description: "Enable, disable, inspect, or test LLM action-required notifications",
		handler: async (args, ctx) => {
			const value = args.trim().toLowerCase();
			if (value === "on" || value === "off") {
				enabled = value === "on";
				ctx.ui.notify(`Action-required notifications ${enabled ? "enabled" : "disabled"}`, "info");
				return;
			}
			if (value === "test") {
				const client = createHarkClient();
				if (!client) {
					ctx.ui.notify("Set PI_HARK_WEBHOOK_URL before testing Hark notifications", "warning");
					return;
				}
				try {
					const result = await client.send(
						{
							title: process.env.PI_HARK_TITLE?.trim() || "Pi",
							project: process.env.PI_HARK_PROJECT?.trim() || "Pi",
							url: process.env.PI_HARK_TAP_URL?.trim() || undefined,
							body: "Pi Hark integration test",
							summary: "Pi Hark integration test",
						},
						{ idempotencyKey: `pi-test:${Date.now()}` },
					);
					ctx.ui.notify(`Hark test sent${result.delivered === undefined ? "" : ` (${result.delivered} device(s))`}`, "info");
				} catch (error) {
					const status = typeof error === "object" && error && "status" in error
						? ` (HTTP ${(error as { status: unknown }).status})`
						: "";
					ctx.ui.notify(`Hark test failed${status}`, "error");
				}
				return;
			}
			if (value && value !== "status") {
				ctx.ui.notify("Usage: /action-notifications [on|off|status|test]", "warning");
				return;
			}

			const channel = notificationChannel();
			const harkState = harkConfigured() ? "configured" : "not configured";
			ctx.ui.notify(
				`Action-required notifications are ${enabled ? "enabled" : "disabled"}; channel: ${channelDescription(channel)}; Hark: ${harkState}`,
				"info",
			);
		},
	});

	pi.on("before_agent_start", (event) => {
		if (!enabled) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\nWhen your final response requires the human to do something or answer a question, append exactly one marker at the very end: [[PI_ACTION_REQUIRED: short description of the required action]]. Do not append it for completed work, optional suggestions, or rhetorical questions. Keep the response useful and natural; the marker is removed before display.`,
		};
	});

	pi.on("agent_start", () => {
		latestAssistantText = "";
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		latestAssistantText = assistantText(event.message);
		if (!ACTION_MARKER.test(latestAssistantText)) return;
		return { message: withoutActionMarkers(event.message) };
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!enabled) return;
		const action = detectActionRequired(latestAssistantText);
		if (action) await notifyUser(ctx, action.summary);
	});
}
