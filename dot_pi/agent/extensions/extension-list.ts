/**
 * /extensions — floating TUI overlay listing all discovered pi extensions.
 *
 * Discovery mirrors pi's documented auto-discovery locations
 * (docs/extensions.md): global ~/.pi/agent/extensions/, project .pi/extensions/,
 * plus explicit entries from settings.json ("extensions" and "packages").
 */
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";

export interface DiscoveredExtension {
	name: string;
	path: string;
	scope: "global" | "project" | "settings";
}

/** Scan one extensions dir; returns file extensions and directory extensions (dir/index.ts). */
function scanDir(dir: string, scope: DiscoveredExtension["scope"]): DiscoveredExtension[] {
	if (!existsSync(dir)) return [];
	const out: DiscoveredExtension[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		if (entry.isFile() && entry.name.endsWith(".ts")) {
			out.push({ name: entry.name.replace(/\.ts$/, ""), path: join(dir, entry.name), scope });
		} else if (entry.isDirectory() && existsSync(join(dir, entry.name, "index.ts"))) {
			out.push({ name: entry.name, path: join(dir, entry.name, "index.ts"), scope });
		}
	}
	return out;
}

export function discoverExtensions(cwd: string): DiscoveredExtension[] {
	const agentDir = join(homedir(), ".pi", "agent");
	const global = scanDir(join(agentDir, "extensions"), "global");
	const project = scanDir(join(cwd, ".pi", "extensions"), "project");
	// settings.json entries: "extensions" (local paths) and "packages" (npm:/git: specs)
	const settingsPath = join(agentDir, "settings.json");
	let settings: string[] = [];
	if (existsSync(settingsPath)) {
		try {
			const s = JSON.parse(readFileSync(settingsPath, "utf8"));
			settings = [...(s.extensions ?? []), ...(s.packages ?? [])].map(String);
		} catch {
			// unreadable settings — skip those entries
		}
	}
	const seen = new Set(global.map((e) => e.path));
	return [
		...global,
		...project.filter((e) => !seen.has(e.path)),
		...settings.map((spec) => {
			const bare = spec.replace(/^(npm|git):/, "");
			const last = bare.split("/").pop() ?? bare;
			return { name: last.replace(/@[\w.~-]+$/, "") || bare, path: spec, scope: "settings" as const };
		}),
	];
}

const VIEWPORT = 20;

class ExtensionListOverlay {
	readonly width = 72;
	focused = false;
	private scroll = 0;
	private items: DiscoveredExtension[];
	private theme: Theme;
	private done: (result: undefined) => void;

	constructor(items: DiscoveredExtension[], theme: Theme, done: (result: undefined) => void) {
		this.items = items;
		this.theme = theme;
		this.done = done;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "return") || data === "q") {
			this.done(undefined);
		} else if (matchesKey(data, "up")) {
			this.scroll = Math.max(0, this.scroll - 1);
		} else if (matchesKey(data, "down")) {
			this.scroll = Math.min(Math.max(0, this.items.length - VIEWPORT), this.scroll + 1);
		}
	}

	render(_width: number): string[] {
		const th = this.theme;
		const innerW = this.width - 2;
		const pad = (s: string) => s + " ".repeat(Math.max(0, innerW - visibleWidth(s) - 2));
		const row = (content: string) => th.fg("border", "│") + " " + pad(content) + th.fg("border", "│");
		const lines: string[] = [];

		lines.push(th.fg("border", `╭${"─".repeat(innerW)}╮`));
		lines.push(row(`${th.fg("accent", "Extensions")} ${th.fg("dim", `(${this.items.length})`)}`));
		lines.push(row(""));

		const start = Math.min(this.scroll, Math.max(0, this.items.length - VIEWPORT));
		const visible = this.items.slice(start, start + VIEWPORT);
		for (const ext of visible) {
			const scopeColor = ext.scope === "global" ? "accent" : ext.scope === "project" ? "success" : "warning";
			lines.push(row(`${th.fg("text", ext.name)} ${th.fg("dim", "·")} ${th.fg(scopeColor, ext.scope)}`));
		}
		if (this.items.length > VIEWPORT) {
			lines.push(row(th.fg("dim", `  ${start + 1}–${Math.min(start + VIEWPORT, this.items.length)} of ${this.items.length}`)));
		}

		lines.push(row(""));
		lines.push(row(th.fg("dim", "↑↓ scroll • Esc close")));
		lines.push(th.fg("border", `╰${"─".repeat(innerW)}╯`));
		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("extensions", {
		description: "List loaded extensions",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (ctx.mode !== "tui") {
				const items = discoverExtensions(ctx.cwd);
				ctx.ui.notify(items.map((e) => `${e.name} (${e.scope})`).join("\n"), "info");
				return;
			}
			await ctx.ui.custom<undefined>(
				(_tui, theme, _keybindings, done) => new ExtensionListOverlay(discoverExtensions(ctx.cwd), theme, done),
				{ overlay: true },
			);
		},
	});
}

// Self-check: bun extension-list.ts → prints discovered extensions for ~/Projects
if (import.meta.main) {
	console.log(discoverExtensions(process.argv[2] ?? process.cwd()));
}
