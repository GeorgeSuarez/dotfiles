import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchDangerousCommand } from "./lib/dangerous-commands.ts";

const CHECKPOINTS_DIR = join(homedir(), ".pi", "agent", "checkpoints");
const HANDOFF_FILE = join(".pi", "HANDOFF.md");
const MAX_HANDOFF_MESSAGE_LENGTH = 3_000;

const protectedPath = /(?:^|\/)\.env(?:\.[^/]+)?$|(?:^|\/)(?:private_(?:auth|models-store)\.json|auth\.json|credentials?\.[^/]+|secrets?\.[^/]+)$|\.(?:pem|key|p12|pfx)$/i;

interface GitState {
	branch: string;
	status: string;
}

function projectSlug(cwd: string): string {
	const slug = cwd.replace(/^\/+/, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
	return slug.slice(0, 160) || "project";
}

function checkpointDirectory(cwd: string): string {
	return join(CHECKPOINTS_DIR, projectSlug(cwd));
}

function checkpointName(label: string): string {
	const timestamp = new Date().toISOString().replace(/[TZ:.]/g, "-").replace(/-+$/, "");
	const safeLabel = label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48);
	return `${timestamp}${safeLabel ? `-${safeLabel}` : ""}.patch`;
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => {
			return Boolean(part && typeof part === "object" && (part as { type?: unknown }).type === "text");
		})
		.map((part) => part.text)
		.join("\n");
}

function recentConversation(ctx: ExtensionContext): string {
	const messages = ctx.sessionManager
		.getBranch()
		.filter((entry) => entry.type === "message")
		.map((entry) => entry.message)
		.filter((message) => message.role === "user" || message.role === "assistant")
		.slice(-8);

	return messages
		.map((message) => {
			const role = message.role === "user" ? "User" : "Assistant";
			const text = textFromContent(message.content).trim();
			const shortened = text.length > MAX_HANDOFF_MESSAGE_LENGTH ? `${text.slice(0, MAX_HANDOFF_MESSAGE_LENGTH)}…` : text;
			return `### ${role}\n\n${shortened}`;
		})
		.filter((message) => !message.endsWith("\n\n"))
		.join("\n\n");
}

async function gitState(pi: ExtensionAPI): Promise<GitState | undefined> {
	const repo = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"]);
	if (repo.code !== 0 || repo.stdout.trim() !== "true") return undefined;

	const [branch, status] = await Promise.all([
		pi.exec("git", ["branch", "--show-current"]),
		pi.exec("git", ["status", "--short"]),
	]);
	return {
		branch: branch.stdout.trim() || "detached HEAD",
		status: status.stdout.trim(),
	};
}

function statusSummary(state: GitState | undefined): string {
	if (!state) return "not a Git repository";
	const changed = state.status ? state.status.split("\n").length : 0;
	return `${state.branch} · ${changed} changed file${changed === 1 ? "" : "s"}`;
}

function updateStatus(ctx: ExtensionContext, turns: number, tools: number, blocked: number, checkpoint?: string): void {
	const suffix = checkpoint ? ` · saved ${checkpoint}` : "";
	ctx.ui.setStatus("pi-workflow", `pi · ${turns} turns · ${tools} tools · ${blocked} blocked${suffix}`);
}

function commandForTool(event: { toolName: string; input: unknown }): { reason: string; preview: string } | undefined {
	const input = (event.input ?? {}) as Record<string, unknown>;
	if (event.toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		const risky = matchDangerousCommand(command);
		if (risky) return { reason: risky.reason, preview: command };
	}

	if (event.toolName === "write" || event.toolName === "edit") {
		const path = typeof input.path === "string" ? input.path.replaceAll("\\", "/") : "";
		if (protectedPath.test(path)) {
			return { reason: "editing likely secret material", preview: path };
		}
	}

	return undefined;
}

async function saveCheckpoint(pi: ExtensionAPI, ctx: ExtensionContext, label: string): Promise<string | undefined> {
	const state = await gitState(pi);
	if (!state) {
		ctx.ui.notify("/checkpoint only works inside a Git repository", "error");
		return undefined;
	}

	const diff = await pi.exec("git", ["diff", "--binary", "HEAD"]);
	if (diff.code !== 0) {
		ctx.ui.notify(`Could not create checkpoint: ${diff.stderr.trim() || "git diff failed"}`, "error");
		return undefined;
	}
	if (!diff.stdout.trim()) {
		ctx.ui.notify("Nothing to checkpoint; the working tree matches HEAD", "info");
		return undefined;
	}

	const directory = checkpointDirectory(ctx.cwd);
	await mkdir(directory, { recursive: true });
	const fileName = checkpointName(label);
	await writeFile(join(directory, fileName), diff.stdout, "utf8");
	await writeFile(
		join(directory, fileName.replace(/\.patch$/, ".json")),
		JSON.stringify({ cwd: ctx.cwd, branch: state.branch, createdAt: new Date().toISOString(), status: state.status }, null, 2),
		"utf8",
	);
	return fileName;
}

