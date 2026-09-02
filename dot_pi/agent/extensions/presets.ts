import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Saveable presets of model + thinking level + active tools.
 * `/preset save <name>` snapshots the current combination, `/preset <name>`
 * applies it, `/preset off` restores what was active before the first preset,
 * `/preset list` shows what exists. Presets and the active name persist in the
 * session (appendEntry) so they survive branch navigation and reloads.
 * Trimmed from pi's examples/extensions/preset.ts.
 */

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface Preset {
	provider?: string;
	model?: string;
	thinkingLevel?: ThinkingLevel;
	tools?: string[];
}

interface OriginalState {
	model: Model<Api> | undefined;
	thinkingLevel: ThinkingLevel;
	tools: string[];
}

interface StateEntryData {
	saved?: { name: string; preset: Preset };
	active?: string;
}

export default function presets(pi: ExtensionAPI) {
	const saved: Map<string, Preset> = new Map();
	let activeName: string | undefined;
	let originalState: OriginalState | undefined;

	async function applyPreset(name: string, preset: Preset, ctx: ExtensionContext): Promise<void> {
		if (activeName === undefined) {
			originalState = { model: ctx.model, thinkingLevel: pi.getThinkingLevel(), tools: pi.getActiveTools() };
		}

		if (preset.provider && preset.model) {
			const model = ctx.modelRegistry.find(preset.provider, preset.model);
			if (!model) ctx.ui.notify(`Preset "${name}": model ${preset.provider}/${preset.model} not found`, "warning");
			else if (!(await pi.setModel(model))) ctx.ui.notify(`Preset "${name}": no API key for ${preset.provider}/${preset.model}`, "warning");
		}

		if (preset.thinkingLevel) pi.setThinkingLevel(preset.thinkingLevel);

		if (preset.tools && preset.tools.length > 0) {
			const allTools = pi.getAllTools().map((tool) => tool.name);
			const valid = preset.tools.filter((tool) => allTools.includes(tool));
			const invalid = preset.tools.filter((tool) => !allTools.includes(tool));
			if (invalid.length > 0) ctx.ui.notify(`Preset "${name}": unknown tools: ${invalid.join(", ")}`, "warning");
			if (valid.length > 0) pi.setActiveTools(valid);
		}

		activeName = name;
		pi.appendEntry("preset-state", { active: name });
	}

	function describePreset(preset: Preset): string {
		const parts: string[] = [];
		if (preset.provider && preset.model) parts.push(`${preset.provider}/${preset.model}`);
		if (preset.thinkingLevel) parts.push(`thinking ${preset.thinkingLevel}`);
		if (preset.tools) parts.push(`tools: ${preset.tools.join(",")}`);
		return parts.join(" · ") || "(current settings)";
	}

	function updateStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus("presets", activeName ? ctx.ui.theme.fg("muted", `preset:${activeName}`) : undefined);
	}

	pi.registerCommand("preset", {
		description: "Save, list, apply, or clear model/thinking/tool presets",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const subcommand = parts.shift();

			if (!subcommand || subcommand === "list") {
				const lines = [...saved.entries()].map(([name, preset]) => `${name}: ${describePreset(preset)}`);
				ctx.ui.notify([`Active: ${activeName ?? "none"}`, ...lines].join("\n"), "info");
				return;
			}

			if (subcommand === "save") {
				const name = parts.shift();
				if (!name) {
					ctx.ui.notify("Usage: /preset save <name>", "error");
					return;
				}
				const preset: Preset = {
					provider: ctx.model?.provider,
					model: ctx.model?.id,
					thinkingLevel: pi.getThinkingLevel(),
					tools: pi.getActiveTools(),
				};
				saved.set(name, preset);
				pi.appendEntry("preset-state", { saved: { name, preset } });
				ctx.ui.notify(`Preset "${name}" saved: ${describePreset(preset)}`, "info");
				return;
			}

			if (subcommand === "off") {
				if (!originalState) {
					ctx.ui.notify("No preset is active", "info");
					return;
				}
				if (originalState.model) await pi.setModel(originalState.model);
				pi.setThinkingLevel(originalState.thinkingLevel);
				pi.setActiveTools(originalState.tools);
				activeName = undefined;
				pi.appendEntry("preset-state", { active: "" });
				updateStatus(ctx);
				ctx.ui.notify("Preset cleared; original settings restored", "info");
				return;
			}

			const preset = saved.get(subcommand);
			if (!preset) {
				ctx.ui.notify(`Unknown preset "${subcommand}". Available: ${[...saved.keys()].join(", ") || "(none saved)"}`, "error");
				return;
			}
			await applyPreset(subcommand, preset, ctx);
			updateStatus(ctx);
			ctx.ui.notify(`Preset "${subcommand}" activated`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== "preset-state") continue;
			const data = entry.data as StateEntryData;
			if (data.saved) saved.set(data.saved.name, data.saved.preset);
			if (data.active !== undefined) activeName = data.active || undefined;
		}
		updateStatus(ctx);
	});
}
