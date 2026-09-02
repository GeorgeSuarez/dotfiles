import { basename, relative, resolve, sep } from "node:path";

export interface DangerousCommand {
	pattern: RegExp;
	reason: string;
}

// — single source for protected paths —

export const PROTECTED_DIRECTORIES = new Set([
	".git",
	".ssh",
	".aws",
	".gnupg",
	"node_modules",
]);

export const PROTECTED_BASENAMES = new Set([
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

export const SAFE_ENV_BASENAMES = new Set([".env.example", ".env.sample", ".env.template"]);
export const PROTECTED_SUFFIXES = [".pem", ".key", ".p12", ".pfx"];

export const MUTATING_COMMANDS = new Set([
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

// — single source for dangerous commands (merged protected-paths + previous list) —

export const dangerousCommands: DangerousCommand[] = [
	{ pattern: /\brm\s+(?:-[^\s]*r|--recursive)/i, reason: "recursive deletion" },
	{ pattern: /\b(?:sudo|doas)\b/i, reason: "elevated privileges" },
	{ pattern: /\b(?:git\s+)?reset\s+--hard\b/i, reason: "discarding tracked changes" },
	{ pattern: /\bgit\s+clean\s+-[^\n]*f/i, reason: "deleting untracked files" },
	{ pattern: /\bgit\s+(?:push\b.*(?:-f|--force)|branch\b.*-D)\b/i, reason: "rewriting shared history" },
	{ pattern: /\b(?:git\s+)?(?:checkout|restore)\s+--/i, reason: "overwriting working-tree files" },
	{ pattern: /\b(?:chmod|chown)\b/i, reason: "changing permissions or ownership" },
	{ pattern: /\b(?:mkfs|wipefs|shred|diskutil\s+erase)\b/i, reason: "can irreversibly destroy data" },
	{ pattern: /\bdd\b/i, reason: "dd can overwrite block devices or files" },
	{ pattern: /\b(?:terraform|pulumi)\s+destroy\b/i, reason: "destroying infrastructure" },
	{ pattern: /\bdocker\s+system\s+prune\b/i, reason: "removing Docker resources" },
	{ pattern: /\b(?:sed|perl)\b[^\n]*\s-[^\s]*i/i, reason: "edits files in place" },
	{ pattern: />\s*\/dev\/(?:disk|sd|nvme|rdisk)/i, reason: "redirects output to a block device" },
	{
		pattern: /(?:>|>>|\b(?:cp|mv|rm)\b)[^\n]*(?:^|[\s/])(?:\.env(?:\.[\w.-]+)?|.*\.(?:pem|key|p12|pfx))\b/i,
		reason: "modifying likely secret material",
	},
];

// helpers — shared by both guards

function stripShellSyntax(value: string): string {
	return value
		.trim()
		.replace(/^[@'\"]+/, "")
		.replace(/[,'\";)]+$/, "")
		.replace(/^<{1,2}/, "")
		.replace(/^>{1,2}/, "");
}

function shellWords(segment: string): string[] {
	const words: string[] = [];
	const pattern = /"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g;
	for (const match of segment.matchAll(pattern)) {
		words.push(stripShellSyntax(match[0]));
	}
	return words.filter(Boolean);
}

export function isProtectedPath(candidate: string, cwd: string): boolean {
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

export function findProtectedTarget(command: string, cwd: string): string | undefined {
	for (const segment of commandSegments(command)) {
		if (!isMutatingSegment(segment)) continue;
		const target = mutationTargets(segment).find((word) => isProtectedPath(word, cwd));
		if (target) return target;
	}
	return undefined;
}

export function matchDangerousCommand(command: string): DangerousCommand | undefined {
	// segment-aware: test each segment so `echo hi; rm -rf /` is caught
	for (const segment of commandSegments(command)) {
		const hit = dangerousCommands.find(({ pattern }) => pattern.test(segment));
		if (hit) return hit;
	}
	// fallback to whole command (covers multi-segment patterns)
	return dangerousCommands.find(({ pattern }) => pattern.test(command));
}
