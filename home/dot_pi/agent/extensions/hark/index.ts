import { StringEnum, type AssistantMessage, type JsonValue } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import {
	createHarkClient,
	HarkError,
} from "./hark-client.ts";
import {
	ACTION_MARKER,
	ACTION_MARKER_GLOBAL,
	MARKER_INSTRUCTION_SENTINEL,
	detectActionRequired,
	doneSummary,
	doneSummaryEnabled,
} from "./detection.ts";
import {
	DEFAULT_HARK_TIMEOUT_SECONDS,
	MAX_CONSECUTIVE_AUTO_REPLIES,
	MAX_ERROR_SNIPPET,
	harkConfigured,
	liveActivityEnabled,
	notificationHash,
	projectLabel as projectLabelForCwd,
	replyEnabled,
	replyTimeoutSeconds,
	sessionKey as sessionKeyForIds,
} from "./config.ts";
import {
	inferReplyType,
	isAnswerable,
	responseText,
	sendInteractiveQuestion,
	waitForHarkResponse,
} from "./reply-waiter.ts";
import { HarkLiveTracker } from "./live-tracker.ts";

// Pre-rewrite public surface, preserved for tests and consumers.
// Canonical implementations live in ./detection.ts, ./config.ts, ./reply-waiter.ts.
export {
	ACTION_WORDS,
	detectActionRequired,
	doneSummary,
	doneSummaryEnabled,
	type ActionRequired,
} from "./detection.ts";

export { inferReplyType, isAnswerable, responseText } from "./reply-waiter.ts";

export {
	harkConfigured,
	liveActivityEnabled,
	replyEnabled,
	replyTimeoutSeconds,
} from "./config.ts";

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
	return text
		// oxlint-disable-next-line eslint/no-control-regex -- strip terminal control characters from notification text.
		.replace(/[\u0000-\u001f\u007f\u001b]/g, " ")
		.replace(/;/g, ",")
		.replace(/\s+/g, " ")
		.trim();
}

function notifyOsc777(title: string, body: string): void {
	process.stdout.write(`\x1b]777;notify;${terminalSafe(title)};${terminalSafe(body)}\x07`);
}

function notifyOsc99(title: string, body: string): void {
	// Kitty graphics/desktop-notification escape; Ghostty and others use OSC 777.
	process.stdout.write(`\x1b]99;i=pi-action:d=0;${terminalSafe(title)}\x1b\\`);
	process.stdout.write(`\x1b]99;i=pi-action:p=body;${terminalSafe(body)}\x1b\\`);
}

function notifyTerminal(title: string, body: string): void {
	if (process.env.KITTY_WINDOW_ID) notifyOsc99(title, body);
	else notifyOsc777(title, body);
}

export type NotificationChannel = "terminal" | "ui" | "both" | "hark" | "all";

/** Extension diagnostics go to stderr so they never pollute tool or TUI output. */
function reportDiagnostic(message: string): void {
	process.stderr.write(`${message}\n`);
}

let channelOverride: NotificationChannel | undefined;
let warnedInvalidChannel = false;

export function setNotificationChannelOverride(channel: NotificationChannel | undefined): void {
	channelOverride = channel;
}

export function notificationChannel(): NotificationChannel {
	if (channelOverride) return channelOverride;
	const raw = process.env.PI_ACTION_NOTIFICATIONS_CHANNEL?.trim().toLowerCase();

	if (!raw) return "terminal";

	if (raw === "ui" || raw === "both" || raw === "hark" || raw === "all") return raw;

	if (!warnedInvalidChannel) {
		warnedInvalidChannel = true;
		reportDiagnostic(`[action-notifications] Unknown PI_ACTION_NOTIFICATIONS_CHANNEL=${JSON.stringify(raw)}; falling back to "terminal".`);
	}

	return "terminal";
}

function channelDescription(channel: NotificationChannel): string {
	if (channel === "both") return "terminal + Pi UI";

	if (channel === "all") return "terminal + Pi UI + Hark";

	return channel;
}

export type HarkVerbosity = "errors" | "actions" | "all";

export type HarkPushKind = "lifecycle" | "error" | "action";

