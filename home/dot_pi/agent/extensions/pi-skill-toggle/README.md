# pi-skill-toggle

Interactive overlay for hiding skills from automatic model selection without deleting them.

```text
/toggle-skills
```

Opens a two-pane overlay listing every skill Pi can discover:

| Pane | Content |
| --- | --- |
| Left | Skill list with mode box, `*` change marker, and `read-only` badge |
| Right | Full path, source root, description, and frontmatter diagnostics |

Keys: type to filter, `↑`/`↓` to move, `space` to toggle, `ctrl+s` to apply and reload, `esc` to cancel.

Toggling writes `disable-model-invocation: true` into the skill's YAML frontmatter. Per [Pi's skills documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md), that hides the skill from automatic model selection while `/skill:<name>` still works. Turning a skill back on removes the key.

## Sources

Skills are discovered from four roots, in this order, with duplicate canonical paths collapsed:

| Kind | Root | Root `.md` files |
| --- | --- | --- |
| `user` | `$PI_CODING_AGENT_DIR/skills` (default `~/.pi/agent/skills`) | yes |
| `global` | `~/.agents/skills` | no |
| `project` | `<cwd>/.pi/skills` | yes |
| `project-legacy` | `<cwd>/.agents/skills` | no |

Symlinked skill directories and files are resolved through `realpath`, so a skill linked from `~/.pi/agent/skills/x` to `~/.agents/skills/x` appears once.

## Safety

- Files are written through the `FileSystem` port via temp-file + rename (`writeFileAtomic`), preserving the original mode.
- The writer re-reads each file before applying and skips the change if the file moved on while the overlay was open.
- A skill is read-only when it is not writable, has no frontmatter, or has an error-severity diagnostic. Read-only skills cannot be toggled.
- Duplicate `disable-model-invocation` keys are an error in Pi; the patcher collapses them to one on the next toggle.

## Layout

```text
src/
├── index.ts              # wires ports and registers /toggle-skills
├── command.ts            # load → overlay → plan → write → reload
├── types.ts              # domain types and result unions
├── discovery/pi-paths.ts # four skill roots, env-aware
├── discovery/skill-locator.ts
├── inventory/loader.ts   # LocatedSkillFile → SkillRecord
├── inventory/classifier.ts
├── frontmatter/parser.ts # offset-preserving frontmatter codec
├── frontmatter/patcher.ts# minimal text patch, no re-serialization
├── frontmatter/validation.ts
├── apply/planner.ts      # SkillRecord + SkillDraft → SkillChange
├── apply/writer.ts       # atomic, conflict-checked writes
├── ports/fs.ts           # FileSystem interface + Node implementation
└── ui/{overlay,render,view-model}.ts
```

Tests live in the repo's `tests/` directory as `pi-skill-toggle.test.mjs`, not next to the source.

## Notes

- Frontmatter is patched as text, not parsed and re-serialized, so comments, key order, and quote style survive.
- `/toggle-skills` requires interactive mode and refuses to run headless.
