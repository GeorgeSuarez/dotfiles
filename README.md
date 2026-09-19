# Dotfiles

My macOS dotfiles, managed with [chezmoi](https://chezmoi.io).

## Layout

```
<repo>/                  # git root; can be cloned anywhere
├── home/                # ← chezmoi sourceDir: every managed file lives here
│   ├── dot_zshrc → ~/.zshrc, dot_tmux.conf, dot_gitconfig
│   ├── dot_config/… (nvim, opencode, ghostty, herdr, starship)
│   ├── dot_agents/ → ~/.agents  (global agent skills)
│   └── dot_pi/ → ~/.pi  (Pi agent harness, not a Raspberry Pi)
├── Brewfile, install.sh, README.md, AGENTS.md  # scaffolding, never applied
└── .gitignore, .git
```

## What's tracked

- Shell: `.zshrc` (starship prompt), `.tmux.conf`, `.gitconfig` (`.zshenv`/`.zprofile` are machine-generated, not managed)
- `~/.config/nvim`, `~/.config/opencode` (`opencode.jsonc`, `tui.json`, plugins), `~/.config/ghostty`, `~/.config/herdr`, `~/.config/starship.toml`
- `~/.agents/` — global agent skills (shared across harnesses)
- `~/.pi/agent/` — pi-specific extensions, settings, prompts, tests

Excluded: `.ssh`, caches, logs, session history, machine-local files (see `~/.zshrc.local`).

## Bootstrap a new machine (repo can live anywhere)

```sh
git clone https://github.com/GeorgeSuarez/dotfiles.git ~/.local/share/chezmoi
cd ~/.local/share/chezmoi && ./install.sh
```

`install.sh` installs Homebrew deps, oh-my-zsh, tmux TPM, writes `~/.config/chezmoi/chezmoi.toml` pointing at this clone's `home/`, and runs `chezmoi apply`. Re-running it is safe.

## Workflow

- Edit configs in place as usual.
- `dotdiff` — review `chezmoi status` + `chezmoi diff` (live vs source).
- `chezmoi re-add <file>` — pull a live change you intend to keep back into the source.
- `sync-dotfiles` — review diff, then apply source -> live.
- `push-dotfiles` — review `git status`, stage tracked changes, review cached diff, commit, push.
