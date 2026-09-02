import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionCommandContext,
	Skill,
} from "@earendil-works/pi-coding-agent";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const STATE_TYPE = "skill-toggler-config";
const STATUS_KEY = "skill-toggler";
const SKILL_SECTION_RE =
	/\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?<\/available_skills>/;

interface SkillTogglerState {
	disabledSkills: string[];
}

/**
 * Toggle which skills Pi advertises automatically.
 * Disabled skills stay discoverable via /skill:name – they are just removed
 * from the auto-invocation catalogue. State is session-scoped.
 */
export default function skillToggler(pi: ExtensionAPI) {
	let disabled = new Set<string>();
	let known: Skill[] = [];

	function persist(): void {
		pi.appendEntry<SkillTogglerState>(STATE_TYPE, { disabledSkills: [...disabled].sort() });
	}

	function restore(ctx: ExtensionContext): void {
		disabled = new Set<string>();
		for (const e of ctx.sessionManager.getBranch()) {
			if (e.type !== "custom" || e.customType !== STATE_TYPE) continue;
			const d = e.data as Partial<SkillTogglerState> | undefined;
			if (Array.isArray(d?.disabledSkills))
				disabled = new Set(d.disabledSkills.filter((n): n is string => typeof n === "string"));
		}
	}

	function active(skills: Skill[]): Skill[] {
		return skills.filter((s) => !disabled.has(s.name));
	}

	function autoAvailable(skills: Skill[]): Skill[] {
		return active(skills).filter((s) => !s.disableModelInvocation);
	}

	function updateStatus(ctx: ExtensionContext, skills = known): void {
		if (skills.length === 0) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		const enabled = autoAvailable(skills).length;
		const total = skills.filter((s) => !s.disableModelInvocation).length;
		const off = total - enabled;
		const label =
			off > 0
				? `skills ${enabled}/${total} · ${ctx.ui.theme.fg("warning", `${off} off`)}`
				: `skills ${enabled}/${total}`;
		// strip ANSI for status? theme.fg already handles, keep as is for TUI footer
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("muted", label));
	}

	function replaceSection(prompt: string, skills: Skill[]): string {
		if (!SKILL_SECTION_RE.test(prompt)) return prompt;
		return prompt.replace(SKILL_SECTION_RE, formatSkillsForPrompt(active(skills)));
	}

	// --- text-mode helpers ---

	function listText(skills: Skill[]): string {
		const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
		return sorted
			.map((s) => {
				if (s.disableModelInvocation) return `⊘ ${s.name}  (manual-only) — ${s.description}`;
				const on = !disabled.has(s.name);
				return `${on ? "◉" : "○"} ${s.name}  — ${s.description}`;
			})
			.join("\n");
	}

	function handleTextArgs(args: string, skills: Skill[], ctx: ExtensionCommandContext): boolean {
		const raw = args.trim();
		if (!raw || raw === "list" || raw === "ls" || raw === "help" || raw === "--help") {
			if (raw.startsWith("help") || raw.startsWith("--")) {
				ctx.ui.notify(
					[
						"/skills              open picker (TUI) or list",
						"/skills list         list all skills",
						"/skills info <name>  show full description + location",
						"/skills enable <name>  enable one or more skills",
						"/skills disable <name> disable one or more skills",
						"/skills toggle <name>  toggle",
						"/skills reset        enable all",
						"/skills off <name>   alias for disable",
						"/skills on <name>    alias for enable",
					].join("\n"),
					"info",
				);
				return true;
			}
			if (skills.length === 0) ctx.ui.notify("No skills loaded", "info");
			else ctx.ui.notify(listText(skills), "info");
			return true;
		}

		const parts = raw.split(/\s+/);
		const cmd = parts.shift()!.toLowerCase();
		const names = parts.map((n) => n.toLowerCase());

		const find = (n: string) => skills.find((s) => s.name.toLowerCase() === n);

		if (cmd === "info" || cmd === "show" || cmd === "detail" || cmd === "desc") {
			if (names.length === 0) {
				ctx.ui.notify("Usage: /skills info <skill-name> [...]  (show full description)", "error");
				return true;
			}
			for (const n of names) {
				const s = find(n);
				if (!s) {
					ctx.ui.notify(`Unknown skill "${n}"`, "warning");
					continue;
				}
				const state = s.disableModelInvocation ? "manual-only" : disabled.has(s.name) ? "disabled" : "enabled";
				ctx.ui.notify(`[${state}] ${s.name}\n${s.description}\n${s.filePath}`, "info");
			}
			return true;
		}

		if (cmd === "reset" || cmd === "clear") {
			disabled.clear();
			persist();
			updateStatus(ctx, skills);
			ctx.ui.notify("All skills enabled", "info");
			return true;
		}

		// enable/disable all must be checked before generic enable/disable
		if (cmd === "enable-all" || cmd === "disable-all" || (names[0] === "all" && (cmd === "enable" || cmd === "on" || cmd === "disable" || cmd === "off"))) {
			const enable = cmd.startsWith("enable") || cmd === "on";
			let c = 0;
			for (const s of skills) {
				if (s.disableModelInvocation) continue;
				if (enable) { if (disabled.delete(s.name)) c++; }
				else { if (!disabled.has(s.name)) { disabled.add(s.name); c++; } }
			}
			if (c) { persist(); updateStatus(ctx, skills); }
			ctx.ui.notify(c ? `${enable ? "Enabled" : "Disabled"} ${c} skill(s)` : `All toggleable skills already ${enable ? "enabled" : "disabled"}`, "info");
			return true;
		}

		if (["enable", "on", "disable", "off", "toggle"].includes(cmd)) {
			if (names.length === 0) {
				ctx.ui.notify(`Usage: /skills ${cmd} <skill-name> [...]`, "error");
				return true;
			}
			let changed = 0;
			for (const n of names) {
				const s = find(n);
				if (!s) {
					ctx.ui.notify(`Unknown skill "${n}"`, "warning");
					continue;
				}
				if (s.disableModelInvocation) {
					ctx.ui.notify(`"${s.name}" is manual-only and cannot be toggled`, "warning");
					continue;
				}
				if (cmd === "enable" || cmd === "on") {
					if (disabled.delete(s.name)) changed++;
				} else if (cmd === "disable" || cmd === "off") {
					if (!disabled.has(s.name)) {
						disabled.add(s.name);
						changed++;
					}
				} else {
					if (disabled.has(s.name)) disabled.delete(s.name);
					else disabled.add(s.name);
					changed++;
				}
			}
			if (changed > 0) {
				persist();
				updateStatus(ctx, skills);
				ctx.ui.notify(`${changed} skill(s) updated. Changes apply next turn.`, "info");
			}
			return true;
		}

		return false;
	}

	pi.on("before_agent_start", async (event) => {
		const skills = event.systemPromptOptions.skills ?? [];
		known = skills;
		const next = replaceSection(event.systemPrompt, skills);
		if (next === event.systemPrompt) return;
		return { systemPrompt: next };
	});

	pi.registerCommand("skills", {
		description: "Enable/disable skills for automatic model invocation",
		handler: async (rawArgs, ctx) => {
			const skills = ctx.getSystemPromptOptions().skills ?? [];
			known = skills;

			if (skills.length === 0) {
				ctx.ui.notify("No skills are currently loaded", "info");
				return;
			}

			// handle explicit textual subcommands even in TUI
			if (rawArgs.trim() && handleTextArgs(rawArgs, skills, ctx)) return;

			// non-TUI fallback: list + hint
			if (ctx.mode !== "tui") {
				handleTextArgs("list", skills, ctx);
				ctx.ui.notify('Tip: /skills enable <name> | /skills disable <name> | /skills reset', "info");
				return;
			}

			const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
			const draft = new Set(disabled);
			let filter = "";
			let selected = 0;

			const filtered = (): Skill[] => {
				if (!filter) return sorted;
				const q = filter.toLowerCase();
				return sorted.filter(
					(s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
				);
			};

			const isToggleable = (s: Skill) => !s.disableModelInvocation;
			const isActive = (s: Skill) => isToggleable(s) && !draft.has(s.name);

			const changed = await ctx.ui.custom<boolean | undefined>(
				(tui, theme, _kb, done) => {
					const commit = (): void => {
						disabled = new Set([...draft].filter((n) => {
							const s = sorted.find((x) => x.name === n);
							return s ? isToggleable(s) : false;
						}));
						persist();
						updateStatus(ctx, skills);
						done(true);
					};

					const render = (width: number): string[] => {
						const list = filtered();
						const countTotal = sorted.filter(isToggleable).length;
						const countOn = sorted.filter((s) => isToggleable(s) && !draft.has(s.name)).length;
						const countOff = countTotal - countOn;

						const lines: string[] = [];
						const border = (c: string, fill = "─") => theme.fg("borderAccent", c + fill.repeat(Math.max(0, width - 2)) + (c === "╭" ? "╮" : c === "├" ? "┤" : "╯"));
						lines.push(border("╭"));

						const title = theme.bold(theme.fg("accent", "Skills"));
						const counts = theme.fg("dim", ` ${countOn}/${countTotal}`) + (countOff ? theme.fg("warning", ` · ${countOff} off`) : "");
						lines.push(truncateToWidth(`│ ${title}${counts}`, width - 1) + theme.fg("borderAccent", "│"));
						if (filter) {
							lines.push(
								truncateToWidth(
									`│ ${theme.fg("dim", "filter:")} ${theme.fg("accent", filter)} ${theme.fg("dim", `· ${list.length} match${list.length === 1 ? "" : "es"} · esc clear`)}`,
									width - 1,
								) + theme.fg("borderAccent", "│"),
							);
						} else {
							lines.push(
								truncateToWidth(
									`│ ${theme.fg("dim", "space toggle · enter save · esc cancel · type to filter · ctrl+a all on · ctrl+x all off")}`,
									width - 1,
								) + theme.fg("borderAccent", "│"),
							);
						}
						lines.push(border("├"));

						const maxRows = Math.min(list.length, 8);
						if (list.length === 0) {
							lines.push(truncateToWidth(`│ ${theme.fg("dim", filter ? `No matches for "${filter}"` : "No skills")}`, width - 1) + theme.fg("borderAccent", "│"));
						} else {
							// keep selected in view
							let first = Math.max(0, selected - maxRows + 1);
							if (first + maxRows > list.length) first = Math.max(0, list.length - maxRows);
							if (selected < first) selected = first;
							if (selected >= first + maxRows) selected = first + maxRows - 1;

							for (let i = first; i < Math.min(list.length, first + maxRows); i++) {
								const s = list[i];
								const sel = i === selected;
								const on = isActive(s);
								const toggleable = isToggleable(s);
								const prefix = sel ? theme.fg("accent", "› ") : "  ";
								const box = toggleable ? theme.fg(on ? "success" : "dim", on ? "◉" : "○") : theme.fg("dim", "⊘");
								const name = theme.fg(sel ? "text" : toggleable ? (on ? "text" : "muted") : "dim", s.name + (toggleable ? "" : " (manual)"));
								// description truncated to fit remaining width
								const used = 2 + 2 + visibleWidth(s.name) + (toggleable ? 0 : 9) + 3;
								const descAvail = Math.max(0, width - used - 6);
								const desc = descAvail > 8 ? theme.fg("dim", " — " + truncateToWidth(s.description.replace(/\s+/g, " "), descAvail)) : "";
								const row = `${prefix}${box} ${name}${desc}`;
								lines.push(truncateToWidth(`│ ${row}`, width - 1) + theme.fg("borderAccent", "│"));
							}
							if (list.length > maxRows) {
								const pos = `${first + 1}-${Math.min(list.length, first + maxRows)} of ${list.length}`;
								lines.push(truncateToWidth(`│ ${theme.fg("dim", pos)}`, width - 1) + theme.fg("borderAccent", "│"));
							}
							// ---- full description detail for selected ----
							const selSkill = list[selected];
							if (selSkill) {
								lines.push(border("├"));
								const avail = Math.max(12, width - 4);
								const fullDesc = selSkill.description.replace(/\s+/g, " ").trim();
								const wrapped = wrapTextWithAnsi(fullDesc, avail);
								const maxDescLines = 4;
								const toShow = wrapped.slice(0, maxDescLines);
								if (wrapped.length > maxDescLines) {
									const last = toShow.length - 1;
									toShow[last] = truncateToWidth(toShow[last], avail - 1) + "…";
								}
								for (const w of toShow) {
									lines.push(truncateToWidth(`│ ${theme.fg("dim", w)}`, width - 1) + theme.fg("borderAccent", "│"));
								}
								if (wrapped.length > maxDescLines) {
									lines.push(
										truncateToWidth(`│ ${theme.fg("dim", `… ${wrapped.length - maxDescLines} more — /skills info ${selSkill.name} for full`)}`, width - 1) +
											theme.fg("borderAccent", "│"),
									);
								}
								const loc = truncateToWidth(selSkill.filePath, avail);
								const state = selSkill.disableModelInvocation
									? theme.fg("warning", "manual-only")
									: isActive(selSkill)
										? theme.fg("success", "enabled · auto")
										: theme.fg("dim", "disabled · hidden");
								lines.push(truncateToWidth(`│ ${theme.fg("dim", loc)}  ${state}`, width - 1) + theme.fg("borderAccent", "│"));
							}
						}
						lines.push(border("╰", "─"));
						return lines;
					};

					const handleInput = (data: string): void => {
						const list = filtered();
						if (matchesKey(data, Key.escape)) {
							if (filter) { filter = ""; selected = 0; tui.requestRender(); return; }
							done(undefined); return;
						}
						if (matchesKey(data, Key.enter)) { commit(); return; }
						if (matchesKey(data, Key.up)) { selected = Math.max(0, selected - 1); tui.requestRender(); return; }
						if (matchesKey(data, Key.down)) { selected = Math.min(Math.max(0, list.length - 1), selected + 1); tui.requestRender(); return; }
						if (matchesKey(data, Key.home)) { selected = 0; tui.requestRender(); return; }
						if (matchesKey(data, Key.end)) { selected = Math.max(0, list.length - 1); tui.requestRender(); return; }
						if (matchesKey(data, Key.pageUp)) { selected = Math.max(0, selected - 10); tui.requestRender(); return; }
						if (matchesKey(data, Key.pageDown)) { selected = Math.min(Math.max(0, list.length - 1), selected + 10); tui.requestRender(); return; }
						if (matchesKey(data, Key.ctrl("u"))) { if (filter) { filter = ""; selected = 0; tui.requestRender(); } return; }
						if (matchesKey(data, Key.ctrl("a"))) {
							const target = filtered().filter(isToggleable);
							for (const s of target) draft.delete(s.name);
							tui.requestRender(); return;
						}
						if (matchesKey(data, Key.ctrl("x")) || matchesKey(data, Key.ctrl("d"))) {
							const target = filtered().filter(isToggleable);
							for (const s of target) draft.add(s.name);
							tui.requestRender(); return;
						}
						if (matchesKey(data, Key.backspace)) {
							if (filter) { filter = filter.slice(0, -1); selected = 0; tui.requestRender(); }
							return;
						}
						if (matchesKey(data, Key.space) || matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
							const s = list[selected];
							if (s && isToggleable(s)) {
								if (draft.has(s.name)) draft.delete(s.name);
								else draft.add(s.name);
								tui.requestRender();
							}
							return;
						}
						// typing -> filter (single printable, no ctrl/alt)
						// ignore if it was a known key combo above; otherwise treat as filter input
						const isCtrl = data.length > 1 && data.charCodeAt(0) < 32;
						if (!isCtrl && data.length === 1 && data >= " " && data <= "~") {
							// avoid adding space when it was toggle; already handled
							filter += data;
							selected = 0;
							tui.requestRender(); return;
						}
						// alt+? ignore
						tui.requestRender();
					};

					return { render, invalidate: () => undefined, handleInput };
				},
				{
					overlay: true,
					overlayOptions: {
						anchor: "center",
						width: "80%",
						minWidth: 64,
						maxHeight: "80%",
						margin: 2,
						visible: (w) => w >= 64,
					},
				},
			);

			if (changed) ctx.ui.notify("Skill settings saved. Changes apply next turn.", "info");
		},
	});

	pi.on("session_start", async (_e, ctx) => {
		restore(ctx);
		known = [];
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "skills: /skills"));
	});

	pi.on("session_tree", async (_e, ctx) => {
		restore(ctx);
		updateStatus(ctx);
	});
}