export default function piWorkflow(pi: ExtensionAPI) {
	let turns = 0;
	let tools = 0;
	let blocked = 0;
	let lastCheckpoint: string | undefined;

	const resetSession = (ctx: ExtensionContext) => {
		turns = 0;
		tools = 0;
		blocked = 0;
		lastCheckpoint = undefined;
		updateStatus(ctx, turns, tools, blocked);
	};

	pi.on("session_start", async (_event, ctx) => resetSession(ctx));
	pi.on("turn_start", async (_event, ctx) => {
		turns += 1;
		updateStatus(ctx, turns, tools, blocked, lastCheckpoint);
	});
	pi.on("tool_call", async (event, ctx) => {
		tools += 1;
		const risky = commandForTool(event);
		if (!risky) {
			updateStatus(ctx, turns, tools, blocked, lastCheckpoint);
			return undefined;
		}

		if (!ctx.hasUI) {
			blocked += 1;
			updateStatus(ctx, turns, tools, blocked, lastCheckpoint);
			return { block: true, reason: `Blocked: ${risky.reason}; no interactive confirmation is available` };
		}

		const approved = await ctx.ui.confirm(
			`Pi workflow: ${risky.reason}`,
			`The agent wants to run or edit:\n\n${risky.preview}\n\nAllow this operation?`,
		);
		if (!approved) {
			blocked += 1;
			updateStatus(ctx, turns, tools, blocked, lastCheckpoint);
			return { block: true, reason: "Blocked by user" };
		}
		updateStatus(ctx, turns, tools, blocked, lastCheckpoint);
		return undefined;
	});

	pi.registerCommand("project", {
		description: "Show project Git and Pi session context",
		handler: async (_args, ctx) => {
			const state = await gitState(pi);
			const session = ctx.sessionManager.getSessionFile() ?? "ephemeral session";
			const changed = state?.status || "clean working tree";
			ctx.ui.notify(
				[`Project: ${ctx.cwd}`, `Git: ${statusSummary(state)}`, `Changes: ${changed}`, `Session: ${session}`].join("\n"),
				"info",
			);
		},
	});

	pi.registerCommand("checkpoint", {
		description: "Save tracked Git changes outside the repository",
		handler: async (args, ctx) => {
			const fileName = await saveCheckpoint(pi, ctx, args);
			if (!fileName) return;
			lastCheckpoint = fileName;
			updateStatus(ctx, turns, tools, blocked, lastCheckpoint);
			ctx.ui.notify(`Checkpoint saved: ${fileName}`, "info");
		},
	});

	pi.registerCommand("checkpoints", {
		description: "List checkpoints for the current project",
		handler: async (_args, ctx) => {
			const directory = checkpointDirectory(ctx.cwd);
			try {
				const files = (await readdir(directory)).filter((file) => file.endsWith(".patch")).sort().reverse();
				ctx.ui.notify(files.length ? files.join("\n") : "No checkpoints for this project", "info");
			} catch {
				ctx.ui.notify("No checkpoints for this project", "info");
			}
		},
	});

	pi.registerCommand("restore", {
		description: "Validate and apply a saved checkpoint",
		handler: async (args, ctx) => {
			const requested = basename(args.trim());
			if (!requested || !requested.endsWith(".patch")) {
				ctx.ui.notify("Usage: /restore <checkpoint.patch>", "error");
				return;
			}

			const patch = join(checkpointDirectory(ctx.cwd), requested);
			if (!existsSync(patch)) {
				ctx.ui.notify(`Checkpoint not found: ${requested}`, "error");
				return;
			}

			const check = await pi.exec("git", ["apply", "--check", patch]);
			if (check.code !== 0) {
				ctx.ui.notify(`Checkpoint does not apply cleanly: ${check.stderr.trim() || "git apply failed"}`, "error");
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify("/restore requires interactive confirmation", "error");
				return;
			}
			const approved = await ctx.ui.confirm("Apply checkpoint?", `This will modify tracked files:\n\n${requested}`);
			if (!approved) {
				ctx.ui.notify("Restore cancelled", "info");
				return;
			}
			const result = await pi.exec("git", ["apply", patch]);
			if (result.code !== 0) {
				ctx.ui.notify(`Could not restore checkpoint: ${result.stderr.trim() || "git apply failed"}`, "error");
				return;
			}
			ctx.ui.notify(`Restored checkpoint: ${requested}`, "info");
		},
	});

	pi.registerCommand("handoff", {
		description: "Write current task context to .pi/HANDOFF.md",
		handler: async (args, ctx) => {
			const state = await gitState(pi);
			const destination = join(ctx.cwd, HANDOFF_FILE);
			if (existsSync(destination) && ctx.hasUI) {
				const approved = await ctx.ui.confirm("Replace handoff?", `${HANDOFF_FILE} already exists. Replace it?`);
				if (!approved) return;
			} else if (existsSync(destination)) {
				ctx.ui.notify("Handoff already exists; interactive confirmation is required to replace it", "error");
				return;
			}

			const gitSection = state
				? `- Branch: ${state.branch}\n- Working tree: ${state.status || "clean"}`
				: "- Not a Git repository";
			const handoff = [
				"# Pi handoff",
				"",
				`Created: ${new Date().toISOString()}`,
				`Next task: ${args.trim() || "Continue the current task"}`,
				"",
				"## Project",
				"",
				`- Directory: ${ctx.cwd}`,
				gitSection,
				`- Session: ${ctx.sessionManager.getSessionFile() ?? "ephemeral session"}`,
				"",
				"## Recent conversation",
				"",
				recentConversation(ctx) || "No user or assistant messages recorded yet.",
				"",
			].join("\n");

			await mkdir(join(ctx.cwd, ".pi"), { recursive: true });
			await writeFile(destination, handoff, "utf8");
			ctx.ui.notify(`Handoff written to ${HANDOFF_FILE}`, "info");
		},
	});

	pi.registerCommand("stats", {
		description: "Show Pi workflow counters for this session",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				[`Turns: ${turns}`, `Tool calls: ${tools}`, `Blocked operations: ${blocked}`, `Last checkpoint: ${lastCheckpoint ?? "none"}`].join(
					"\n",
				),
				"info",
			);
		},
	});
}
