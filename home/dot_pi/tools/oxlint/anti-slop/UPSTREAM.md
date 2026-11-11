# anti-slop Oxlint plugin

Source: [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop).

Installed 2026-11-11 by copying the plugin bundled with the `install-anti-slop`
skill (`~/.agents/skills/install-anti-slop/scripts/install.mjs`) into
`tools/oxlint/anti-slop/`.

Exact upstream revision: **unknown**. The skill bundle carries no commit,
version, or package metadata, so the copied tree cannot be pinned to a
revision. The bundled copy was produced from upstream between 2026-10-14 (skill
file mtime) and the install date above.

Installed paths:

- `tools/oxlint/anti-slop/index.ts` — generic plugin, registered as `anti-slop`.
- `tools/oxlint/anti-slop/rules/` — 18 rules, all enabled at `error`.
- `tools/oxlint/anti-slop/shared/`, `tools/oxlint/anti-slop/vendor/` — rule
  internals and the ESLint Stylistic `padding-line-between-statements` port.
  See `vendor/eslint-stylistic/UPSTREAM.md` for that subset's own provenance.
- `tools/oxlint/anti-slop/effect/index.ts` — Effect plugin, **not registered**:
  this repository has no direct `effect` dependency and the rules were not
  requested.

Configuration lives in `.oxlintrc.json` at the repository root, with `oxlint`
and `@oxlint/plugins` pinned to the same exact version so the two move together.

## Local adaptations

None in the copied source: the plugin is vendored verbatim. Local decisions are
configuration only:

- `jsPlugins` entry `anti-slop` → `./tools/oxlint/anti-slop/index.ts`.
- `ignorePatterns` keeps `tools/oxlint/anti-slop/**` (vendored, not application
  source) and `agent/npm/**` (second dependency tree) out of the lint run, plus
  the project-local agent tooling directories listed by the install skill.
- `agent/extensions/herdr-agent-state.ts` is ignored: herdr generates it,
  overwrites it on upgrade, and it carries `// @ts-nocheck`.
- `agent/extensions/subagent/**` is ignored: both files are symlinks into
  `@earendil-works/pi-coding-agent/examples/extensions/subagent`.
- `tsconfig.json` excludes `tools/oxlint/anti-slop` and
  `agent/extensions/subagent` for the same two reasons.
