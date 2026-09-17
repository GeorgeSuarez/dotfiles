# mise vs chezmoi — how mise works and how to migrate this repo

Research date: 2026-09-17. Primary sources only; links inline.
Your repo: `github.com/GeorgeSuarez/dotfiles` (`~/.local/share/chezmoi`), macOS-only,
no templates, `Brewfile` + `install.sh` bootstrap.

## TL;DR

- mise and chezmoi are **not the same tool**. mise = dev-tools + env vars + tasks
  in one `mise.toml` ([home](https://mise.en.dev/)). chezmoi = dotfiles
  source-state → home-directory manager
  ([concepts](https://www.chezmoi.io/reference/concepts/)).
- Community consensus is **keep both**: chezmoi owns files, mise owns tool
  versions ([Tom Meurs](https://tommeurs.nl/posts/dotfile-management-mise-chezmoi/),
  [mcowger gist](https://gist.github.com/mcowger/c807fd05283f3b2dade15bb5906fceba)).
- mise **just grew** dotfiles support (`mise dot`, `[dotfiles]` table,
  `mise bootstrap`) — symlink/copy/template/track modes
  ([dotfiles docs](https://mise.jdx.dev/dotfiles.html)). Full migration is now
  *possible* but you lose chezmoi's filename-attribute system and Go templates.
- Recommendation for this repo: **Path A (hybrid)**. One `~/.config/mise/config.toml`
  tracked by chezmoi, move versioned runtimes out of `Brewfile` into `[tools]`.
  Full-migration steps documented below as Path B if you want it.

## 1. How mise works

One CLI, three jobs, one config file per directory
([home](https://mise.en.dev/), [repo](https://github.com/jdx/mise)):

```toml
# mise.toml
[tools]
node = "24"
python = "3.13"

[env]
_.file = ".env.local"

[tasks.test]
run = "pytest"
```

1. **Dev tools.** Installs/switches runtimes (node, python, go, terraform, hundreds
   more). Versions declared in `[tools]`; `mise use node@26` installs *and* writes
   `mise.toml`, `mise install` installs all ([dev-tools](https://mise.en.dev/dev-tools/),
   [walkthrough](https://mise.en.dev/walkthrough.html)).
2. **Env vars.** `[env]` per-directory, plus `.env` files, `_.file`, `_.source`
   directives ([repo README](https://github.com/jdx/mise)).
3. **Tasks.** `[tasks.*]` with `run`/`depends`/`env`, or standalone scripts in
   `mise-tasks/`; run via `mise run <name>` ([tasks](https://mise.jdx.dev/tasks/),
   [toml-tasks](https://mise.en.dev/tasks/toml-tasks.html)).

Key mechanics:

- **Hierarchical config.** `mise.toml` / `mise.local.toml` / `.mise/config.toml` /
  `.config/mise.toml` walk *up* the tree and merge; closer files win. Global
  defaults live at `~/.config/mise/config.toml`
  ([configuration](https://mise.jdx.dev/configuration.html)).
- **Activation.** `eval "$(mise activate zsh)"` in rc hooks PATH/env refresh on
  every prompt; `cd` into a project auto-switches tools. Alternative: shims or
  one-shot `mise x -- <cmd>` ([getting-started](https://mise.jdx.dev/getting-started.html),
  [installing](https://mise.jdx.dev/installing-mise.html)).
- **Install → activate split.** `mise install node@20` only downloads to
  `~/.local/share/mise/installs`; a version must also be *set* in a config file
  to be on PATH — `mise use` does both ([dev-tools](https://mise.en.dev/dev-tools/)).
- **New: dotfiles.** `[dotfiles]` entries keyed by *target* path with
  `source`/`mode`/`content`/`exclude`/`variants`. Modes: `symlink` (default),
  `symlink-each`, `copy`, `template` (Tera engine), plus `track` for
  history-only versioning. `mise dot add/track/save/apply/status/diff/rollback`,
  watcher service `history-watch`, runs inside `mise bootstrap`
  ([dotfiles](https://mise.jdx.dev/dotfiles.html),
  [bootstrap](https://github.com/jdx/mise/blob/ecd3e2fd/docs/bootstrap.md)).

## 2. How chezmoi works (what you have today)

Declarative: **source state** (`~/.local/share/chezmoi`) + **config file**
(`~/.config/chezmoi/chezmoi.toml`) + destination state (`~`) → computed
**target state** → `chezmoi apply` writes minimal diff atomically
([concepts](https://www.chezmoi.io/reference/concepts/),
[how-it-works](https://twpayne-chezmoi.mintlify.app/concepts/how-chezmoi-works),
[setup](https://www.chezmoi.io/user-guide/setup/)).

- **Filename attributes.** `dot_` → leading dot, `executable_`, `private_`,
  `readonly_`, `encrypted_`, `exact_`, `create_`/`modify_`/`remove_`, `run_` /
  `run_once_` / `run_onchange_` / `run_before_` / `run_after_`, `symlink_`,
  `.tmpl` suffix = Go `text/template`
  ([attributes](https://www.chezmoi.io/reference/source-state-attributes/)).
- **No symlinks by default.** Generates regular files in place (enables
  encrypted/executable/private/templates), unlike Stow
  ([design FAQ](https://www.chezmoi.io/user-guide/frequently-asked-questions/design/)).
- **Single git repo = source of truth**, templates + per-machine config for
  divergence, secrets via age/gpg or password-manager integration, stays public-safe
  ([what-chezmoi-does](https://github.com/twpayne/chezmoi/blob/master/assets/chezmoi.io/docs/what-does-chezmoi-do.md)).

Your inventory (from source dir, 2026-09-17):

| Concern | Today |
|---|---|
| Shell | `dot_zshrc`, `dot_zshenv`, `dot_zprofile` (oh-my-zsh, starship, zsh plugins) |
| Editor/config | `dot_config/nvim/**`, `dot_config/opencode/`, `dot_config/ghostty/config`, `dot_config/herdr/config.toml`, `dot_config/starship.toml`→`~/.config/starship.toml` |
| Misc | `dot_tmux.conf`, `dot_gitconfig`, `dot_pi/**`, `dot_agents/` |
| Tool install | `Brewfile` (chezmoi, git, gh, tmux, neovim, starship, bun, node, openjdk, ripgrep, fd, lazygit, zsh-*, herdr, bitwarden-cli, ghostty + font casks) + `install.sh` (Homebrew → `brew bundle` → oh-my-zsh → TPM → `chezmoi apply`) |
| Conventions | No `.tmpl` (per `AGENTS.md`); `~/.zshrc.local` machine-local; `sync-dotfiles` = `re-add && diff && apply`; repo-only files excluded via `.chezmoiignore` |

## 3. Gap analysis: what migrates 1:1 and what doesn't

| chezmoi feature | mise equivalent | Friction |
|---|---|---|
| `dot_*` files → `~` | `[dotfiles]` `symlink`/`copy` ([dotfiles](https://mise.jdx.dev/dotfiles.html)) | Low for plain files; rename `dot_zshrc` → `~/.dotfiles/.zshrc`, add entry |
| Whole-dir (`dot_config/nvim`) | `mode = "symlink"` on directory, or `symlink-each` to leave neighbors alone | Low |
| `.tmpl` Go templates | `mode = "template"` with Tera + `{{ env.VAR }}`, `exec()`, `secret()` | Medium — rewrite templates; you have none, so ~zero cost |
| `run_once_before/after_*` scripts | `mise bootstrap` + `[tasks]` / pre/post-dotfiles hooks ([bootstrap](https://github.com/jdx/mise/blob/ecd3e2fd/docs/bootstrap.md)) | Medium — rewire `install.sh` |
| `private_/readonly_/encrypted_` | `content` writes `0600`; tracking `encrypt` via `[history.encryption]`; no per-file mode prefixes | Medium — secrets story is weaker/newer |
| `exact_` dirs, `modify_`, `.chezmoiignore`, `.chezmoiexternal` | `exclude`, `manifest = "git"`, `variants` (os/profile) | Medium — different model, no exact equivalent for `modify_` |
| `chezmoi diff/edit/apply`, persistent SHA state | `mise dot diff/status/apply`, `mise dot save/history/rollback/undo`, watcher service | Low conceptually, new commands |
| `Brewfile` (tools) | `[tools]` + `mise install` ([dev-tools](https://mise.en.dev/dev-tools/)) | **This is the win** — pin `node/python/go/...` per project, not just brew latest |

## 4. Path A — hybrid (recommended, ~30 min)

Keep chezmoi for files; add mise for tools. This is the documented combo
([Tom Meurs](https://tommeurs.nl/posts/dotfile-management-mise-chezmoi/)).

1. Install mise, activate in zsh (after starship block in `dot_zshrc`):
   ```sh
   curl https://mise.run | sh
   echo 'eval "$(~/.local/bin/mise activate zsh)"' >> ~/.zshrc
   mise doctor
   ```
   ([getting-started](https://mise.jdx.dev/getting-started.html)).
2. Create global tools config and track it with chezmoi:
   ```sh
   mkdir -p ~/.config/mise && cat >> ~/.config/mise/config.toml <<'EOF'
   [tools]
   node = "lts"
   python = "3.13"
   go = "1.22"
   bun = "latest"
   neovim = "latest"
   EOF
   mise install
   chezmoi add ~/.config/mise/config.toml
   ```
   Keep GUI/system packages (ghostty cask, fonts) in `Brewfile`; move *versioned
   runtimes* to `[tools]`.
3. Bootstrap ordering with two scripts in source root
   ([combo pattern](https://tommeurs.nl/posts/dotfile-management-mise-chezmoi/)):
   `run_once_before_10-install-mise.sh` (`curl https://mise.run | sh` if missing),
   `run_after_90-mise-install.sh` (`mise install`).
4. Workflow becomes `chezmoi update && mise upgrade` per machine.

You keep: templates-if-needed-later, `private_` secrets, `chezmoi diff`,
one-command `install.sh`. You gain: per-project tool pins, `[env]`, `[tasks]`.

## 5. Path B — full move to mise dotfiles (experimental)

Only if you want one tool. Expect paper cuts; `mise dot` is new (Sept 2026 docs).

1. `curl https://mise.run | sh`, activate, `mise doctor` as above.
2. Seed sources from live files (defaults to `symlink` under `~/.dotfiles`):
   ```sh
   mise dot add ~/.zshrc ~/.zshenv ~/.zprofile ~/.tmux.conf ~/.gitconfig
   mise dot add ~/.config/nvim ~/.config/ghostty ~/.config/herdr ~/.config/starship.toml
   ```
   (`add` moves file → source, writes `[dotfiles]` entry, applies;
   `--mode copy` for files apps rewrite; `--no-apply` to review first
   ([dotfiles](https://mise.jdx.dev/dotfiles.html))).
3. Convert leftovers by hand: machine-local `~/.zshrc.local` → tracking
   `exclude` or `mode = "track"` + `autosave = false`; per-OS paths → `variants`
   with `os = "macos"|"linux"`; secrets → `[history.encryption]` + `--encrypt`
   *before* first save (private repo required).
4. Replace `install.sh`/`Brewfile` with `mise bootstrap`: `[tools]` for runtimes,
   bootstrap packages for brew/cask equivalents, pre/post-dotfiles hooks for
   oh-my-zsh/TPM clones. New machine: clone repo → `mise bootstrap`
   ([bootstrap/setup](https://mise.jdx.dev/dotfiles.html),
   [bootstrap doc](https://github.com/jdx/mise/blob/ecd3e2fd/docs/bootstrap.md)).
5. Enable history: `[bootstrap.services.mise-history] builtin = "history-watch"`,
   `mise bootstrap services apply`, `mise dot track` per file, set origin + sync.
6. Decommission: `chezmoi apply` one last time, verify `mise dot status` clean,
   `brew uninstall chezmoi`, archive dotfiles repo, keep `~/.local/share/chezmoi`
   backup until two machines prove clean.

What you lose: filename-attribute model, Go templates, `exact_`/`modify_`,
mature `chezmoi edit/diff/merge` flow, big community recipe base
([attributes](https://www.chezmoi.io/reference/source-state-attributes/),
[design](https://www.chezmoi.io/user-guide/frequently-asked-questions/design/)).

## 6. Recommendation for *this* repo

Do Path A. Your chezmoi is simple (no templates), healthy, and already encodes
macOS bootstrap (`Brewfile` + TPM + oh-my-zsh). A full rewrite buys one fewer
binary at the cost of re-implementing secrets handling, bootstrap ordering, and
~222 managed files under a brand-new subsystem. Revisit Path B in 6–12 months
once `mise dot` stabilizes — your template-free layout will make that move cheap
when/if you want it.

---
Sources: [mise home](https://mise.en.dev/) · [dev-tools](https://mise.en.dev/dev-tools/) ·
[configuration](https://mise.jdx.dev/configuration.html) · [walkthrough](https://mise.en.dev/walkthrough.html) ·
[getting-started](https://mise.jdx.dev/getting-started.html) · [installing](https://mise.jdx.dev/installing-mise.html) ·
[tasks](https://mise.jdx.dev/tasks/) · [dotfiles](https://mise.jdx.dev/dotfiles.html) ·
[bootstrap](https://github.com/jdx/mise/blob/ecd3e2fd/docs/bootstrap.md) ·
[chezmoi concepts](https://www.chezmoi.io/reference/concepts/) ·
[how-chezmoi-works](https://twpayne-chezmoi.mintlify.app/concepts/how-chezmoi-works) ·
[source-state-attributes](https://www.chezmoi.io/reference/source-state-attributes/) ·
[setup](https://www.chezmoi.io/user-guide/setup/) ·
[what-chezmoi-does](https://github.com/twpayne/chezmoi/blob/master/assets/chezmoi.io/docs/what-does-chezmoi-do.md) ·
[combo: Meurs](https://tommeurs.nl/posts/dotfile-management-mise-chezmoi/) ·
[combo: gist](https://gist.github.com/mcowger/c807fd05283f3b2dade15bb5906fceba)
