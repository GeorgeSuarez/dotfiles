import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionCommandContext,
	Skill,
} from "@earendil-works/pi-coding-agent";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const STATE_TYPE = "skill-toggler-config";
const STATUS_KEY = "skill-toggler";
const SKILL_SECTION_RE =
	/\n\nThe following skills provide specialized instructions for specific tasks\.[\s\S]*?<\/available_skills>/;

interface SkillTogglerState {
	disabledSkills: string[];
}

/**
 * Toggle which discovered skills Pi advertises to the model automatically.
 *
 * Skill files remain discovered when a skill is disabled, and explicit
 * /skill:name commands remain available when skill commands are enabled. This
 * only removes the skill from the automatic system-prompt catalogue. The
 * selection is stored in the session, so it follows branches and does not
 * modify a project's settings.
 */
export default function skillToggler(pi: ExtensionAPI) {
	let disabledSkills = new Set<string>();
	let knownSkills: Skill[] = [];

	function persistState(): void {
		pi.appendEntry<SkillTogglerState>(STATE_TYPE, {
			disabledSkills: [...disabledSkills].sort(),
		});
	}

	function restoreFromBranch(ctx: ExtensionContext): void {
		disabledSkills = new Set<string>();

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;

			const data = entry.data as Partial<SkillTogglerState> | undefined;
			if (Array.isArray(data?.disabledSkills)) {
				disabledSkills = new Set(
					data.disabledSkills.filter((name): name is string => typeof name === "string"),
				);
			}
		}
	}

	function activeSkills(skills: Skill[]): Skill[] {
		return skills.filter((skill) => !disabledSkills.has(skill.name));
	}

	function automaticallyAvailableSkills(skills: Skill[]): Skill[] {
		return activeSkills(skills).filter((skill) => !skill.disableModelInvocation);
	}

	function updateStatus(ctx: ExtensionContext, skills = knownSkills): void {
		if (skills.length === 0) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}

		const enabledCount = automaticallyAvailableSkills(skills).length;
		ctx.ui.setStatus(
			STATUS_KEY,
			ctx.ui.theme.fg("muted", `skills ${enabledCount}/${skills.length}`),
		);
	}

	function replaceSkillSection(systemPrompt: string, skills: Skill[]): string {
		if (!SKILL_SECTION_RE.test(systemPrompt)) return systemPrompt;
		return systemPrompt.replace(SKILL_SECTION_RE, formatSkillsForPrompt(activeSkills(skills)));
	}

	pi.on("before_agent_start", async (event) => {
		const skills = event.systemPromptOptions.skills ?? [];
		knownSkills = skills;

		const systemPrompt = replaceSkillSection(event.systemPrompt, skills);
		if (systemPrompt === event.systemPrompt) return;

		return { systemPrompt };
	});

	pi.registerCommand("skills", {
		description: "Enable or disable skills for automatic model invocation",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/skills requires TUI mode", "error");
				return;
			}

			const skills = ctx.getSystemPromptOptions().skills ?? [];
			knownSkills = skills;

			if (skills.length === 0) {
				ctx.ui.notify("No skills are currently loaded", "info");
				return;
			}

			const sortedSkills = [...skills].sort((a, b) => a.name.localeCompare(b.name));
			const draftDisabled = new Set(disabledSkills);

			const changed = await ctx.ui.custom<boolean | undefined>(
				(tui, theme, _keybindings, done) => {
					let selectedIndex = 0;

					const commit = (): void => {
						disabledSkills = new Set(draftDisabled);
						for (const skill of sortedSkills) {
							if (skill.disableModelInvocation) disabledSkills.add(skill.name);
						}
						persistState();
						updateStatus(ctx, skills);
					done(true);
					};

					const render = (width: number): string[] => {
						const innerWidth = Math.max(24, width - 4);
						const lines: string[] = [];
						const border = theme.fg("borderAccent", `╭${"─".repeat(Math.max(0, width - 2))}╮`);
						lines.push(border);
						lines.push(truncateToWidth(`│ ${theme.bold(theme.fg("accent", "Skill Configuration"))}`, width - 1) + theme.fg("borderAccent", "│"));
						lines.push(truncateToWidth(`│ ${theme.fg("dim", "Toggle skills for automatic model use")}`, width - 1) + theme.fg("borderAccent", "│"));
						lines.push(truncateToWidth(`│ ${theme.fg("dim", "↑↓ navigate  space toggle  enter save  esc cancel")}`, width - 1) + theme.fg("borderAccent", "│"));
						lines.push(theme.fg("borderAccent", `├${"─".repeat(Math.max(0, width - 2))}┤`));

						const maxRows = Math.max(1, Math.min(sortedSkills.length, 12));
						let firstRow = Math.max(0, selectedIndex - maxRows + 1);
						if (firstRow + maxRows > sortedSkills.length) firstRow = Math.max(0, sortedSkills.length - maxRows);

						for (let row = firstRow; row < Math.min(sortedSkills.length, firstRow + maxRows); row++) {
							const skill = sortedSkills[row];
							const isSelected = row === selectedIndex;
							const active = !draftDisabled.has(skill.name) && !skill.disableModelInvocation;
							const label = skill.disableModelInvocation ? `${skill.name} (manual-only)` : skill.name;
							const prefix = isSelected ? theme.fg("accent", "› ") : "  ";
							const radio = active ? "◉" : "○";
							const styledRadio = theme.fg(
								active ? "success" : "dim",
								radio,
							);
							const content = `${prefix}${styledRadio} ${theme.fg(isSelected ? "text" : "muted", label)}`;
							lines.push(truncateToWidth(`│ ${content}`, innerWidth + 1) + theme.fg("borderAccent", "│"));
						}

						if (sortedSkills.length > maxRows) {
							lines.push(truncateToWidth(`│ ${theme.fg("dim", `${firstRow + 1}-${Math.min(sortedSkills.length, firstRow + maxRows)} of ${sortedSkills.length}`)}`, width - 1) + theme.fg("borderAccent", "│"));
						}
						lines.push(theme.fg("borderAccent", `╰${"─".repeat(Math.max(0, width - 2))}╯`));
						return lines;
					};

					const handleInput = (data: string): void => {
						if (matchesKey(data, Key.escape)) {
							done(undefined);
							return;
						}
						if (matchesKey(data, Key.enter)) {
							commit();
							return;
						}
						if (matchesKey(data, Key.up)) {
							selectedIndex = Math.max(0, selectedIndex - 1);
						} else if (matchesKey(data, Key.down)) {
							selectedIndex = Math.min(sortedSkills.length - 1, selectedIndex + 1);
						} else if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || matchesKey(data, Key.space)) {
							const skill = sortedSkills[selectedIndex];
							if (!skill.disableModelInvocation) {
								if (draftDisabled.has(skill.name)) draftDisabled.delete(skill.name);
								else draftDisabled.add(skill.name);
							}
						}
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
						visible: (width) => width >= 64,
					},
				},
			);

			if (changed) ctx.ui.notify("Skill settings saved. Changes apply to the next agent turn.", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreFromBranch(ctx);
		knownSkills = [];
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", "skills: /skills"));
	});

	pi.on("session_tree", async (_event, ctx) => {
		restoreFromBranch(ctx);
		updateStatus(ctx);
	});
}
