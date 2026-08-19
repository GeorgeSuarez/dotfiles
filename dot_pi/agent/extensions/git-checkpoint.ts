import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface Checkpoint {
	id: string;
	entryId?: string;
	ref: string;
	timestamp: number;
}

export default function gitCheckpoint(pi: ExtensionAPI) {
	const checkpoints: Checkpoint[] = [];

	async function createCheckpoint(ctx?: ExtensionContext, label = "automatic"): Promise<Checkpoint | undefined> {
		const status = await pi.exec("git", ["rev-parse", "--show-toplevel"]);
		if (status.code !== 0) return undefined;
		const result = await pi.exec("git", ["stash", "create"]);
		const ref = result.stdout.trim();
		if (!ref) return undefined;
		const checkpoint = {
			id: `${Date.now()}-${checkpoints.length + 1}`,
			entryId: ctx?.sessionManager.getLeafId() ?? undefined,
			ref,
			timestamp: Date.now(),
		};
		checkpoints.push(checkpoint);
		pi.appendEntry("git-checkpoint", { ...checkpoint, label });
		return checkpoint;
	}

	async function restore(checkpoint: Checkpoint, ctx: ExtensionContext): Promise<void> {
		if (ctx.hasUI && !(await ctx.ui.confirm("Restore Git checkpoint?", `Apply checkpoint ${checkpoint.id}?`))) return;
		const result = await pi.exec("git", ["stash", "apply", checkpoint.ref]);
		if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Unable to restore checkpoint");
		ctx.ui.notify(`Restored Git checkpoint ${checkpoint.id}`, "info");
	}

	pi.registerCommand("checkpoint", {
		description: "Create a Git checkpoint of current uncommitted changes",
		handler: async (_args, ctx) => {
			const checkpoint = await createCheckpoint(ctx, "manual");
			ctx.ui.notify(checkpoint ? `Checkpoint created: ${checkpoint.id}` : "No Git changes to checkpoint", checkpoint ? "info" : "warning");
		},
	});

	pi.registerCommand("checkpoints", {
		description: "List Git checkpoints created in this Pi session",
		handler: async (_args, ctx) => {
			if (checkpoints.length === 0) {
				ctx.ui.notify("No checkpoints in this session", "info");
				return;
			}
			ctx.ui.notify(checkpoints.map((item, index) => `${index + 1}. ${item.id} (${new Date(item.timestamp).toLocaleTimeString()})`).join("\n"), "info");
		},
	});

	pi.registerCommand("rollback", {
		description: "Restore the latest Git checkpoint",
		handler: async (_args, ctx) => {
			const checkpoint = checkpoints.at(-1);
			if (!checkpoint) {
				ctx.ui.notify("No checkpoint available", "warning");
				return;
			}
			await restore(checkpoint, ctx);
		},
	});

	pi.on("turn_start", async (_event, ctx) => {
		try {
			await createCheckpoint(ctx);
		} catch (error) {
			ctx.ui.notify(`Git checkpoint skipped: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	});

	pi.on("session_before_fork", async (event, ctx) => {
		const checkpoint = [...checkpoints].reverse().find((item) => item.entryId === event.entryId);
		if (checkpoint) await restore(checkpoint, ctx);
	});
}
