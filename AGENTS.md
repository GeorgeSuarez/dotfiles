# AGENTS.md

macOS dotfiles managed with [chezmoi](https://chezmoi.io). Tooling comes from the `Brewfile`; there is no build/test/lint step.

## Chezmoi naming (files here are NOT named like the files they manage)

- `dot_*` → `~/.` (e.g. `dot_zshrc` → `~/.zshrc`); a `dot_config/` dir → `~/.config/` (nvim, opencode, herdr)
- `private_*` → applied with mode 0600; `private_Library/private_Application Support/` → `~/Library/Application Support/` (ghostty)
- No `.tmpl` templates are used; never add one without introducing template data too
- `dot_pi/` is a Raspberry Pi's config, not macOS

## Sync workflow — the repo and live config both change

- `~/.zshrc` defines the two aliases: `sync-dotfiles` (`chezmoi re-add && chezmoi diff && chezmoi apply`) and `push-dotfiles` (`chezmoi cd`, git add/stage/`git commit` — opens `$EDITOR` — `git push`)
- Two directions: editing a repo file must be followed by `chezmoi apply` to reach the live config; editing a live config (e.g. `nvim` settings) is pulled back with `chezmoi re-add`
- `~/.zshrc.local` is machine-local, never synced (sourced from `~/.zshrc`); keep it out of the repo
- Commits use conventional style: `feat(pi):`, `chore(nvim):`, `chore(ghostty):`

## Gotchas

- `dot_pi/agent/private_auth.json` and `private_models-store.json` are secrets — untracked and not in `.gitignore`, so `push-dotfiles` would stage them; never `git add` or commit them
- `README.md`, `Brewfile`, `install.sh`, `node_modules/`, `*.log` are ignored by `.chezmoiignore` (repo-only, never applied to home); add new dependencies to `Brewfile`, not install.sh
- `dot_config/opencode/` is the live opencode config (plugins, `opencode.jsonc`); edits need `chezmoi apply` plus a restart to take effect
- Neovim changes: read `dot_config/nvim/AGENTS.md` first — the config follows its own conventions (stylua, lazy.nvim)