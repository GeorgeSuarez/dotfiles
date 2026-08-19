import { basename, relative, resolve, sep } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

// Hard-blocked locations. Add project-specific paths here when needed.
const PROTECTED_DIRECTORIES = new Set([
	".git",
	".ssh",
	".aws",
	".gnupg",
	"node_modules",
]);

const PROTECTED_BASENAMES = new Set([
	".env",
	".env.local",
	".env.production",
	".env.staging",
	"auth.json",
	"credentials.json",
	"secrets.json",
	"token.json",
	"id_rsa",
	"id_ed25519",
]);

const SAFE_ENV_BASENAMES = new Set([".env.example", ".env.sample", ".env.template"]);
const PROTECTED_SUFFIXES = [".pem", ".key", ".p12", ".pfx"];

const MUTATING_COMMANDS = new Set([
	"rm",
	"mv",
	"cp",
	"install",
	"tee",
	"touch",
	"chmod",
	"chown",
	"truncate",
	"shred",
	"dd",
]);

interface GuardResult {
	kind: "protected-path" | "destructive-command";
	reason: string;
}

function stripShellSyntax(value: string): string {
	return value
		.trim()
		.replace(/^[@'\"]+/, "")
		.replace(/[,'\";)]+$/, "")
		.replace(/^<{1,2}/, "")
		.replace(/^>{1,2}/, "");
}

/** A deliberately small shell tokenizer. It is not intended to execute shell syntax. */
function shellWords(segment: string): string[] {
	const words: string[] = [];
	const pattern = /"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g;
	for (const match of segment.matchAll(pattern)) {
		words.push(stripShellSyntax(match[0]));
	}
	return words.filter(Boolean);
}

function pathIsProtected(candidate: string, cwd: string): boolean {
	let value = stripShellSyntax(candidate);
	const deviceAssignment = value.match(/^(?:if|of)=(.+)$/i);
	if (deviceAssignment) value = stripShellSyntax(deviceAssignment[1]);
	if (!value || value === "." || value === ".." || value.startsWith("-")) return false;

	const absolutePath = resolve(cwd, value);
	const relativePath = relative(cwd, absolutePath);
	const segments = relativePath.split(sep).filter(Boolean);
	const fileName = basename(absolutePath);

	if (segments.some((segment) => PROTECTED_DIRECTORIES.has(segment))) return true;
	if (SAFE_ENV_BASENAMES.has(fileName)) return false;
	if (PROTECTED_BASENAMES.has(fileName)) return true;
	if (/^\.env(?:\..+)?$/i.test(fileName)) return true;
	return PROTECTED_SUFFIXES.some((suffix) => fileName.toLowerCase().endsWith(suffix));
}

function commandName(segment: string): string | undefined {
	const words = shellWords(segment);
	let index = 0;

	// Ignore environment assignments and common command wrappers.
	while (index < words.length) {
		if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) {
			index++;
			continue;
		}
		if (["env", "command", "builtin", "sudo", "doas"].includes(words[index])) {
			index++;
			continue;
		}
		break;
	}

	const command = words[index];
	return command ? basename(command) : undefined;
}

function commandSegments(command: string): string[] {
	return command.split(/&&|\|\||[;|\n]/).map((segment) => segment.trim()).filter(Boolean);
}

function isMutatingSegment(segment: string): boolean {
	const name = commandName(segment);
	if (!name) return false;
	if (MUTATING_COMMANDS.has(name)) return true;
	if ((name === "sed" || name === "perl") && /(^|\s)-[^\s]*i/.test(segment)) return true;
	if (name === "git") {
		return /\bgit\s+(?:checkout|restore|reset|clean|apply|mv|rm)\b/i.test(segment);
	}
	return />{1,2}\s*/.test(segment);
}

function mutationTargets(segment: string): string[] {
	const name = commandName(segment);
	if (!name) return [];

	const targets: string[] = [];
	for (const match of segment.matchAll(/>{1,2}\s*(?:"([^"]+)"|'([^']+)'|([^\s;|]+))/g)) {
		targets.push(match[1] ?? match[2] ?? match[3]);
	}

	if (name === "git") {
		const words = shellWords(segment);
		const separator = words.indexOf("--");
		if (separator >= 0) {
			targets.push(...words.slice(separator + 1));
		} else {
			const subcommandIndex = words.findIndex((word) =>
				["checkout", "restore", "reset", "apply", "mv", "rm"].includes(word),
			);
			if (subcommandIndex >= 0) {
				targets.push(
					...words
						.slice(subcommandIndex + 1)
						.filter((word) => word !== "--" && !word.startsWith("-")),
				);
			}
		}
		return targets;
	}

	if (MUTATING_COMMANDS.has(name) || ((name === "sed" || name === "perl") && /(^|\s)-[^\s]*i/.test(segment))) {
		return targets.concat(
			shellWords(segment).slice(1).filter((word) => word !== "--" && !word.startsWith("-")),
		);
	}

	return targets;
}

function protectedPathGuard(command: string, cwd: string): GuardResult | undefined {
	for (const segment of commandSegments(command)) {
		if (!isMutatingSegment(segment)) continue;
		const protectedTarget = mutationTargets(segment).find((word) => pathIsProtected(word, cwd));
		if (protectedTarget) {
			return {
				kind: "protected-path",
				reason: `A mutating command targets protected path "${protectedTarget}".`,
			};
		}
	}
	return undefined;
}

function destructiveCommandGuard(command: string): GuardResult | undefined {
	const segments = commandSegments(command);

	for (const segment of segments) {
		if (/^\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*=\S+)\s+|env\s+)*(?:sudo|doas)\b/i.test(segment)) {
			const wrapper = segment.match(/(?:sudo|doas)/i)?.[0] ?? "sudo";
			return { kind: "destructive-command", reason: `${wrapper} runs with elevated privileges.` };
		}

		const name = commandName(segment);
		if (!name) continue;

		if (name === "rm") {
			return { kind: "destructive-command", reason: "rm deletes files or directories." };
		}
		if (name === "sudo" || name === "doas") {
			return { kind: "destructive-command", reason: `${name} runs with elevated privileges.` };
		}
		if (["mkfs", "wipefs", "shred"].includes(name)) {
			return { kind: "destructive-command", reason: `${name} can irreversibly destroy data.` };
		}
		if (name === "dd") {
			return { kind: "destructive-command", reason: "dd can overwrite block devices or files." };
		}
		if (name === "chmod" || name === "chown") {
			return { kind: "destructive-command", reason: `${name} changes permissions or ownership.` };
		}
		if (name === "git" && /\bgit\s+(?:reset\s+--hard|clean\b.*(?:-f|--force)|push\b.*(?:-f|--force)|branch\b.*-D)\b/i.test(segment)) {
			return { kind: "destructive-command", reason: "This Git command can discard work or rewrite shared history." };
		}
		if ((name === "sed" || name === "perl") && /(^|\s)-[^\s]*i/.test(segment)) {
			return { kind: "destructive-command", reason: `${name} edits files in place.` };
		}
		if (/>\s*\/dev\/(?:disk|sd|nvme|rdisk)/i.test(segment)) {
			return { kind: "destructive-command", reason: "This redirects output to a block device." };
		}
	}

	return undefined;
}

function shorten(command: string, maxLength = 600): string {
	return command.length <= maxLength ? command : `${command.slice(0, maxLength - 1)}…`;
}

async function confirmDestructive(
	ctx: ExtensionContext,
	command: string,
	guard: GuardResult,
): Promise<{ block: true; reason: string } | undefined> {
	if (!ctx.hasUI) {
		return {
			block: true,
			reason: `Destructive command blocked because Pi has no UI for confirmation: ${guard.reason}`,
		};
	}

	const confirmed = await ctx.ui.confirm(
		"Allow destructive command?",
		`${guard.reason}\n\n${shorten(command)}`,
	);
	if (confirmed) return undefined;

	return { block: true, reason: `Blocked by user: ${guard.reason}` };
}

export default function protectedPaths(pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
			const path = event.input.path;
			if (pathIsProtected(path, ctx.cwd)) {
				if (ctx.hasUI) ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
				return {
					block: true,
					reason: `Path "${path}" is protected. Edit the guard configuration if this change is intentional.`,
				};
			}
			return undefined;
		}

		if (!isToolCallEventType("bash", event)) return undefined;

		const command = event.input.command;
		const protectedGuard = protectedPathGuard(command, ctx.cwd);
		if (protectedGuard) {
			if (ctx.hasUI) ctx.ui.notify(`Blocked command targeting a protected path: ${protectedGuard.reason}`, "warning");
			return { block: true, reason: protectedGuard.reason };
		}

		const destructiveGuard = destructiveCommandGuard(command);
		if (destructiveGuard) return confirmDestructive(ctx, command, destructiveGuard);

		return undefined;
	});
}