let verbosityOverride: HarkVerbosity | undefined;
let warnedInvalidVerbosity = false;

export function setHarkVerbosityOverride(verbosity: HarkVerbosity | undefined): void {
	verbosityOverride = verbosity;
}

export function harkVerbosity(): HarkVerbosity {
	if (verbosityOverride) return verbosityOverride;
	const raw = process.env.PI_HARK_VERBOSITY?.trim().toLowerCase();

	if (!raw) return "actions";

	if (raw === "errors" || raw === "actions" || raw === "all") return raw;

	if (!warnedInvalidVerbosity) {
		warnedInvalidVerbosity = true;
		reportDiagnostic(`[action-notifications] Unknown PI_HARK_VERBOSITY=${JSON.stringify(raw)}; falling back to "actions".`);
	}

	return "actions";
}

function verbosityDescription(verbosity: HarkVerbosity): string {
	if (verbosity === "all") return "everything (starts, finishes, errors, actions)";

	if (verbosity === "errors") return "actions and errors";

	return "actions only";
}

/** Free-tier Hark is one-way only: verbosity decides which push kinds may buzz the phone.
 * Levels are cumulative: actions < errors (actions + errors) < all (+ lifecycle). */
export function verbosityAllows(kind: HarkPushKind): boolean {
	const verbosity = harkVerbosity();

	if (kind === "action") return true;

	if (kind === "error") return verbosity === "errors" || verbosity === "all";

	return verbosity === "all";
}

function projectLabel(ctx: ExtensionContext): string {
	return projectLabelForCwd(ctx.cwd ?? "");
}

/** Result payload reported by a finished tool call: JSON text or a structured value. */
type ToolResultPayload = JsonValue | undefined;

/** Only a string result is rendered as-is; everything else becomes JSON text. */
const TOOL_RESULT_TEXT_SCHEMA = Type.String();

