// Phase 2 extraction (Q9 option A): Live Activity run-tracker as a Pi-ctx-free
// class. Logic is verbatim from agent/extensions/hark/index.ts; index.ts
// remains canonical until wiring. Pure args only (sessionId/leafId/cwd) so
// index.ts can pass session values. The tracker is an accessory: every method
// swallows errors and never rejects.

import {
	liveActivityEnabled,
	liveBaseTitle,
	liveDismissAfterSeconds,
	livePatchIntervalMs,
	sessionKey,
} from "./config.ts";
import {
	createActivityClient,
	type LiveActivityClient,
	type LiveSymbol,
} from "./activity-client.ts";

export interface HarkLiveTrackerIdentity {
	sessionId: string;
	leafId: string | null | undefined;
	cwd: string;
}

export type HarkLiveTrackerActivities = Pick<
	LiveActivityClient,
	"startActivity" | "updateActivity" | "endActivity"
>;

export type HarkLiveEndSymbol = Extract<LiveSymbol, "success" | "warning" | "terminal">;

export class HarkLiveTracker {
	private readonly sessionId: string;
	private readonly leafId: string | null | undefined;
	private readonly cwd: string;
	private readonly injected?: HarkLiveTrackerActivities;
	private activities?: HarkLiveTrackerActivities;
	private liveActivityId: string | undefined;
	private liveKey: string | undefined;
	private liveUsable = false;
	private liveEnded = true;
	private liveToolCalls = 0;
	private liveLastPatch = 0;
	private startPromise: Promise<void> = Promise.resolve();

	constructor(identity: HarkLiveTrackerIdentity, activities?: HarkLiveTrackerActivities) {
		this.sessionId = identity.sessionId;
		this.leafId = identity.leafId;
		this.cwd = identity.cwd;
		this.injected = activities;
	}

	get toolCalls(): number {
		return this.liveToolCalls;
	}

	get usable(): boolean {
		return this.liveUsable;
	}

	get ended(): boolean {
		return this.liveEnded;
	}

	toolDetail(): string {
		return `${this.liveToolCalls} tool call${this.liveToolCalls === 1 ? "" : "s"}`;
	}

	async start(): Promise<void> {
		try {
			this.liveActivityId = undefined;
			this.liveKey = undefined;
			this.liveUsable = false;
			this.liveEnded = false;
			this.liveToolCalls = 0;
			this.liveLastPatch = 0;
			this.startPromise = this.init();
			await this.startPromise;
		} catch {
			// The tracker is an accessory: it must never break the session.
		}
	}

	private async init(): Promise<void> {
		try {
			if (!liveActivityEnabled()) return;
			// Default wiring resolves the client lazily here (not in the
			// constructor), exactly when index.ts created it per run.
			const activities = this.injected ?? defaultActivities();

			if (!activities) return;
			this.activities = activities;
			// Constant payload: repeated starts replay idempotently
			// on the same key instead of 409ing on a changed body.
			const key = sessionKey("pi-run", this.sessionId, this.leafId);
			const project = this.cwd.split("/").filter(Boolean).pop();

			const result = await activities.startActivity({
				title: project ? `${liveBaseTitle()} · ${project}` : liveBaseTitle(),
				status: "Running",
				style: "terminal",
				key,
				replace: true,
			}, { idempotencyKey: `${key}:start`.slice(0, 200) });

			// accepted:0 means no device can render Live Activities; stay quiet.
			if ((result.accepted ?? 1) === 0) return;
			this.liveKey = key;
			this.liveActivityId = result.activityId || key;
			this.liveUsable = true;
		} catch {
			// Silent: a missing card is better than a broken run.
		}
	}

	async patch(status: string, detail?: string, force = false): Promise<void> {
		try {
			try {
				await this.startPromise;
			} catch {
				// init never rejects (all errors caught inside). Defensive only.
			}

			if (!this.liveUsable || !this.liveActivityId || !this.activities) return;
			const now = Date.now();

			// Coalesce rapid tool churn: updates share a rate-limit budget with pushes.
			if (!force && now - this.liveLastPatch < livePatchIntervalMs()) return;
			this.liveLastPatch = now;

			try {
				await this.activities.updateActivity(this.liveActivityId, { status, detail });
			} catch {
				// Silent: a stale card is better than a broken run.
			}
		} catch {
			// Never reject: progress reporting must never break the run.
		}
	}

	noteTool(name: string): void {
		if (!this.liveUsable) return;
		this.liveToolCalls += 1;
		void this.patch(`Running ${name}`, this.toolDetail());
	}

	async end(status: string, symbol: HarkLiveEndSymbol, detail?: string): Promise<void> {
		try {
			try {
				await this.startPromise;
			} catch {
				// Defensive only; see patch.
			}

			if (!this.liveUsable || !this.liveActivityId || this.liveEnded || !this.activities) return;
			this.liveEnded = true;
			this.liveUsable = false;
			const idempotencyKey = this.liveKey ? `${this.liveKey}:end:${Date.now()}`.slice(0, 200) : undefined;

			try {
				await this.activities.endActivity(this.liveActivityId, {
					status,
					progress: 1,
					symbol,
					dismissAfterSeconds: liveDismissAfterSeconds(),
					detail,
				}, { idempotencyKey });
			} catch {
				// Silent: nothing left to do with a finished run.
			}
		} catch {
			// Never reject.
		}
	}
}

function defaultActivities(): HarkLiveTrackerActivities | undefined {
	const client = createActivityClient();

	if (!client) return undefined;

	return {
		startActivity: client.startActivity.bind(client),
		updateActivity: client.updateActivity.bind(client),
		endActivity: client.endActivity.bind(client),
	};
}
