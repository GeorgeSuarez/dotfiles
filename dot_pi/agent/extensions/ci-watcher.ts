import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Watches the latest GitHub Actions run for a branch and injects the result into
 * the session when it completes, so the agent can wake up and react (e.g. fix a
 * failing CI run). Started with `/watch [branch|pr] [interval-seconds]`,
 * stopped with `/unwatch`, and cleaned up on session shutdown.
 */

interface RunSnapshot {
	status: string;
	conclusion: string | null;
	displayTitle: string | null;
	url: string | null;
}

const MIN_INTERVAL_MS = 15_000;

function parseSnapshot(stdout: string): RunSnapshot | undefined {
	try {
		const runs = JSON.parse(stdout) as RunSnapshot[];
		return Array.isArray(runs) ? runs[0] : undefined;
	} catch {
		return undefined;
	}
}

export default function ciWatcher(pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let branch: string | undefined;
	let cwd: string | undefined;

	function stop(): void {
		if (timer) clearInterval(timer);
		timer = undefined;
		branch = undefined;
	}

	pi.registerCommand("watch", {
		description: "Watch the latest GitHub Actions run for a branch until it completes",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			let ref = parts[0] ?? "";
			if (!ref) {
				const current = await pi.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd });
				ref = current.stdout.trim();
			}
			if (!ref) {
				ctx.ui.notify("Usage: /watch [branch-or-pr-number] [interval-seconds]", "error");
				return;
			}

			// Resolve a PR number to its head branch
			if (/^\d+$/.test(ref)) {
				const pr = await pi.exec("gh", ["pr", "view", ref, "--json", "headRefName", "--jq", ".headRefName"], { cwd: ctx.cwd, timeout: 15_000 });
				if (pr.code !== 0 || !pr.stdout.trim()) {
					ctx.ui.notify(`ci-watcher: could not resolve PR ${ref}: ${pr.stderr.trim() || "not found"}`, "error");
					return;
				}
				ref = pr.stdout.trim();
			}

			const intervalArg = Number(parts[1]);
			const fallbackMs = Number(process.env.PI_CI_WATCH_INTERVAL ?? 60) * 1000;
			const intervalMs = Math.max(Number.isFinite(intervalArg) && intervalArg > 0 ? intervalArg * 1000 : 0, fallbackMs, MIN_INTERVAL_MS);

			stop();
			branch = ref;
			cwd = ctx.cwd;
			ctx.ui.setStatus("ci-watcher", `watching CI: ${ref} (every ${Math.round(intervalMs / 1000)}s)`);

			const poll = async (): Promise<void> => {
				if (!branch || !cwd) return;
				const result = await pi.exec(
					"gh",
					["run", "list", "--branch", branch, "--limit", "1", "--json", "status,conclusion,displayTitle,url"],
					{ cwd, timeout: 20_000 },
				);
				if (result.code !== 0) {
					ctx.ui.notify(`ci-watcher: gh failed: ${(result.stderr.trim() || `exit ${result.code}`).slice(0, 200)}`, "warning");
					return; // transient failure; keep polling
				}
				const run = parseSnapshot(result.stdout);
				if (!run) return;
				if (run.status !== "completed") {
					ctx.ui.setStatus("ci-watcher", `CI ${run.status}: ${branch}`);
					return;
				}

				const conclusion = run.conclusion ?? "unknown";
				ctx.ui.notify(`CI ${conclusion} on ${branch}: ${run.displayTitle ?? ""}`, conclusion === "success" ? "info" : "warning");
				await pi.sendMessage(
					{
						customType: "ci-watcher",
						content:
							`CI run on branch "${branch}" finished with conclusion "${conclusion}": ${run.displayTitle ?? "(no title)"}${run.url ? ` ${run.url}` : ""}`.trim() +
							(conclusion === "success" ? "" : "\n\nInvestigate the failure, fix it, and push again."),
						display: true,
					},
					{ deliverAs: "followUp", triggerTurn: true },
				);
				stop();
			};

			timer = setInterval(() => {
				void poll();
			}, intervalMs);
			void poll();
		},
	});

	pi.registerCommand("unwatch", {
		description: "Stop watching CI",
		handler: async (_args, ctx) => {
			if (!timer) {
				ctx.ui.notify("Not watching CI", "info");
				return;
			}
			stop();
			ctx.ui.setStatus("ci-watcher", "");
			ctx.ui.notify("Stopped watching CI", "info");
		},
	});

	pi.on("session_shutdown", async () => {
		stop();
	});
}