export function errorSnippet(result: ToolResultPayload): string {
	let text = "";

	if (result !== null && result !== undefined) {
		if (Check(TOOL_RESULT_TEXT_SCHEMA, result)) {
			text = result;
		} else {
			try {
				text = JSON.stringify(result) ?? String(result);
			} catch {
				text = String(result);
			}
		}
	}

	const cleaned = text
		// oxlint-disable-next-line eslint/no-control-regex -- strip terminal control characters from notification text.
		.replace(/[\u0000-\u001f\u007f\u001b]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	return cleaned.length > MAX_ERROR_SNIPPET
		? `${cleaned.slice(0, MAX_ERROR_SNIPPET - 1).trimEnd()}…`
		: cleaned;
}

function sessionKey(ctx: ExtensionContext, prefix: string, suffix = "leaf"): string {
	return sessionKeyForIds(
		prefix,
		ctx.sessionManager.getSessionId(),
		ctx.sessionManager.getLeafId() ?? suffix,
	);
}

function warnUnavailable(ctx: ExtensionContext, message: string): void {
	if (ctx.hasUI) ctx.ui.notify(message, "warning");
	else reportDiagnostic(`[action-notifications] ${message}`);
}

async function pushToHark(ctx: ExtensionContext, keyPrefix: string, body: string, summary: string): Promise<void> {
	const client = createHarkClient();

	if (!client) {
		warnUnavailable(ctx, "Hark notifications are selected but PI_HARK_WEBHOOK_URL is not set");

		return;
	}

	try {
		// Unique per notification: the previous leaf-scoped key caused the
		// server to dedupe every alert after the first as an idempotent replay.
		const idempotencyKey = `${sessionKey(ctx, keyPrefix)}:${Date.now()}:${notificationHash(summary)}`.slice(0, 200);

		const result = await client.send(
			{
				title: process.env.PI_HARK_TITLE?.trim() || "Pi",
				project: process.env.PI_HARK_PROJECT?.trim() || "Pi",
				url: process.env.PI_HARK_TAP_URL?.trim() || undefined,
				body,
				summary,
			},
			{ idempotencyKey },
		);

		if (result.delivered === 0) {
			warnUnavailable(ctx, "Hark sent but no iPhone is registered for this service (delivered: 0)");
		}
	} catch (error) {
		const status = error instanceof HarkError ? ` (HTTP ${error.status})` : "";

		warnUnavailable(ctx, `Unable to send the Hark notification${status}`);
	}
}

async function notifyHark(ctx: ExtensionContext, summary: string): Promise<void> {
	await pushToHark(ctx, "pi-action", `Pi needs your attention: ${summary}`, summary);
}

async function notifyDone(ctx: ExtensionContext, summary: string): Promise<void> {
	await pushToHark(ctx, "pi-done", `Pi done in ${projectLabel(ctx)}: ${summary}`, `Pi done: ${summary}`);
}

async function notifyUser(ctx: ExtensionContext, summary: string, opts?: { skipHark?: boolean }): Promise<void> {
	const body = `Action required: ${summary}`;
	const channel = notificationChannel();
	const wantsTerminal = channel === "terminal" || channel === "both" || channel === "all";
	const useTerminal = ctx.mode === "tui" && wantsTerminal;
	const useUi = ctx.hasUI && (channel === "ui" || channel === "both" || channel === "all");
	// Skipped when an interactive Hark question replaces the one-way buzz below.
	const useHark = (channel === "hark" || channel === "all") && !opts?.skipHark;

	if (useTerminal) notifyTerminal("Pi", body);
	else if (wantsTerminal && !ctx.hasUI) {
		// Headless/non-TUI fallback: previously these alerts were silently dropped.
		reportDiagnostic(`[Pi] ${body}`);
	}

	if (useUi) ctx.ui.notify(body, "warning");

	if (useHark) await notifyHark(ctx, summary);
}

/** One line of `/action-notifications status`: whether replies are usable. */
function describeReplyState(channel: NotificationChannel, replyDisabled: boolean): string {
	if (!harkConfigured()) return "unavailable (Hark not configured)";

	if (!replyEnabled() || replyDisabled) return "off";

	if (channel === "hark" || channel === "all") return "on (answer from the iPhone notification)";

	return "idle (needs channel hark or all)";
}

/** One line of `/action-notifications status`: whether the Live Activity is on. */
function describeLiveState(): string {
	if (!liveActivityEnabled()) return "off (PI_HARK_LIVE_ACTIVITY=on to enable)";

	if (!harkConfigured()) return "unavailable (Hark not configured)";

	return "on (run card on the Lock Screen)";
}

/** One line of `/action-notifications status`: whether the done summary is on. */
function describeDoneState(channel: NotificationChannel, doneDisabled: boolean): string {
	if (!doneSummaryEnabled() || doneDisabled) return "off";

	if (!harkConfigured()) return "unavailable (Hark not configured)";

	if (channel === "hark" || channel === "all") return "on (done summary to iPhone)";

	return "idle (needs channel hark or all)";
}

export default function actionNotifications(pi: ExtensionAPI) {
	let enabled = process.env.PI_ACTION_NOTIFICATIONS === "on";
	let replyDisabled = false;
	let doneDisabled = false;
	let cycleAssistantText = "";
	let cycleHasToolCall = false;
	let lastNotifiedHash: string | undefined;
	let lastSummary = "";
	let replyInFlight = false;
	let consecutiveAutoReplies = 0;
	const replyControllers = new Set<AbortController>();
	// Live Activity run tracker. Session-scoped: a fresh run retakes the
	// device slot via replace:true instead of stacking cards.
	let tracker: HarkLiveTracker | undefined;


	pi.registerTool({
		name: "ask_user_on_iphone",
		label: "Ask User on iPhone",
		description: "Ask the user an approval, yes/no, or text question through Hark on their iPhone and wait for the response. Blocks the agent until the user replies, denies, or the timeout expires.",
		parameters: Type.Object({
			question: Type.String({ minLength: 1, maxLength: 1_800, description: "The question to send to the user's iPhone" }),
			responseType: Type.Optional(StringEnum(["approval", "yes_no", "text"] as const)),
			timeoutSeconds: Type.Optional(Type.Integer({ minimum: 30, maximum: 86_400, description: "How long to wait, in seconds" })),
		}),
		executionMode: "sequential",

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const client = createHarkClient();

			if (!client) {
				throw new Error("Hark is not configured; set PI_HARK_WEBHOOK_URL before using ask_user_on_iphone");
			}

			const question = params.question.trim();

			if (!question) throw new Error("ask_user_on_iphone question cannot be empty or whitespace");
			const timeoutSeconds = params.timeoutSeconds ?? DEFAULT_HARK_TIMEOUT_SECONDS;
			const operationSignal = signal ?? new AbortController().signal;
			const responseType = params.responseType ?? "text";
			const correlationId = `pi-${ctx.sessionManager.getSessionId()}-${toolCallId}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
			const idempotencyKey = `pi-question:${ctx.sessionManager.getSessionId()}:${toolCallId}`.replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 200);

			const event = await sendInteractiveQuestion(client, {
				question,
				responseType,
				timeoutSeconds,
				correlationId,
				idempotencyKey,
				signal: operationSignal,
			});

			if (!event.eventId) throw new Error("Hark did not return an event ID");

			const reportProgress = (elapsedSeconds: number): void => {
				try {
					onUpdate?.({
						content: [{ type: "text", text: `Waiting for iPhone response… ${elapsedSeconds}s of ${timeoutSeconds}s elapsed.` }],
						details: { status: "pending", elapsedSeconds, timeoutSeconds },
					});
				} catch {
					// Progress reporting must never break the wait loop.
				}
			};

			try {
				const result = await waitForHarkResponse(client, event.eventId, timeoutSeconds, operationSignal, reportProgress);

				if (result.response.status === "expired") {
					return {
						content: [{ type: "text", text: `Timed out after ${timeoutSeconds}s waiting for iPhone response (no reply, expired)` }],
						details: {
							status: result.response.status,
							action: result.response.action,
							text: result.response.text,
							correlationId: result.response.correlationId,
						},
					};
				}

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

	pi.registerCommand("action-notifications", {
		description: "Enable, disable, inspect, or test LLM action-required notifications",
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const value = (sub ?? "").toLowerCase();

			if (value === "on" || value === "off") {
				enabled = value === "on";
				ctx.ui.notify(`Action-required notifications ${enabled ? "enabled" : "disabled"}`, "info");

				return;
			}

			if (value === "channel") {
				const target = (rest[0] ?? "").toLowerCase();

				if (target === "terminal" || target === "ui" || target === "both" || target === "hark" || target === "all") {
					setNotificationChannelOverride(target);
					ctx.ui.notify(`Action-required notification channel: ${channelDescription(target)} (session only; PI_ACTION_NOTIFICATIONS_CHANNEL overrides on restart)`, "info");
				} else if (target === "default" || target === "reset" || target === "") {
					setNotificationChannelOverride(undefined);
					ctx.ui.notify(`Action-required notification channel reset to env: ${channelDescription(notificationChannel())}`, "info");
				} else {
					ctx.ui.notify("Usage: /action-notifications channel [terminal|ui|both|hark|all|reset]", "warning");
				}

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
					const status = error instanceof HarkError ? ` (HTTP ${error.status})` : "";

					ctx.ui.notify(`Hark test failed${status}`, "error");
				}

				return;
			}

			if (value === "reply") {
				const target = (rest[0] ?? "").toLowerCase();

				if (target === "on" || target === "off") {
					replyDisabled = target === "off";
					ctx.ui.notify(`iPhone answers ${replyDisabled ? "disabled" : "enabled"} (session only; PI_ACTION_REPLY=off disables on restart)`, "info");
				} else {
					ctx.ui.notify("Usage: /action-notifications reply [on|off]", "warning");
				}

				return;
			}

			if (value === "verbosity") {
				const target = (rest[0] ?? "").toLowerCase();

				if (target === "errors" || target === "actions" || target === "all") {
					setHarkVerbosityOverride(target);
					ctx.ui.notify(`Hark verbosity: ${verbosityDescription(target)} (session only; PI_HARK_VERBOSITY overrides on restart)`, "info");
				} else if (target === "default" || target === "reset" || target === "") {
					setHarkVerbosityOverride(undefined);
					ctx.ui.notify(`Hark verbosity reset to env: ${verbosityDescription(harkVerbosity())}`, "info");
				} else {
					ctx.ui.notify("Usage: /action-notifications verbosity [errors|actions|all|reset]", "warning");
				}

				return;
			}

			if (value === "done") {
				const target = (rest[0] ?? "").toLowerCase();

				if (target === "on" || target === "off") {
					doneDisabled = target === "off";
					ctx.ui.notify(`Done summaries ${doneDisabled ? "disabled" : "enabled"} (session only; PI_HARK_DONE_SUMMARY=off disables on restart)`, "info");
				} else {
					ctx.ui.notify("Usage: /action-notifications done [on|off]", "warning");
				}

				return;
			}

			if (value && value !== "status") {
				ctx.ui.notify("Usage: /action-notifications [on|off|status|test|channel <name|reset>|reply <on|off>|verbosity <level|reset>|done <on|off>]", "warning");

				return;
			}

			const channel = notificationChannel();
			const harkState = harkConfigured() ? "configured" : "not configured";
			const last = lastSummary ? `; last: ${lastSummary}` : "";
			const replyState = describeReplyState(channel, replyDisabled);
			const liveState = describeLiveState();
			const doneState = describeDoneState(channel, doneDisabled);
			ctx.ui.notify(
				`Action-required notifications are ${enabled ? "enabled" : "disabled"}; channel: ${channelDescription(channel)}; Hark: ${harkState}; verbosity: ${verbosityDescription(harkVerbosity())}; replies: ${replyState}; live: ${liveState}; done: ${doneState}${last}`,
				"info",
			);
		},
	});

	pi.on("before_agent_start", (event) => {
		if (!enabled) return;

		if (event.systemPrompt.includes(MARKER_INSTRUCTION_SENTINEL)) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\nWhen your final response requires the human to do something or answer a question, append exactly one marker at the very end: [[PI_ACTION_REQUIRED: short description of the required action]]. Do not append it for completed work, optional suggestions, or rhetorical questions. Keep the response useful and natural; the marker is removed before display.`,
		};
	});

	const wantsHarkPush = (): boolean => {
		const channel = notificationChannel();

		return channel === "hark" || channel === "all";
	};

	const maybePushLifecycle = async (ctx: ExtensionContext, phase: "started" | "finished"): Promise<void> => {
		if (!enabled || !wantsHarkPush() || !verbosityAllows("lifecycle")) return;
		const summary = phase === "started" ? `Pi started in ${projectLabel(ctx)}` : `Pi finished in ${projectLabel(ctx)}`;
		await pushToHark(ctx, "pi-lifecycle", summary, summary);
	};

	pi.on("agent_start", async (_event, ctx) => {
		cycleAssistantText = "";
		cycleHasToolCall = false;
		tracker = new HarkLiveTracker({
			sessionId: ctx.sessionManager.getSessionId(),
			leafId: ctx.sessionManager.getLeafId(),
			cwd: ctx.cwd ?? "",
		});
		await tracker.start();
		await maybePushLifecycle(ctx, "started");
	});

	pi.on("tool_execution_start", (event) => {
		tracker?.noteTool(event.toolName);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		if (tracker?.usable) {
			void tracker.patch(
				event.isError ? `${event.toolName} failed` : `Ran ${event.toolName}`,
				tracker.toolDetail(),
			);
		}

		if (!enabled || !event.isError) return;

		if (!wantsHarkPush() || !verbosityAllows("error")) return;
		const summary = `${event.toolName} failed in ${projectLabel(ctx)}`;
		const snippet = errorSnippet(event.result);
		await pushToHark(ctx, "pi-error", snippet ? `${summary}: ${snippet}` : summary, summary);
	});

	pi.on("message_end", async (event) => {
		// A real user message (including an injected iPhone answer) resets
		// the auto-reply streak so the next genuine question can prompt again.
		if (event.message.role === "user") {
			consecutiveAutoReplies = 0;

			return;
		}

		if (event.message.role !== "assistant") return;
		const text = assistantText(event.message);
		cycleAssistantText = cycleAssistantText ? `${cycleAssistantText}\n${text}` : text;
		cycleHasToolCall = event.message.content.some((part) => part.type === "toolCall");

		if (!ACTION_MARKER.test(cycleAssistantText)) return;

		return { message: withoutActionMarkers(event.message) };
	});

	const offerReply = async (ctx: ExtensionContext, summary: string): Promise<void> => {
		const client = createHarkClient();

		if (!client) return;
		const controller = new AbortController();
		replyControllers.add(controller);
		replyInFlight = true;

		try {
			const responseType = inferReplyType(summary);
			const timeoutSeconds = replyTimeoutSeconds();

			const event = await sendInteractiveQuestion(client, {
				question: `Pi asks: ${summary}`,
				responseType,
				timeoutSeconds,
				correlationId: `pi-reply-${ctx.sessionManager.getSessionId()}-${Date.now()}`.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100),
				idempotencyKey: `${sessionKey(ctx, "pi-reply")}:${Date.now()}:${notificationHash(summary)}`.slice(0, 200),
				signal: controller.signal,
			});

			if (!event.eventId) return;
			const result = await waitForHarkResponse(client, event.eventId, timeoutSeconds, controller.signal);

			// Timeouts and cancellations stay silent: injecting anything here
			// would wake the agent with no new information and risk a prompt loop.
			if (result.response.status === "expired" || result.response.status === "canceled") return;
			consecutiveAutoReplies += 1;
			pi.sendUserMessage(
				`Answered from the iPhone notification: ${responseText(result)}\n\nThe question was: ${summary}`,
				{ deliverAs: "followUp" },
			);
		} catch (error) {
			if (controller.signal.aborted) return;

			const status = error instanceof HarkError ? error.status : undefined;

			if (status === 402) {
				// Interactive prompts need Hark Pro: degrade to the one-way buzz
				// so the question is still seen, and say why answers aren't offered.
				await notifyHark(ctx, summary).catch(() => undefined);
				warnUnavailable(ctx, "Hark Pro is required for iPhone answers; sent one-way instead");

				return;
			}

			warnUnavailable(ctx, "Unable to collect the iPhone reply");
		} finally {
			replyControllers.delete(controller);
			replyInFlight = false;
		}
	};

	pi.on("agent_settled", async (_event, ctx) => {
		if (!enabled) {
			await tracker?.end("Stopped", "terminal");

			return;
		}

		// The last assistant message queued tool calls, so the loop is not
		// over yet — notifying now would fire mid-task on partial text.
		if (cycleHasToolCall) return;

		if (!cycleAssistantText.trim()) {
			await tracker?.end("Done", "success");
			await maybePushLifecycle(ctx, "finished");

			return;
		}

		const action = detectActionRequired(cycleAssistantText);

		if (!action) {
			// Finished work: one done push with a short summary beats the
			// generic lifecycle ping, so skip the latter when this fires.
			const summary = doneSummary(cycleAssistantText);

			if (summary && doneSummaryEnabled() && !doneDisabled && wantsHarkPush()) {
				await notifyDone(ctx, summary);
				await tracker?.end("Done", "success", summary);

				return;
			}

			await tracker?.end("Done", "success");
			await maybePushLifecycle(ctx, "finished");

			return;
		}

		const hash = `${action.source}:${notificationHash(action.summary)}`;

		if (hash === lastNotifiedHash) return;
		lastNotifiedHash = hash;
		lastSummary = action.summary;
		// Answerable questions go out as interactive Hark prompts so the user
		// can reply from the notification; the answer is injected as a user
		// message. The interactive push replaces the one-way Hark buzz.
		const channel = notificationChannel();

		const wantReply = enabled && replyEnabled() && !replyDisabled && harkConfigured()
			&& (channel === "hark" || channel === "all")
			&& !replyInFlight && consecutiveAutoReplies < MAX_CONSECUTIVE_AUTO_REPLIES
			&& isAnswerable(action.summary);

		await notifyUser(ctx, action.summary, { skipHark: wantReply });

		if (wantReply) {
			// The card reflects the wait instead of going stale mid-prompt.
			await tracker?.patch("Waiting for iPhone answer", action.summary, true);
			await offerReply(ctx, action.summary);
		}

		await tracker?.end("Needs you", "warning");
	});

	pi.on("session_shutdown", () => {
		for (const controller of replyControllers) controller.abort();
		replyControllers.clear();
		void tracker?.end("Session ended", "terminal");
	});
}
